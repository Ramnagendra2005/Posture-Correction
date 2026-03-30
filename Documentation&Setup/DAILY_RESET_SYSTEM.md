# Daily Reset System - Implementation Guide

## Overview

The Posture Correction system now includes a robust daily reset mechanism that ensures users get fresh statistics each day and their progress is properly tracked in the database. This system integrates the frontend React application with the Node.js/Express backend and MongoDB database.

## Features Implemented

### 🔄 **Daily Timer Reset**
- Timer resets automatically at 00:00:00 each day
- Today's tracking time is displayed in `hr:min:sec` format
- Real-time session tracking with persistent storage

### 📊 **Dynamic Score Display**
- Real-time posture scores from camera feed analysis
- Scores update live during active sessions
- Historical data preserved for progress tracking

### ✅ **Dynamic Corrections Counter**
- Live corrections count from posture analysis
- Incremental updates based on feedback from Python service
- Daily totals stored in database

### 💾 **Database Integration**
- All session data is automatically saved to MongoDB
- Daily summaries track progress over time
- User can see historical data when logging back in

## Technical Architecture

### Backend Changes

#### New API Endpoints

1. **`GET /api/posture/today-overview`**
   - Returns today's complete overview with real-time data
   - Includes timer in hr:min:sec format
   - Provides dynamic scores and corrections count
   - Handles daily reset logic

2. **`POST /api/posture/update-realtime`**
   - Updates database with real-time posture data
   - Called by frontend during active sessions
   - Maintains live synchronization between Python service and database

#### Enhanced Database Models

**DailySummary Schema Updates:**
```javascript
{
  userId: ObjectId,
  date: Date,              // Ensures daily reset
  totalTimeTracked: Number, // Minutes tracked today
  totalCorrections: {
    total: Number          // Total corrections for the day
  },
  averageScores: {
    overall: Number        // Current session average
  },
  lastReset: Date          // For frontend sync
}
```

### Frontend Changes

#### Analysis.jsx Enhancements

1. **Daily Reset Detection**
```javascript
// Check if this is a new day (timer reset)
const currentDate = new Date().toDateString();
const lastResetDate = new Date(overviewData.lastReset).toDateString();

if (currentDate !== lastResetDate) {
  // Reset daily counters
  setCorrectionsCount(0);
  setSessionStartTime(null);
  setElapsedTime(0);
}
```

2. **Real-time Timer Implementation**
```javascript
// Format time in hr:min:sec
const formatTime = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};
```

3. **Backend Integration**
```javascript
// Update backend with real-time data
const updateBackendRealtime = async (scores, corrections) => {
  await fetch("http://localhost:3000/api/posture/update-realtime", {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ scores, corrections, sessionTime: elapsedTime })
  });
};
```

## Data Flow

### Session Start Flow
1. User clicks "Start Analysis"
2. Frontend calls backend `/api/sessions/start`
3. Backend creates new session in database
4. Frontend calls Python service `/start_analysis`
5. Python service begins camera analysis
6. Real-time updates begin flowing

### Real-time Updates Flow
1. Python service generates posture analysis data
2. Frontend polls `/feedback` endpoint every second
3. Frontend updates UI with live scores/corrections
4. Frontend calls `/api/posture/update-realtime` to sync database
5. Backend updates daily summary in real-time

### Session End Flow
1. User clicks "Stop Analysis" 
2. Frontend calls Python service `/stop_analysis`
3. Python service returns session summary
4. Frontend calls backend `/api/sessions/stop`
5. Backend saves complete session data
6. Daily summary is updated with final totals

### Daily Reset Flow
1. User logs in on new day
2. Frontend calls `/api/posture/today-overview`
3. Backend detects new date, creates fresh daily summary
4. Frontend receives reset indicator
5. Frontend resets local counters and timers
6. Fresh tracking begins for new day

## Database Collections

### PostureSession
- Individual session records
- Start/end times, duration, scores
- Links to user and daily summary

### DailySummary  
- One record per user per day
- Aggregated statistics for the day
- Automatic daily reset at midnight

### User
- User account information
- Preferences and settings
- Authentication data

## Configuration

### Environment Variables
```bash
# Backend (Node.js)
MONGODB_URI=mongodb://localhost:27017/posture_correction
JWT_SECRET=your_jwt_secret_key
FRONTEND_URL=http://localhost:5173

# Frontend (React)
VITE_API_URL=http://localhost:3000
VITE_PYTHON_SERVICE_URL=http://localhost:5001
```

### Service URLs
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000  
- **Python Service**: http://localhost:5001
- **MongoDB**: mongodb://localhost:27017

## Usage Instructions

### For Users

1. **Login to System**
   - Use existing account or create new one
   - Daily data automatically resets each day

2. **Start Posture Analysis**
   - Click "Start Analysis" button
   - Allow camera permissions
   - Timer begins tracking in real-time

3. **Monitor Real-time Data**
   - View live posture scores
   - See corrections count increase
   - Watch timer increment in hr:min:sec format

4. **Stop Session**
   - Click "Stop Analysis"
   - All data is automatically saved
   - View session summary

5. **Daily Progress**
   - Return next day to see fresh counters
   - Historical data preserved in profile
   - Progress trends available in reports

### For Developers

1. **Start Backend Services**
```bash
cd Backend
npm install
npm start
```

2. **Start Frontend**
```bash
cd Frontend  
npm install
npm run dev
```

3. **Start Python Service**
```bash  
cd Backend/python
pip install -r requirements.txt
python posture_detector.py
```

4. **Database Setup**
```bash
# MongoDB should be running on localhost:27017
# Collections are created automatically
```

## Benefits

### ✨ **User Experience**
- **Clear Progress Tracking**: See exactly how much time spent each day
- **Real-time Feedback**: Live updates during posture analysis sessions  
- **Historical Data**: Progress preserved across login sessions
- **Daily Fresh Start**: Clean slate each day for motivation

### 🛠 **Technical Benefits**
- **Data Persistence**: All session data safely stored in database
- **Real-time Sync**: Frontend and backend stay synchronized
- **Scalable Architecture**: Supports multiple users with isolated daily data
- **Robust Error Handling**: Graceful fallbacks for service interruptions

### 📈 **Analytics Benefits**
- **Trend Analysis**: Track posture improvement over time
- **Session Insights**: Detailed breakdown of each monitoring session
- **Daily Summaries**: Quick overview of daily posture health
- **Progress Reports**: Visual representation of posture journey

## Future Enhancements

- [ ] Weekly/Monthly summary reports
- [ ] Posture goal setting and tracking
- [ ] Social features for posture challenges
- [ ] Advanced analytics and machine learning insights
- [ ] Mobile app integration
- [ ] Wearable device integration

## Troubleshooting

### Common Issues

1. **Timer Not Resetting**
   - Check system date/time settings
   - Verify backend `/today-overview` endpoint response
   - Clear browser localStorage if needed

2. **Real-time Updates Not Working**  
   - Ensure Python service is running on port 5001
   - Check network connectivity between services
   - Verify authentication token is valid

3. **Data Not Persisting**
   - Confirm MongoDB is running and accessible
   - Check backend database connection
   - Verify user authentication

4. **Session Not Starting**
   - Check camera permissions in browser
   - Ensure Python service endpoints are accessible
   - Verify backend session management

This implementation provides a comprehensive daily reset system that enhances user experience while maintaining robust data tracking and analytics capabilities.
