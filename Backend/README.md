# Posture Monitoring Backend

A comprehensive Node.js/Express backend for real-time posture monitoring with auto-framing capabilities, featuring JWT authentication, MongoDB integration, and Python-based computer vision.

## 🚀 Features

### Core Functionality
- **Real-time Posture Detection**: Computer vision-powered posture analysis
- **Auto-framing**: Intelligent camera framing with Kalman filtering
- **User Authentication**: JWT-based login/signup system
- **Session Management**: Track and store posture sessions
- **Comprehensive Analytics**: Detailed reporting and trend analysis

### Posture Metrics Tracked
- **Head Tilt**: Neck position and alignment
- **Shoulder Alignment**: Shoulder level and positioning
- **Spinal Posture**: Back bending and slouching detection
- **Eye Health**: Blink rate monitoring
- **Proximity**: Distance from screen detection

### Data & Analytics
- Session-based tracking with start/stop functionality
- Daily, weekly, and monthly trend analysis
- Posture pattern storage for detailed insights
- Real-time scoring system (0-100 scale)
- Chart-ready data for frontend visualization

## 🛠 Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT tokens with bcrypt hashing
- **Real-time Communication**: Socket.IO
- **Computer Vision**: Python with OpenCV and MediaPipe
- **Security**: Helmet, CORS, Rate limiting
- **Validation**: Express-validator
- **Logging**: Winston

## 📁 Project Structure

```
Backend/
├── server.js                 # Main server configuration
├── package.json              # Node.js dependencies
├── .env.example              # Environment variables template
├── models/
│   └── index.js              # MongoDB schemas (User, Session, Pattern, DailySummary)
├── routes/
│   ├── auth.js               # Authentication endpoints
│   ├── user.js               # User profile management
│   ├── session.js            # Session management
│   ├── posture.js            # Posture control endpoints
│   └── reports.js            # Analytics and reporting
├── middleware/
│   ├── auth.js               # JWT authentication middleware
│   └── errorHandler.js       # Global error handling
├── services/
│   └── postureService.js     # Core posture monitoring service
├── utils/
│   └── logger.js             # Winston logging configuration
├── backend.py                # Python posture detection microservice
├── requirements.txt          # Python dependencies
└── logs/                     # Application logs
```

## 🚀 Quick Start

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (local or Atlas)
- Python 3.8+
- Webcam for posture detection

### Installation

1. **Clone and navigate to backend directory**
```bash
cd Backend
```

2. **Install Node.js dependencies**
```bash
npm install
```

3. **Install Python dependencies**
```bash
pip install -r requirements.txt
```

4. **Environment Setup**
```bash
cp .env.example .env
# Edit .env with your configuration
```

5. **Start MongoDB**
```bash
# If using local MongoDB
mongod

# Or ensure MongoDB Atlas connection is configured
```

6. **Run the application**
```bash
# Development mode
npm run dev

# Production mode
npm start
```

## 🔧 Configuration

### Environment Variables (.env)

```env
# Server Configuration
NODE_ENV=development
PORT=5000

# Database
MONGODB_URI=mongodb://localhost:27017/posture_monitoring

# JWT Security
JWT_SECRET=your_super_secure_jwt_secret_key_here_minimum_32_characters
JWT_EXPIRE=7d

# CORS
FRONTEND_URL=http://localhost:5173

# Python Service
PYTHON_EXECUTABLE=python

# Rate Limiting
MAX_REQUESTS_PER_WINDOW=100
WINDOW_MS=900000
```

### MongoDB Setup

The application automatically creates the following collections:
- `users` - User accounts and preferences
- `posturesessions` - Monitoring sessions
- `posturepatterns` - Detailed posture data points
- `dailysummaries` - Aggregated daily statistics

## 📡 API Endpoints

### Authentication
```http
POST /api/auth/register     # Register new user
POST /api/auth/login        # User login
POST /api/auth/refresh      # Refresh JWT token
POST /api/auth/logout       # User logout
GET  /api/auth/me          # Get current user info
```

### User Management
```http
GET  /api/user/profile      # Get user profile
PUT  /api/user/profile      # Update profile
PUT  /api/user/preferences  # Update preferences
GET  /api/user/preferences  # Get preferences
POST /api/user/change-password  # Change password
DELETE /api/user/account    # Deactivate account
```

### Session Management
```http
POST /api/sessions/start    # Start monitoring session
POST /api/sessions/stop     # Stop active session
GET  /api/sessions/active   # Get active session info
GET  /api/sessions          # Get session history (paginated)
GET  /api/sessions/:id      # Get specific session details
GET  /api/sessions/:id/patterns  # Get session posture patterns
PATCH /api/sessions/:id     # Update session (pause/resume)
```

### Posture Control
```http
GET  /api/posture/stream    # Video stream info
POST /api/posture/toggle-auto-frame  # Toggle auto-framing
POST /api/posture/auto-frame-settings  # Update auto-frame settings
GET  /api/posture/settings  # Get posture settings
POST /api/posture/calibrate # Calibrate detection thresholds
GET  /api/posture/status    # Get monitoring status
POST /api/posture/feedback  # Submit manual feedback
```

### Reports & Analytics
```http
GET  /api/reports/overview  # General statistics
GET  /api/reports/daily-trends  # Daily posture trends
GET  /api/reports/correction-breakdown  # Correction type breakdown
GET  /api/reports/session-comparison  # Session-by-session comparison
GET  /api/reports/hourly-patterns  # Hourly posture patterns
GET  /api/reports/posture-patterns  # Detailed posture patterns
GET  /api/reports/weekly-summary  # Weekly summary with trends
```

## 🔌 Real-time Communication (Socket.IO)

### Client Connection
```javascript
const socket = io('http://localhost:5000', {
  auth: {
    token: 'your_jwt_token_here'
  }
});
```

### Events

**Client to Server:**
- `start_posture_monitoring` - Begin monitoring
- `stop_posture_monitoring` - End monitoring

**Server to Client:**
- `monitoring_started` - Session started confirmation
- `monitoring_stopped` - Session ended confirmation
- `posture_data` - Real-time posture data
- `posture_feedback` - Feedback messages
- `score_update` - Score updates

## 🐍 Python Microservice

The Python service (`backend.py`) handles:
- Camera capture and processing
- MediaPipe pose/face detection
- Auto-framing with Kalman filtering
- Real-time posture analysis
- Structured data output to Node.js

### Running Python Service Standalone
```bash
cd Backend
python backend.py
```

## 📊 Data Models

### User Schema
```javascript
{
  username: String,
  email: String,
  password: String (hashed),
  firstName: String,
  lastName: String,
  preferences: {
    autoFraming: { enabled, margin, smoothing },
    notifications: { enabled, frequency },
    thresholds: { neckDeviation, shoulderTilt, backBending }
  }
}
```

### Posture Session Schema
```javascript
{
  userId: ObjectId,
  startTime: Date,
  endTime: Date,
  duration: Number, // minutes
  status: 'active' | 'paused' | 'completed',
  postureMetrics: {
    headTiltCount: Number,
    shoulderBendingCount: Number,
    backBendingCount: Number,
    totalCorrections: Number
  },
  scores: {
    headTiltScore: Number,
    shoulderAlignmentScore: Number,
    spinalPostureScore: Number,
    overallScore: Number
  },
  eyeHealth: {
    blinkCount: Number,
    averageBlinkRate: Number,
    lowBlinkWarnings: Number
  }
}
```

## 🔒 Security Features

- JWT token authentication
- Password hashing with bcrypt
- Rate limiting (100 requests per 15 minutes)
- CORS protection
- Input validation and sanitization
- Helmet security headers
- Environment variable protection

## 📈 Analytics & Reporting

The backend provides comprehensive analytics:

1. **Real-time Metrics**: Live posture scores and corrections
2. **Session Analytics**: Individual session performance
3. **Daily Trends**: Day-over-day improvement tracking
4. **Weekly Summaries**: Weekly progress with improvement indicators
5. **Hourly Patterns**: Time-of-day posture patterns
6. **Correction Breakdown**: Analysis by correction type

All data is formatted for easy integration with Chart.js on the frontend.

## 🚨 Error Handling

- Centralized error handling middleware
- Structured error responses
- Comprehensive logging with Winston
- Graceful shutdown handling
- Database connection error recovery

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## 📝 Logging

Logs are written to:
- `logs/combined.log` - All application logs
- `logs/error.log` - Error logs only
- Console output in development

Log levels: error, warn, info, http, debug

## 🔄 Data Flow

1. **Authentication**: User logs in → JWT token issued
2. **Session Start**: Frontend requests session start → Python service launched
3. **Real-time Processing**: Python analyzes video → Sends data to Node.js → Stored in MongoDB → Pushed to frontend via Socket.IO
4. **Session End**: Stop request → Python service terminated → Session data finalized
5. **Analytics**: Frontend requests reports → Node.js aggregates data from MongoDB → Returns chart-ready data

## 🤝 Integration with Frontend

This backend is designed to work seamlessly with a React frontend using:
- Axios for HTTP requests
- Socket.IO client for real-time data
- Chart.js for data visualization
- JWT token management

## 📋 TODO / Future Enhancements

- [ ] Add data export functionality (CSV, PDF)
- [ ] Implement user groups/teams
- [ ] Add email notifications
- [ ] Mobile app API endpoints
- [ ] Advanced ML posture recommendations
- [ ] Integration with health tracking devices

## 🆘 Troubleshooting

### Common Issues

1. **MongoDB Connection**: Ensure MongoDB is running and connection string is correct
2. **Python Dependencies**: Install OpenCV and MediaPipe in Python environment
3. **Camera Access**: Ensure webcam permissions are granted
4. **Port Conflicts**: Check if ports 5000 and 5001 are available

### Debug Mode
```bash
LOG_LEVEL=debug npm run dev
```

## 📄 License

MIT License - See LICENSE file for details

## 👥 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

**Built with ❤️ for better posture and health**
