"""RSS feed fetching and XML parsing helpers."""

import re
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"


def fetch_feed_data(url: str) -> Optional[bytes]:
	"""Fetch raw XML bytes from an RSS URL. Returns None on error."""
	try:
		from urllib.parse import urlparse
		host = urlparse(url).netloc or url
		print(f"  Fetching feed: {host}")
		with urllib.request.urlopen(url) as response:
			return response.read()
	except urllib.error.URLError as e:
		print(f"  [WARN] Could not fetch feed: {e}")
	except Exception as e:
		print(f"  [WARN] Unexpected fetch error: {e}")
	return None


def parse_rss_items(xml_content: bytes) -> List[ET.Element]:
	"""Return all <item> elements from an RSS feed."""
	try:
		root = ET.fromstring(xml_content)
		channel = root.find("channel")
		if channel is None:
			print("Warning: No 'channel' element found. Attempting to find items directly.")
			return root.findall(".//item") or []
		return channel.findall("item")
	except ET.ParseError as e:
		print(f"Error parsing XML: {e}")
	except Exception as e:
		print(f"Unexpected error parsing XML: {e}")
	return []


def extract_item_data(item: ET.Element) -> Dict[str, str]:
	"""Extract title, year, category, and link from an RSS <item> element."""
	title_el = item.find("title")
	title_raw = title_el.text if title_el is not None and title_el.text else "Unknown Title"

	year_match = re.search(r'\((\d{4})\)', title_raw)
	if year_match:
		year = year_match.group(1)
		title = re.sub(r'\s*\(\d{4}\)\s*', ' ', title_raw).strip()
	else:
		year = "Unknown release Year"
		title = title_raw

	category_el = item.find("category")
	category = category_el.text if category_el is not None and category_el.text else "Unknown"

	link_el = item.find("link")
	link = link_el.text if link_el is not None and link_el.text else "No link"

	return {"title": title, "year": year, "category": category, "link": link}
