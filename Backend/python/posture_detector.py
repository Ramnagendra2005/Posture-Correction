#!/usr/bin/env python3
"""
Posture Detection Microservice

This script replicates the exact posture detection and auto-framing functionality
from your Flask backend, but designed to work as a microservice with Node.js.

The script processes video input and outputs structured data via stdout that
the Node.js backend can parse and handle.
"""

import cv2
import mediapipe as mp
import numpy as np
import json
import sys
import time
import argparse
import math
from datetime import datetime
from collections import deque

# Initialize MediaPipe components
mp_pose = mp.solutions.pose
mp_face_mesh = mp.solutions.face_mesh

class PostureDetector:
    def __init__(self, config):
        """Initialize the posture detector with configuration"""
        self.config = config
        
        # Initialize MediaPipe
        self.pose = mp_pose.Pose(
            min_detection_confidence=0.7,
            min_tracking_confidence=0.5
        )
        self.face_mesh = mp_face_mesh.FaceMesh(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        
        # Auto-framing setup
        self.auto_frame_enabled = config.get('auto_frame_enabled', True)
        self.auto_frame_margin = config.get('auto_frame_margin', 50)
        self.min_visibility = 0.6
        self.prediction_horizon = 0.2
        self.dt = 1.0 / 30
        
        # Initialize Kalman filter for auto-framing
        self.kf_box = self._init_kalman_filter()
        self.current_frame_rect = None
        
        # Tracking variables
        self.blink_count = 0
        self.start_time = time.time()
        self.frame_count = 0
        
        # Eye blink detection indices
        self.left_eye_indices = [33, 160, 158, 133, 153, 144]
        self.right_eye_indices = [362, 385, 387, 263, 373, 380]
        
        # Thresholds
        self.neck_threshold = config.get('neck_threshold', 0.08)
        self.shoulder_threshold = config.get('shoulder_threshold', 0.05)
        self.back_threshold = config.get('back_threshold', 0.12)
        
        # Score tracking
        self.scores = {
            'headTiltScore': 100,
            'shoulderAlignmentScore': 100,
            'spinalPostureScore': 100,
            'overallScore': 100
        }
        
        # Metrics tracking
        self.metrics = {
            'headTiltCount': 0,
            'shoulderBendingCount': 0,
            'backBendingCount': 0,
            'totalCorrections': 0
        }
        
        # Eye health tracking
        self.eye_health = {
            'blinkCount': 0,
            'averageBlinkRate': 0,
            'lowBlinkWarnings': 0
        }

    def _init_kalman_filter(self):
        """Initialize Kalman filter for auto-framing"""
        kf = cv2.KalmanFilter(8, 4)
        kf.measurementMatrix = np.eye(4, 8, dtype=np.float32)
        
        # Transition matrix with velocity integration
        F = np.eye(8, dtype=np.float32)
        for i in range(4):
            F[i, i+4] = self.dt
        kf.transitionMatrix = F
        
        kf.processNoiseCov = np.eye(8, dtype=np.float32) * 1e-2
        kf.measurementNoiseCov = np.eye(4, dtype=np.float32) * 1e-1
        
        return kf

    def calculate_distance(self, p1, p2):
        """Calculate Euclidean distance between two points"""
        return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)

    def eye_aspect_ratio(self, landmarks, left_indices, right_indices):
        """Calculate eye aspect ratio for blink detection"""
        left_eye = [landmarks[i] for i in left_indices]
        right_eye = [landmarks[i] for i in right_indices]
        
        def eye_ratio(eye):
            return (math.dist((eye[1].x, eye[1].y), (eye[5].x, eye[5].y)) +
                    math.dist((eye[2].x, eye[2].y), (eye[4].x, eye[4].y))) / (
                    2.0 * math.dist((eye[0].x, eye[0].y), (eye[3].x, eye[3].y)))
        
        return (eye_ratio(left_eye) + eye_ratio(right_eye)) / 2.0

    def get_person_bounding_box(self, pose_landmarks, frame_shape):
        """Get bounding box around detected person"""
        if not pose_landmarks:
            return None

        h, w = frame_shape[:2]
        pts = [(lm.x * w, lm.y * h) 
               for lm in pose_landmarks.landmark 
               if lm.visibility >= self.min_visibility]
        
        if not pts:
            return None

        xs, ys = zip(*pts)
        x1, x2 = min(xs), max(xs)
        y1, y2 = min(ys), max(ys)

        # Dynamic padding
        pad_x = (x2 - x1) * 0.25 + self.auto_frame_margin
        pad_y = (y2 - y1) * 0.25 + self.auto_frame_margin

        x1 = max(0, x1 - pad_x)
        y1 = max(0, y1 - pad_y)
        x2 = min(w, x2 + pad_x)
        y2 = min(h, y2 + pad_y)

        return [int(x1), int(y1), int(x2 - x1), int(y2 - y1)]

    def apply_auto_framing(self, frame, pose_results):
        """Apply auto-framing with Kalman filtering"""
        if not self.auto_frame_enabled:
            return frame

        h, w = frame.shape[:2]
        
        # Update Kalman filter with measurement
        if hasattr(pose_results, 'pose_landmarks') and pose_results.pose_landmarks:
            meas = self.get_person_bounding_box(pose_results.pose_landmarks, frame.shape)
            if meas:
                z = np.array(meas, dtype=np.float32).reshape(4, 1)
                
                if not hasattr(self.kf_box, 'initialized'):
                    self.kf_box.statePost[:4, 0] = z[:, 0]
                    self.kf_box.statePost[4:, 0] = 0
                    self.kf_box.initialized = True
                
                self.kf_box.correct(z)
                
                # Predict with horizon
                prediction = self.kf_box.predict()
                x, y, bw, bh = prediction[:4, 0]
                
                # Preserve aspect ratio
                aspect = w / h
                if bw / bh > aspect:
                    nw, nh = bw, bw / aspect
                else:
                    nw, nh = bh * aspect, bh
                
                cx, cy = x + bw / 2, y + bh / 2
                fx = np.clip(cx - nw/2, 0, w - nw)
                fy = np.clip(cy - nh/2, 0, h - nh)
                self.current_frame_rect = [int(fx), int(fy), int(nw), int(nh)]

        # Apply cropping if we have a valid rect
        if self.current_frame_rect:
            x, y, cw, ch = self.current_frame_rect
            x = int(np.clip(x, 0, w - cw))
            y = int(np.clip(y, 0, h - ch))
            cw, ch = int(min(cw, w - x)), int(min(ch, h - y))
            
            if cw > 0 and ch > 0:
                crop = frame[y:y+ch, x:x+cw]
                if crop.size > 0:
                    frame = cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR)
                    # Add auto-framing indicator
                    cv2.rectangle(frame, (5, 5), (25, 25), (0, 255, 0), 2)

        return frame

    def analyze_posture(self, landmarks):
        """Analyze posture and return feedback and metrics"""
        feedback_messages = []
        issues = []
        metrics_update = {
            'headTiltIncrement': 0,
            'shoulderBendingIncrement': 0,
            'backBendingIncrement': 0
        }

        # Get landmark positions
        left_shoulder = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER]
        right_shoulder = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER]
        nose = landmarks[mp_pose.PoseLandmark.NOSE]
        left_hip = landmarks[mp_pose.PoseLandmark.LEFT_HIP]
        right_hip = landmarks[mp_pose.PoseLandmark.RIGHT_HIP]

        # Calculate measurements
        shoulder_width = abs(left_shoulder.x - right_shoulder.x)
        torso_mid = ((left_hip.x + right_hip.x) / 2, (left_hip.y + right_hip.y) / 2)
        torso_length = self.calculate_distance((nose.x, nose.y), torso_mid)
        
        ideal_neck_x = (left_shoulder.x + right_shoulder.x) / 2
        neck_deviation = abs(nose.x - ideal_neck_x)
        shoulder_deviation = abs(left_shoulder.y - right_shoulder.y)

        # Check proximity
        if shoulder_width > 0.6:
            feedback_messages.append("Move Back! You are too close to the screen.")
            issues.append({
                'type': 'proximity_warning',
                'severity': 'moderate',
                'description': 'Too close to screen'
            })
        elif shoulder_width < 0.48:
            feedback_messages.append("You are Leaning. Sit straight!")
            issues.append({
                'type': 'proximity_warning',
                'severity': 'mild',
                'description': 'Leaning forward'
            })

        # Check neck alignment
        neck_threshold_actual = self.neck_threshold * shoulder_width
        if neck_deviation > neck_threshold_actual:
            feedback_messages.append("Straighten your neck!")
            metrics_update['headTiltIncrement'] = 1
            self.scores['headTiltScore'] = max(60, self.scores['headTiltScore'] - 2)
            
            if nose.x > ideal_neck_x:
                feedback_messages.append("Move neck to the left.")
            else:
                feedback_messages.append("Move neck to the right.")
            
            issues.append({
                'type': 'head_tilt',
                'severity': 'moderate' if neck_deviation > neck_threshold_actual * 1.5 else 'mild',
                'description': f'Neck deviation: {neck_deviation:.3f}'
            })

        # Check shoulder alignment
        shoulder_threshold_actual = self.shoulder_threshold * torso_length
        if shoulder_deviation > shoulder_threshold_actual:
            feedback_messages.append("Align your shoulders!")
            metrics_update['shoulderBendingIncrement'] = 1
            self.scores['shoulderAlignmentScore'] = max(60, self.scores['shoulderAlignmentScore'] - 2)
            
            if left_shoulder.y > right_shoulder.y:
                feedback_messages.append("Put down your left shoulder.")
            else:
                feedback_messages.append("Put down your right shoulder.")
            
            issues.append({
                'type': 'shoulder_misalignment',
                'severity': 'moderate' if shoulder_deviation > shoulder_threshold_actual * 1.5 else 'mild',
                'description': f'Shoulder tilt: {shoulder_deviation:.3f}'
            })

        # Check spinal posture (simplified back bending detection)
        if torso_length < 0.3:  # Assuming normalized coordinates
            feedback_messages.append("Straighten Your Shoulders!")
            metrics_update['backBendingIncrement'] = 1
            self.scores['spinalPostureScore'] = max(60, self.scores['spinalPostureScore'] - 2)
            
            issues.append({
                'type': 'back_bending',
                'severity': 'moderate',
                'description': 'Slouching detected'
            })

        # Update overall score
        self.scores['overallScore'] = int(
            (self.scores['headTiltScore'] + 
             self.scores['shoulderAlignmentScore'] + 
             self.scores['spinalPostureScore']) / 3
        )

        return feedback_messages, issues, metrics_update

    def process_frame(self, frame):
        """Process a single frame and return analysis results"""
        results = {}
        
        # Flip frame for mirror view
        frame = cv2.flip(frame, 1)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Process with MediaPipe Pose
        pose_results = self.pose.process(rgb_frame)
        
        # Apply auto-framing
        frame = self.apply_auto_framing(frame, pose_results)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        feedback_messages = []
        issues = []
        metrics_update = {}
        
        if pose_results.pose_landmarks:
            landmarks = pose_results.pose_landmarks.landmark
            feedback_messages, issues, metrics_update = self.analyze_posture(landmarks)
            
            # Update metrics
            self.metrics['headTiltCount'] += metrics_update.get('headTiltIncrement', 0)
            self.metrics['shoulderBendingCount'] += metrics_update.get('shoulderBendingIncrement', 0)
            self.metrics['backBendingCount'] += metrics_update.get('backBendingIncrement', 0)
            self.metrics['totalCorrections'] = (
                self.metrics['headTiltCount'] + 
                self.metrics['shoulderBendingCount'] + 
                self.metrics['backBendingCount']
            )

        # Process face mesh for blink detection
        face_results = self.face_mesh.process(rgb_frame)
        eye_health_update = {'blinkIncrement': 0, 'lowBlinkWarning': False}
        
        if face_results.multi_face_landmarks:
            landmarks_face = face_results.multi_face_landmarks[0].landmark
            ear = self.eye_aspect_ratio(landmarks_face, self.left_eye_indices, self.right_eye_indices)
            
            if ear < 0.2:
                self.blink_count += 1
                eye_health_update['blinkIncrement'] = 1
            
            elapsed_time = time.time() - self.start_time
            if elapsed_time >= 60:  # Check every minute
                blink_rate = self.blink_count / (elapsed_time / 60)
                if blink_rate < 15:
                    feedback_messages.append("Blink More! Your eye blink rate is low.")
                    eye_health_update['lowBlinkWarning'] = True
                    self.eye_health['lowBlinkWarnings'] += 1
                
                self.eye_health['averageBlinkRate'] = blink_rate
                self.blink_count = 0
                self.start_time = time.time()

        # Calculate instantaneous scores for this frame
        instant_scores = {
            'instantHeadTiltScore': self.scores['headTiltScore'],
            'instantShoulderScore': self.scores['shoulderAlignmentScore'],
            'instantSpinalScore': self.scores['spinalPostureScore'],
            'instantOverallScore': self.scores['overallScore']
        }

        # Build posture data structure
        posture_data = {
            'posture': {
                'neckPosition': {
                    'x': landmarks[mp_pose.PoseLandmark.NOSE].x if pose_results.pose_landmarks else 0,
                    'y': landmarks[mp_pose.PoseLandmark.NOSE].y if pose_results.pose_landmarks else 0,
                    'deviation': abs(landmarks[mp_pose.PoseLandmark.NOSE].x - 
                                   ((landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER].x + 
                                     landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER].x) / 2)) 
                                   if pose_results.pose_landmarks else 0
                },
                'shoulderAlignment': {
                    'leftShoulder': {
                        'x': landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER].x if pose_results.pose_landmarks else 0,
                        'y': landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER].y if pose_results.pose_landmarks else 0
                    },
                    'rightShoulder': {
                        'x': landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER].x if pose_results.pose_landmarks else 0,
                        'y': landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER].y if pose_results.pose_landmarks else 0
                    },
                    'tiltAngle': abs(landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER].y - 
                                   landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER].y) if pose_results.pose_landmarks else 0
                },
                'spinalCurvature': {
                    'upperBack': 0,  # Would need more complex calculation
                    'lowerBack': 0,  # Would need more complex calculation
                    'overallBending': metrics_update.get('backBendingIncrement', 0)
                },
                'proximityToScreen': {
                    'shoulderWidth': abs(landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER].x - 
                                       landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER].x) if pose_results.pose_landmarks else 0,
                    'distanceCategory': 'optimal'  # Would be determined by shoulder width analysis
                }
            },
            'scores': instant_scores,
            'issues': issues,
            'metrics': metrics_update,
            'eyeHealth': eye_health_update
        }

        self.frame_count += 1
        return posture_data, feedback_messages

    def run(self):
        """Main processing loop"""
        cap = cv2.VideoCapture(0)
        
        # Set camera resolution
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        
        print("POSTURE_DETECTOR_READY", flush=True)
        
        try:
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                
                # Process frame
                posture_data, feedback_messages = self.process_frame(frame)
                
                # Output structured data
                if posture_data:
                    print(f"POSTURE_DATA:{json.dumps(posture_data)}", flush=True)
                
                if feedback_messages:
                    for message in feedback_messages:
                        feedback_data = {
                            'message': message,
                            'category': 'posture',
                            'severity': 'warning',
                            'timestamp': datetime.now().isoformat()
                        }
                        print(f"FEEDBACK:{json.dumps(feedback_data)}", flush=True)
                
                # Output scores every 30 frames (roughly every second)
                if self.frame_count % 30 == 0:
                    print(f"SCORES:{json.dumps(self.scores)}", flush=True)
                
                # Small delay to prevent overwhelming output
                time.sleep(0.033)  # ~30 FPS
                
        except KeyboardInterrupt:
            pass
        finally:
            cap.release()
            print("POSTURE_DETECTOR_STOPPED", flush=True)

def main():
    parser = argparse.ArgumentParser(description='Posture Detection Microservice')
    parser.add_argument('--user-id', required=True, help='User ID')
    parser.add_argument('--session-id', required=True, help='Session ID')
    parser.add_argument('--auto-frame-enabled', type=bool, default=True, help='Enable auto-framing')
    parser.add_argument('--auto-frame-margin', type=int, default=50, help='Auto-frame margin')
    parser.add_argument('--auto-frame-smoothing', type=float, default=0.3, help='Auto-frame smoothing')
    parser.add_argument('--neck-threshold', type=float, default=0.08, help='Neck deviation threshold')
    parser.add_argument('--shoulder-threshold', type=float, default=0.05, help='Shoulder tilt threshold')
    parser.add_argument('--back-threshold', type=float, default=0.12, help='Back bending threshold')
    
    args = parser.parse_args()
    
    config = {
        'user_id': args.user_id,
        'session_id': args.session_id,
        'auto_frame_enabled': args.auto_frame_enabled,
        'auto_frame_margin': args.auto_frame_margin,
        'auto_frame_smoothing': args.auto_frame_smoothing,
        'neck_threshold': args.neck_threshold,
        'shoulder_threshold': args.shoulder_threshold,
        'back_threshold': args.back_threshold
    }
    
    detector = PostureDetector(config)
    detector.run()

if __name__ == "__main__":
    main()
