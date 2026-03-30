from flask import Flask, render_template, request, redirect, url_for, session, jsonify, Response, send_file
from flask_cors import CORS
import cv2
import mediapipe as mp
import numpy as np
import time
import threading
import queue
import json
import csv
import os
from datetime import datetime, timedelta
from collections import deque
import google.generativeai as genai
import matplotlib.pyplot as plt
import matplotlib
import io
import seaborn as sns
from matplotlib.colors import LinearSegmentedColormap
from authlib.integrations.flask_client import OAuth

# Set matplotlib to use a non-GUI backend
matplotlib.use('Agg')

app = Flask(__name__)
CORS(app, supports_credentials=True, origins=["http://localhost:5173"])
app.secret_key = 'YOUR_SECRET_KEY'

# -------------------------------
# Configuration
# -------------------------------
class Config:
    # Performance settings
    FPS_TARGET = 30
    FRAME_BUFFER_SIZE = 1
    DETECTION_CONFIDENCE = 0.7
    TRACKING_CONFIDENCE = 0.5
    
    # Detection thresholds (configurable)
    NECK_DEVIATION_THRESHOLD = 0.08
    SHOULDER_TILT_THRESHOLD = 0.05
    FORWARD_HEAD_THRESHOLD = 0.12
    SLOUCH_THRESHOLD = 0.15
    LEAN_THRESHOLD = 0.1
    
    # Auto-framing settings
    AUTO_FRAME_MARGIN = 50
    SMOOTHING_FACTOR = 0.3
    MIN_DETECTION_CONFIDENCE = 0.6
    
    # Logging
    LOG_POSTURE_DATA = True
    DATA_DIR = "posture_data"

# -------------------------------
# Enhanced Kalman Filter for Smooth Auto-framing
# -------------------------------
class KalmanBoxTracker:
    def __init__(self):
        self.kalman = cv2.KalmanFilter(8, 4)
        self.kalman.measurementMatrix = np.eye(4, 8, dtype=np.float32)
        
        # State transition matrix (position + velocity)
        dt = 1.0 / Config.FPS_TARGET
        self.kalman.transitionMatrix = np.array([
            [1, 0, 0, 0, dt, 0, 0, 0],
            [0, 1, 0, 0, 0, dt, 0, 0],
            [0, 0, 1, 0, 0, 0, dt, 0],
            [0, 0, 0, 1, 0, 0, 0, dt],
            [0, 0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 0, 1, 0, 0],
            [0, 0, 0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 0, 1]
        ], dtype=np.float32)
        
        self.kalman.processNoiseCov = np.eye(8, dtype=np.float32) * 0.01
        self.kalman.measurementNoiseCov = np.eye(4, dtype=np.float32) * 0.1
        self.initialized = False
    
    def update(self, bbox):
        if not self.initialized:
            self.kalman.statePre = np.array([bbox[0], bbox[1], bbox[2], bbox[3], 0, 0, 0, 0], dtype=np.float32)
            self.kalman.statePost = self.kalman.statePre.copy()
            self.initialized = True
        
        measurement = np.array([[bbox[0]], [bbox[1]], [bbox[2]], [bbox[3]]], dtype=np.float32)
        self.kalman.correct(measurement)
        prediction = self.kalman.predict()
        return prediction[:4].flatten()

# -------------------------------
# Advanced Posture Analyzer
# -------------------------------
class PostureAnalyzer:
    def __init__(self):
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            min_detection_confidence=Config.DETECTION_CONFIDENCE,
            min_tracking_confidence=Config.TRACKING_CONFIDENCE,
            model_complexity=1  # Balance between speed and accuracy
        )
        
        # Smoothing buffers for stable detection
        self.angle_buffer = deque(maxlen=5)
        self.position_buffer = deque(maxlen=3)
        
    def calculate_angle(self, p1, p2, p3):
        """Calculate angle between three points using vector mathematics"""
        v1 = np.array([p1.x - p2.x, p1.y - p2.y])
        v2 = np.array([p3.x - p2.x, p3.y - p2.y])
        
        cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))
        cos_angle = np.clip(cos_angle, -1, 1)
        angle = np.degrees(np.arccos(cos_angle))
        return angle
    
    def get_landmark_coords(self, landmarks, landmark_id):
        """Get normalized coordinates of a landmark"""
        landmark = landmarks[landmark_id.value]
        return np.array([landmark.x, landmark.y, landmark.z])
    
    def analyze_posture(self, frame):
        """Comprehensive posture analysis with angle-invariant detection"""
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.pose.process(rgb_frame)
        
        feedback = []
        posture_scores = {
            "neck_alignment": 100,
            "shoulder_level": 100,
            "forward_head": 100,
            "spine_straight": 100,
            "body_lean": 100,
            "overall": 100
        }
        
        if results.pose_landmarks:
            landmarks = results.pose_landmarks.landmark
            
            # Key landmark positions
            nose = self.get_landmark_coords(landmarks, self.mp_pose.PoseLandmark.NOSE)
            left_shoulder = self.get_landmark_coords(landmarks, self.mp_pose.PoseLandmark.LEFT_SHOULDER)
            right_shoulder = self.get_landmark_coords(landmarks, self.mp_pose.PoseLandmark.RIGHT_SHOULDER)
            left_ear = self.get_landmark_coords(landmarks, self.mp_pose.PoseLandmark.LEFT_EAR)
            right_ear = self.get_landmark_coords(landmarks, self.mp_pose.PoseLandmark.RIGHT_EAR)
            left_hip = self.get_landmark_coords(landmarks, self.mp_pose.PoseLandmark.LEFT_HIP)
            right_hip = self.get_landmark_coords(landmarks, self.mp_pose.PoseLandmark.RIGHT_HIP)
            
            # Calculate key metrics
            shoulder_center = (left_shoulder + right_shoulder) / 2
            ear_center = (left_ear + right_ear) / 2
            hip_center = (left_hip + right_hip) / 2
            
            # 1. Neck alignment (forward head posture)
            neck_forward_distance = abs(nose[0] - shoulder_center[0])
            if neck_forward_distance > Config.FORWARD_HEAD_THRESHOLD:
                feedback.append("Move your head back - forward head detected")
                posture_scores["forward_head"] = max(30, 100 - (neck_forward_distance * 500))
            
            # 2. Shoulder level check
            shoulder_height_diff = abs(left_shoulder[1] - right_shoulder[1])
            if shoulder_height_diff > Config.SHOULDER_TILT_THRESHOLD:
                feedback.append("Level your shoulders - uneven shoulder height detected")
                posture_scores["shoulder_level"] = max(40, 100 - (shoulder_height_diff * 1000))
            
            # 3. Neck tilt detection
            neck_tilt = abs(ear_center[0] - shoulder_center[0])
            if neck_tilt > Config.NECK_DEVIATION_THRESHOLD:
                side = "right" if ear_center[0] > shoulder_center[0] else "left"
                feedback.append(f"Straighten your neck - tilting to the {side}")
                posture_scores["neck_alignment"] = max(35, 100 - (neck_tilt * 800))
            
            # 4. Body lean detection
            body_lean = abs(shoulder_center[0] - hip_center[0])
            if body_lean > Config.LEAN_THRESHOLD:
                side = "right" if shoulder_center[0] > hip_center[0] else "left"
                feedback.append(f"Sit straight - body leaning to the {side}")
                posture_scores["body_lean"] = max(45, 100 - (body_lean * 600))
            
            # 5. Slouching detection (spine curvature)
            spine_angle = self.calculate_angle(
                type('obj', (object,), {'x': ear_center[0], 'y': ear_center[1]})(),
                type('obj', (object,), {'x': shoulder_center[0], 'y': shoulder_center[1]})(),
                type('obj', (object,), {'x': hip_center[0], 'y': hip_center[1]})()
            )
            
            if spine_angle < 160:  # Slouching threshold
                feedback.append("Sit up straight - slouching detected")
                posture_scores["spine_straight"] = max(40, spine_angle - 60)
            
            # Calculate overall score
            scores = list(posture_scores.values())[:-1]  # Exclude overall
            posture_scores["overall"] = int(sum(scores) / len(scores))
            
        return feedback, posture_scores, results

# -------------------------------
# Smart Auto-framing System
# -------------------------------
class AutoFraming:
    def __init__(self):
        self.tracker = KalmanBoxTracker()
        self.enabled = True
        self.last_valid_bbox = None
        
    def get_person_bbox(self, pose_landmarks, frame_shape):
        """Extract bounding box around person with dynamic padding"""
        if not pose_landmarks:
            return None
            
        h, w = frame_shape[:2]
        visible_landmarks = [
            (lm.x * w, lm.y * h) for lm in pose_landmarks.landmark
            if lm.visibility > Config.MIN_DETECTION_CONFIDENCE
        ]
        
        if len(visible_landmarks) < 5:  # Need minimum landmarks
            return None
            
        xs, ys = zip(*visible_landmarks)
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        
        # Dynamic padding based on person size
        width = x_max - x_min
        height = y_max - y_min
        padding_x = width * 0.3 + Config.AUTO_FRAME_MARGIN
        padding_y = height * 0.2 + Config.AUTO_FRAME_MARGIN
        
        # Constrain to frame boundaries
        x1 = max(0, int(x_min - padding_x))
        y1 = max(0, int(y_min - padding_y))
        x2 = min(w, int(x_max + padding_x))
        y2 = min(h, int(y_max + padding_y))
        
        return [x1, y1, x2 - x1, y2 - y1]
    
    def apply_framing(self, frame, pose_results):
        """Apply smooth auto-framing to keep person centered"""
        if not self.enabled:
            return frame
            
        if hasattr(pose_results, 'pose_landmarks') and pose_results.pose_landmarks:
            bbox = self.get_person_bbox(pose_results.pose_landmarks, frame.shape)
            if bbox:
                smooth_bbox = self.tracker.update(bbox)
                self.last_valid_bbox = smooth_bbox
            else:
                smooth_bbox = self.last_valid_bbox
        else:
            smooth_bbox = self.last_valid_bbox
            
        if smooth_bbox is not None:
            x, y, w, h = [int(val) for val in smooth_bbox]
            
            # Ensure valid crop coordinates
            frame_h, frame_w = frame.shape[:2]
            x = max(0, min(x, frame_w - w))
            y = max(0, min(y, frame_h - h))
            w = min(w, frame_w - x)
            h = min(h, frame_h - y)
            
            if w > 0 and h > 0:
                cropped = frame[y:y+h, x:x+w]
                frame = cv2.resize(cropped, (frame_w, frame_h))
                
                # Visual indicator
                cv2.rectangle(frame, (10, 10), (30, 30), (0, 255, 0), -1)
                cv2.putText(frame, "AUTO", (35, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
        
        return frame

# -------------------------------
# High-Performance Video Processor
# -------------------------------
class VideoProcessor:
    def __init__(self):
        self.cap = None
        self.frame_queue = queue.Queue(maxsize=2)
        self.result_queue = queue.Queue(maxsize=5)
        self.running = False
        
        # Initialize components
        self.posture_analyzer = PostureAnalyzer()
        self.auto_framing = AutoFraming()
        
        # Performance tracking
        self.fps_counter = 0
        self.fps_start_time = time.time()
        self.current_fps = 0
        
        # Threading
        self.capture_thread = None
        self.process_thread = None
        
    def initialize_camera(self):
        """Initialize camera with optimized settings"""
        self.cap = cv2.VideoCapture(0)
        if not self.cap.isOpened():
            raise RuntimeError("Could not open camera")
            
        # Optimize camera settings for performance
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, Config.FRAME_BUFFER_SIZE)
        self.cap.set(cv2.CAP_PROP_FPS, Config.FPS_TARGET)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        
    def capture_frames(self):
        """Dedicated thread for frame capture"""
        while self.running:
            ret, frame = self.cap.read()
            if ret:
                frame = cv2.flip(frame, 1)  # Mirror view
                
                # Clear old frames to prevent lag
                if not self.frame_queue.empty():
                    try:
                        self.frame_queue.get_nowait()
                    except queue.Empty:
                        pass
                
                try:
                    self.frame_queue.put(frame, timeout=0.01)
                except queue.Full:
                    pass
            else:
                time.sleep(0.001)
    
    def process_frames(self):
        """Dedicated thread for posture analysis"""
        while self.running:
            try:
                frame = self.frame_queue.get(timeout=0.1)
                
                # Analyze posture
                feedback, scores, pose_results = self.posture_analyzer.analyze_posture(frame)
                
                # Apply auto-framing
                framed = self.auto_framing.apply_framing(frame, pose_results)
                
                # Update FPS counter
                self.update_fps()
                
                # Add FPS display
                cv2.putText(framed, f"FPS: {self.current_fps:.1f}", (10, 50), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                
                # Store results
                result = {
                    'frame': framed,
                    'feedback': feedback,
                    'scores': scores,
                    'timestamp': time.time()
                }
                
                # Clear old results
                if not self.result_queue.empty():
                    try:
                        self.result_queue.get_nowait()
                    except queue.Empty:
                        pass
                
                try:
                    self.result_queue.put(result, timeout=0.01)
                except queue.Full:
                    pass
                    
            except queue.Empty:
                continue
            except Exception as e:
                print(f"Processing error: {e}")
    
    def update_fps(self):
        """Update FPS counter"""
        self.fps_counter += 1
        if self.fps_counter >= 30:
            current_time = time.time()
            self.current_fps = 30 / (current_time - self.fps_start_time)
            self.fps_start_time = current_time
            self.fps_counter = 0
    
    def start(self):
        """Start video processing threads"""
        if self.running:
            return
            
        self.initialize_camera()
        self.running = True
        
        self.capture_thread = threading.Thread(target=self.capture_frames, daemon=True)
        self.process_thread = threading.Thread(target=self.process_frames, daemon=True)
        
        self.capture_thread.start()
        self.process_thread.start()
    
    def stop(self):
        """Stop video processing"""
        self.running = False
        
        if self.capture_thread:
            self.capture_thread.join(timeout=1)
        if self.process_thread:
            self.process_thread.join(timeout=1)
        
        if self.cap:
            self.cap.release()
    
    def get_latest_result(self):
        """Get the most recent processing result"""
        try:
            return self.result_queue.get_nowait()
        except queue.Empty:
            return None

# -------------------------------
# Data Logger for Analytics
# -------------------------------
class PostureLogger:
    def __init__(self):
        self.data_dir = Config.DATA_DIR
        os.makedirs(self.data_dir, exist_ok=True)
        self.session_start = datetime.now()
        
    def log_posture_data(self, scores, feedback):
        """Log posture data to CSV"""
        if not Config.LOG_POSTURE_DATA:
            return
            
        timestamp = datetime.now().isoformat()
        data = {
            'timestamp': timestamp,
            'overall_score': scores.get('overall', 0),
            'neck_alignment': scores.get('neck_alignment', 0),
            'shoulder_level': scores.get('shoulder_level', 0),
            'forward_head': scores.get('forward_head', 0),
            'spine_straight': scores.get('spine_straight', 0),
            'body_lean': scores.get('body_lean', 0),
            'feedback_count': len(feedback),
            'has_issues': len(feedback) > 0
        }
        
        filename = os.path.join(self.data_dir, f"posture_log_{datetime.now().strftime('%Y%m%d')}.csv")
        
        # Write header if file doesn't exist
        write_header = not os.path.exists(filename)
        
        with open(filename, 'a', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=data.keys())
            if write_header:
                writer.writeheader()
            writer.writerow(data)

# -------------------------------
# Global instances
# -------------------------------
video_processor = VideoProcessor()
posture_logger = PostureLogger()
current_feedback = []
current_scores = {}

# Gemini API setup
API_KEY = "AIzaSyCXrWVF01ZEj32qdc0uXSLsu9KK64ShL5k"
genai.configure(api_key=API_KEY)
model = genai.GenerativeModel("gemini-1.5-pro")

# -------------------------------
# Flask Routes
# -------------------------------
@app.route("/")
def index():
    # This route is likely unused if your frontend is separate, but good to have.
    return "Posture detection backend is running."

@app.route("/chat", methods=["POST"])
def chat():
    user_message = request.json.get("message", "")
    try:
        response = model.generate_content(user_message)
        if response and response.text:
            formatted_response = response.text.replace("\n", "<br>")
        else:
            formatted_response = "I'm sorry, I couldn't understand that."
        return jsonify({"response": formatted_response})
    except Exception as e:
        return jsonify({"response": f"Error: {str(e)}"})

@app.route('/video_feed_front')
def video_feed_front():
    def generate_frames():
        while True:
            result = video_processor.get_latest_result()
            if result:
                global current_feedback, current_scores
                current_feedback = result['feedback']
                current_scores = result['scores']
                
                # Log data
                posture_logger.log_posture_data(current_scores, current_feedback)
                
                # Encode frame
                ret, buffer = cv2.imencode('.jpg', result['frame'])
                if ret:
                    frame_bytes = buffer.tobytes()
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            else:
                time.sleep(0.001)  # Small delay to prevent busy waiting
    
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/feedback')
def feedback():
    return jsonify({"feedback": current_feedback})

@app.route('/get_scores')
def get_scores():
    return jsonify(current_scores)

@app.route('/toggle_auto_frame', methods=['POST'])
def toggle_auto_frame():
    video_processor.auto_framing.enabled = not video_processor.auto_framing.enabled
    return jsonify({"auto_frame_enabled": video_processor.auto_framing.enabled})

@app.route('/api/settings', methods=['GET', 'POST'])
def settings_api():
    if request.method == 'GET':
        return jsonify({
            "auto_frame_enabled": video_processor.auto_framing.enabled,
            "detection_confidence": Config.DETECTION_CONFIDENCE,
            "neck_threshold": Config.NECK_DEVIATION_THRESHOLD,
            "shoulder_threshold": Config.SHOULDER_TILT_THRESHOLD,
            "forward_head_threshold": Config.FORWARD_HEAD_THRESHOLD
        })
    else:
        data = request.json
        if 'neck_threshold' in data:
            Config.NECK_DEVIATION_THRESHOLD = float(data['neck_threshold'])
        if 'shoulder_threshold' in data:
            Config.SHOULDER_TILT_THRESHOLD = float(data['shoulder_threshold'])
        if 'forward_head_threshold' in data:
            Config.FORWARD_HEAD_THRESHOLD = float(data['forward_head_threshold'])
        
        return jsonify({"status": "Settings updated successfully"})

@app.route('/overview')
def overview():
    session_duration = (datetime.now() - posture_logger.session_start).total_seconds() / 3600
    
    return jsonify({
        "postureScore": current_scores.get('overall', 0),
        "timeTracked": f"{session_duration:.1f} hrs",
        "corrections": len(current_feedback),
        "breaksTaken": 0  # Could be enhanced to track actual breaks
    })

# Initialize OAuth (keeping your existing setup)
oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id='42043198999-25lgpoq8daebi2ks4khk1bhkcjqo41dg.apps.googleusercontent.com',
    client_secret='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',
    access_token_url='https://oauth2.googleapis.com/token',
    authorize_url='https://accounts.google.com/o/oauth2/v2/auth',
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    api_base_url='https://www.googleapis.com/oauth2/v2/',
    client_kwargs={'scope': 'openid email profile'},
)

@app.route('/login')
def login():
    redirect_uri = url_for('authorize', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/authorize')
def authorize():
    token = google.authorize_access_token()
    resp = google.get('userinfo', token=token)
    user_info = resp.json()
    session['user'] = user_info
    return redirect('http://localhost:5173')

@app.route('/api/user')
def user():
    user_info = session.get('user')
    if user_info:
        return jsonify(user_info)
    return jsonify({'error': 'Not logged in'}), 401

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect('http://localhost:5173')

# -------------------------------
# Application Lifecycle
# -------------------------------
def initialize():
    """Initialize video processing on app start"""
    video_processor.start()

def cleanup():
    """Cleanup on app shutdown"""
    video_processor.stop()

import atexit
atexit.register(cleanup)

if __name__ == "__main__":
    # --- CORRECTED CODE SECTION ---
    # The @app.before_first_request decorator is removed as it's deprecated.
    # We now call the initialize() function directly before running the app.
    # This ensures the video processor starts up correctly.
    initialize()
    
    try:
        app.run(debug=False, threaded=True, host='0.0.0.0', port=5000)
    except KeyboardInterrupt:
        cleanup()

