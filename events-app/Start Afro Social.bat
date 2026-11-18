@echo off
setlocal
cd /d "%~dp0"
title Afro Social

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem Already running? Just open it (S-072).
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3000/api/version; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo Afro Social is already running. Opening it...
  start "" http://localhost:3000
  exit /b 0
)

if not exist node_modules (
  echo First run: installing. This takes a minute or two...
  call npm install
  if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)
if not exist .env.local copy .env.example .env.local >nul
if not exist data\app.db (
  echo Adding sample events so there is something to look at...
  call npm run seed
)

echo Starting Afro Social at http://localhost:3000
echo Keep this window open while you use it. Close it to stop the app.
start "" /min powershell -NoProfile -Command "Start-Sleep 6; Start-Process http://localhost:3000"
call npm run dev
