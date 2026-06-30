#!/usr/bin/env python3
"""
Watchlist formatter — fetches Plex RSS feeds and writes watchlist.json.
Feed URLs are read from RSS_URLS in .env (comma-separated).
"""

import os
import json
from pathlib import Path
from dotenv import load_dotenv

# Load scripts/.env first, then root .env as fallback
_script_dir = Path(__file__).parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

from watchlist.processor import load_blacklist, process_watchlist
from plex_checker.tmdb import search_movie, has_home_release

TMDB_CACHE_PATH = _script_dir / "plex_checker_cache.json"


def load_owned_titles(report_path: Path) -> set:
	try:
		data = json.loads(report_path.read_text())
		titles = set()
		for section in ("movies", "series"):
			for entry in data.get(section, {}).get("titles_on_disk", []):
				if isinstance(entry, dict) and "title" in entry:
					titles.add(entry["title"].lower())
		return titles
	except Exception:
		return set()


def enrich_with_tmdb(items: list, api_key: str | None, cache: dict) -> list:
	"""Add in_theaters flag to movie items using TMDB release_dates."""
	for item in items:
		if item.get("category", "").lower() != "movie":
			item["in_theaters"] = False
			continue
		year = item.get("year")
		year_int = int(year) if year and str(year).isdigit() else None
		match = search_movie(item["title"], year_int, api_key, cache)
		if not match:
			item["in_theaters"] = False
			continue
		item["in_theaters"] = not has_home_release(match["id"], api_key, cache)
		if item["in_theaters"]:
			print(f"  ~ Theater-only (no home release yet): {item['title']}")
	return items


def main():
	rss_urls_env = os.getenv("RSS_URLS")
	if not rss_urls_env:
		print("Error: RSS_URLS not found in .env file")
		exit(1)

	rss_urls = [url.strip() for url in rss_urls_env.split(",") if url.strip()]
	if not rss_urls:
		print("Error: No valid URLs found in RSS_URLS environment variable.")
		exit(1)

	output_path = str(_script_dir / "watchlist.json")
	blacklist_path = str(_script_dir / "plex_blacklist.json")

	blacklist = load_blacklist(blacklist_path)
	owned_titles = load_owned_titles(_script_dir / "report.json")
	result = process_watchlist(rss_urls, output_path, remove_unreleased=True, blacklist=blacklist, owned_titles=owned_titles, as_json=True)

	if result is None:
		print("  [ERROR] Failed to write watchlist output file")
		return

	# Enrich items with TMDB theater status
	api_key = os.getenv("TMDB_API_KEY")
	if not api_key:
		return  # No TMDB key — skip enrichment

	try:
		cache = json.loads(TMDB_CACHE_PATH.read_text())
	except Exception:
		cache = {}

	data = json.loads(result)
	data["items"] = enrich_with_tmdb(data["items"], api_key, cache)

	with open(output_path, "w", encoding="utf-8") as f:
		json.dump(data, f, indent=2)

	try:
		TMDB_CACHE_PATH.write_text(json.dumps(cache, indent=2))
	except Exception as e:
		print(f"  [WARN] Could not save TMDB cache: {e}")


if __name__ == "__main__":
	main()
