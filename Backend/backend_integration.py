#!/usr/bin/env python3
"""
Backend Integration Service
This service integrates the Python posture detection with the Node.js backend
for persistent data storage and session management.
"""

import requests
import json
import time
from datetime import datetime, timedelta
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class BackendIntegration:
    def __init__(self, backend_url="http://localhost:3000", auth_token=None):
        self.backend_url = backend_url
        self.auth_token = auth_token
        self.session_id = None
        self.session_start_time = None
        self.corrections_count = 0
        
    def set_auth_token(self, token):
        """Set the authentication token for backend requests"""
        self.auth_token = token
        
    def get_headers(self):
        """Get request headers with authorization"""
        headers = {'Content-Type': 'application/json'}
        if self.auth_token:
            headers['Authorization'] = f'Bearer {self.auth_token}'
        return headers
    
    def start_session(self, user_data=None):
        """Start a new monitoring session in the backend"""
        try:
            endpoint = f"{self.backend_url}/api/sessions/start"
            payload = {
                'cameraResolution': '1280x720',
                'userAgent': 'Python Posture Detection Service',
                'platform': 'Python'
            }
            if user_data:
                payload.update(user_data)
                
            response = requests.post(endpoint, json=payload, headers=self.get_headers())
            
            if response.status_code == 201:
                data = response.json()
                self.session_id = data['data']['sessionId']
                self.session_start_time = datetime.now()
                self.corrections_count = 0
                logger.info(f"Session started successfully: {self.session_id}")
                return True
            else:
                logger.error(f"Failed to start session: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"Error starting session: {e}")
            return False
    
    def update_realtime_data(self, scores, corrections_count=None):
        """Update real-time posture data in the backend"""
        try:
            endpoint = f"{self.backend_url}/api/posture/update-realtime"
            
            # Calculate session time
            session_time = 0
            if self.session_start_time:
                session_time = int((datetime.now() - self.session_start_time).total_seconds())
            
            # Update corrections count if provided
            if corrections_count is not None:
                self.corrections_count = corrections_count
            
            payload = {
                'scores': scores,
                'corrections': self.corrections_count,
                'sessionTime': session_time
            }
            
            response = requests.post(endpoint, json=payload, headers=self.get_headers())
            
            if response.status_code == 200:
                return True
            else:
                logger.warning(f"Failed to update real-time data: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"Error updating real-time data: {e}")
            return False
    
    def stop_session(self, session_summary=None):
        """Stop the current monitoring session"""
        try:
            # Stop session in backend
            endpoint = f"{self.backend_url}/api/sessions/stop"
            response = requests.post(endpoint, headers=self.get_headers())
            
            if response.status_code == 200:
                logger.info("Session stopped successfully")
                
                # Save session data if provided
                if session_summary:
                    self.save_session_data(session_summary)
                
                # Reset session variables
                self.session_id = None
                self.session_start_time = None
                self.corrections_count = 0
                
                return True
            else:
                logger.error(f"Failed to stop session: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"Error stopping session: {e}")
            return False
    
    def save_session_data(self, session_summary):
        """Save detailed session data to the backend"""
        try:
            endpoint = f"{self.backend_url}/api/posture/save-session"
            
            # Prepare session data
            session_data = {
                'sessionId': self.session_id or f'python-session-{int(time.time())}',
                'duration': session_summary.get('duration', 0),
                'durationMinutes': session_summary.get('duration_minutes', 0),
                'averageScores': session_summary.get('average_scores', {}),
                'totalFeedbackCount': session_summary.get('total_feedback_count', self.corrections_count),
                'blinkRate': session_summary.get('blink_rate', 0),
                'scoresHistory': session_summary.get('scores_history', []),
                'feedbackHistory': session_summary.get('feedback_history', [])
            }
            
            response = requests.post(endpoint, json=session_data, headers=self.get_headers())
            
            if response.status_code == 200:
                logger.info("Session data saved successfully")
                return True
            else:
                logger.error(f"Failed to save session data: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"Error saving session data: {e}")
            return False
    
    def get_today_overview(self):
        """Get today's overview data from the backend"""
        try:
            endpoint = f"{self.backend_url}/api/posture/today-overview"
            response = requests.get(endpoint, headers=self.get_headers())
            
            if response.status_code == 200:
                return response.json()['data']
            else:
                logger.warning(f"Failed to get today's overview: {response.status_code}")
                return None
                
        except Exception as e:
            logger.error(f"Error getting today's overview: {e}")
            return None
    
    def increment_corrections(self):
        """Increment the corrections counter"""
        self.corrections_count += 1

# Example usage class for integration with posture detection
class PostureDetectionService:
    def __init__(self):
        self.backend = BackendIntegration()
        self.current_scores = {
            'headTilt': 100,
            'shoulderAlignment': 100,
            'spinalPosture': 100,
            'overallScore': 100
        }
        self.feedback_history = []
        
    def set_auth_token(self, token):
        """Set authentication token"""
        self.backend.set_auth_token(token)
        
    def start_monitoring(self):
        """Start posture monitoring with backend integration"""
        if self.backend.start_session():
            logger.info("Posture monitoring started with backend integration")
            return True
        return False
        
    def update_posture_scores(self, new_scores):
        """Update posture scores and sync with backend"""
        self.current_scores.update(new_scores)
        
        # Update backend with new scores
        self.backend.update_realtime_data(self.current_scores)
        
    def add_correction_feedback(self, feedback_message):
        """Add correction feedback and increment counter"""
        self.feedback_history.append({
            'timestamp': datetime.now().isoformat(),
            'message': feedback_message
        })
        
        # Increment corrections counter
        self.backend.increment_corrections()
        
        # Update backend with new correction count
        self.backend.update_realtime_data(self.current_scores, self.backend.corrections_count)
        
    def stop_monitoring(self):
        """Stop monitoring and save session data"""
        session_summary = {
            'duration': int((datetime.now() - self.backend.session_start_time).total_seconds()) if self.backend.session_start_time else 0,
            'duration_minutes': int((datetime.now() - self.backend.session_start_time).total_seconds() / 60) if self.backend.session_start_time else 0,
            'average_scores': self.current_scores,
            'total_feedback_count': self.backend.corrections_count,
            'feedback_history': self.feedback_history,
            'blink_rate': 15  # Default blink rate
        }
        
        return self.backend.stop_session(session_summary)


if __name__ == "__main__":
    # Example usage
    service = PostureDetectionService()
    
    # This would typically be set from the frontend authentication
    # service.set_auth_token("your-jwt-token-here")
    
    print("Backend Integration Service Example")
    print("This service integrates Python posture detection with the Node.js backend")
    print("for persistent data storage and daily timer reset functionality.")
