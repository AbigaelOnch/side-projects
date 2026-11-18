@echo off
title Assistant
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run setup_windows.bat first.
  pause & exit /b 1
)
".venv\Scripts\python.exe" -c "import flask" 2>nul || (
  echo Installing the assistant's web interface - one time only...
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt --quiet || (echo Install failed. & pause & exit /b 1)
)
if exist ".venv\Scripts\pythonw.exe" (
  rem  Start with no console window. Close the assistant from its Quit button.
  start "" ".venv\Scripts\pythonw.exe" -m assistant ui
) else (
  ".venv\Scripts\python.exe" -m assistant ui
)
