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
  python3 ~/plex_checker.py --api-key YOUR_TMDB_KEY

Get a free TMDB API key at: https://www.themoviedb.org/settings/api
"""

import os
import re
import json
import time
import argparse
import requests
import difflib
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from pathlib import Path
from datetime import datetime, timezone

TMDB_BASE = "https://api.themoviedb.org/3"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plex_checker_cache.json")
BLACKLIST_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plex_blacklist.json")

# ── Blacklist ──────────────────────────────────────────────────────────────────
# Edit plex_blacklist.json (next to this script) to suppress false positives.
# The file is created automatically with empty lists on first run.
#
# Structure:
# {
#   "shows": [
#     {"show": "Some Show", "note": "skip entirely"}
#   ],
#   "episodes": [
#     {"show": "Letterkenny", "season": 11, "episode": 9, "note": "does not exist"},
#     {"show": "Some Anime",  "season": 0,  "episode": 1047, "note": "absolute-numbered, use season 0"}
#   ],
#   "seasons": [
#     {"show": "Some Show", "season": 2, "note": "intentionally skipped"}
#   ],
#   "movies": [
#     {"title": "Some Spin-off", "collection": "My Collection", "note": "not interested"}
#   ]
# }
#
# Notes:
#   - Matching is case-insensitive.
#   - "shows" skips the entire show — no TMDB lookup, no episode checks, no output.
#   - For absolute-numbered shows (anime etc.), use "season": 0 in "episodes".
#   - The "collection" field on movie entries is optional; omitting it matches
#     that title regardless of which collection it appears in.
#   - The "note" field is purely for your reference and is never read by the script.

# Load scripts/.env first (takes precedence), then root .env as fallback
_script_dir = Path(__file__).parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

# Pass your media roots via --movies-roots and --series-roots (see --help)
DEFAULT_MOVIES_ROOTS = []
DEFAULT_SERIES_ROOTS = []

# Shows that use absolute episode numbering rather than S##E## (add more as needed)
ABSOLUTE_NUMBERED_SHOWS = [
    "One Piece",
    "Naruto",
]


def load_blacklist(path=BLACKLIST_FILE):
    if os.path.exists(path):
        try:
            with open(path) as f:
                bl = json.load(f)
            # Ensure all three keys exist
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

    Episode entries support three forms:
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
    Return True if this season should be suppressed -- covers both the
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
    col_n   = _normalize(collection or "")
    for entry in bl.get("movies", []):
        if _normalize(entry.get("title", "")) != title_n:
            continue
        # If the blacklist entry specifies a collection, it must also match
        if entry.get("collection") and _normalize(entry["collection"]) != col_n:
            continue
        return True
    return False


# ─── Cache helpers ────────────────────────────────────────────────────────────

def load_cache(path):
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

def save_cache(cache, path):
    with open(path, "w") as f:
        json.dump(cache, f, indent=2)


# ─── TMDB API helpers ─────────────────────────────────────────────────────────

tmdb_session = requests.Session()
_retries = Retry(total=5, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504])
tmdb_session.mount("https://", HTTPAdapter(max_retries=_retries, pool_connections=10, pool_maxsize=10))

def tmdb_get(endpoint, params, api_key, cache, delay=0.02):
    cache_key = endpoint + str(sorted(params.items()))
    if cache_key in cache:
        return cache[cache_key]
    params["api_key"] = api_key
    url = TMDB_BASE + endpoint
    try:
        r = tmdb_session.get(url, params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
        cache[cache_key] = data
        if delay > 0:
            time.sleep(delay)
        return data
    except requests.RequestException as e:
        print(f"  [WARN] TMDB request failed: {e}")
        return None


def get_best_match(query, results):
    if not results:
        return None
    best_result = results[0]
    best_score = 0
    for r in results:
        title = r.get("title") or r.get("name", "")
        if not title: continue
        score = difflib.SequenceMatcher(None, query.lower(), title.lower()).ratio()
        if score > best_score:
            best_score = score
            best_result = r
    return best_result

def search_movie(title, year, api_key, cache):
    data = tmdb_get("/search/movie", {"query": title, "year": year}, api_key, cache)
    if data and data.get("results"):
        return get_best_match(title, data["results"])
    data = tmdb_get("/search/movie", {"query": title}, api_key, cache)
    if data and data.get("results"):
        return get_best_match(title, data["results"])
    return None


def get_movie_collection(movie_id, api_key, cache):
    data = tmdb_get(f"/movie/{movie_id}", {}, api_key, cache)
    if data and data.get("belongs_to_collection"):
        col_id = data["belongs_to_collection"]["id"]
        col_data = tmdb_get(f"/collection/{col_id}", {}, api_key, cache)
        if col_data:
            return col_data.get("parts", []), data["belongs_to_collection"]["name"]
    return [], None


def search_tv(title, year, api_key, cache):
    data = tmdb_get("/search/tv", {"query": title, "first_air_date_year": year}, api_key, cache)
    if data and data.get("results"):
        return get_best_match(title, data["results"])
    data = tmdb_get("/search/tv", {"query": title}, api_key, cache)
    if data and data.get("results"):
        return get_best_match(title, data["results"])
    return None


def get_tv_details(tv_id, api_key, cache):
    return tmdb_get(f"/tv/{tv_id}", {}, api_key, cache)


def get_tv_season(tv_id, season_number, api_key, cache):
    return tmdb_get(f"/tv/{tv_id}/season/{season_number}", {}, api_key, cache)

def get_all_tv_episodes_flat(tv_id, total_seasons, api_key, cache):
    """Return {abs_ep_number: {"air_date": str, "name": str}} for all aired episodes."""
    all_eps = {}
    for sn in range(1, total_seasons + 1):
        data = get_tv_season(tv_id, sn, api_key, cache)
        if not data or "episodes" not in data:
            continue
        for ep in data["episodes"]:
            abs_n = ep.get("absolute_episode_number") or ep.get("episode_number")
            if abs_n:
                all_eps[abs_n] = {
                    "air_date": ep.get("air_date", ""),
                    "name":     ep.get("name", ""),
                }
    return all_eps


# ─── Folder parsing ───────────────────────────────────────────────────────────

FOLDER_RE = re.compile(r'^(.+?)\s*\((\d{4})\)\s*$')
SEASON_RE = re.compile(
    r'[Ss]eason\s*(\d+)'   # Season 01, Season 1, Season 01 [Ep ...]
    r'|[Ss](\d+)',          # S01, S02 anywhere in string
    re.IGNORECASE
)
EPISODE_RE = re.compile(
    r'[Ss]\d+[Ee](\d+)'             # S01E05
    r'|[Ee][Pp]?(\d+)'              # E05 or EP05
    r'|\s-\s0*(\d+)(?:\s|-)'        # " - 500 " or " - 500-" anime absolute
    r'|-\s*(\d{1}\d{2})\s*-'        # - 101 - (SxEE)
    r'|[\._](\d{2,3})[\._\[]',      # .001. or .001[ (Naruto dot-style)
    re.IGNORECASE
)

# 4Kids / Specialized titles mapping to absolute numbers (One Piece example)
ANIME_SPECIAL_MAPPINGS = {
    "GOOD WHALE HUNTING": 62,
    "WHISKY BUSINESS": 64,
    "BIG TROUBLE IN LITTLE GARDEN": 70,
    "WAX ON, WAX OFF": 73,
    "NAMI DEEREST": 78,
    "REINDEER SHAMES": 79,
    "DEER AND LOATHING IN DRUM KINGDOM": 80,
    "THE BEGINNING AND THE END": 48
}

VIDEO_EXTS = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".wmv", ".flv", ".ts", ".m2ts", ".mpg", ".mpeg"}
ALLOWED_EXTS = {".srt", ".en.srt", ".sub", ".idx", ".nfo", ".jpg", ".jpeg", ".png", ".tbn", ".bif", ".txt", ".vtt"}


def parse_name_year(name):
    # Strip quality/source tags like [1080p], [WEBRip], [YTS.MX], etc.
    name = re.sub(r'\[.*?\]', '', name).strip()
    # Strip any stray trailing brackets or lone parentheses
    name = re.sub(r'[\]\[]+$', '', name).strip()  # remove ] and [ only, NOT )
    m = FOLDER_RE.match(name)
    if m:
        title = m.group(1).strip()
        # Normalize dots-as-spaces (e.g. "Mad.Max.2") only when no spaces are present
        if '.' in title and ' ' not in title:
            title = title.replace('.', ' ')
        return title, int(m.group(2))
    # Fallback: find any (YEAR) pattern even if there's trailing junk
    m2 = re.search(r'\((\d{4})\)', name)
    if m2:
        title = name[:m2.start()].strip()
        title = re.sub(r'[\s._()\[\]-]+$', '', title)  # clean trailing junk
        if '.' in title and ' ' not in title:
            title = title.replace('.', ' ')
        return title, int(m2.group(1))
    return name.strip(), None

def parse_season_number(name):
    m = SEASON_RE.search(name)
    if not m:
        return None
    return int(next(g for g in m.groups() if g is not None))

def parse_episode_numbers(name):
    eps = set()
    
    # 0. Explicit absolute tag in brackets: [Ep 123] or [Ep 123-125]
    # This is the most reliable tag, added by our renaming tool for anime.
    m = re.search(r'\[Ep\s*(\d+(?:-\d+)?)\]', name, re.IGNORECASE)
    if m:
        parts = m.group(1).split('-')
        if len(parts) == 2:
            eps.update(range(int(parts[0]), int(parts[1]) + 1))
        else:
            eps.add(int(parts[0]))
        if eps: return eps

    # 1. Season/Episode format: S04E01-E02, S04E03-04, S04E05E06, etc.
    m = re.search(r'[Ss]\d+((?:[Ee\-_xX]+\d+)+)', name, re.IGNORECASE)
    if m:
        nums = re.findall(r'\d+', m.group(1))
        eps.update(int(n) for n in nums)
        if eps: return eps
            
    # 2. Multi-episode absolute format: "Naruto.110-111.", " - 066-067 -"
    m = re.search(r'(?:^|[ \-._])(\d{2,4}(?:-\d{2,4})+)(?:$|[ \-._\[])', name)
    if m:
        eps.update(int(n) for n in m.group(1).split('-'))
        if eps: return eps
            
    # 3. Fallback to existing single match
    m = EPISODE_RE.search(name)
    if m:
        eps.add(int(next(g for g in m.groups() if g is not None)))
        
    return eps

def is_video(name):
    return Path(name).suffix.lower() in VIDEO_EXTS

def clean_ep_title(title, show_name=""):
    """Strip show name, S01E01 markers, etc. for fuzzy title matching."""
    title = re.sub(r'\[.*?\]', '', title).strip()
    title = re.sub(r'^[^\w\s]+|[^\w\s]+$', '', title)
    title = re.sub(r'S\d+E\d+|E\d+', '', title, flags=re.IGNORECASE)
    if show_name:
        title = re.sub(re.escape(show_name), '', title, flags=re.IGNORECASE)
    title = re.sub(r'[\._\[\]\-\(\)]+', ' ', title)
    return title.strip().lower()

def iter_dirs(roots):
    """Yield every immediate subdirectory found across all root paths."""
    for root in roots:
        p = Path(root)
        if not p.exists():
            print(f"  [SKIP] Not found: {p}")
            continue
        for d in sorted(p.iterdir()):
            if d.is_dir():
                yield d


def get_match_score(s1, s2):
    """Combined fuzzy + keyword-overlap similarity score between two strings."""
    ratio = difflib.SequenceMatcher(None, s1, s2).ratio()
    s1_clean = re.sub(r'[^\w\s]', ' ', s1.lower())
    s2_clean = re.sub(r'[^\w\s]', ' ', s2.lower())
    stop = {'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
            'being', 'in', 'on', 'at', 'to', 'from', 'with', 'of', 'for', 'by', 'vs', 'versus'}
    w1 = set(re.findall(r'\w+', s1_clean)) - stop
    w2 = set(re.findall(r'\w+', s2_clean)) - stop
    if not w1 or not w2:
        return ratio
    overlap = len(w1 & w2) / max(len(w1), len(w2))
    return (ratio + overlap) / 2


# ─── Movie checker ────────────────────────────────────────────────────────────

def check_movies(movies_roots, api_key, cache, blacklist):
    print("\n" + "═" * 60)
    print("  MOVIES — Collection completeness check")
    print("═" * 60)

    all_folders = list(iter_dirs(movies_roots))
    if not all_folders:
        print("  [SKIP] No movie folders found.")
        return {"total": 0, "total_size": 0, "titles_on_disk": [], "missing": [], "multiple_videos": [], "unneeded_files": []}

    titles_on_disk = [{"title": t, "year": y} for t, y in (parse_name_year(f.name) for f in all_folders)]

    print(f"  {len(all_folders)} movies found across {len(movies_roots)} drive(s)")
    print(f"  Pass 1/2: Resolving local movies to TMDB IDs...\n")

    # ── Pass 1: look up every local folder on TMDB, collect their IDs ─────────
    local_tmdb_ids = set()
    folder_to_tmdb_id = {}

    multiple_videos = []
    unneeded_files = []
    total_size = 0

    total = len(all_folders)
    for i, folder in enumerate(all_folders, 1):
        title, year = parse_name_year(folder.name)
        print(f"  [{i}/{total}] {folder.name}", flush=True)

        movie = search_movie(title, year, api_key, cache)
        videos = []
        extras = []
        for f in folder.iterdir():
            if f.is_file():
                if is_video(f.name):
                    videos.append(f.name)
                    try:
                        total_size += f.stat().st_size
                    except OSError:
                        pass
                elif f.suffix.lower() not in ALLOWED_EXTS:
                    extras.append(f.name)
        
        if len(videos) > 1:
            multiple_videos.append({"folder": folder.name, "videos": videos})
            print(f"    [WARN] Multiple video files found: {videos}")
        if extras:
            unneeded_files.append({"folder": folder.name, "files": extras})
            print(f"    [WARN] Unneeded files found: {extras}")
        if movie:
            local_tmdb_ids.add(movie["id"])
            folder_to_tmdb_id[folder.name] = movie["id"]
        else:
            print(f"    [WARN] Not found on TMDB (searched: '{title}' {year})")

    print(f"\n  Pass 2/2: Checking collections for gaps...\n")

    # ── Pass 2: for each movie that belongs to a collection, check by ID ──────
    missing = []
    seen_collections = set()
    today_str = datetime.now().strftime("%Y-%m-%d")

    for folder in all_folders:
        tmdb_id = folder_to_tmdb_id.get(folder.name)
        if not tmdb_id:
            continue

        parts, collection_name = get_movie_collection(tmdb_id, api_key, cache)
        if not parts:
            continue

        col_key = (collection_name or str(tmdb_id)).lower()
        if col_key in seen_collections:
            continue
        seen_collections.add(col_key)

        print(f"  Collection: {collection_name}")
        collection_missing = []

        for part in parts:
            part_id    = part.get("id")
            part_title = part.get("title", "")
            release    = part.get("release_date") or ""
            part_year  = int(release[:4]) if release[:4].isdigit() else None

            if not release:
                continue
            if release > today_str:
                continue

            if part_id in local_tmdb_ids:
                print(f"    ✓ {part_title} ({part_year})")
            elif is_movie_blacklisted(blacklist, part_title, collection_name):
                print(f"    ~ {part_title} ({part_year})  [blacklisted]")
            else:
                print(f"    ✗ MISSING: {part_title} ({part_year})")
                collection_missing.append({
                    "type": "movie",
                    "collection": collection_name,
                    "title": part_title,
                    "year": part_year,
                    "tmdb_id": part_id,
                })

        missing.extend(collection_missing)

    return {
        "total": len(all_folders),
        "total_size": total_size,
        "titles_on_disk": titles_on_disk,
        "missing": missing,
        "multiple_videos": multiple_videos,
        "unneeded_files": unneeded_files,
    }


# ─── Series checker ───────────────────────────────────────────────────────────

def check_series(series_roots, api_key, cache, blacklist, series_filter=None):
    print("\n" + "═" * 60)
    print("  SERIES — Season & episode completeness check")
    print("═" * 60)

    all_show_folders = list(iter_dirs(series_roots))
    if not all_show_folders:
        print("  [SKIP] No series folders found.")
        return {"total_shows": 0, "total_seasons": 0, "total_episodes": 0, "total_size": 0, "shows_on_disk": [], "missing": [], "multiple_videos": [], "unneeded_files": []}

    shows_on_disk = [{"title": t, "year": y} for t, y in (parse_name_year(f.name) for f in all_show_folders)]

    if series_filter:
        all_show_folders = [d for d in all_show_folders if series_filter.lower() in d.name.lower()]
        if not all_show_folders:
            print(f"  [SKIP] Not found: {series_filter}")
            return {"total_shows": 0, "total_seasons": 0, "total_episodes": 0, "total_size": 0, "missing": [], "multiple_videos": [], "unneeded_files": []}

    print(f"  {len(all_show_folders)} shows found across {len(series_roots)} drive(s)\n")

    missing = []
    multiple_videos = []
    unneeded_files = []
    total_seasons_on_disk = 0
    total_episodes_on_disk = 0
    total_size = 0
    today = datetime.now().strftime("%Y-%m-%d")

    for show_folder in all_show_folders:
        title, year = parse_name_year(show_folder.name)

        if is_show_blacklisted(blacklist, title):
            print(f"  Skipping: {show_folder.name}  [blacklisted]")
            continue

        print(f"  Checking: {show_folder.name}")

        tv = search_tv(title, year, api_key, cache)
        if not tv:
            print(f"    [WARN] Not found on TMDB — skipping")
            continue

        tv_id = tv["id"]
        details = get_tv_details(tv_id, api_key, cache)
        total_seasons = details.get("number_of_seasons", 0) if details else 0

        season_files = {}

        for d in show_folder.iterdir():
            if d.is_file():
                if is_video(d.name):
                    sn = parse_season_number(d.name)
                    if sn is not None:
                        season_files.setdefault(sn, []).append(d)
                    else:
                        print(f"    [WARN] Video file in show root lacks season number: {d.name}")
                        unneeded_files.append({"show": title, "file": f"{show_folder.name}/{d.name}"})
                elif d.suffix.lower() not in ALLOWED_EXTS:
                    unneeded_files.append({"show": title, "file": f"{show_folder.name}/{d.name}"})
            elif d.is_dir():
                sn = parse_season_number(d.name)
                if sn is not None:
                    for f in d.iterdir():
                        if f.is_file():
                            if is_video(f.name):
                                season_files.setdefault(sn, []).append(f)
                            elif f.suffix.lower() not in ALLOWED_EXTS:
                                unneeded_files.append({"show": title, "file": f"{show_folder.name}/{d.name}/{f.name}"})

        total_seasons_on_disk += len(season_files)
        for sn, files in season_files.items():
            total_episodes_on_disk += len(files)
            for f in files:
                try:
                    total_size += f.stat().st_size
                except OSError:
                    pass

        uses_absolute = any(
            re.search(r'\[Ep\s*\d+', d.name, re.IGNORECASE)
            for d in show_folder.iterdir() if d.is_dir()
        )
        if not uses_absolute:
            for sn, files in season_files.items():
                if any("[Ep " in f.name for f in files):
                    uses_absolute = True
                    break
        
        if not uses_absolute and any(s.lower() in title.lower() for s in ABSOLUTE_NUMBERED_SHOWS):
            uses_absolute = True

        if uses_absolute:
            all_present = set()
            ep_to_file = {}

            flat_eps = get_all_tv_episodes_flat(tv_id, total_seasons, api_key, cache)
            flat_eps_data = {n: v["name"] for n, v in flat_eps.items()}

            for sn, files in season_files.items():
                for f in files:
                    eps = None
                    ep_tags = re.findall(r'\[Ep\s*(\d+)\]', f.name, re.IGNORECASE)
                    if ep_tags:
                        eps = {int(et) for et in ep_tags}

                    if not eps and flat_eps_data:
                        cleaned_f = clean_ep_title(f.name, title)
                        for sm_key, sm_abs in ANIME_SPECIAL_MAPPINGS.items():
                            if sm_key.lower() in cleaned_f:
                                eps = {sm_abs}
                                break

                        if not eps:
                            best_abs = None
                            best_score = 0
                            for te_abs, te_name in flat_eps_data.items():
                                te_cleaned = clean_ep_title(te_name)
                                score = get_match_score(cleaned_f, te_cleaned)
                                if score > 0.55 and score > best_score:
                                    best_score = score
                                    best_abs = te_abs
                            if best_abs:
                                eps = {best_abs}

                    if not eps:
                        parsed = parse_episode_numbers(f.name)
                        if parsed:
                            if "One Piece" not in title or any(p > 300 for p in parsed):
                                eps = parsed

                    if eps:
                        for ep in eps:
                            if ep in ep_to_file:
                                multiple_videos.append({"show": title, "season": "absolute", "episode": ep, "files": [ep_to_file[ep], f.name]})
                            else:
                                ep_to_file[ep] = f.name
                        all_present.update(eps)

            expected_flat = {n for n, v in flat_eps.items() if v["air_date"] and v["air_date"] <= today}
            gap = sorted(expected_flat - all_present)

            # Filter out blacklisted absolute episodes (season=0)
            gap_filtered = [ep for ep in gap if not is_episode_blacklisted(blacklist, title, 0, ep)]
            blacklisted_count = len(gap) - len(gap_filtered)

            if gap_filtered:
                gap_display = str(gap_filtered[:10]) + ("..." if len(gap_filtered) > 10 else "")
                for ep in gap_filtered:
                    missing.append({
                        "type": "episode",
                        "show": title,
                        "season": 0,
                        "episode": ep,
                        "air_date": flat_eps[ep]["air_date"],
                        "tmdb_id": tv_id,
                    })
                bl_note = f", {blacklisted_count} blacklisted" if blacklisted_count else ""
                print(f"    ✗ absolute-numbered, missing ep: {gap_display}{bl_note}")
            else:
                bl_note = f" ({blacklisted_count} blacklisted)" if blacklisted_count else ""
                print(f"    ✓ All episodes present (absolute, {len(all_present)} ep{bl_note})")
            continue

        # ── Detect entirely absent seasons ────────────────────────────────────
        for sn in range(1, total_seasons + 1):
            if sn in season_files:
                continue

            season_data = get_tv_season(tv_id, sn, api_key, cache)
            if not season_data or not season_data.get("episodes"):
                continue

            air_dates = [ep.get("air_date") or "" for ep in season_data["episodes"] if ep.get("air_date")]
            if not air_dates or min(air_dates) > today:
                continue

            if is_season_blacklisted(blacklist, title, sn):
                print(f"    ~ Season {sn:02d}: entire season missing but blacklisted")
                continue

            missing.append({
                "type": "season_missing",
                "show": title,
                "season": sn,
                "first_air_date": min(air_dates),
                "tmdb_id": tv_id,
            })
            print(f"    ✗ Season {sn:02d}: ENTIRE SEASON MISSING (premiered {min(air_dates)})")

        # ── Detect missing episodes within seasons you have ───────────────────
        for sn, files in sorted(season_files.items()):
            if sn == 0:
                continue

            present = set()
            ep_to_file = {}
            for f in files:
                eps = parse_episode_numbers(f.name)
                if eps:
                    for ep in eps:
                        if ep in ep_to_file:
                            multiple_videos.append({"show": title, "season": sn, "episode": ep, "files": [ep_to_file[ep], f.name]})
                        else:
                            ep_to_file[ep] = f.name
                    present.update(eps)
                else:
                    unneeded_files.append({"show": title, "file": f"{show_folder.name}/Season {str(sn).zfill(2)}/{f.name}"})
                    print(f"    [WARN] Season {sn:02d}: unrecognised episode filename (non-standard naming): {f.name}")

            season_data = get_tv_season(tv_id, sn, api_key, cache)
            if not season_data or "episodes" not in season_data:
                print(f"    [WARN] Season {sn}: could not fetch info from TMDB")
                continue

            air_dates = {ep["episode_number"]: ep.get("air_date", "")
                         for ep in season_data["episodes"]}
            expected = {n for n, d in air_dates.items() if d and d <= today}

            if not expected:
                continue

            gap = sorted(expected - present)

            # Filter out blacklisted episodes and entirely blacklisted seasons
            gap_filtered = [
                ep for ep in gap
                if not is_season_blacklisted(blacklist, title, sn)
                and not is_episode_blacklisted(blacklist, title, sn, ep)
            ]
            blacklisted_count = len(gap) - len(gap_filtered)

            if gap_filtered:
                for ep in gap_filtered:
                    missing.append({
                        "type": "episode",
                        "show": title,
                        "season": sn,
                        "episode": ep,
                        "air_date": air_dates.get(ep, "unknown"),
                        "tmdb_id": tv_id,
                    })
                bl_note = f" ({blacklisted_count} blacklisted)" if blacklisted_count else ""
                print(f"    ✗ Season {sn:02d}: missing episodes {gap_filtered}{bl_note}")
            else:
                bl_note = f" ({blacklisted_count} blacklisted)" if blacklisted_count else ""
                print(f"    ✓ Season {sn:02d}: complete ({len(present)} ep{bl_note})")

    return {
        "total_shows": len(all_show_folders),
        "total_seasons": total_seasons_on_disk,
        "total_episodes": total_episodes_on_disk,
        "total_size": total_size,
        "shows_on_disk": shows_on_disk,
        "missing": missing,
        "multiple_videos": multiple_videos,
        "unneeded_files": unneeded_files,
    }


# ─── Plex sync check ─────────────────────────────────────────────────────────

def _rel_path(fpath, roots):
    """Return path relative to the first matching root, or the full path."""
    for root in roots:
        root = root.rstrip("/")
        if fpath.startswith(root + "/"):
            return fpath[len(root) + 1:]
    return fpath

def check_plex_sync(plex_url, plex_token, movies_roots, series_roots):
    print("\n" + "═" * 60)
    print("  PLEX SYNC — Cross-checking index against disk")
    print("═" * 60)

    if not plex_url or not plex_token:
        print("  [SKIP] PLEX_URL / PLEX_TOKEN not configured")
        return {"not_indexed": [], "stale": []}

    plex_scan_wait = int(os.environ.get("PLEX_SCAN_WAIT", "15"))
    headers = {"X-Plex-Token": plex_token, "Accept": "application/json"}
    all_roots = [r.rstrip("/") for r in list(movies_roots) + list(series_roots)]

    # Fetch library sections
    try:
        r = tmdb_session.get(f"{plex_url}/library/sections", headers=headers, timeout=10)
        r.raise_for_status()
        sections = r.json()["MediaContainer"]["Directory"]
    except Exception as e:
        print(f"  [WARN] Could not reach Plex: {e}")
        return {"not_indexed": [], "stale": []}

    # Trigger a partial scan on every section so newly downloaded files get picked up
    triggered = 0
    for section in sections:
        try:
            tmdb_session.get(
                f"{plex_url}/library/sections/{section['key']}/refresh",
                headers=headers,
                timeout=10,
            )
            triggered += 1
        except Exception:
            pass
    if triggered:
        print(f"  ↻ Triggered scan on {triggered} section(s) — waiting {plex_scan_wait}s for Plex to index…")
        time.sleep(plex_scan_wait)

    # Fetch all file paths currently indexed by Plex
    plex_files = set()
    try:
        for section in sections:
            skey = section["key"]
            params = {"X-Plex-Token": plex_token}
            if section["type"] == "show":
                params["type"] = "4"  # episodes only
            r2 = tmdb_session.get(f"{plex_url}/library/sections/{skey}/all",
                                   headers=headers, params=params, timeout=60)
            r2.raise_for_status()
            for item in r2.json()["MediaContainer"].get("Metadata", []):
                for media in item.get("Media", []):
                    for part in media.get("Part", []):
                        plex_files.add(part["file"])
        print(f"  Plex has {len(plex_files)} files indexed")
    except Exception as e:
        print(f"  [WARN] Could not reach Plex: {e}")
        return {"not_indexed": [], "stale": []}

    # Scan all video files on disk
    disk_files = set()
    for root in all_roots:
        p = Path(root)
        if not p.exists():
            continue
        for f in p.rglob("*"):
            if f.is_file() and f.suffix.lower() in VIDEO_EXTS:
                disk_files.add(str(f))

    print(f"  Disk has {len(disk_files)} video files")

    # Files on disk not indexed by Plex
    not_indexed = []
    for fpath in sorted(disk_files - plex_files):
        ftype = "movie" if any(fpath.startswith(r + "/") for r in movies_roots) else "episode"
        not_indexed.append({"type": ftype, "path": _rel_path(fpath, all_roots)})

    if not_indexed:
        print(f"  ✗ {len(not_indexed)} file(s) on disk not indexed by Plex")
        for item in not_indexed[:5]:
            print(f"    • {item['path']}")
        if len(not_indexed) > 5:
            print(f"    … and {len(not_indexed) - 5} more")
    else:
        print("  ✓ All disk files indexed by Plex")

    return {"not_indexed": not_indexed}


# ─── Report ───────────────────────────────────────────────────────────────────

def print_report(report_data):
    print("\n" + "═" * 60)
    print("  SUMMARY REPORT")
    print("═" * 60)

    missing_movies = report_data["movies"]["missing"]
    multiple_movies = report_data["movies"]["multiple_videos"]
    unneeded_movies = report_data["movies"]["unneeded_files"]
    
    missing_series = report_data["series"]["missing"]
    multiple_series = report_data["series"]["multiple_videos"]
    unneeded_series = report_data["series"]["unneeded_files"]

    if not any([missing_movies, multiple_movies, unneeded_movies, missing_series, multiple_series, unneeded_series]):
        print("\n  ✓ Everything looks great! No gaps or issues found.\n")
        return

    if missing_movies:
        print(f"\n  Missing movies ({len(missing_movies)}):")
        for m in missing_movies:
            print(f"    • {m['title']} ({m['year']})  [{m['collection']}]")

    seasons_missing = [e for e in missing_series if e["type"] == "season_missing"]
    eps_missing     = [e for e in missing_series if e["type"] == "episode"]

    if seasons_missing:
        print(f"\n  Missing entire seasons ({len(seasons_missing)}):")
        for s in seasons_missing:
            print(f"    • {s['show']}  Season {s['season']:02d}  (premiered {s['first_air_date']})")

    if eps_missing:
        print(f"\n  Missing episodes ({len(eps_missing)}):")
        by_show = {}
        for e in eps_missing:
            by_show.setdefault(e["show"], {}).setdefault(e["season"], []).append(e["episode"])
        for show in sorted(by_show):
            for sn in sorted(by_show[show]):
                season_label = f"S{sn:02d}" if isinstance(sn, int) and sn > 0 else "absolute"
                print(f"    • {show}  {season_label}  ep {sorted(by_show[show][sn])}")

    if multiple_movies:
        print(f"\n  Movies with multiple video files ({len(multiple_movies)}):")
        for m in multiple_movies:
            print(f"    • {m['folder']}: {', '.join(m['videos'])}")

    if multiple_series:
        print(f"\n  Series with multiple videos per episode ({len(multiple_series)}):")
        for m in multiple_series:
            season_label = f"S{m['season']:02d}" if isinstance(m['season'], int) and m['season'] > 0 else "absolute"
            print(f"    • {m['show']} {season_label}E{m['episode']:02d}: {', '.join(m['files'])}")

    if unneeded_movies:
        print(f"\n  Movies with unneeded files ({len(unneeded_movies)}):")
        for m in unneeded_movies:
            print(f"    • {m['folder']}: {', '.join(m['files'])}")

    if unneeded_series:
        print(f"\n  Series with unneeded files ({len(unneeded_series)}):")
        for s in unneeded_series:
            print(f"    • {s['file']}")

    print()


def save_report(report_data, out_path):
    report_data["generated"] = datetime.now(timezone.utc).isoformat()
    with open(out_path, "w") as f:
        json.dump(report_data, f, indent=2)
    print(f"  JSON report saved → {out_path}")


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Check your Plex library for missing movies/seasons/episodes",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Use defaults (both drives, as configured in the script):
  python3 ~/plex_checker.py --api-key YOUR_KEY

  # Override roots at runtime:
  python3 ~/plex_checker.py \\
    --movies-roots /mnt/drive1/movies,/mnt/drive2/movies \\
    --series-roots /mnt/drive1/series,/mnt/drive2/series \\
    --api-key YOUR_KEY

  # Check only movies:
  python3 ~/plex_checker.py --api-key YOUR_KEY --skip-series

  # To suppress false positives, edit plex_blacklist.json next to this script.
        """
    )
    parser.add_argument("--api-key", default="", help="TMDB API key (or set TMDB_API_KEY in .env)")
    parser.add_argument("--movies-roots", default="", help="Comma-separated movie root dirs (overrides defaults)")
    parser.add_argument("--series-roots", default="", help="Comma-separated series root dirs (overrides defaults)")
    parser.add_argument("--skip-movies",  action="store_true")
    parser.add_argument("--skip-series",  action="store_true")
    parser.add_argument("--series",       default="", help="Only check show folders matching this string")
    parser.add_argument("--output",  default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "report.json"))
    parser.add_argument("--cache",   default=CACHE_FILE)
    parser.add_argument("--blacklist", default=BLACKLIST_FILE, help="Path to blacklist JSON file")

    args = parser.parse_args()

    blacklist = load_blacklist(args.blacklist)

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

    cache = load_cache(args.cache)

    print("\nPlex Media Checker")
    print(f"Time  : {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"Movies: {', '.join(movies_roots)}")
    print(f"Series: {', '.join(series_roots)}")

    report_data = {
        "movies": {"total": 0, "total_size": 0, "titles_on_disk": [], "missing": [], "multiple_videos": [], "unneeded_files": []},
        "series": {"total_shows": 0, "total_seasons": 0, "total_episodes": 0, "total_size": 0, "shows_on_disk": [], "missing": [], "multiple_videos": [], "unneeded_files": []},
        "plex_sync": {"not_indexed": [], "stale": []},
    }

    try:
        if not args.skip_movies:
            report_data["movies"] = check_movies(movies_roots, api_key, cache, blacklist)
        if not args.skip_series:
            report_data["series"] = check_series(series_roots, api_key, cache, blacklist, series_filter=args.series)
    finally:
        save_cache(cache, args.cache)

    plex_url   = os.environ.get("PLEX_URL", "")
    plex_token = os.environ.get("PLEX_TOKEN", "")
    report_data["plex_sync"] = check_plex_sync(plex_url, plex_token, movies_roots, series_roots)

    print_report(report_data)
    save_report(report_data, args.output)


if __name__ == "__main__":
    main()