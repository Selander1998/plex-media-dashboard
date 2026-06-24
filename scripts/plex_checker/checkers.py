"""
check_movies, check_series, check_plex_sync — the three main analysis passes.

Output philosophy: only print lines that require attention.
  ✗  — missing content
  ~  — intentionally skipped (blacklisted)
  [WARN] — file/naming issue worth knowing about
Section headers and counts are always printed; per-item "Checking X" lines are not.
"""

import os
import re
import time
from datetime import datetime
from pathlib import Path

from .blacklist import (
	is_episode_blacklisted,
	is_season_blacklisted,
	is_show_blacklisted,
	is_movie_blacklisted,
)
from .tmdb import (
	tmdb_session,
	search_movie,
	get_movie_collection,
	search_tv,
	get_tv_details,
	get_tv_season,
	get_all_tv_episodes_flat,
)
from .media_scan import (
	ANIME_SPECIAL_MAPPINGS,
	ABSOLUTE_NUMBERED_SHOWS,
	VIDEO_EXTS,
	ALLOWED_EXTS,
	parse_name_year,
	parse_season_number,
	parse_episode_numbers,
	is_video,
	clean_ep_title,
	iter_dirs,
	get_match_score,
)


# ─── Movie checker ─────────────────────────────────────────────────────────────

def check_movies(movies_roots, api_key, cache, blacklist):
	print("\n" + "═" * 60)
	print("  MOVIES — Collection completeness check")
	print("═" * 60)

	all_folders = list(iter_dirs(movies_roots))
	if not all_folders:
		print("  [SKIP] No movie folders found.")
		return {
			"total": 0,
			"total_size": 0,
			"titles_on_disk": [],
			"missing": [],
			"multiple_videos": [],
			"unneeded_files": [],
			"not_found_on_tmdb": [],
		}

	titles_on_disk = [{"title": t, "year": y} for t, y in (parse_name_year(f.name) for f in all_folders)]

	print(f"  {len(all_folders)} movies found across {len(movies_roots)} drive(s)")
	print(f"  Pass 1/2: Resolving local movies to TMDB IDs...\n", flush=True)

	# ── Pass 1: look up every local folder on TMDB ────────────────────────────
	local_tmdb_ids = set()
	folder_to_tmdb_id = {}
	multiple_videos = []
	unneeded_files = []
	not_found_on_tmdb = []
	total_size = 0

	total = len(all_folders)
	for i, folder in enumerate(all_folders):
		title, year = parse_name_year(folder.name)

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
			print(f"  [WARN] {folder.name} — multiple video files: {', '.join(videos)}")
		if extras:
			unneeded_files.append({"folder": folder.name, "files": extras})
			print(f"  [WARN] {folder.name} — unneeded files: {', '.join(extras)}")
		if movie:
			local_tmdb_ids.add(movie["id"])
			folder_to_tmdb_id[folder.name] = movie["id"]
		else:
			not_found_on_tmdb.append({"folder": folder.name, "title": title, "year": year})
			print(f"  [WARN] {folder.name} — not found on TMDB")
		print(f"[PROGRESS] movies {i + 1}/{total}", flush=True)

	# ── Pass 2: for each movie in a collection, check completeness ────────────
	p2_total = sum(1 for f in all_folders if f.name in folder_to_tmdb_id)
	print(f"\n  Pass 2/2: Checking collections for gaps... ({p2_total} with TMDB IDs)\n", flush=True)

	missing = []
	seen_collections = set()
	today_str = datetime.now().strftime("%Y-%m-%d")
	p2_done = 0

	for folder in all_folders:
		tmdb_id = folder_to_tmdb_id.get(folder.name)
		if not tmdb_id:
			continue

		p2_done += 1
		parts, collection_name = get_movie_collection(tmdb_id, api_key, cache)
		if not parts:
			print(f"[PROGRESS] movies_p2 {p2_done}/{p2_total}", flush=True)
			continue

		col_key = (collection_name or str(tmdb_id)).lower()
		if col_key in seen_collections:
			print(f"[PROGRESS] movies_p2 {p2_done}/{p2_total}", flush=True)
			continue
		seen_collections.add(col_key)

		collection_missing = []

		for part in parts:
			part_id = part.get("id")
			part_title = part.get("title", "")
			release = part.get("release_date") or ""
			part_year = int(release[:4]) if release[:4].isdigit() else None

			if not release:
				continue
			if release > today_str:
				continue

			if part_id in local_tmdb_ids:
				pass
			elif is_movie_blacklisted(blacklist, part_title, collection_name):
				print(f"  ~ MISSING (blacklisted): {part_title} ({part_year})  [{collection_name}]")
			else:
				print(f"  ✗ MISSING: {part_title} ({part_year})  [{collection_name}]")
				collection_missing.append({
					"type": "movie",
					"collection": collection_name,
					"title": part_title,
					"year": part_year,
					"tmdb_id": part_id,
				})

		missing.extend(collection_missing)
		print(f"[PROGRESS] movies_p2 {p2_done}/{p2_total}", flush=True)

	return {
		"total": len(all_folders),
		"total_size": total_size,
		"titles_on_disk": titles_on_disk,
		"missing": missing,
		"multiple_videos": multiple_videos,
		"unneeded_files": unneeded_files,
		"not_found_on_tmdb": not_found_on_tmdb,
	}


# ─── Series checker ────────────────────────────────────────────────────────────

def check_series(series_roots, api_key, cache, blacklist, series_filter=None):
	print("\n" + "═" * 60)
	print("  SERIES — Season & episode completeness check")
	print("═" * 60)

	all_show_folders = list(iter_dirs(series_roots))
	if not all_show_folders:
		print("  [SKIP] No series folders found.")
		return {
			"total_shows": 0,
			"total_seasons": 0,
			"total_episodes": 0,
			"total_size": 0,
			"shows_on_disk": [],
			"missing": [],
			"multiple_videos": [],
			"unneeded_files": [],
			"not_found_on_tmdb": [],
		}

	shows_on_disk = [{"title": t, "year": y} for t, y in (parse_name_year(f.name) for f in all_show_folders)]

	if series_filter:
		all_show_folders = [d for d in all_show_folders if series_filter.lower() in d.name.lower()]
		if not all_show_folders:
			print(f"  [SKIP] Not found: {series_filter}")
			return {
				"total_shows": 0,
				"total_seasons": 0,
				"total_episodes": 0,
				"total_size": 0,
				"shows_on_disk": [],
				"missing": [],
				"multiple_videos": [],
				"unneeded_files": [],
				"not_found_on_tmdb": [],
			}

	print(f"  {len(all_show_folders)} shows found across {len(series_roots)} drive(s)", flush=True)

	missing = []
	multiple_videos = []
	unneeded_files = []
	not_found_on_tmdb = []
	total_seasons_on_disk = 0
	total_episodes_on_disk = 0
	total_size = 0
	today = datetime.now().strftime("%Y-%m-%d")

	total = len(all_show_folders)
	for i, show_folder in enumerate(all_show_folders):
		title, year = parse_name_year(show_folder.name)

		if is_show_blacklisted(blacklist, title):
			continue

		tv = search_tv(title, year, api_key, cache)
		if not tv:
			not_found_on_tmdb.append({"folder": show_folder.name, "title": title, "year": year})
			print(f"  [WARN] {show_folder.name} — not found on TMDB")
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
						print(f"  [WARN] {show_folder.name} — video file lacks season number: {d.name}")
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
						elif f.is_dir():
							# Handle double-nested season folders (e.g. Season 22/Season 22/file.mkv)
							for ff in f.iterdir():
								if ff.is_file() and is_video(ff.name):
									season_files.setdefault(sn, []).append(ff)

		total_seasons_on_disk += len(season_files)
		for sn, files in season_files.items():
			total_episodes_on_disk += len(files)
			for f in files:
				try:
					total_size += f.stat().st_size
				except OSError:
					pass

		# Detect absolute numbering (anime-style)
		uses_absolute = any(
			re.search(r'\[Ep\s*\d+', d.name, re.IGNORECASE)
			for d in show_folder.iterdir()
			if d.is_dir()
		)
		if not uses_absolute:
			for sn, files in season_files.items():
				if any("[Ep " in f.name for f in files):
					uses_absolute = True
					break
		if not uses_absolute and any(s.lower() in title.lower() for s in ABSOLUTE_NUMBERED_SHOWS):
			uses_absolute = True

		if uses_absolute:
			_check_absolute_show(
				title, tv_id, total_seasons, season_files, today,
				api_key, cache, blacklist, missing, multiple_videos,
			)
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
				print(f"  ~ {show_folder.name}  S{sn:02d}: entire season missing but blacklisted")
				continue

			missing.append({
				"type": "season_missing",
				"show": title,
				"season": sn,
				"first_air_date": min(air_dates),
				"tmdb_id": tv_id,
			})
			print(f"  ✗ {show_folder.name}  S{sn:02d}: ENTIRE SEASON MISSING (premiered {min(air_dates)})")

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
							multiple_videos.append({
								"show": title,
								"season": sn,
								"episode": ep,
								"files": [ep_to_file[ep], f.name],
							})
						else:
							ep_to_file[ep] = f.name
					present.update(eps)
				else:
					unneeded_files.append({
						"show": title,
						"file": f"{show_folder.name}/Season {str(sn).zfill(2)}/{f.name}",
					})
					print(f"  [WARN] {show_folder.name}  S{sn:02d}: unrecognised filename: {f.name}")

			season_data = get_tv_season(tv_id, sn, api_key, cache)
			if not season_data or "episodes" not in season_data:
				print(f"  [WARN] {show_folder.name}  S{sn:02d}: could not fetch TMDB info")
				continue

			air_dates = {ep["episode_number"]: ep.get("air_date", "") for ep in season_data["episodes"]}
			expected = {n for n, d in air_dates.items() if d and d <= today}

			if not expected:
				continue

			gap = sorted(expected - present)
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
				print(f"  ✗ {show_folder.name}  S{sn:02d}: missing ep {gap_filtered}{bl_note}")
		print(f"[PROGRESS] series {i + 1}/{total}", flush=True)

	return {
		"total_shows": len(all_show_folders),
		"total_seasons": total_seasons_on_disk,
		"total_episodes": total_episodes_on_disk,
		"total_size": total_size,
		"shows_on_disk": shows_on_disk,
		"missing": missing,
		"multiple_videos": multiple_videos,
		"unneeded_files": unneeded_files,
		"not_found_on_tmdb": not_found_on_tmdb,
	}


def _check_absolute_show(title, tv_id, total_seasons, season_files, today, api_key, cache, blacklist, missing, multiple_videos):
	"""Handle episode-completeness check for absolute-numbered (anime-style) shows."""
	all_present = set()
	ep_to_file = {}

	flat_eps = get_all_tv_episodes_flat(tv_id, total_seasons, api_key, cache)
	flat_eps_data = {n: v["name"] for n, v in flat_eps.items()}

	for _, files in season_files.items():
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
						multiple_videos.append({
							"show": title,
							"season": "absolute",
							"episode": ep,
							"files": [ep_to_file[ep], f.name],
						})
					else:
						ep_to_file[ep] = f.name
				all_present.update(eps)

	expected_flat = {n for n, v in flat_eps.items() if v["air_date"] and v["air_date"] <= today}
	gap = sorted(expected_flat - all_present)
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
		bl_note = f" ({blacklisted_count} blacklisted)" if blacklisted_count else ""
		print(f"  ✗ {title}  absolute ep missing: {gap_display}{bl_note}")


# ─── Plex sync check ──────────────────────────────────────────────────────────

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

	def fetch_plex_files():
		files = set()
		for section in sections:
			skey = section["key"]
			params = {"X-Plex-Token": plex_token}
			if section["type"] == "show":
				params["type"] = "4"  # episodes only
			r2 = tmdb_session.get(
				f"{plex_url}/library/sections/{skey}/all",
				headers=headers,
				params=params,
				timeout=60,
			)
			r2.raise_for_status()
			for item in r2.json()["MediaContainer"].get("Metadata", []):
				for media in item.get("Media", []):
					for part in media.get("Part", []):
						files.add(part["file"])
		return files

	# Fetch current Plex index before deciding whether to scan
	try:
		plex_files = fetch_plex_files()
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

	# If everything on disk is already indexed, skip the scan entirely
	if not (disk_files - plex_files):
		print("  ✓ All disk files indexed by Plex")
		return {"not_indexed": [], "stale": []}

	# New files detected — trigger scan and wait for Plex to index them
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
		new_count = len(disk_files - plex_files)
		print(f"  ↻ {new_count} unindexed file(s) — triggered scan on {triggered} section(s), waiting {plex_scan_wait}s…")
		time.sleep(plex_scan_wait)

	# Re-fetch after scan to get the updated index
	try:
		plex_files = fetch_plex_files()
	except Exception as e:
		print(f"  [WARN] Could not reach Plex after scan: {e}")
		return {"not_indexed": [], "stale": []}

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

	return {"not_indexed": not_indexed, "stale": []}
