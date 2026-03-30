@echo off
echo ================================================
echo  Smart Posture Monitoring System - Startup
echo ================================================
echo.

echo Checking if MongoDB is running...
tasklist /FI "IMAGENAME eq mongod.exe" 2>NUL | find /I /N "mongod.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    echo ✓ MongoDB is running
) else (
    echo ⚠ MongoDB not detected. Please start MongoDB first:
    echo   mongod --dbpath C:\data\db
    echo.
    pause
    exit /b 1
)

echo.
echo Starting services...
echo.

REM Start Node.js backend in new window
echo Starting Node.js Backend (Port 3000)...
start "Node.js Backend" cmd /k "cd /d %~dp0Backend && node server.js"

REM Wait a moment
timeout /t 3 /nobreak >nul

REM Start Python posture service in new window
echo Starting Python Posture Service (Port 5001)...
start "Python Posture Service" cmd /k "cd /d %~dp0Backend && python backend.py"

REM Wait a moment
timeout /t 3 /nobreak >nul

REM Start React frontend in new window
echo Starting React Frontend (Port 5173)...
start "React Frontend" cmd /k "cd /d %~dp0Frontend && npm run dev"

echo.
echo ================================================
echo  All services started!
echo ================================================
echo.
echo Services running:
echo  - Node.js Backend: http://localhost:3000
echo  - Python Service:  http://localhost:5001  
echo  - React Frontend:  http://localhost:5173
echo.
echo The React app should open automatically.
echo If not, navigate to: http://localhost:5173
echo.
echo Press any key to exit this window...
pause >nul
