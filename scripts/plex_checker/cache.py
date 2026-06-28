"""TMDB response cache — load from / save to a JSON file."""
from __future__ import annotations

import os
import json
from pathlib import Path
from typing import Any

# Data files live in scripts/, one level above this package
_SCRIPTS_DIR = Path(__file__).parent.parent
CACHE_FILE = str(_SCRIPTS_DIR / "plex_checker_cache.json")


def load_cache(path: str = CACHE_FILE) -> dict[str, Any]:
	if os.path.exists(path):
		try:
			with open(path) as f:
				return json.load(f)
		except json.JSONDecodeError as e:
			print(f"  [WARN] Cache file {path} is corrupted: {e}. Starting fresh.")
			try:
				os.rename(path, path + ".bak")
				print(f"  [WARN] Corrupted cache backed up to {path}.bak")
			except OSError:
				pass
			return {}
	return {}


def save_cache(cache: dict[str, Any], path: str = CACHE_FILE) -> None:
	try:
		with open(path, "w") as f:
			json.dump(cache, f, indent=2)
	except OSError as e:
		print(f"  [WARN] Could not save cache to {path}: {e}")
