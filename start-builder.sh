#!/usr/bin/env bash
#
# Launcher for the scene builder (macOS / Linux).
#
# Runs from its own folder whichever way it was started, installs the project
# dependencies the first time, then starts the builder and opens it in your
# browser. Leave the terminal open while you work.

set -u
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed, or not on your PATH."
  echo "  Install it from https://nodejs.org (or: brew install node)"
  echo
  exit 1
fi

# Checking for a file inside a known dependency, rather than just the
# node_modules folder, so a half-finished install gets retried.
if [ ! -f node_modules/d3-geo/package.json ]; then
  echo
  echo "  First run - setting things up. This takes a few minutes,"
  echo "  and only happens once."
  echo
  npm install || { echo; echo "  Setup failed while installing dependencies."; exit 1; }
  echo
  echo "  Downloading the headless browser used to capture frames..."
  npx playwright install chromium || { echo; echo "  Setup failed while downloading the browser."; exit 1; }
  echo
  echo "  Setup complete."
  echo
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo
  echo "  NOTE: ffmpeg was not found, so renders will fail."
  echo "  You can still build and preview scenes."
  echo "  To fix:  brew install ffmpeg   (or your package manager)"
  echo
fi

exec node server.js
