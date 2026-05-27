#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[$(date '+%H:%M:%S')] Starting update"

echo "[$(date '+%H:%M:%S')] Running plex_checker..."
python3 -u "$SCRIPTS_DIR/plex_checker.py"

echo "[$(date '+%H:%M:%S')] Running watchlist formatter..."
python3 -u "$SCRIPTS_DIR/format.py"

echo "[$(date '+%H:%M:%S')] Update complete"
