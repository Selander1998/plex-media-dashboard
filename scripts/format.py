import xml.etree.ElementTree as ET
import urllib.request
import urllib.error
import re
import os
import json
import argparse
import datetime
from typing import List, Dict, Optional, Set
from dotenv import load_dotenv

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'

def fetch_feed_data(url: str) -> Optional[str]:
    """
    Fetches XML content from a URL.
    
    Args:
        url: The URL to fetch.
        
    Returns:
        The XML content as a string, or None if fetching failed.
    """
    try:
        print(f"Fetching data from: {url}")
        with urllib.request.urlopen(url) as response:
            return response.read()
    except urllib.error.URLError as e:
        print(f"Error fetching URL {url}: {e}")
    except Exception as e:
        print(f"Unexpected error fetching {url}: {e}")
    return None

def parse_rss_items(xml_content: str) -> List[ET.Element]:
    """
    Parses RSS items from XML content.
    
    Args:
        xml_content: The XML string to parse.
        
    Returns:
        A list of 'item' Elements found in the RSS feed.
    """
    try:
        root = ET.fromstring(xml_content)
        channel = root.find('channel')
        if channel is None:
            # Maybe it's a different RSS flavor?
            # Fallback: try finding items directly under root if channel missing or root is channel
            # usage: root.findall('.//item')
            print("Warning: No 'channel' element found. Attempting to find items directly.")
            return root.findall('.//item') or []
            
        items = channel.findall('item')
        return items
    except ET.ParseError as e:
        print(f"Error parsing XML: {e}")
    except Exception as e:
        print(f"Unexpected error parsing XML: {e}")
    return []

def extract_item_data(item: ET.Element) -> Dict[str, str]:
    """
    Extracts relevant data (title, year, category, link) from an RSS item element.
    
    Args:
        item: The XML element representing an item.
        
    Returns:
        A dictionary containing cleaned title, year, category, and link.
    """
    title_element = item.find('title')
    title_raw = title_element.text if title_element is not None and title_element.text else "Unknown Title"
    
    year_match = re.search(r'\((\d{4})\)', title_raw)
    if year_match:
        year = year_match.group(1)
        # Remove the year from the title for cleaner output
        title = re.sub(r'\s*\(\d{4}\)\s*', ' ', title_raw).strip()
    else:
        year = "Unknown release Year"
        title = title_raw

    category_element = item.find('category')
    category = category_element.text if category_element is not None and category_element.text else "Unknown"

    link_element = item.find('link')
    link = link_element.text if link_element is not None and link_element.text else "No link"
    
    return {
        "title": title,
        "year": year,
        "category": category,
        "link": link
    }

def load_blacklist(blacklist_path: str) -> Set[str]:
    """
    Loads the blacklist from a text file.
    Each non-empty, non-comment line is treated as a title to exclude (case-insensitive).

    Args:
        blacklist_path: Path to the blacklist file.

    Returns:
        A set of lowercased title strings to exclude.
    """
    blacklist: Set[str] = set()
    if not os.path.exists(blacklist_path):
        return blacklist
    try:
        with open(blacklist_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    blacklist.add(line.lower())
        print(f"Loaded {len(blacklist)} blacklist entries from '{blacklist_path}'")
    except IOError as e:
        print(f"Warning: Could not read blacklist file '{blacklist_path}': {e}")
    return blacklist


def format_output(items_data: List[Dict[str, str]]) -> str:
    """
    Formats the parsed items into the desired string output.
    
    Args:
        items_data: A list of dicts with item data.
        
    Returns:
        A formatted string ready for writing to file.
    """
    output_lines = []
    
    for i, data in enumerate(items_data, 1):
        output_lines.append(f"#{i}:")
        output_lines.append(f"   Title: {data['title']}")
        output_lines.append(f"   Released: {data['year']}")
        output_lines.append(f"   Type: {data['category'].upper()}")
        output_lines.append(f"   Link: {data['link']}")
        output_lines.append("")
        
    return '\n'.join(output_lines)

def is_released(url: str, title: str) -> bool:
    """
    Checks if the item is released by fetching its Plex page and looking for 'Where to Watch'.
    
    Args:
        url: The Plex URL of the item.
        title: Title of the item (for logging).
        
    Returns:
        True if released (or if check fails), False if likely unreleased.
    """
    try:
        # Use a real user agent to avoid being blocked
        headers = {
            'User-Agent': USER_AGENT
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            html_content = response.read().decode('utf-8')
            
            # Heuristic 1: Check for "Where to Watch" section
            if "Where to Watch" in html_content:
                return True
                
            # Heuristic 2: Check for "Audience Rating" or "Tomatometer"
            if "audience rating" in html_content or "Tomatometer" in html_content:
                return True
            
            return False
            
    except Exception as e:
        print(f"Warning: Could not check release status for {title} ({e}). Assuming released.")
        return True

def process_watchlist(urls: List[str], output_file_path: str = "plex_watchlist.txt", remove_unreleased: bool = False, blacklist: Optional[Set[str]] = None, print_output: bool = False, as_json: bool = False) -> Optional[str]:
    """
    Main logic to fetch, parse, and save watchlist data.
    
    Args:
        urls: List of RSS feed URLs.
        output_file_path: Path to the output file.
        
    Returns:
        True if successful (items found and written), False otherwise.
    """
    all_items_data: List[Dict[str, str]] = []
    seen_links: Set[str] = set()

    for url in urls:
        xml_content = fetch_feed_data(url)
        if not xml_content:
            continue
            
        items = parse_rss_items(xml_content)
        print(f"Parsed {len(items)} items from {url}")
        
        for item in items:
            data = extract_item_data(item)
            
            # Simple deduplication based on link - check before expensive operations
            if data['link'] in seen_links:
                continue

            # Skip blacklisted titles
            if blacklist and data['title'].lower() in blacklist:
                print(f"Skipping blacklisted item: {data['title']}")
                continue

            if remove_unreleased:
                try:
                    # Current year
                    current_year = datetime.datetime.now().year
                    # Parse item year
                    item_year = int(data['year'])
                    
                    if item_year > current_year:
                        continue
                    elif item_year == current_year:
                        # Deep check for current year items
                        print(f"Checking release status for: {data['title']}...")
                        if not is_released(data['link'], data['title']):
                            print(f"Skipping unreleased item: {data['title']}")
                            continue
                except ValueError:
                    # Use year is not a valid number (e.g. "Unknown release Year"), we keep it safely
                    pass

            # Add to list and seen set
            seen_links.add(data['link'])
            all_items_data.append(data)

    if not all_items_data:
        print("No items found to write.")
        # If we failed to find items, we might not want to overwrite the file with empty content, or maybe we do? 
        # The original code returned False.
        return False

    print(f"\nSuccessfully parsed {len(all_items_data)} total unique items from watchlist")

    if as_json:
        output = json.dumps({"generated": datetime.datetime.now().isoformat(), "items": all_items_data}, indent=2)
    else:
        output = format_output(all_items_data)

    if print_output:
        return output

    try:
        with open(output_file_path, 'w', encoding='utf-8') as f:
            f.write(output)
        return output
    except IOError as e:
        print(f"Error writing to file {output_file_path}: {e}")
        return None

def main():
    load_dotenv()
    
    rss_urls_env = os.getenv('RSS_URLS')
    
    if not rss_urls_env:
        print("Error: RSS_URLS not found in .env file")
        print("Please create a .env file with: RSS_URLS=url1,url2,url3")
        exit(1)
    
    # Split by comma and strip whitespace
    rss_urls = [url.strip() for url in rss_urls_env.split(',') if url.strip()]
    
    if not rss_urls:
        print("Error: No valid URLs found in RSS_URLS environment variable.")
        exit(1)

    parser = argparse.ArgumentParser(description="Plex Watchlist RSS Formatter")
    parser.add_argument("--remove-unreleased", action="store_true", help="Remove movies that are not yet released (future year)")
    parser.add_argument("-o", "--output", default="output.txt", help="Path to the output file (default: output.txt)")
    parser.add_argument("--blacklist", default="blacklist.txt", help="Path to the blacklist file (default: blacklist.txt)")
    parser.add_argument("--print", action="store_true", dest="print_output", help="Print output instead of writing to file")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Write JSON output instead of plain text")
    args = parser.parse_args()

    blacklist = load_blacklist(args.blacklist)

    result = process_watchlist(rss_urls, args.output, args.remove_unreleased, blacklist, args.print_output, args.as_json)

    if result is None:
        print("Failed to create output file")
    elif args.print_output:
        print("\nOutput:\n")
        print(result)
    else:
        print("Output file created successfully")

if __name__ == "__main__":
    main()
