# 🚀 Smart Posture Monitoring System - Setup Guide

## Overview
This system has been migrated from Flask to a modern Node.js + Python microservice architecture with JWT authentication.

## Architecture
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   React App     │    │   Node.js API    │    │  Python Microservice│
│   (Port 5173)   │◄──►│   (Port 3000)    │◄──►│    (Port 5001)      │
│                 │    │                  │    │                     │
│ - Authentication│    │ - JWT Auth       │    │ - Posture Detection │
│ - Dashboard     │    │ - User Management│    │ - Video Processing  │
│ - Real-time UI  │    │ - MongoDB        │    │ - OpenCV/MediaPipe  │
│ - Socket.IO     │    │ - Socket.IO      │    │ - Auto-framing      │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
```

## Prerequisites
- Node.js 18+ 
- Python 3.8+
- MongoDB (local or cloud)
- Webcam/Camera
- Git

## 🛠️ Installation Steps

### 1. Install Node.js Dependencies
```bash
cd Frontend
npm install socket.io-client
npm install

cd ../Backend  
npm install
```

### 2. Install Python Dependencies
```bash
cd Backend
pip install flask flask-cors opencv-python mediapipe numpy
# OR
pip install -r python/requirements.txt
```

### 3. Setup MongoDB
Option A - Local MongoDB:
```bash
# Install MongoDB Community Edition
# Start MongoDB service
mongod --dbpath /path/to/your/db
```

Option B - MongoDB Atlas (Cloud):
1. Create account at https://cloud.mongodb.com
2. Create cluster and get connection string

### 4. Environment Configuration
Create `Backend/.env`:
```env
# Database
MONGODB_URI=mongodb://localhost:27017/posture_monitoring
# or MongoDB Atlas: mongodb+srv://username:password@cluster.mongodb.net/posture_monitoring

# Authentication
JWT_SECRET=your_super_secret_jwt_key_here_make_it_long_and_random

# CORS
FRONTEND_URL=http://localhost:5173

# Server
PORT=3000
NODE_ENV=development

# Python Service
PYTHON_SERVICE_URL=http://localhost:5001
```

### 5. Start the Services

#### Terminal 1 - MongoDB (if local)
```bash
mongod
```

#### Terminal 2 - Node.js Backend
```bash
cd Backend
node server.js
```
Output: `🚀 Server running on port 3000`

#### Terminal 3 - Python Posture Service  
```bash
cd Backend
python posture_detector.py
```
Output: `Starting Posture Detection Service...`

#### Terminal 4 - React Frontend
```bash
cd Frontend
npm run dev
```
Output: `Local: http://localhost:5173/`

## 📱 Usage

1. **Open Browser**: Navigate to `http://localhost:5173`

2. **Sign Up/Login**: 
   - Create account with email/password
   - JWT tokens stored in localStorage

3. **Start Monitoring**:
   - Click "Start Your Analysis" 
   - Allow camera permissions
   - Real-time posture feedback appears

4. **View Reports**:
   - Navigate to Reports section
   - View analytics and trends
   - Data stored in MongoDB

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login  
- `GET /api/auth/verify` - Verify JWT token

### User Management
- `GET /api/user/profile` - Get user profile
- `PUT /api/user/profile` - Update profile

### Posture Sessions
- `POST /api/session/start` - Start monitoring
- `POST /api/session/end` - Stop monitoring
- `GET /api/session/current` - Get active session

### Reports & Analytics
- `GET /api/reports/analytics` - Comprehensive analytics
- `GET /api/reports/daily` - Daily summaries
- `GET /api/reports/weekly` - Weekly trends

### Posture Detection Service (Python)
- `GET /video_feed` - Live video stream
- `GET /feedback` - Real-time posture feedback
- `POST /toggle_auto_frame` - Toggle auto-framing

## 🔄 Real-time Communication

Socket.IO events:
- `postureData` - Real-time posture analysis
- `sessionUpdate` - Session progress updates  
- `connect` - Client connection
- `disconnect` - Client disconnection

## 📊 Database Schema

### Users Collection
```javascript
{
  _id: ObjectId,
  email: String,
  password: String (hashed),
  name: String,
  createdAt: Date,
  lastLogin: Date
}
```

### PostureSessions Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  startTime: Date,
  endTime: Date,
  duration: Number,
  averageScore: Number,
  totalCorrections: Number
}
```

### PosturePatterns Collection
```javascript
{
  _id: ObjectId,
  sessionId: ObjectId,
  timestamp: Date,
  scores: {
    headTilt: Number,
    shoulderAlignment: Number,
    spinalPosture: Number,
    hipBalance: Number,
    legPosition: Number,
    overallScore: Number
  },
  feedback: [String]
}
```

## 🚨 Troubleshooting

### Common Issues

**Port Conflicts:**
```bash
# Kill processes on specific ports
npx kill-port 3000 5001 5173
```

**Camera Access:**
- Ensure browser has camera permissions
- Check if camera is being used by other apps
- Try different browsers (Chrome recommended)

**MongoDB Connection:**
```bash
# Test MongoDB connection
mongosh "mongodb://localhost:27017/posture_monitoring"
```

**Python Dependencies:**
```bash
# Install with specific versions
pip install opencv-python==4.8.1.78 mediapipe==0.10.3
```

### Logs & Debugging

**Node.js Logs:**
- Server logs appear in Terminal 2
- Winston logs saved to `logs/` directory

**Python Service Logs:**
- Posture detection logs in Terminal 3
- OpenCV errors indicate camera issues

**Frontend Console:**
- Open browser DevTools (F12)
- Check Console tab for errors
- Network tab shows API calls

## 🎯 Key Features

✅ **JWT Authentication** - Secure login/signup  
✅ **Real-time Monitoring** - Live posture analysis  
✅ **Auto-framing** - Automatic camera adjustment  
✅ **MongoDB Storage** - Persistent data storage  
✅ **Socket.IO** - Real-time communication  
✅ **Responsive Design** - Mobile-friendly UI  
✅ **Analytics Dashboard** - Comprehensive reports  
✅ **Microservice Architecture** - Scalable design  

## 🆕 Migration Benefits

- **Modern Tech Stack**: Node.js + React + MongoDB
- **Better Security**: JWT instead of OAuth dependency  
- **Real-time Updates**: Socket.IO for live data
- **Scalable Architecture**: Separated concerns
- **Better Performance**: Optimized data flow
- **Maintainable Code**: Clean separation of services

## 📞 Support

If you encounter issues:
1. Check this guide first
2. Verify all services are running  
3. Check browser console for errors
4. Ensure camera permissions are granted
5. Restart services if needed

---

**Happy Monitoring! 📊✨**
