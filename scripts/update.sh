#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting update"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running plex_checker..."
python3 "$SCRIPTS_DIR/plex_checker.py" --output "$SCRIPTS_DIR/report.json"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running watchlist formatter..."
python3 "$SCRIPTS_DIR/format.py" --output "$SCRIPTS_DIR/watchlist.json" --blacklist "$SCRIPTS_DIR/blacklist.txt" --json --remove-unreleased

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Update complete"
