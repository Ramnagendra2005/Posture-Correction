from flask import Flask, jsonify, Response
from flask_cors import CORS
import cv2
import mediapipe as mp
import math
import numpy as np
import time
import json
from threading import Lock, Event, Thread
import os as _os
import requests as _requests

app = Flask(__name__)
CORS(app)

# -------------------------------
# Initialize MediaPipe components
# -------------------------------
mp_pose = mp.solutions.pose
pose_front = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)

mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(min_detection_confidence=0.5, min_tracking_confidence=0.5)

# -------------------------------
# Auto-framing parameters
# -------------------------------
frame_size = (640, 480)
auto_frame_margin = 50
min_visibility = 0.6
prediction_horizon = 0.2
dt = 1.0 / 30
kalman_process_noise = 1e-2
kalman_measure_noise = 1e-1

# -------------------------------
# Global variables for tracking
# -------------------------------
current_feedback = []
blink_count = 0
start_time = time.time()
feedback_lock = Lock()
camera_active = False
camera_lock = Lock()
current_session_data = {
    "session_id": None,
    "start_time": None,
    "scores": [],
    "feedback_history": [],
    "blink_rate": 0
}

# -------------------------------
# Tracked time (append-only)
# -------------------------------
_tracked_time_lock = Lock()
_tracked_time_json_path = _os.path.join(_os.path.dirname(__file__), "tracked_time.json")

_tracked_state = {
    "date": None,                # 'YYYY-MM-DD'
    "todays_seconds": 0.0,       # persisted daily total
    "session_seconds": 0.0,      # in-memory current session time
    "known_session_start": None, # to detect session restarts
    "last_tick": time.time(),
    "_since_last_persist": 0.0,
    "_since_last_sync": 0.0
}

def _today_str():
    return time.strftime("%Y-%m-%d")

def _load_tracked_time():
    try:
        with open(_tracked_time_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)  # Changed from _json.load to json.load
    except Exception:
        data = {}
    today = _today_str()
    date = data.get("date")
    secs = float(data.get("todays_seconds", 0.0))
    if date != today:
        date, secs = today, 0.0
    with _tracked_time_lock:
        _tracked_state["date"] = date
        _tracked_state["todays_seconds"] = secs
        _tracked_state["session_seconds"] = 0.0
        _tracked_state["known_session_start"] = None
        _tracked_state["last_tick"] = time.time()
        _tracked_state["_since_last_persist"] = 0.0
        _tracked_state["_since_last_sync"] = 0.0

def _persist_tracked_time():
    with _tracked_time_lock:
        payload = {
            "date": _tracked_state["date"] or _today_str(),
            "todays_seconds": round(_tracked_state["todays_seconds"], 3)
        }
    try:
        with open(_tracked_time_json_path, "w", encoding="utf-8") as f:
            json.dump(payload, f)  # Changed from _json.dump to json.dump
    except Exception:
        pass

def _sync_tracked_time_to_db():
    try:
        import requests as _requests
    except Exception:
        return
    node_base = _os.environ.get("NODE_API_BASE", "http://localhost:3001").rstrip("/")
    user_id = _os.environ.get("POSTURE_USER_ID", "flask-user")
    with _tracked_time_lock:
        body = {
            "user_id": user_id,
            "date": _tracked_state["date"] or _today_str(),
            "todays_time_tracked_seconds": float(_tracked_state["todays_seconds"]),
            "current_session_time_seconds": float(_tracked_state["session_seconds"])
        }
    try:
        _requests.post(f"{node_base}/api/posture/tracked-time", json=body, timeout=2.0)
    except Exception:
        pass

def _tracked_time_loop(stop_evt: Event):
    _load_tracked_time()
    interval = 1.0
    while not stop_evt.is_set():
        t0 = time.time()
        now = time.time()
        with _tracked_time_lock:
            delta = max(0.0, now - _tracked_state["last_tick"])
            _tracked_state["last_tick"] = now
        # daily rollover
        today = _today_str()
        with _tracked_time_lock:
            if _tracked_state["date"] != today:
                _tracked_state["date"] = today
                _tracked_state["todays_seconds"] = 0.0
        # read camera/session without modifying existing logic
        with camera_lock:
            _active = camera_active
        _session_start = current_session_data.get("start_time")
        # detect new session
        with _tracked_time_lock:
            if _active and _session_start and _tracked_state["known_session_start"] != _session_start:
                _tracked_state["session_seconds"] = 0.0
                _tracked_state["known_session_start"] = _session_start
        # accumulate when active
        if _active:
            with _tracked_time_lock:
                _tracked_state["todays_seconds"] += delta
                _tracked_state["session_seconds"] += delta
                _tracked_state["_since_last_persist"] += delta
                _tracked_state["_since_last_sync"] += delta
        do_persist = do_sync = False
        with _tracked_time_lock:
            if _tracked_state["_since_last_persist"] >= 5.0:
                _tracked_state["_since_last_persist"] = 0.0
                do_persist = True
            if _tracked_state["_since_last_sync"] >= 5.0:
                _tracked_state["_since_last_sync"] = 0.0
                do_sync = True
        if do_persist:
            _persist_tracked_time()
        if do_sync:
            _sync_tracked_time_to_db()
        elapsed = time.time() - t0
        time.sleep(max(0.0, interval - elapsed))

_tracker_stop_evt = Event()
_tracker_thread = None

# Flask 2.0+ uses before_request instead of before_first_request
@app.before_request
def _start_tracked_time_loop():
    global _tracker_thread
    if _tracker_thread is None or not _tracker_thread.is_alive():
        _tracker_thread = Thread(target=_tracked_time_loop, args=(_tracker_stop_evt,), daemon=True)
        _tracker_thread.start()

# -------------------------------
# Utility functions
# -------------------------------
def calculate_distance(p1, p2):
    """Calculate Euclidean distance between two points."""
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)

def eye_aspect_ratio(landmarks, left_indices, right_indices):
    """Calculate eye aspect ratio for blink detection."""
    left_eye = [landmarks[i] for i in left_indices]
    right_eye = [landmarks[i] for i in right_indices]
    
    def eye_ratio(eye):
        return (math.dist((eye[1].x, eye[1].y), (eye[5].x, eye[5].y)) +
                math.dist((eye[2].x, eye[2].y), (eye[4].x, eye[4].y))) / (
                2.0 * math.dist((eye[0].x, eye[0].y), (eye[3].x, eye[3].y)))
    
    return (eye_ratio(left_eye) + eye_ratio(right_eye)) / 2.0

def calculate_angle(a, b, c):
    """Calculate angle between three points."""
    a, b, c = np.array(a), np.array(b), np.array(c)
    ba = a - b
    bc = c - b
    cosine_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc))
    angle = np.degrees(np.arccos(np.clip(cosine_angle, -1.0, 1.0)))
    return angle

# -------------------------------
# Kalman filter for smoothing bbox
# -------------------------------
class KalmanBoxFilter:
    def __init__(self):
        self.kf = cv2.KalmanFilter(8, 4)
        self.kf.measurementMatrix = np.eye(4, 8, dtype=np.float32)
        F = np.eye(8, dtype=np.float32)
        for i in range(4):
            F[i, i+4] = dt
        self.kf.transitionMatrix = F
        self.kf.processNoiseCov = np.eye(8, dtype=np.float32) * kalman_process_noise
        self.kf.measurementNoiseCov = np.eye(4, dtype=np.float32) * kalman_measure_noise
        self.initialized = False

    def correct(self, meas):
        z = np.array(meas, dtype=np.float32).reshape(4,1)
        if not self.initialized:
            self.kf.statePost[:4,0] = z[:,0]
            self.kf.statePost[4:,0] = 0
            self.initialized = True
        return self.kf.correct(z)

    def predict(self, horizon=0.0):
        if horizon > 0:
            Fh = np.eye(8, dtype=np.float32)
            for i in range(4):
                Fh[i, i+4] = horizon
            self.kf.transitionMatrix = Fh
        p = self.kf.predict()
        for i in range(4):
            self.kf.transitionMatrix[i, i+4] = dt
        return p[:4,0].tolist()

kf_box = KalmanBoxFilter()
current_frame_rect = None
auto_frame_enabled = True

# -------------------------------
# Auto-framing functions
# -------------------------------
def get_person_bounding_box(pose_landmarks, frame_shape):
    """Get bounding box around detected person."""
    if not pose_landmarks:
        return None

    h, w = frame_shape[:2]
    pts = [(lm.x * w, lm.y * h) 
           for lm in pose_landmarks.landmark 
           if lm.visibility >= min_visibility]
    if not pts:
        return None

    xs, ys = zip(*pts)
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)

    pad_x = (x2 - x1) * 0.25 + auto_frame_margin
    pad_y = (y2 - y1) * 0.25 + auto_frame_margin

    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(w, x2 + pad_x)
    y2 = min(h, y2 + pad_y)

    return [int(x1), int(y1), int(x2 - x1), int(y2 - y1)]

def apply_auto_framing(frame, pose_results):
    """Apply auto-framing to the video feed."""
    global current_frame_rect, kf_box

    h, w = frame.shape[:2]
    
    if getattr(pose_results, "pose_landmarks", None):
        meas = get_person_bounding_box(pose_results.pose_landmarks, frame.shape)
        if meas:
            kf_box.correct(meas)
            x, y, bw, bh = kf_box.predict(horizon=prediction_horizon)
            
            aspect = w / h
            if bw / bh > aspect:
                nw, nh = bw, bw / aspect
            else:
                nw, nh = bh * aspect, bh
            
            cx, cy = x + bw / 2, y + bh / 2
            fx = np.clip(cx - nw/2, 0, w - nw)
            fy = np.clip(cy - nh/2, 0, h - nh)
            current_frame_rect = [int(fx), int(fy), int(nw), int(nh)]

    if current_frame_rect and auto_frame_enabled:
        x, y, cw, ch = current_frame_rect
        x = int(np.clip(x, 0, w - cw))
        y = int(np.clip(y, 0, h - ch))
        cw, ch = int(min(cw, w - x)), int(min(ch, h - y))
        crop = frame[y:y+ch, x:x+cw]
        frame = (cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR)
                 if (cw, ch) != (w, h) else crop)
        cv2.rectangle(frame, (5,5), (25,25), (0,255,0), 2)

    return frame

def check_proximity(landmarks):
    """Check if user is too close to the screen."""
    left_shoulder = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER]
    right_shoulder = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER]
    shoulder_width = abs(left_shoulder.x - right_shoulder.x)
    feedback_messages = []
    
    if shoulder_width > 0.6:
        feedback_messages.append("Move Back! You are too close to the screen.")
    elif shoulder_width < 0.48:
        feedback_messages.append("You are Leaning. Sit straight!")
    
    return feedback_messages

def analyze_posture_basic(landmarks):
    """Basic posture analysis for general feedback."""
    left_shoulder = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER]
    right_shoulder = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER]
    nose = landmarks[mp_pose.PoseLandmark.NOSE]
    left_hip = landmarks[mp_pose.PoseLandmark.LEFT_HIP]
    right_hip = landmarks[mp_pose.PoseLandmark.RIGHT_HIP]
    
    torso_mid = ((left_hip.x + right_hip.x) / 2, (left_hip.y + right_hip.y) / 2)
    torso_length = calculate_distance((nose.x, nose.y), torso_mid)
    shoulder_deviation = abs(left_shoulder.y - right_shoulder.y)
    
    feedback_messages = []
    if shoulder_deviation > 0.05 * torso_length:
        feedback_messages.append("Straighten Your Shoulders!")
    
    return feedback_messages

def analyze_posture_detailed(landmarks):
    """Detailed posture analysis with comprehensive feedback - EXACT COPY from original backend.py"""
    feedback_messages = []
    
    # Extract landmark positions exactly as in original
    left_shoulder = (landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER].x,
                     landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER].y)
    right_shoulder = (landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER].x,
                      landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER].y)
    neck = (landmarks[mp_pose.PoseLandmark.NOSE].x,
            landmarks[mp_pose.PoseLandmark.NOSE].y)
    left_hip = (landmarks[mp_pose.PoseLandmark.LEFT_HIP].x,
                landmarks[mp_pose.PoseLandmark.LEFT_HIP].y)
    right_hip = (landmarks[mp_pose.PoseLandmark.RIGHT_HIP].x,
                 landmarks[mp_pose.PoseLandmark.RIGHT_HIP].y)

    # Calculate measurements exactly as in original
    shoulder_width = calculate_distance(left_shoulder, right_shoulder)
    torso_length = calculate_distance(neck, ((left_hip[0] + right_hip[0]) / 2,
                                             (left_hip[1] + right_hip[1]) / 2))
    ideal_neck_x = (left_shoulder[0] + right_shoulder[0]) / 2
    neck_deviation = abs(neck[0] - ideal_neck_x)
    shoulder_deviation = abs(left_shoulder[1] - right_shoulder[1])

    # Define thresholds exactly as in original
    neck_threshold = 0.1 * shoulder_width
    shoulder_threshold = 0.05 * torso_length

    # EXACT neck analysis logic from original
    if neck_deviation > neck_threshold:
        feedback_messages.append("Straighten your neck!")
        if neck[0] > ideal_neck_x:
            feedback_messages.append("Move neck to the left.")
        else:
            feedback_messages.append("Move neck to the right.")

    # EXACT shoulder analysis logic from original  
    if shoulder_deviation > shoulder_threshold:
        feedback_messages.append("Align your shoulders!")
        if left_shoulder[1] > right_shoulder[1]:
            feedback_messages.append("Put down your left shoulder.")
        else:
            feedback_messages.append("Put down your right shoulder.")
    
    return feedback_messages

def analyze_posture(landmarks):
    """Combined posture analysis with all feedback types."""
    global current_feedback
    
    # Get all types of feedback
    proximity_feedback = check_proximity(landmarks)
    basic_feedback = analyze_posture_basic(landmarks)
    detailed_feedback = analyze_posture_detailed(landmarks)
    
    # Combine all feedback
    feedback_messages = proximity_feedback + basic_feedback + detailed_feedback
    
    with feedback_lock:
        current_feedback = feedback_messages
    
    return feedback_messages

def calculate_posture_scores(feedback_messages):
    """Calculate posture scores based on detailed feedback - EXACT logic from original backend.py"""
    scores = {
        "headTilt": 85,
        "shoulderAlignment": 80,
        "spinalPosture": 85,
        "hipBalance": 75,
        "legPosition": 80
    }
    
    # EXACT score adjustment logic from original backend.py
    for msg in feedback_messages:
        if "Straighten your neck" in msg or "Move neck" in msg:
            scores["headTilt"] = 60
        if "Align your shoulders" in msg or "Put down your left shoulder" in msg or "Put down your right shoulder" in msg:
            scores["shoulderAlignment"] = 65
        if "Straighten Your Shoulders" in msg:
            scores["spinalPosture"] = 80
        if "Put down your left shoulder" in msg:
            scores["hipBalance"] = 70
        if "Put down your right shoulder" in msg:
            scores["legPosition"] = 70
        if "Move Back" in msg or "Leaning" in msg:
            scores["spinalPosture"] = max(70, scores["spinalPosture"] - 15)
    
    # Calculate overall score as average
    scores["overallScore"] = int(
        (scores["headTilt"] +
         scores["shoulderAlignment"] +
         scores["spinalPosture"] +
         scores["hipBalance"] +
         scores["legPosition"]) / 5
    )
    
    return scores

# -------------------------------
# Video generation function
# -------------------------------
def generate_video_feed():
    """Generate video feed with comprehensive posture analysis - EXACT LOGIC from original backend.py"""
    global blink_count, start_time, current_feedback, camera_active, current_session_data
    
    with camera_lock:
        camera_active = True
    
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, frame_size[0])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, frame_size[1])
    
    # Initialize session data
    session_start_time = time.time()
    current_session_data["start_time"] = session_start_time
    current_session_data["session_id"] = f"session_{int(session_start_time)}"
    current_session_data["scores"] = []
    current_session_data["feedback_history"] = []
    
    left_eye_indices = [33, 160, 158, 133, 153, 144]
    right_eye_indices = [362, 385, 387, 263, 373, 380]
    
    try:
        while cap.isOpened():
            # Check if camera should stop
            with camera_lock:
                if not camera_active:
                    break
                    
            ret, frame = cap.read()
            if not ret:
                break

            # Initialize feedback messages for this frame
            feedback_messages = []

            # Flip for a mirror view
            frame = cv2.flip(frame, 1)
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Process with MediaPipe Pose
            results = pose_front.process(rgb_frame)
            
            # Apply auto-framing (must be before drawing landmarks)
            frame = apply_auto_framing(frame, results)
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)  # Update RGB frame after framing
            
            if results.pose_landmarks:
                landmarks = results.pose_landmarks.landmark
                
                # EXACT DETAILED ANALYSIS from original backend.py
                left_shoulder = (landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER].x,
                                 landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER].y)
                right_shoulder = (landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER].x,
                                  landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER].y)
                neck = (landmarks[mp_pose.PoseLandmark.NOSE].x,
                        landmarks[mp_pose.PoseLandmark.NOSE].y)
                left_hip = (landmarks[mp_pose.PoseLandmark.LEFT_HIP].x,
                            landmarks[mp_pose.PoseLandmark.LEFT_HIP].y)
                right_hip = (landmarks[mp_pose.PoseLandmark.RIGHT_HIP].x,
                             landmarks[mp_pose.PoseLandmark.RIGHT_HIP].y)

                shoulder_width = calculate_distance(left_shoulder, right_shoulder)
                torso_length = calculate_distance(neck, ((left_hip[0] + right_hip[0]) / 2,
                                                         (left_hip[1] + right_hip[1]) / 2))
                ideal_neck_x = (left_shoulder[0] + right_shoulder[0]) / 2
                neck_deviation = abs(neck[0] - ideal_neck_x)
                shoulder_deviation = abs(left_shoulder[1] - right_shoulder[1])

                neck_threshold = 0.1 * shoulder_width
                shoulder_threshold = 0.05 * torso_length

                # EXACT neck analysis from original
                if neck_deviation > neck_threshold:
                    feedback_messages.append("Straighten your neck!")
                    if neck[0] > ideal_neck_x:
                        feedback_messages.append("Move neck to the left.")
                    else:
                        feedback_messages.append("Move neck to the right.")

                # EXACT shoulder analysis from original
                if shoulder_deviation > shoulder_threshold:
                    feedback_messages.append("Align your shoulders!")
                    if left_shoulder[1] > right_shoulder[1]:
                        feedback_messages.append("Put down your left shoulder.")
                    else:
                        feedback_messages.append("Put down your right shoulder.")
                
                # EXACT proximity check from original
                if shoulder_width > 0.6:
                    feedback_messages.append("Move Back! You are too close to the screen.")
                elif shoulder_width < 0.48:
                    feedback_messages.append("You are Leaning. Sit straight!")

            # Process face mesh for eye blink detection - EXACT from original
            face_results = face_mesh.process(rgb_frame)
            if face_results.multi_face_landmarks:
                landmarks_face = face_results.multi_face_landmarks[0].landmark
                ear = eye_aspect_ratio(landmarks_face, left_eye_indices, right_eye_indices)
                if ear < 0.2:
                    blink_count += 1
                elapsed_time = time.time() - start_time
                if elapsed_time >= 60:
                    if blink_count < 15:
                        feedback_messages.append("Blink More! Your eye blink rate is low.")
                    current_session_data["blink_rate"] = blink_count
                    blink_count = 0
                    start_time = time.time()

            # Calculate and store scores for this frame
            scores = calculate_posture_scores(feedback_messages)
            current_session_data["scores"].append({
                "timestamp": time.time(),
                "scores": scores
            })
            current_session_data["feedback_history"].append({
                "timestamp": time.time(),
                "feedback": feedback_messages.copy()
            })

            # Update the global feedback variable
            with feedback_lock:
                current_feedback = feedback_messages.copy()

            # Add camera status indicators
            if auto_frame_enabled:
                cv2.putText(frame, "Auto-framing: ON", (frame.shape[1] - 200, 30), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            
            # Add session time indicator
            session_duration = time.time() - session_start_time
            cv2.putText(frame, f"Session: {int(session_duration//60)}:{int(session_duration%60):02d}", 
                        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            
            # Encode and stream the frame
            ret, buffer = cv2.imencode('.jpg', frame)
            frame_bytes = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
    
    finally:
        cap.release()
        with camera_lock:
            camera_active = False

# -------------------------------
# API endpoints
# -------------------------------
@app.route('/video_feed')
def video_feed():
    """Video streaming route."""
    return Response(
        generate_video_feed(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )

@app.route('/feedback')
def get_feedback():
    """Get current posture feedback."""
    with feedback_lock:
        feedback_copy = current_feedback.copy()
    
    scores = calculate_posture_scores(feedback_copy)
    
    return jsonify({
        "feedback": feedback_copy,
        "scores": scores,
        "timestamp": time.time()
    })

@app.route('/toggle_auto_frame', methods=['POST'])
def toggle_auto_frame():
    """Toggle auto-framing on/off."""
    global auto_frame_enabled
    auto_frame_enabled = not auto_frame_enabled
    return jsonify({"auto_frame_enabled": auto_frame_enabled})

@app.route('/stop_analysis', methods=['POST'])
def stop_analysis():
    """Stop the camera analysis."""
    global camera_active, current_session_data
    
    with camera_lock:
        camera_active = False
    
    # Calculate session summary
    if current_session_data["start_time"]:
        session_duration = time.time() - current_session_data["start_time"]
        
        # Calculate average scores
        if current_session_data["scores"]:
            total_scores = {"headTilt": 0, "shoulderAlignment": 0, "spinalPosture": 0, 
                           "hipBalance": 0, "legPosition": 0, "overallScore": 0}
            
            for score_entry in current_session_data["scores"]:
                scores = score_entry["scores"]
                for key in total_scores:
                    total_scores[key] += scores.get(key, 0)
            
            avg_scores = {key: round(value / len(current_session_data["scores"]), 1) 
                         for key, value in total_scores.items()}
        else:
            avg_scores = {"headTilt": 0, "shoulderAlignment": 0, "spinalPosture": 0, 
                         "hipBalance": 0, "legPosition": 0, "overallScore": 0}
        
        session_summary = {
            "session_id": current_session_data["session_id"],
            "duration": round(session_duration, 2),
            "duration_minutes": round(session_duration / 60, 2),
            "average_scores": avg_scores,
            "total_feedback_count": len(current_session_data["feedback_history"]),
            "blink_rate": current_session_data.get("blink_rate", 0),
            "end_time": time.time()
        }
        
        # Reset session data
        current_session_data = {
            "session_id": None,
            "start_time": None,
            "scores": [],
            "feedback_history": [],
            "blink_rate": 0
        }
        
        return jsonify({
            "status": "stopped", 
            "camera_active": False,
            "session_summary": session_summary
        })
    
    return jsonify({"status": "stopped", "camera_active": False})

@app.route('/camera_status')
def camera_status():
    """Get current camera status."""
    global camera_active, current_session_data
    
    with camera_lock:
        active = camera_active
    
    if active and current_session_data["start_time"]:
        session_duration = time.time() - current_session_data["start_time"]
        return jsonify({
            "camera_active": active,
            "session_duration": round(session_duration, 2),
            "session_id": current_session_data["session_id"]
        })
    
    return jsonify({"camera_active": active})

@app.route('/session_data')
def get_session_data():
    """Get current session data."""
    global current_session_data
    
    if current_session_data["start_time"]:
        session_duration = time.time() - current_session_data["start_time"]
        
        # Calculate current averages
        if current_session_data["scores"]:
            latest_scores = current_session_data["scores"][-1]["scores"]
        else:
            latest_scores = {"headTilt": 0, "shoulderAlignment": 0, "spinalPosture": 0, 
                           "hipBalance": 0, "legPosition": 0, "overallScore": 0}
        
        return jsonify({
            "session_id": current_session_data["session_id"],
            "duration": round(session_duration, 2),
            "duration_minutes": round(session_duration / 60, 2),
            "current_scores": latest_scores,
            "total_feedback_count": len(current_session_data["feedback_history"]),
            "blink_rate": current_session_data.get("blink_rate", 0),
            "scores_history": current_session_data["scores"][-10:],  # Last 10 scores
            "active": True
        })
    
    return jsonify({"active": False})

@app.route('/health')
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "service": "posture_detector"})

@app.route('/tracked_time')
def tracked_time():
    with _tracked_time_lock:
        todays_secs = float(_tracked_state["todays_seconds"])
        session_secs = float(_tracked_state["session_seconds"])
    return jsonify({
        "todays_time_tracked_seconds": round(todays_secs, 3),
        "todays_time_tracked_minutes": round(todays_secs / 60.0, 3),
        "current_section_time_seconds": round(session_secs, 3),
        "current_section_time_minutes": round(session_secs / 60.0, 3)
        
    })

if __name__ == "__main__":
    print("Starting Posture Detection Service...")
    print("Available endpoints:")
    print("  - Video feed: http://localhost:5001/video_feed")
    print("  - Feedback: http://localhost:5001/feedback")
    print("  - Toggle auto-frame: http://localhost:5001/toggle_auto_frame")
    print("  - Stop analysis: http://localhost:5001/stop_analysis")
    print("  - Camera status: http://localhost:5001/camera_status")
    print("  - Session data: http://localhost:5001/session_data")
    
    # Disable Flask's dotenv loading to avoid dependency issues
    app.run(host='0.0.0.0', port=5001, debug=False, threaded=True, load_dotenv=False)
