"""Watchlist processing — blacklist loading, release checks, deduplication, and output."""

import json
import re
import datetime
import urllib.request
import urllib.error
from typing import Dict, List, Optional, Set

from .feed import fetch_feed_data, parse_rss_items, extract_item_data

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"


def load_blacklist(blacklist_path: str) -> Set[str]:
	"""
	Load watchlist-blocked titles from the 'watchlist' key in plex_blacklist.json.
	Returns an empty set if the file is missing or malformed.
	"""
	blacklist: Set[str] = set()
	try:
		with open(blacklist_path, "r", encoding="utf-8") as f:
			data = json.load(f)
		entries = data.get("watchlist", [])
		blacklist = {e.lower() for e in entries if isinstance(e, str)}
	except FileNotFoundError:
		pass
	except (IOError, json.JSONDecodeError) as e:
		print(f"Warning: Could not read blacklist file '{blacklist_path}': {e}")
	return blacklist


def is_released(url: str, title: str) -> bool:
	"""
	Check release status by parsing the releaseDate from the Plex page JSON.
	Falls back to True (fail open) if the date can't be determined.
	"""
	try:
		req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
		with urllib.request.urlopen(req) as response:
			html = response.read().decode("utf-8")
		match = re.search(r'releaseDate\\":\\"(\d{4}-\d{2}-\d{2})\\"', html)
		if match:
			release_date = match.group(1)
			today = datetime.datetime.now().strftime("%Y-%m-%d")
			released = release_date <= today
			if not released:
				print(f"  ~ Skipping unreleased: {title} (releases {release_date})")
			return released
		# Fall back to old heuristics if no date found
		if "Where to Watch" in html:
			return True
		if "audience rating" in html or "Tomatometer" in html:
			return True
		return False
	except Exception as e:
		print(f"Warning: Could not check release status for {title} ({e}). Assuming released.")
		return True


def format_output(items_data: List[Dict[str, str]]) -> str:
	"""Format parsed items as a numbered plain-text list."""
	lines = []
	for i, data in enumerate(items_data, 1):
		lines.append(f"#{i}:")
		lines.append(f"   Title: {data['title']}")
		lines.append(f"   Released: {data['year']}")
		lines.append(f"   Type: {data['category'].upper()}")
		lines.append(f"   Link: {data['link']}")
		lines.append("")
	return "\n".join(lines)


def process_watchlist(
	urls: List[str],
	output_file_path: str = "plex_watchlist.txt",
	remove_unreleased: bool = False,
	blacklist: Optional[Set[str]] = None,
	print_output: bool = False,
	as_json: bool = False,
) -> Optional[str]:
	"""
	Fetch all RSS feeds, deduplicate, filter, and write the result to disk.
	Returns the output string on success, None on write error, False if no items found.
	"""
	all_items_data: List[Dict[str, str]] = []
	seen_links: Set[str] = set()

	for url in urls:
		xml_content = fetch_feed_data(url)
		if not xml_content:
			continue

		items = parse_rss_items(xml_content)

		for item in items:
			data = extract_item_data(item)

			# Deduplicate by link before any expensive operations
			if data["link"] in seen_links:
				continue

			if blacklist and data["title"].lower() in blacklist:
				print(f"  ~ Skipping blacklisted: {data['title']}")
				continue

			if remove_unreleased:
				try:
					current_year = datetime.datetime.now().year
					item_year = int(data["year"])
					if item_year > current_year:
						continue
					if item_year == current_year:
						print(f"Checking release status for: {data['title']}...")
						if not is_released(data["link"], data["title"]):
							print(f"Skipping unreleased item: {data['title']}")
							continue
				except ValueError:
					pass  # Unknown year — keep it

			seen_links.add(data["link"])
			all_items_data.append(data)

	if not all_items_data:
		print("No items found to write.")
		return False

	print(f"\n  ✓ {len(all_items_data)} unique watchlist items")

	if as_json:
		output = json.dumps(
			{"generated": datetime.datetime.now().isoformat(), "items": all_items_data},
			indent=2,
		)
	else:
		output = format_output(all_items_data)

	if print_output:
		return output

	try:
		with open(output_file_path, "w", encoding="utf-8") as f:
			f.write(output)
		return output
	except IOError as e:
		print(f"Error writing to file {output_file_path}: {e}")
		return None
