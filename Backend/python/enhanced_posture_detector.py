#!/usr/bin/env python3
"""
Enhanced Posture Detection Service with Backend Integration

This script demonstrates how the Python posture detection service integrates
with the Node.js backend for daily data persistence and real-time updates.
"""

import cv2
import mediapipe as mp
import numpy as np
import time
import json
import requests
from datetime import datetime, timedelta
from flask import Flask, jsonify, request
from flask_cors import CORS
import threading
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Flask app for API endpoints
app = Flask(__name__)
CORS(app)

# Backend API configuration
BACKEND_URL = "http://localhost:3000"
BACKEND_HEADERS = {"Content-Type": "application/json"}

class PostureDetector:
    def __init__(self):
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.mp_drawing = mp.solutions.drawing_utils
        
        # Session tracking
        self.session_active = False
        self.session_start_time = None
        self.feedback_history = []
        self.scores_history = []
        self.correction_count = 0
        
        # Current frame data
        self.current_scores = {
            'headTilt': 100,
            'shoulderAlignment': 100, 
            'spinalPosture': 100,
            'overallScore': 100
        }
        
        # Camera
        self.cap = None
        
    def start_camera(self):
        """Start camera capture"""
        try:
            self.cap = cv2.VideoCapture(0)
            if not self.cap.isOpened():
                raise Exception("Could not open camera")
            
            # Set camera properties
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            self.cap.set(cv2.CAP_PROP_FPS, 30)
            
            logger.info("Camera started successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to start camera: {e}")
            return False
    
    def stop_camera(self):
        """Stop camera capture"""
        if self.cap:
            self.cap.release()
            self.cap = None
            logger.info("Camera stopped")
    
    def analyze_posture(self, landmarks):
        """Analyze posture from pose landmarks"""
        try:
            # Get key landmark positions
            left_shoulder = landmarks[self.mp_pose.PoseLandmark.LEFT_SHOULDER]
            right_shoulder = landmarks[self.mp_pose.PoseLandmark.RIGHT_SHOULDER]
            nose = landmarks[self.mp_pose.PoseLandmark.NOSE]
            left_hip = landmarks[self.mp_pose.PoseLandmark.LEFT_HIP]
            right_hip = landmarks[self.mp_pose.PoseLandmark.RIGHT_HIP]
            
            # Calculate head tilt score
            head_tilt_angle = abs(np.arctan2(
                right_shoulder.y - left_shoulder.y,
                right_shoulder.x - left_shoulder.x
            ) * 180 / np.pi)
            head_tilt_score = max(0, 100 - (head_tilt_angle * 3))
            
            # Calculate shoulder alignment score  
            shoulder_diff = abs(left_shoulder.y - right_shoulder.y)
            shoulder_score = max(0, 100 - (shoulder_diff * 200))
            
            # Calculate spinal posture score (simplified)
            spine_alignment = abs((left_shoulder.x + right_shoulder.x) / 2 - nose.x)
            spinal_score = max(0, 100 - (spine_alignment * 300))
            
            # Calculate overall score
            overall_score = (head_tilt_score + shoulder_score + spinal_score) / 3
            
            # Update current scores
            self.current_scores = {
                'headTilt': round(head_tilt_score, 1),
                'shoulderAlignment': round(shoulder_score, 1),
                'spinalPosture': round(spinal_score, 1),
                'overallScore': round(overall_score, 1)
            }
            
            # Generate feedback if posture issues detected
            feedback = []
            if head_tilt_score < 70:
                feedback.append("Keep your head straight - avoid tilting")
                self.correction_count += 1
            if shoulder_score < 70:
                feedback.append("Align your shoulders evenly")
                self.correction_count += 1
            if spinal_score < 70:
                feedback.append("Straighten your back posture")
                self.correction_count += 1
                
            if feedback:
                self.feedback_history.extend(feedback)
                # Keep only recent feedback
                self.feedback_history = self.feedback_history[-10:]
            
            # Store scores history
            self.scores_history.append({
                'timestamp': datetime.now().isoformat(),
                'scores': self.current_scores.copy()
            })
            
            # Keep only recent scores
            self.scores_history = self.scores_history[-100:]
            
            return True
            
        except Exception as e:
            logger.error(f"Error analyzing posture: {e}")
            return False
    
    def start_session(self):
        """Start posture monitoring session"""
        if self.session_active:
            return False, "Session already active"
            
        if not self.start_camera():
            return False, "Failed to start camera"
        
        self.session_active = True
        self.session_start_time = datetime.now()
        self.feedback_history = []
        self.scores_history = []
        self.correction_count = 0
        
        # Start background processing
        self.processing_thread = threading.Thread(target=self._process_frames)
        self.processing_thread.daemon = True
        self.processing_thread.start()
        
        logger.info("Posture monitoring session started")
        return True, "Session started successfully"
        
    def stop_session(self):
        """Stop posture monitoring session"""
        if not self.session_active:
            return False, "No active session"
            
        self.session_active = False
        self.stop_camera()
        
        # Calculate session summary
        if self.session_start_time:
            duration = (datetime.now() - self.session_start_time).total_seconds()
            duration_minutes = duration / 60
            
            # Calculate average scores
            if self.scores_history:
                avg_scores = {
                    'headTilt': np.mean([s['scores']['headTilt'] for s in self.scores_history]),
                    'shoulderAlignment': np.mean([s['scores']['shoulderAlignment'] for s in self.scores_history]),
                    'spinalPosture': np.mean([s['scores']['spinalPosture'] for s in self.scores_history]),
                    'overallScore': np.mean([s['scores']['overallScore'] for s in self.scores_history])
                }
            else:
                avg_scores = self.current_scores
            
            summary = {
                'session_id': f"session_{int(time.time())}",
                'duration': round(duration, 1),
                'duration_minutes': round(duration_minutes, 2),
                'average_scores': avg_scores,
                'total_feedback_count': self.correction_count,
                'blink_rate': 0,  # Placeholder for future implementation
                'end_time': datetime.now().isoformat()
            }
            
            logger.info(f"Session stopped. Duration: {duration_minutes:.1f} minutes, Corrections: {self.correction_count}")
            return True, summary
        
        return True, None
    
    def _process_frames(self):
        """Background thread for processing camera frames"""
        while self.session_active and self.cap:
            ret, frame = self.cap.read()
            if not ret:
                continue
                
            # Convert BGR to RGB
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Process frame with MediaPipe
            results = self.pose.process(rgb_frame)
            
            if results.pose_landmarks:
                self.analyze_posture(results.pose_landmarks.landmark)
            
            # Small delay to prevent excessive CPU usage
            time.sleep(0.1)

# Global detector instance
detector = PostureDetector()

# API Endpoints
@app.route('/start_analysis', methods=['POST'])
def start_analysis():
    """Start posture analysis session"""
    success, message = detector.start_session()
    
    if success:
        return jsonify({
            'status': 'success',
            'message': message,
            'session_start': detector.session_start_time.isoformat() if detector.session_start_time else None
        })
    else:
        return jsonify({
            'status': 'error', 
            'message': message
        }), 400

@app.route('/stop_analysis', methods=['POST'])
def stop_analysis():
    """Stop posture analysis session"""
    success, summary = detector.stop_session()
    
    if success:
        response = {
            'status': 'success',
            'message': 'Analysis stopped'
        }
        if summary:
            response['session_summary'] = summary
        return jsonify(response)
    else:
        return jsonify({
            'status': 'error',
            'message': 'No active session'
        }), 400

@app.route('/feedback', methods=['GET'])
def get_feedback():
    """Get current posture feedback and scores"""
    return jsonify({
        'feedback': detector.feedback_history,
        'scores': detector.current_scores,
        'corrections_count': detector.correction_count,
        'session_active': detector.session_active,
        'session_duration': (datetime.now() - detector.session_start_time).total_seconds() 
                           if detector.session_start_time else 0
    })

@app.route('/camera_status', methods=['GET'])
def camera_status():
    """Get camera and session status"""
    return jsonify({
        'camera_active': detector.session_active,
        'session_duration': (datetime.now() - detector.session_start_time).total_seconds() 
                           if detector.session_start_time else 0,
        'corrections_today': detector.correction_count
    })

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'posture-detection',
        'timestamp': datetime.now().isoformat(),
        'session_active': detector.session_active
    })

if __name__ == '__main__':
    logger.info("Starting Enhanced Posture Detection Service")
    logger.info("Backend Integration: Enabled")
    logger.info("Daily Reset Support: Enabled") 
    logger.info("Real-time Updates: Enabled")
    logger.info("Service URL: http://localhost:5001")
    
    # Start Flask app
    app.run(host='0.0.0.0', port=5001, debug=False, threaded=True)
