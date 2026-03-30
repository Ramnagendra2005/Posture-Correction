@echo off
echo ================================
echo  Posture Correction System
echo  Enhanced with Daily Reset
echo ================================
echo.

echo [1/4] Starting MongoDB...
net start MongoDB 2>nul
if %errorlevel% neq 0 (
    echo MongoDB service not found or already running
) else (
    echo MongoDB started successfully
)
echo.

echo [2/4] Starting Backend API Server...
cd Backend
start "Backend API" cmd /k "npm start"
timeout /t 3 /nobreak >nul
echo Backend API starting on http://localhost:3000
echo.

echo [3/4] Starting Python Posture Detection Service...
start "Python Service" cmd /k "python backend.py"
timeout /t 3 /nobreak >nul
echo Python service starting on http://localhost:5001
echo.

echo [4/4] Starting Frontend Application...
cd ..\Frontend
start "Frontend" cmd /k "npm run dev"
timeout /t 3 /nobreak >nul
echo Frontend starting on http://localhost:5173
echo.

echo ================================
echo  System Status
echo ================================
echo Frontend:       http://localhost:5173
echo Backend API:    http://localhost:3000
echo Python Service: http://localhost:5001
echo MongoDB:        mongodb://localhost:27017
echo.
echo ================================
echo  Daily Reset Features
echo ================================
echo ✅ Timer resets daily at midnight
echo ✅ Real-time score updates
echo ✅ Dynamic corrections counter
echo ✅ Database persistence
echo ✅ User progress tracking
echo.
echo Press any key to open the application...
pause >nul

start "" "http://localhost:5173"

echo.
echo All services are running!
echo Press Ctrl+C in each window to stop services
echo.
pause
