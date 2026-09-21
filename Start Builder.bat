@echo off
setlocal
title Heritle Scene Builder

REM Double-click launcher for the scene builder.
REM
REM Runs from its own folder whichever way it was started, installs the
REM project dependencies the first time, then starts the builder and opens
REM it in your browser. Keep this window open while you work.

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or not on your PATH.
  echo.
  echo   Install it from https://nodejs.org
  echo   or run:  winget install OpenJS.NodeJS.LTS
  echo.
  echo   Then close this window and double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\maplibre-gl\package.json" (
  echo.
  echo   First run - setting things up. This takes a few minutes,
  echo   and only happens once.
  echo.
  REM --no-audit: see the note in Update.bat and the README.
  call npm install --no-audit
  if errorlevel 1 (
    echo.
    echo   Setup failed while installing dependencies.
    pause
    exit /b 1
  )
  echo.
  echo   Downloading the headless browser used to capture frames...
  call npx playwright install chromium
  if errorlevel 1 (
    echo.
    echo   Setup failed while downloading the browser.
    pause
    exit /b 1
  )
  echo.
  echo   Setup complete.
  echo.
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo.
  echo   NOTE: ffmpeg was not found, so renders will fail.
  echo   You can still build and preview scenes.
  echo   To fix:  winget install Gyan.FFmpeg   then reopen this window.
  echo.
)

node server.js

REM If the server stopped because of an error, hold the window open so the
REM message is readable rather than vanishing.
if errorlevel 1 pause
