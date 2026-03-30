@echo off
echo Migrating Cumulative Time Data...
echo.

cd Backend
node utils/migrateCumulativeTime.js

echo.
echo Migration Complete!
echo See Backend/logs/combined.log for details
echo.
pause
