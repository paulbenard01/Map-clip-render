#!/usr/bin/env bash
#
# Pulls the latest changes and refreshes dependencies (macOS / Linux).
# Only works in a git clone — see "Keeping it up to date" in the README.

set -u
cd "$(dirname "$0")"

if ! command -v git >/dev/null 2>&1; then
  echo; echo "  Git is not installed. Install it and try again."; echo
  exit 1
fi

if [ ! -d .git ]; then
  echo
  echo "  This folder is a downloaded copy, not a git clone,"
  echo "  so there is nothing to pull from."
  echo "  See \"Keeping it up to date\" in the README."
  echo
  exit 1
fi

echo; echo "  Fetching the latest changes..."; echo
git pull || {
  echo
  echo "  Could not update. If it mentions local changes, you have edited"
  echo "  project files yourself - move them aside and try again."
  echo
  exit 1
}

echo; echo "  Checking dependencies..."
# --no-audit: npm flags a critical advisory against MapLibre 4, which this
# project stays on deliberately. It is in MapLibre's HTML popup sanitizer, a
# code path this tool never touches (no popups anywhere). See the README
# section "On the library version". Run `npm audit` any time to see it.
npm install --no-audit || { echo; echo "  Dependencies failed to update."; exit 1; }

# A no-op when the right browser is already there.
npx playwright install chromium

echo; echo "  Up to date."; echo
