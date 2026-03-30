# Posture Correction System

A comprehensive web application for real-time posture monitoring and analysis.

## Getting Started

### Prerequisites

- Node.js 16+ installed
- MongoDB instance running
- Python 3.7+ with OpenCV installed (for posture detection)

### Backend Setup

1. Navigate to the Backend directory
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with the following configuration:
   ```
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/posture_monitoring
   JWT_SECRET=your_jwt_secret
   FRONTEND_URL=http://localhost:5173
   ```

4. Start the backend server:
   ```
   npm start
   ```
   Or use the provided batch file:
   ```
   start_backend.bat
   ```

### Frontend Setup

1. Navigate to the Frontend directory
2. Install dependencies:
   ```
   npm install
   ```
3. Start the development server:
   ```
   npm run dev
   ```
   
### Troubleshooting Connection Issues

If you encounter connection issues between the frontend and backend:

1. Make sure both servers are running
2. Verify the backend is running on port 5000
3. Check that all frontend API calls are targeting http://localhost:5000

## Features

- Real-time posture monitoring
- Visual feedback on posture issues
- Daily and cumulative time tracking
- Analytics dashboard with posture trends
- Session history and reporting

## Daily Reset System

The system includes a daily reset feature that resets daily tracking metrics at midnight while preserving cumulative time statistics. See `CUMULATIVE_TIME_TRACKING.md` for more information on how this works.

## Running the Migration

To add cumulative time tracking to existing user data, run:

```
migrate_cumulative_time.bat
```
