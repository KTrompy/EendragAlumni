#!/usr/bin/env bash
# Stages every tracked change under src/ (skips the node_modules/.vite churn
# that shows up in `git status` but was never meant to be committed),
# commits with the message you pass in, and pushes.
#
# Usage:
#   ./push.sh "commit message here"

set -e

if [ -z "$1" ]; then
  echo "Usage: ./push.sh \"commit message\""
  exit 1
fi

git add src/ public/ *.sql package.json package-lock.json vite.config.js index.html vercel.json README.md push.sh 2>/dev/null
git commit -m "$1"
git push
