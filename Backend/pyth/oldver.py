from flask import Flask, render_template, request,redirect,url_for,session, jsonify, Response, send_file
from flask_cors import CORS  # Import CORS
import cv2
import mediapipe as mp
import math
import numpy as np
import time
import google.generativeai as genai
import matplotlib.pyplot as plt
import matplotlib
import io
from datetime import datetime, timedelta
import seaborn as sns
from matplotlib.colors import LinearSegmentedColormap

# Set matplotlib to use a non-GUI backend
matplotlib.use('Agg')

app = Flask(__name__)
CORS(app, supports_credentials=True, origins=["http://localhost:5173"])# Enable CORS for all routes

# -------------------------------
# Gemini Chat API Initialization
# -------------------------------
API_KEY = "AIzaSyCXrWVF01ZEj32qdc0uXSLsu9KK64ShL5k"
genai.configure(api_key=API_KEY)
model = genai.GenerativeModel("gemini-1.5-pro")  # Use latest model

# Function to format bot responses properly
def format_response(text):
    formatted_text = text.replace("\n", "<br>")  # Preserve line breaks
    return formatted_text

# Chat endpoints
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/chat", methods=["POST"])
def chat():
    user_message = request.json.get("message", "")
    try:
        response = model.generate_content(user_message)
        if response and response.text:
            formatted_response = format_response(response.text)
        else:
            formatted_response = "I'm sorry, I couldn't understand that."
        return jsonify({"response": formatted_response})
    except Exception as e:
        return jsonify({"response": f"Error: {str(e)}"})

# -------------------------------
# Posture and Video Feed Code
# -------------------------------

# Default posture scores
posture_scores = {
    "headTilt": 80,
    "shoulderAlignment": 70,
    "spinalPosture": 85,
    "hipBalance": 60,
    "legPosition": 75,
    "overallScore": 90
}

# Mock history data for graphs
posture_history = []
session_history = []
blink_rate_history = []
components_history = []

# Initialize with some sample data
def initialize_mock_data():
    global posture_history, session_history, blink_rate_history, components_history
    
    # Generate last 7 days of data
    for i in range(7):
        date = (datetime.now() - timedelta(days=6-i)).strftime("%m/%d")
        posture_history.append({
            "date": date,
            "score": np.random.randint(60, 95)
        })
    
    # Generate session data
    for i in range(5):
        session_history.append({
            "session": f"Session {i+1}",
            "score": np.random.randint(65, 95),
            "corrections": np.random.randint(2, 15)
        })
    
    # Generate blink rate data over time
    for i in range(8):
        hour = f"{(9 + i*2) % 24:02d}:00"
        blink_rate_history.append({
            "time": hour,
            "blinks": np.random.randint(10, 25)
        })
    
    # Generate component history data
    today_components = {
        "headTilt": posture_scores["headTilt"],
        "shoulderAlignment": posture_scores["shoulderAlignment"],
        "spinalPosture": posture_scores["spinalPosture"],
        "hipBalance": posture_scores["hipBalance"], 
        "legPosition": posture_scores["legPosition"]
    }
    yesterday_components = {
        "headTilt": np.random.randint(65, 85),
        "shoulderAlignment": np.random.randint(60, 80),
        "spinalPosture": np.random.randint(70, 90),
        "hipBalance": np.random.randint(55, 75),
        "legPosition": np.random.randint(65, 85)
    }
    
    components_history = {
        "today": today_components,
        "yesterday": yesterday_components
    }

# Initialize the mock data
initialize_mock_data()

def update_scores_from_feedback(feedback):
    """Update posture scores based on feedback messages."""
    global posture_scores
    # Adjust scores based on detected feedback in a simple way.
    if any("Straighten your neck" in msg for msg in feedback):
        posture_scores["headTilt"] = 60
    if any("Align your shoulders" in msg for msg in feedback):
        posture_scores["shoulderAlignment"] = 65
    if any("Straighten Your Shoulders" in msg for msg in feedback):
        posture_scores["spinalPosture"] = 80
    if any("Put down your left shoulder" in msg for msg in feedback):
        posture_scores["hipBalance"] = 70
    if any("Put down your right shoulder" in msg for msg in feedback):
        posture_scores["legPosition"] = 70
    # For overall score, simply take the average of the others.
    posture_scores["overallScore"] = int(
        (posture_scores["headTilt"] +
         posture_scores["shoulderAlignment"] +
         posture_scores["spinalPosture"] +
         posture_scores["hipBalance"] +
         posture_scores["legPosition"]) / 5
    )

# -------------------------------
# Initialize MediaPipe components
# -------------------------------
mp_pose = mp.solutions.pose
pose_front = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)

mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(min_detection_confidence=0.5, min_tracking_confidence=0.5)

# -------------------------------
# Global variables for notifications and feedback
# -------------------------------
notification_message = ""
current_feedback = []  # Global list to store the current feedback messages
blink_count = 0
start_time = time.time()
start_tracking = time.time()  # Global tracking start time for today's overview

# -------------------------------
# Utility functions for video processing
# -------------------------------
def calculate_distance(p1, p2):
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)

def send_notification(message):
    global notification_message
    notification_message = message

def eye_aspect_ratio(landmarks, left_indices, right_indices):
    left_eye = [landmarks[i] for i in left_indices]
    right_eye = [landmarks[i] for i in right_indices]
    def eye_ratio(eye):
        return (math.dist((eye[1].x, eye[1].y), (eye[5].x, eye[5].y)) +
                math.dist((eye[2].x, eye[2].y), (eye[4].x, eye[4].y))) / (
                2.0 * math.dist((eye[0].x, eye[0].y), (eye[3].x, eye[3].y)))
    return (eye_ratio(left_eye) + eye_ratio(right_eye)) / 2.0

left_eye_indices = [33, 160, 158, 133, 153, 144]
right_eye_indices = [362, 385, 387, 263, 373, 380]

def check_proximity(landmarks):
    left_shoulder = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER]
    right_shoulder = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER]
    shoulder_width = abs(left_shoulder.x - right_shoulder.x)
    if shoulder_width > 0.6:
        send_notification("Move Back! You are too close to the screen.")
    elif shoulder_width <0.48:
        send_notification("You are Leaning sit straight")

def calculate_angle(a, b, c):
    a, b, c = np.array(a), np.array(b), np.array(c)
    ba = a - b
    bc = c - b
    cosine_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc))
    return np.degrees(np.arccos(cosine_angle))

def analyze_posture(landmarks):
    left_shoulder = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER]
    right_shoulder = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER]
    nose = landmarks[mp_pose.PoseLandmark.NOSE]
    left_hip = landmarks[mp_pose.PoseLandmark.LEFT_HIP]
    right_hip = landmarks[mp_pose.PoseLandmark.RIGHT_HIP]
    torso_mid = ((left_hip.x + right_hip.x) / 2, (left_hip.y + right_hip.y) / 2)
    torso_length = calculate_distance((nose.x, nose.y), torso_mid)
    shoulder_deviation = abs(left_shoulder.y - right_shoulder.y)
    if shoulder_deviation > 0.05 * torso_length:
        send_notification("Straighten Your Shoulders!")

# -------------------------------
# Video generation function (Front Camera)
# -------------------------------
def generate_front_camera():
    global blink_count, start_time, notification_message, current_feedback
    cap = cv2.VideoCapture(0)
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # Initialize a local list to collect feedback messages for this frame
        feedback_messages = []

        # Flip for a mirror view
        frame = cv2.flip(frame, 1)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = pose_front.process(rgb_frame)
        
        if results.pose_landmarks:
            check_proximity(results.pose_landmarks.landmark)
            analyze_posture(results.pose_landmarks.landmark)
            # Draw landmarks on the frame
            mp.solutions.drawing_utils.draw_landmarks(
                frame, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)
            landmarks = results.pose_landmarks.landmark

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

            if neck_deviation > neck_threshold:
                feedback_messages.append("Straighten your neck!")
                if neck[0] > ideal_neck_x:
                    feedback_messages.append("Move neck to the left.")
                else:
                    feedback_messages.append("Move neck to the right.")

            if shoulder_deviation > shoulder_threshold:
                feedback_messages.append("Align your shoulders!")
                if left_shoulder[1] > right_shoulder[1]:
                    feedback_messages.append("Put down your left shoulder.")
                else:
                    feedback_messages.append("Put down your right shoulder.")

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
                blink_count = 0
                start_time = time.time()

        if notification_message:
            feedback_messages.append(notification_message)
            notification_message = ""

        # Update the global feedback variable so it can be served to clients
        current_feedback = feedback_messages.copy()

        ret, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
    cap.release()

# -------------------------------
# Flask Endpoints for Video and Feedback
# -------------------------------
@app.route('/video_feed_front')
def video_feed_front():
    return Response(
        generate_front_camera(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )

@app.route('/feedback')
def feedback():
    global current_feedback
    # Update posture scores based on the current feedback
    update_scores_from_feedback(current_feedback)
    return jsonify({"feedback": current_feedback})

@app.route('/get_scores')
def get_scores():
    # Send the posture scores
    return jsonify(posture_scores)

# -------------------------------
# Endpoint for Today's Overview
# -------------------------------
@app.route('/overview')
def overview():
    # Get the posture scores
    postureScore = posture_scores.get("overallScore", 0)

    # Calculate the time tracked since the beginning of the session
    tracked_seconds = time.time() - start_tracking
    hours = tracked_seconds / 3600
    timeTracked = f"{hours:.1f} hrs"

    # Count corrections based on feedback messages (using some keywords)
    corrections = 0
    for msg in current_feedback:
        if any(kw in msg for kw in ["Straighten your neck", "Align your shoulders", "Move neck", "Put down"]):
            corrections += 1

    # Count breaks taken based on low blink feedback messages
    breaksTaken = 0
    for msg in current_feedback:
        if "Blink More" in msg:
            breaksTaken += 1

    return jsonify({
        "postureScore": postureScore,
        "timeTracked": timeTracked,
        "corrections": corrections,
        "breaksTaken": breaksTaken
    })

# -------------------------------
# NEW: Report data endpoint
# -------------------------------
@app.route('/report/data')
def report_data():
    # Calculate the time tracked since the beginning of the session
    tracked_seconds = time.time() - start_tracking
    hours = tracked_seconds / 3600
    
    # Get the current posture score
    current_score = posture_scores.get("overallScore", 0)
    
    # Calculate a random score trend
    trend_options = ["improving", "declining", "stable"]
    score_trend = np.random.choice(trend_options, p=[0.4, 0.2, 0.4])
    
    # Generate random average score
    average_score = int(np.random.randint(current_score-10, current_score+10))
    if average_score > 100:
        average_score = 97
    
    return jsonify({
        "currentScore": current_score,
        "averageScore": average_score,
        "scoreTrend": score_trend,
        "timeTracked": f"{hours:.1f}",
        "totalSessions": len(session_history),
        "totalCorrections": sum(session["corrections"] for session in session_history),
        "totalBreaks": np.random.randint(3, 12),
        "headTiltScore": posture_scores["headTilt"],
        "shoulderAlignmentScore": posture_scores["shoulderAlignment"],
        "spinalPostureScore": posture_scores["spinalPosture"],
        "hipBalanceScore": posture_scores["hipBalance"],
        "legPositionScore": posture_scores["legPosition"],
    })

# -------------------------------
# NEW: Graph generation endpoints
# -------------------------------

# Create posture over time graph
@app.route('/graph/posture_over_time')
def posture_over_time_graph():
    plt.figure(figsize=(10, 6))
    plt.style.use('dark_background')
    
    # Extract data
    dates = [entry['date'] for entry in posture_history]
    scores = [entry['score'] for entry in posture_history]
    
    # Create custom color map with gradient
    colors = [(0.2, 0.4, 0.8, 1.0), (0.6, 0.2, 0.7, 1.0)]
    cmap = LinearSegmentedColormap.from_list("custom_cmap", colors, N=100)
    
    # Create the plot
    plt.figure(figsize=(10, 6), facecolor='#1f2937')
    ax = plt.subplot(111)
    ax.set_facecolor('#1f2937')
    
    # Plot line and points
    plt.plot(dates, scores, '-', color='#4c72b0', linewidth=3, alpha=0.7)
    plt.plot(dates, scores, 'o', color='#8c54a1', markersize=8)
    
    # Fill area below the line with gradient
    plt.fill_between(dates, scores, color='#4c72b0', alpha=0.2)
    
    # Add today's score with annotation
    plt.scatter(dates[-1], scores[-1], s=120, color='#10b981', zorder=5)
    plt.annotate(f'Today: {scores[-1]}', 
                xy=(dates[-1], scores[-1]), 
                xytext=(dates[-1], scores[-1]+15),
                ha='center',
                color='white',
                fontweight='bold')
    
    # Styling
    plt.title('Posture Score Trend (Last 7 Days)', fontsize=16, color='white', fontweight='bold', pad=20)
    plt.xlabel('Date', fontsize=12, color='#9ca3af', labelpad=10)
    plt.ylabel('Score', fontsize=12, color='#9ca3af', labelpad=10)
    plt.ylim(min(scores)-10, 105)
    
    # Grid and spines
    plt.grid(axis='y', linestyle='--', alpha=0.3)
    for spine in ax.spines.values():
        spine.set_visible(False)
    
    # Add horizontal line for good score threshold
    plt.axhline(y=80, color='#10b981', linestyle='--', alpha=0.5)
    plt.text(dates[0], 82, 'Good Posture Threshold', color='#10b981', fontsize=10)
    
    plt.tight_layout()
    
    # Save to BytesIO buffer
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', transparent=True)
    plt.close()
    buf.seek(0)
    
    return send_file(buf, mimetype='image/png')

# Create posture components radar chart
@app.route('/graph/posture_components')
def posture_components_graph():
    # Set the style
    plt.style.use('dark_background')
    
    # Create the figure
    fig = plt.figure(figsize=(8, 8), facecolor='#1f2937')
    
    # Extract data
    categories = ['Head Tilt', 'Shoulder Alignment', 'Spinal Posture', 'Hip Balance', 'Leg Position']
    today_values = [
        components_history['today']['headTilt'],
        components_history['today']['shoulderAlignment'],
        components_history['today']['spinalPosture'],
        components_history['today']['hipBalance'],
        components_history['today']['legPosition']
    ]
    yesterday_values = [
        components_history['yesterday']['headTilt'],
        components_history['yesterday']['shoulderAlignment'],
        components_history['yesterday']['spinalPosture'],
        components_history['yesterday']['hipBalance'],
        components_history['yesterday']['legPosition']
    ]
    
    # Compute angles for the radar chart
    N = len(categories)
    angles = np.linspace(0, 2*np.pi, N, endpoint=False).tolist()
    angles += angles[:1]  # Close the loop
    
    # Add values to complete the loop
    today_values += today_values[:1]
    yesterday_values += yesterday_values[:1]
    
    # Set up the radar chart
    ax = fig.add_subplot(111, polar=True)
    ax.set_facecolor('#1f2937')
    
    # Plot the data
    ax.plot(angles, today_values, 'o-', linewidth=2, color='#818cf8', label='Today')
    ax.fill(angles, today_values, color='#818cf8', alpha=0.25)
    
    ax.plot(angles, yesterday_values, 'o-', linewidth=2, color='#a78bfa', label='Yesterday')
    ax.fill(angles, yesterday_values, color='#a78bfa', alpha=0.1)
    
    # Customize the chart
    ax.set_theta_offset(np.pi / 2)  # Start from the top
    ax.set_theta_direction(-1)  # Go clockwise
    
    # Set the labels
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories, fontsize=12, color='white')
    
    # Set the y-axis limits and labels
    ax.set_ylim(0, 100)
    ax.set_yticks([20, 40, 60, 80, 100])
    ax.set_yticklabels(['20', '40', '60', '80', '100'], color='#9ca3af')
    
    # Add legend and title
    plt.legend(loc='upper right', bbox_to_anchor=(1.3, 1.1), frameon=False, fontsize=12)
    plt.title('Posture Component Analysis', fontsize=16, color='white', fontweight='bold', pad=20)
    
    # Add concentric circles and grid styling
    ax.grid(color='gray', alpha=0.3)
    
    plt.tight_layout()
    
    # Save to BytesIO buffer
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight')
    plt.close()
    buf.seek(0)
    
    return send_file(buf, mimetype='image/png')

# Create blink rate graph
@app.route('/graph/blink_rate')
def blink_rate_graph():
    plt.style.use('dark_background')
    
    # Create figure
    fig, ax = plt.subplots(figsize=(10, 6), facecolor='#1f2937')
    ax.set_facecolor('#1f2937')
    
    # Extract data
    times = [entry['time'] for entry in blink_rate_history]
    blinks = [entry['blinks'] for entry in blink_rate_history]
    
    # Get ideal blink range
    recommended_blinks = [15] * len(times)
    min_blinks = [12] * len(times)
    
    # Create bar chart
    bars = ax.bar(times, blinks, width=0.6, color='#60a5fa', alpha=0.8)
    
    # Highlight bars below minimum threshold
    for i, (bar, blink) in enumerate(zip(bars, blinks)):
        if blink < 12:
            bar.set_color('#f87171')
    
    # Add recommended range
    ax.plot(times, recommended_blinks, '--', color='#34d399', label='Recommended (15 blinks/min)')
    ax.plot(times, min_blinks, '--', color='#fbbf24', label='Minimum (12 blinks/min)')
    
    # Fill recommended range area
    ax.fill_between(times, min_blinks, recommended_blinks, color='#fbbf24', alpha=0.1)
    ax.fill_between(times, recommended_blinks, [25] * len(times), color='#34d399', alpha=0.1)
    
    # Styling
    ax.set_title('Blink Rate Throughout the Day', fontsize=16, color='white', fontweight='bold', pad=20)
    ax.set_xlabel('Time of Day', fontsize=12, color='#9ca3af', labelpad=10)
    ax.set_ylabel('Blinks per Minute', fontsize=12, color='#9ca3af', labelpad=10)
    ax.set_ylim(0, 30)
    
    # Remove spines
    for spine in ax.spines.values():
        spine.set_visible(False)
        
    # Add grid
    ax.grid(axis='y', linestyle='--', alpha=0.2)
    
    # Add annotations for low blink rates
    for i, blink in enumerate(blinks):
        if blink < 12:
            ax.annotate('Low!', xy=(i, blink), xytext=(i, blink+2),
                        ha='center', color='#f87171', fontweight='bold')
    
    # Add legend
    ax.legend(frameon=False, loc='upper right')
    
    plt.tight_layout()
    
    # Save to BytesIO buffer
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight')
    plt.close()
    buf.seek(0)
    
    return send_file(buf, mimetype='image/png')

# Create session comparison graph
@app.route('/graph/session_comparison')
def session_comparison_graph():
    plt.style.use('dark_background')
    
    # Create figure
    fig, ax = plt.subplots(figsize=(10, 6), facecolor='#1f2937')
    ax.set_facecolor('#1f2937')
    
    # Extract data
    sessions = [session['session'] for session in session_history]
    scores = [session['score'] for session in session_history]
    corrections = [session['corrections'] for session in session_history]
    
    # Set positions and width for bars
    x = np.arange(len(sessions))
    width = 0.35
    
    # Create bars
    score_bars = ax.bar(x - width/2, scores, width, color='#8b5cf6', label='Score')
    correction_bars = ax.bar(x + width/2, corrections, width, color='#ec4899', label='Corrections')
    
    # Add labels with arrows connecting to bars
    for i, (score, correction) in enumerate(zip(scores, corrections)):
        if i == len(scores) - 1:  # Latest session
            # Add "Current" label to the last session
            ax.annotate('Latest', xy=(i, score), xytext=(i-width/2, score+10),
                      ha='center', color='white', fontweight='bold')
            
            # Draw trend lines if more than one session
            if len(scores) > 1:
                prev_score = scores[i-1]
                if score > prev_score:
                    ax.annotate('↑ Improved', xy=(i-width/4, max(score, prev_score)+5), 
                              color='#10b981', fontweight='bold', ha='center')
                else:
                    ax.annotate('↓ Declined', xy=(i-width/4, max(score, prev_score)+5), 
                              color='#f87171', fontweight='bold', ha='center')
    
    # Style the graph
    ax.set_title('Session Performance Comparison', fontsize=16, color='white', fontweight='bold', pad=20)
    ax.set_xlabel('Sessions', fontsize=12, color='#9ca3af', labelpad=10)
    ax.set_ylabel('Score / Corrections', fontsize=12, color='#9ca3af', labelpad=10)
    ax.set_xticks(x)
    ax.set_xticklabels(sessions)
    
    # Set y-axis limits
    ax.set_ylim(0, max(max(scores), max(corrections) * 5) + 15)
    
    # Remove spines
    for spine in ax.spines.values():
        spine.set_visible(False)
    
    # Add grid
    ax.grid(axis='y', linestyle='--', alpha=0.2)
    
    # Add legend
    ax.legend(frameon=False)
    
    plt.tight_layout()
    
    # Save to BytesIO buffer
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight')
    plt.close()
    buf.seek(0)
    
    return send_file(buf, mimetype='image/png')



################## OAuth2.0 #################
# OAuth configuration – replace these with your actual Google credentials
app.secret_key = 'YOUR_SECRET_KEY'
from authlib.integrations.flask_client import OAuth
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
    # The _external parameter is required to build an absolute redirect URL.
    redirect_uri = url_for('authorize', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/authorize')
def authorize():
    # Exchange the authorization code for a token
    token = google.authorize_access_token()
    # Fetch the user’s profile information from Google
    resp = google.get('userinfo', token=token)
    user_info = resp.json()
    # Store the user info in session
    session['user'] = user_info
    # After successful login, redirect to the frontend app (adjust URL if needed)
    return redirect('http://localhost:5173')

@app.route('/api/user')
def user():
    # Return the logged-in user’s info as JSON
    user_info = session.get('user')
    if user_info:
        return jsonify(user_info)
    return jsonify({'error': 'Not logged in'}), 401

@app.route('/logout')
def logout():
    session.pop('user', None)
    # Redirect back to the frontend landing page
    return redirect('http://localhost:5173')

# -------------------------------
# Main driver
# -------------------------------
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)

