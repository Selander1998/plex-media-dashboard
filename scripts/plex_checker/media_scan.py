"""
Folder parsing, filename regex helpers, and media-scan utilities.

Used by checkers.py to resolve local folder names to titles/years and to
detect video files, episode numbers, etc.
"""

from __future__ import annotations

import re
import difflib
from pathlib import Path
from typing import Generator

# ── Regex patterns ────────────────────────────────────────────────────────────

FOLDER_RE = re.compile(r'^(.+?)\s*\((\d{4})\)\s*$')
SEASON_RE = re.compile(
	r'[Ss]eason\s*(\d+)'  # Season 01, Season 1
	r'|[Ss](\d+)',         # S01, S02 anywhere in string
	re.IGNORECASE,
)
EPISODE_RE = re.compile(
	r'[Ss]\d+[Ee](\d+)'          # S01E05
	r'|[Ee][Pp]?(\d+)'            # E05 or EP05
	r'|\s-\s0*(\d+)(?:\s|-)'      # " - 500 " or " - 500-" anime absolute
	r'|-\s*(\d{1}\d{2})\s*-'      # - 101 - (SxEE)
	r'|[\._](\d{2,3})[\._\[]',    # .001. or .001[ (Naruto dot-style)
	re.IGNORECASE,
)

# ── File-type sets ─────────────────────────────────────────────────────────────

VIDEO_EXTS = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".wmv", ".flv", ".ts", ".m2ts", ".mpg", ".mpeg"}
ALLOWED_EXTS = {".srt", ".en.srt", ".sub", ".idx", ".nfo", ".jpg", ".jpeg", ".png", ".tbn", ".bif", ".txt", ".vtt"}

# ── Show-specific constants ────────────────────────────────────────────────────

# Shows that use absolute episode numbering rather than S##E##
ABSOLUTE_NUMBERED_SHOWS = [
	"One Piece",
	"Naruto",
]

# 4Kids / specialised title → absolute episode number mappings (One Piece)
ANIME_SPECIAL_MAPPINGS = {
	"GOOD WHALE HUNTING": 62,
	"WHISKY BUSINESS": 64,
	"BIG TROUBLE IN LITTLE GARDEN": 70,
	"WAX ON, WAX OFF": 73,
	"NAMI DEEREST": 78,
	"REINDEER SHAMES": 79,
	"DEER AND LOATHING IN DRUM KINGDOM": 80,
	"THE BEGINNING AND THE END": 48,
}


# ── Parsing helpers ────────────────────────────────────────────────────────────

def parse_name_year(name: str) -> tuple[str, int | None]:
	"""Extract (title, year) from a folder name like 'Movie Title (2023)'."""
	# Strip quality/source tags like [1080p], [WEBRip], [YTS.MX], etc.
	name = re.sub(r'\[.*?\]', '', name).strip()
	# Strip any stray trailing brackets or lone parentheses
	name = re.sub(r'[\]\[]+$', '', name).strip()
	m = FOLDER_RE.match(name)
	if m:
		title = m.group(1).strip()
		# Normalize dots-as-spaces (e.g. "Mad.Max.2") only when no spaces present
		if '.' in title and ' ' not in title:
			title = title.replace('.', ' ')
		return title, int(m.group(2))
	# Fallback: find any (YEAR) pattern even if there's trailing junk
	m2 = re.search(r'\((\d{4})\)', name)
	if m2:
		title = name[:m2.start()].strip()
		title = re.sub(r'[\s._()\[\]-]+$', '', title)
		if '.' in title and ' ' not in title:
			title = title.replace('.', ' ')
		return title, int(m2.group(1))
	return name.strip(), None


def parse_season_number(name: str) -> int | None:
	"""Return the season number embedded in a folder/filename, or None."""
	m = SEASON_RE.search(name)
	if not m:
		return None
	return int(next(g for g in m.groups() if g is not None))


def parse_episode_numbers(name: str) -> set[int]:
	"""Return a set of episode numbers found in a filename."""
	eps = set()

	# 0. Explicit absolute tag in brackets: [Ep 123] or [Ep 123-125]
	m = re.search(r'\[Ep\s*(\d+(?:-\d+)?)\]', name, re.IGNORECASE)
	if m:
		parts = m.group(1).split('-')
		if len(parts) == 2:
			eps.update(range(int(parts[0]), int(parts[1]) + 1))
		else:
			eps.add(int(parts[0]))
		if eps:
			return eps

	# 1. Season/Episode format: S04E01-E02, S04E03-04, S04E05E06, etc.
	m = re.search(r'[Ss]\d+((?:[Ee\-_xX]+\d+)+)', name, re.IGNORECASE)
	if m:
		nums = re.findall(r'\d+', m.group(1))
		eps.update(int(n) for n in nums)
		if eps:
			return eps

	# 2. Multi-episode absolute format: "Naruto.110-111.", " - 066-067 -"
	m = re.search(r'(?:^|[ \-._])(\d{2,4}(?:-\d{2,4})+)(?:$|[ \-._\[])', name)
	if m:
		parts = [int(n) for n in m.group(1).split('-')]
		eps.update(range(parts[0], parts[-1] + 1))
		if eps:
			return eps

	# 3. Fallback to single match
	m = EPISODE_RE.search(name)
	if m:
		eps.add(int(next(g for g in m.groups() if g is not None)))

	return eps


def is_video(name: str) -> bool:
	"""Return True if the filename has a recognised video extension."""
	return Path(name).suffix.lower() in VIDEO_EXTS


def clean_ep_title(title: str, show_name: str = "") -> str:
	"""Strip show name, S01E01 markers, etc. for fuzzy title matching."""
	title = re.sub(r'\[.*?\]', '', title).strip()
	title = re.sub(r'^[^\w\s]+|[^\w\s]+$', '', title)
	title = re.sub(r'S\d+E\d+|E\d+', '', title, flags=re.IGNORECASE)
	if show_name:
		title = re.sub(re.escape(show_name), '', title, flags=re.IGNORECASE)
	title = re.sub(r'[\._\[\]\-\(\)]+', ' ', title)
	return title.strip().lower()


def iter_dirs(roots: list[str]) -> Generator[Path, None, None]:
	"""Yield every immediate subdirectory found across all root paths."""
	for root in roots:
		p = Path(root)
		if not p.exists():
			print(f"  [SKIP] Not found: {p}")
			continue
		for d in sorted(p.iterdir()):
			if d.is_dir():
				yield d


def get_match_score(s1: str, s2: str) -> float:
	"""Combined fuzzy + keyword-overlap similarity score between two strings."""
	ratio = difflib.SequenceMatcher(None, s1, s2).ratio()
	s1_clean = re.sub(r'[^\w\s]', ' ', s1.lower())
	s2_clean = re.sub(r'[^\w\s]', ' ', s2.lower())
	stop = {
		'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
		'being', 'in', 'on', 'at', 'to', 'from', 'with', 'of', 'for', 'by', 'vs', 'versus',
	}
	w1 = set(re.findall(r'\w+', s1_clean)) - stop
	w2 = set(re.findall(r'\w+', s2_clean)) - stop
	if not w1 or not w2:
		return ratio
	overlap = len(w1 & w2) / max(len(w1), len(w2))
	return (ratio + overlap) / 2
