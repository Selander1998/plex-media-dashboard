#!/usr/bin/env python3
"""
Plex Media Completeness Checker
Scans your media libraries across multiple drives and reports:
  - Movies missing from their sequel/prequel collection
  - TV seasons entirely absent from disk
  - Individual missing episodes within seasons you have

Expected folder structure:
  movies/<Movie Name (YEAR)>/
  series/<Show Name (YEAR)>/Season XX/<episode files>

Usage:
  python3 plex_checker.py --api-key YOUR_TMDB_KEY

Get a free TMDB API key at: https://www.themoviedb.org/settings/api
"""

import os
import argparse
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Load scripts/.env first (takes precedence), then root .env as fallback
_script_dir = Path(__file__).parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

from plex_checker.blacklist import load_blacklist, BLACKLIST_FILE
from plex_checker.cache import load_cache, save_cache, CACHE_FILE
from plex_checker.checkers import check_movies, check_series, check_plex_sync
from plex_checker.report import print_report, save_report

DEFAULT_OUTPUT = str(_script_dir / "report.json")

# Override roots via --movies-roots / --series-roots or MOVIES_ROOTS / SERIES_ROOTS in .env
DEFAULT_MOVIES_ROOTS = []
DEFAULT_SERIES_ROOTS = []


def main():
	parser = argparse.ArgumentParser(
		description="Check your Plex library for missing movies/seasons/episodes",
		formatter_class=argparse.RawDescriptionHelpFormatter,
		epilog="""
Examples:
  # Use defaults (roots from .env):
  python3 plex_checker.py --api-key YOUR_KEY

  # Override roots at runtime:
  python3 plex_checker.py \\
    --movies-roots /mnt/drive1/movies,/mnt/drive2/movies \\
    --series-roots /mnt/drive1/series,/mnt/drive2/series \\
    --api-key YOUR_KEY

  # Check only movies:
  python3 plex_checker.py --api-key YOUR_KEY --skip-series

  # To suppress false positives, edit plex_blacklist.json next to this script.
		""",
	)
	parser.add_argument("--api-key", default="", help="TMDB API key (or set TMDB_API_KEY in .env)")
	parser.add_argument("--movies-roots", default="", help="Comma-separated movie root dirs")
	parser.add_argument("--series-roots", default="", help="Comma-separated series root dirs")
	parser.add_argument("--skip-movies", action="store_true")
	parser.add_argument("--skip-series", action="store_true")
	parser.add_argument("--series", default="", help="Only check show folders matching this string")
	parser.add_argument("--output", default=DEFAULT_OUTPUT)
	parser.add_argument("--cache", default=CACHE_FILE)
	parser.add_argument("--blacklist", default=BLACKLIST_FILE)

	args = parser.parse_args()

	api_key = args.api_key or os.environ.get("TMDB_API_KEY", "")
	if not api_key:
		print("ERROR: No TMDB API key found. Set TMDB_API_KEY in .env or pass --api-key.")
		raise SystemExit(1)

	movies_roots = (
		[p.strip() for p in args.movies_roots.split(",") if p.strip()]
		or [p.strip() for p in os.environ.get("MOVIES_ROOTS", "").split(",") if p.strip()]
		or DEFAULT_MOVIES_ROOTS
	)
	series_roots = (
		[p.strip() for p in args.series_roots.split(",") if p.strip()]
		or [p.strip() for p in os.environ.get("SERIES_ROOTS", "").split(",") if p.strip()]
		or DEFAULT_SERIES_ROOTS
	)

	blacklist = load_blacklist(args.blacklist)
	cache = load_cache(args.cache)

	print("\nPlex Media Checker")
	print(f"Time  : {datetime.now().strftime('%Y-%m-%d %H:%M')}")
	print(f"Movies: {', '.join(movies_roots)}")
	print(f"Series: {', '.join(series_roots)}")

	report_data = {
		"movies": {
			"total": 0,
			"total_size": 0,
			"titles_on_disk": [],
			"missing": [],
			"multiple_videos": [],
			"unneeded_files": [],
			"not_found_on_tmdb": [],
		},
		"series": {
			"total_shows": 0,
			"total_seasons": 0,
			"total_episodes": 0,
			"total_size": 0,
			"shows_on_disk": [],
			"missing": [],
			"multiple_videos": [],
			"unneeded_files": [],
			"not_found_on_tmdb": [],
		},
		"plex_sync": {"not_indexed": [], "stale": []},
	}

	try:
		if not args.skip_movies:
			report_data["movies"] = check_movies(movies_roots, api_key, cache, blacklist)
		if not args.skip_series:
			report_data["series"] = check_series(series_roots, api_key, cache, blacklist, series_filter=args.series)
	finally:
		save_cache(cache, args.cache)

	plex_url = os.environ.get("PLEX_URL", "")
	plex_token = os.environ.get("PLEX_TOKEN", "")
	report_data["plex_sync"] = check_plex_sync(plex_url, plex_token, movies_roots, series_roots)

	print_report(report_data)
	save_report(report_data, args.output)


if __name__ == "__main__":
	main()
