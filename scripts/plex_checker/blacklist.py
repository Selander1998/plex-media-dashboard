"""
Blacklist loading and matching helpers.

Edit plex_blacklist.json (in the scripts/ directory) to suppress false positives.
The file is created automatically with empty lists on first run.

Structure:
{
  "shows": [
    {"show": "Some Show", "note": "skip entirely"}
  ],
  "episodes": [
    {"show": "Letterkenny", "season": 11, "episode": 9, "note": "does not exist"},
    {"show": "Some Anime",  "season": 0,  "episode": 1047, "note": "absolute-numbered, use season 0"},
    {"show": "Some Anime",  "season": 1,  "episodes": [1, 13], "note": "inclusive range"}
  ],
  "seasons": [
    {"show": "Some Show", "season": 2, "note": "intentionally skipped"}
  ],
  "movies": [
    {"title": "Some Spin-off", "collection": "My Collection", "note": "not interested"}
  ]
}

Notes:
  - Matching is case-insensitive.
  - "shows" skips the entire show — no TMDB lookup, no episode checks, no output.
  - For absolute-numbered shows (anime etc.), use "season": 0 in "episodes".
  - The "collection" field on movie entries is optional; omitting it matches
    that title regardless of which collection it appears in.
  - The "note" field is purely for your reference and is never read by the script.
"""

import os
import re
import json
from pathlib import Path

# Data files live in scripts/, one level above this package
_SCRIPTS_DIR = Path(__file__).parent.parent
BLACKLIST_FILE = str(_SCRIPTS_DIR / "plex_blacklist.json")


def load_blacklist(path=BLACKLIST_FILE):
	if os.path.exists(path):
		try:
			with open(path) as f:
				bl = json.load(f)
			bl.setdefault("episodes", [])
			bl.setdefault("seasons", [])
			bl.setdefault("shows", [])
			bl.setdefault("movies", [])
			return bl
		except json.JSONDecodeError as e:
			print(f"  [WARN] Blacklist file {path} is corrupted: {e}. Treating as empty.")
	return {"episodes": [], "seasons": [], "shows": [], "movies": []}


def _normalize(s):
	"""Lowercase + collapse whitespace for loose name matching."""
	return re.sub(r'\s+', ' ', (s or "").strip().lower())


def is_episode_blacklisted(bl, show, season, episode):
	"""
	Return True if this episode should be suppressed.
	'season' is 0 for absolute-numbered shows.

	Episode entries support two forms:
	  {"show": "X", "season": 1, "episode": 5}          -- single episode
	  {"show": "X", "season": 1, "episodes": [13, 24]}  -- inclusive range
	"""
	show_n = _normalize(show)
	for entry in bl.get("episodes", []):
		if _normalize(entry.get("show", "")) != show_n:
			continue
		if int(entry.get("season", -1)) != int(season):
			continue
		if "episodes" in entry:
			lo, hi = entry["episodes"][0], entry["episodes"][1]
			if lo <= int(episode) <= hi:
				return True
		elif int(entry.get("episode", -1)) == int(episode):
			return True
	return False


def is_season_blacklisted(bl, show, season):
	"""
	Return True if this season should be suppressed — covers both the
	'entire season absent' check and the per-episode gap check.
	"""
	show_n = _normalize(show)
	for entry in bl.get("seasons", []):
		if _normalize(entry.get("show", "")) != show_n:
			continue
		if int(entry.get("season", -1)) != int(season):
			continue
		return True
	return False


def is_show_blacklisted(bl, show):
	"""Return True if the entire show should be skipped."""
	show_n = _normalize(show)
	return any(_normalize(entry.get("show", "")) == show_n for entry in bl.get("shows", []))


def is_movie_blacklisted(bl, title, collection=None):
	"""Return True if a missing-movie entry should be suppressed."""
	title_n = _normalize(title)
	col_n = _normalize(collection or "")
	for entry in bl.get("movies", []):
		if _normalize(entry.get("title", "")) != title_n:
			continue
		# If the blacklist entry specifies a collection, it must also match
		if entry.get("collection") and _normalize(entry["collection"]) != col_n:
			continue
		return True
	return False
