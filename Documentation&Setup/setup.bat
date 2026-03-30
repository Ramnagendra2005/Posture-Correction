@echo off
echo 🚀 Smart Posture System - Quick Setup
echo ================================

echo.
echo 📦 Installing Python dependencies...
pip install flask flask-cors opencv-python mediapipe numpy

echo.
echo 📦 Installing Node.js dependencies...
cd Backend
call npm install
cd ..

cd Frontend  
call npm install
cd ..

echo.
echo ✅ Setup complete! 
echo.
echo 🎯 To start the system:
echo 1. Start MongoDB (in separate terminal): mongod
echo 2. Start Node.js backend: cd Backend && node server.js  
echo 3. Start Python service: cd Backend && python posture_detector.py
echo 4. Start frontend: cd Frontend && npm run dev
echo.
echo 📱 Then open: http://localhost:5173
echo.
pause
