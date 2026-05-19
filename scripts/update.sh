#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting update"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running plex_checker..."
python3 "$SCRIPTS_DIR/plex_checker.py"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running watchlist formatter..."
python3 "$SCRIPTS_DIR/format.py"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Update complete"
