@echo off
title AI Assistant - connect Google Calendar
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run setup_windows.bat first.
  pause & exit /b 1
)
echo A browser window will open to allow calendar access.
echo If it says "Google hasn't verified this app", click Continue - the app is yours.
echo.
".venv\Scripts\python.exe" -m assistant connect calendar
echo.
pause
