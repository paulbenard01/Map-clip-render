@echo off
setlocal
title Update Heritle Scene Builder

REM Double-click to pull the latest changes and refresh dependencies.
REM
REM Only works in a git clone. If you downloaded a ZIP instead, see the
REM README - cloning once makes every future update this one double-click.

cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Git is not installed, or not on your PATH.
  echo   Install it with:  winget install Git.Git
  echo   then close this window and try again.
  echo.
  pause
  exit /b 1
)

if not exist ".git" (
  echo.
  echo   This folder is a downloaded copy, not a git clone,
  echo   so there is nothing to pull from.
  echo.
  echo   To fix this once and for all, see "Keeping it up to date"
  echo   in the README. After that, updating is just this file.
  echo.
  pause
  exit /b 1
)

echo.
echo   Fetching the latest changes...
echo.
git pull
if errorlevel 1 (
  echo.
  echo   Could not update. If it mentions local changes, you have edited
  echo   project files yourself - move them aside and try again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Checking dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo   Dependencies failed to update.
  pause
  exit /b 1
)

REM A no-op when the right browser is already there.
call npx playwright install chromium

echo.
echo   Up to date. Close this window and start the builder as usual.
echo.
pause
