"""TMDB response cache — load from / save to a JSON file."""

import os
import json
from pathlib import Path

# Data files live in scripts/, one level above this package
_SCRIPTS_DIR = Path(__file__).parent.parent
CACHE_FILE = str(_SCRIPTS_DIR / "plex_checker_cache.json")


def load_cache(path=CACHE_FILE):
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


def save_cache(cache, path=CACHE_FILE):
	try:
		with open(path, "w") as f:
			json.dump(cache, f, indent=2)
	except OSError as e:
		print(f"  [WARN] Could not save cache to {path}: {e}")
