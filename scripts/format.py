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


if __name__ == "__main__":
	main()
