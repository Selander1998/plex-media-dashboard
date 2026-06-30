"""
check_movies, check_series, check_plex_sync — the three main analysis passes.

Output philosophy: only print lines that require attention.
  ✗  — missing content
  ~  — intentionally skipped (blacklisted)
  [WARN] — file/naming issue worth knowing about
Section headers and counts are always printed; per-item "Checking X" lines are not.
"""

from __future__ import annotations

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any, TypedDict

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
	has_home_release,
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

_WORKERS = 8  # concurrent TMDB connections; stays well under the ~50 req/s rate limit

# Files with these keywords in their names are bonus/featurette content even when they carry S##E## tags.
# They are never counted as episodes and are flagged as unneeded so the user can review manually.
_FEATURETTE_RE = re.compile(
	r'inside[.\s_-]the[.\s_-]episode|deleted[.\s_-]scene|behind[.\s_-]the[.\s_-]scenes?'
	r'|making[.\s_-]of|featurette',
	re.IGNORECASE,
)


class MovieResult(TypedDict):
	total: int
	total_size: int
	titles_on_disk: list[dict[str, Any]]
	missing: list[dict[str, Any]]
	multiple_videos: list[dict[str, Any]]
	unneeded_files: list[dict[str, Any]]
	not_found_on_tmdb: list[dict[str, Any]]


class SeriesResult(TypedDict):
	total_shows: int
	total_seasons: int
	total_episodes: int
	total_size: int
	shows_on_disk: list[dict[str, Any]]
	missing: list[dict[str, Any]]
	multiple_videos: list[dict[str, Any]]
	unneeded_files: list[dict[str, Any]]
	not_found_on_tmdb: list[dict[str, Any]]
	folder_renames: list[dict[str, Any]]


class PlexSyncResult(TypedDict):
	not_indexed: list[dict[str, str]]
	stale: list


# ─── Per-item workers (pure: no shared-state mutation) ────────────────────────

def _file_info(p: Path) -> dict[str, Any]:
	try:
		size = p.stat().st_size
	except OSError:
		size = 0
	return {"name": p.name, "full_path": str(p), "size": size}


def _process_movie_folder(folder: Path, api_key: str | None, cache: dict[str, Any]) -> dict[str, Any]:
	"""TMDB lookup + file scan for one movie folder. No shared-state side effects."""
	title, year = parse_name_year(folder.name)
	movie = search_movie(title, year, api_key, cache)
	video_files: list[dict[str, Any]] = []
	extras: list[str] = []
	total_size = 0
	for f in folder.iterdir():
		if not f.is_file():
			continue
		if is_video(f.name):
			try:
				size = f.stat().st_size
				total_size += size
			except OSError:
				size = 0
			video_files.append({"name": f.name, "full_path": str(f), "size": size})
		elif f.suffix.lower() not in ALLOWED_EXTS:
			extras.append(f.name)
	return {
		"folder": folder.name,
		"title": title,
		"year": year,
		"tmdb_id": movie["id"] if movie else None,
		"video_files": video_files,
		"extras": extras,
		"total_size": total_size,
	}


def _check_movie_collection(
	tmdb_id: int,
	local_tmdb_ids: frozenset[int],
	api_key: str | None,
	cache: dict[str, Any],
	blacklist: dict[str, list],
	today: str,
) -> tuple[str | None, list[dict[str, Any]], list[str]]:
	"""Check one movie's collection for missing parts. Returns (col_key, missing, log_lines)."""
	parts, collection_name = get_movie_collection(tmdb_id, api_key, cache)
	if not parts:
		return None, [], []
	col_key = (collection_name or str(tmdb_id)).lower()
	missing: list[dict[str, Any]] = []
	log_lines: list[str] = []
	for part in parts:
		part_id = part.get("id")
		part_title = part.get("title", "")
		release = part.get("release_date") or ""
		part_year = int(release[:4]) if release[:4].isdigit() else None
		if not release or release > today:
			continue
		if part_id in local_tmdb_ids:
			continue
		if is_movie_blacklisted(blacklist, part_title, collection_name):
			log_lines.append(f"  ~ MISSING (blacklisted): {part_title} ({part_year})  [{collection_name}]")
		else:
			log_lines.append(f"  ✗ MISSING: {part_title} ({part_year})  [{collection_name}]")
			home = has_home_release(part_id, api_key, cache)
			in_theaters = not home
			if in_theaters:
				log_lines[-1] += "  [cam only]"
			missing.append({
				"type": "movie",
				"collection": collection_name,
				"title": part_title,
				"year": part_year,
				"tmdb_id": part_id,
				"in_theaters": in_theaters,
			})
	return col_key, missing, log_lines


def _check_absolute_show(
	title: str,
	tv_id: int,
	total_seasons: int,
	season_files: dict[int, list[Path]],
	today: str,
	api_key: str | None,
	cache: dict[str, Any],
	blacklist: dict[str, list],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
	"""Absolute-numbered (anime) episode completeness check. Returns (missing, multiple_videos, log_lines)."""
	missing: list[dict[str, Any]] = []
	multiple_videos: list[dict[str, Any]] = []
	log_lines: list[str] = []
	all_present: set[int] = set()
	ep_to_file: dict[int, str] = {}
	ep_to_path: dict[int, Path] = {}

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
					best_score = 0.0
					for te_abs, te_name in flat_eps_data.items():
						score = get_match_score(cleaned_f, clean_ep_title(te_name))
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
							"files": [_file_info(ep_to_path[ep]), _file_info(f)],
						})
					else:
						ep_to_file[ep] = f.name
						ep_to_path[ep] = f
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
		log_lines.append(f"  ✗ {title}  absolute ep missing: {gap_display}{bl_note}")

	return missing, multiple_videos, log_lines


def _process_show_folder(
	show_folder: Path,
	api_key: str | None,
	cache: dict[str, Any],
	blacklist: dict[str, list],
	today: str,
) -> dict[str, Any] | None:
	"""TMDB lookup + gap detection for one show folder. Returns per-show data, or None if blacklisted."""
	title, year = parse_name_year(show_folder.name)
	if is_show_blacklisted(blacklist, title):
		return None

	log_lines: list[str] = []
	missing: list[dict[str, Any]] = []
	multiple_videos: list[dict[str, Any]] = []
	unneeded_files: list[dict[str, Any]] = []
	total_size = 0

	tv = search_tv(title, year, api_key, cache)
	if not tv:
		log_lines.append(f"  [WARN] {show_folder.name} — not found on TMDB")
		return {
			"not_found": {"folder": show_folder.name, "title": title, "year": year},
			"folder_rename": None,
			"missing": [], "multiple_videos": [], "unneeded_files": [],
			"total_size": 0, "seasons_count": 0, "episodes_count": 0,
			"log_lines": log_lines,
		}

	folder_rename: dict[str, Any] | None = None
	if year is None:
		tmdb_year = (tv.get("first_air_date") or "")[:4]
		if tmdb_year.isdigit():
			suggested = f"{title} ({tmdb_year})"
			if suggested != show_folder.name:
				folder_rename = {
					"current_name": show_folder.name,
					"current_path": str(show_folder),
					"suggested_name": suggested,
				}
				log_lines.append(f"  [INFO] {show_folder.name} — no year in folder name, suggest: {suggested}")

	tv_id = tv["id"]
	details = get_tv_details(tv_id, api_key, cache)
	total_seasons = details.get("number_of_seasons", 0) if details else 0

	season_files: dict[int, list[Path]] = {}
	for d in show_folder.iterdir():
		if d.is_file():
			if is_video(d.name):
				sn = parse_season_number(d.name)
				if sn is not None:
					season_files.setdefault(sn, []).append(d)
				else:
					log_lines.append(f"  [WARN] {show_folder.name} — video file lacks season number: {d.name}")
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

	seasons_count = len(season_files)
	episodes_count = 0
	for sn, files in season_files.items():
		episodes_count += len(files)
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
		abs_missing, abs_mv, abs_log = _check_absolute_show(
			title, tv_id, total_seasons, season_files, today, api_key, cache, blacklist,
		)
		missing.extend(abs_missing)
		multiple_videos.extend(abs_mv)
		log_lines.extend(abs_log)
	else:
		# Detect entirely absent seasons
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
				log_lines.append(f"  ~ {show_folder.name}  S{sn:02d}: entire season missing but blacklisted")
				continue
			missing.append({
				"type": "season_missing",
				"show": title,
				"season": sn,
				"first_air_date": min(air_dates),
				"tmdb_id": tv_id,
			})
			log_lines.append(f"  ✗ {show_folder.name}  S{sn:02d}: ENTIRE SEASON MISSING (premiered {min(air_dates)})")

		# Detect missing episodes within seasons you have
		for sn, files in sorted(season_files.items()):
			if sn == 0:
				continue
			present: set[int] = set()
			ep_to_file: dict[int, str] = {}
			ep_to_path: dict[int, Path] = {}
			seen_pairs: set[frozenset] = set()
			for f in files:
				if not re.search(r'[Ss]\d+[Ee]\d+', f.name):
					continue  # bonus/extra without S##E## — already caught as unneeded
				if _FEATURETTE_RE.search(f.name):
					unneeded_files.append({"show": title, "file": f"{show_folder.name}/Season {sn:02d}/{f.name}"})
					log_lines.append(f"  [WARN] {show_folder.name}  S{sn:02d}: bonus content in season folder (needs manual review): {f.name}")
					continue
				eps = parse_episode_numbers(f.name)
				if eps:
					for ep in eps:
						if ep in ep_to_file:
							pair = frozenset([str(ep_to_path[ep]), str(f)])
							if pair not in seen_pairs:
								seen_pairs.add(pair)
								existing_path = ep_to_path[ep]
								existing_eps = parse_episode_numbers(existing_path.name)
								new_eps = parse_episode_numbers(f.name)
								eps_in_conflict = sorted(existing_eps | new_eps)
								ep_label = eps_in_conflict[0] if len(eps_in_conflict) == 1 else eps_in_conflict
								if new_eps > existing_eps:
									# existing has fewer episodes — prefer it (single-ep file)
									suggested_keep = str(existing_path)
								elif existing_eps > new_eps:
									# new file has fewer episodes — prefer it (single-ep file)
									suggested_keep = str(f)
								else:
									suggested_keep = None
								multiple_videos.append({
									"show": title,
									"season": sn,
									"episode": ep_label,
									"files": [_file_info(existing_path), _file_info(f)],
									"suggested_keep": suggested_keep,
								})
						else:
							ep_to_file[ep] = f.name
							ep_to_path[ep] = f
					present.update(eps)
				else:
					unneeded_files.append({
						"show": title,
						"file": f"{show_folder.name}/Season {str(sn).zfill(2)}/{f.name}",
					})
					log_lines.append(f"  [WARN] {show_folder.name}  S{sn:02d}: unrecognised filename: {f.name}")

			season_data = get_tv_season(tv_id, sn, api_key, cache)
			if not season_data or "episodes" not in season_data:
				log_lines.append(f"  [WARN] {show_folder.name}  S{sn:02d}: could not fetch TMDB info")
				continue
			air_dates_map = {ep["episode_number"]: ep.get("air_date", "") for ep in season_data["episodes"]}
			expected = {n for n, ad in air_dates_map.items() if ad and ad <= today}
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
						"air_date": air_dates_map.get(ep, "unknown"),
						"tmdb_id": tv_id,
					})
				bl_note = f" ({blacklisted_count} blacklisted)" if blacklisted_count else ""
				log_lines.append(f"  ✗ {show_folder.name}  S{sn:02d}: missing ep {gap_filtered}{bl_note}")

	return {
		"not_found": None,
		"folder_rename": folder_rename,
		"missing": missing,
		"multiple_videos": multiple_videos,
		"unneeded_files": unneeded_files,
		"total_size": total_size,
		"seasons_count": seasons_count,
		"episodes_count": episodes_count,
		"log_lines": log_lines,
	}


# ─── Movie checker ─────────────────────────────────────────────────────────────

def check_movies(movies_roots: list[str], api_key: str | None, cache: dict[str, Any], blacklist: dict[str, list]) -> MovieResult:
	print("\n" + "═" * 60)
	print("  MOVIES — Collection completeness check")
	print("═" * 60)

	all_folders = list(iter_dirs(movies_roots))
	if not all_folders:
		print("  [SKIP] No movie folders found.")
		return {
			"total": 0, "total_size": 0, "titles_on_disk": [],
			"missing": [], "multiple_videos": [], "unneeded_files": [], "not_found_on_tmdb": [],
		}

	titles_on_disk = [{"title": t, "year": y} for t, y in (parse_name_year(f.name) for f in all_folders)]
	total = len(all_folders)
	print(f"  {total} movies found across {len(movies_roots)} drive(s)")
	print(f"  Pass 1/2: Resolving local movies to TMDB IDs ({_WORKERS} workers)...\n", flush=True)

	# ── Pass 1: parallel folder → TMDB lookup ─────────────────────────────────
	folder_results: list[dict[str, Any]] = [{}] * total
	with ThreadPoolExecutor(max_workers=_WORKERS) as executor:
		futures = {executor.submit(_process_movie_folder, f, api_key, cache): i for i, f in enumerate(all_folders)}
		done = 0
		for fut in as_completed(futures):
			folder_results[futures[fut]] = fut.result()
			done += 1
			print(f"[PROGRESS] movies {done}/{total}", flush=True)

	local_tmdb_ids: set[int] = set()
	folder_to_tmdb_id: dict[str, int] = {}
	multiple_videos: list[dict[str, Any]] = []
	unneeded_files: list[dict[str, Any]] = []
	not_found_on_tmdb: list[dict[str, Any]] = []
	total_size = 0

	for r in folder_results:
		total_size += r["total_size"]
		if len(r["video_files"]) > 1:
			multiple_videos.append({"folder": r["folder"], "files": r["video_files"]})
			print(f"  [WARN] {r['folder']} — multiple video files: {', '.join(vf['name'] for vf in r['video_files'])}")
		if r["extras"]:
			unneeded_files.append({"folder": r["folder"], "files": r["extras"]})
			print(f"  [WARN] {r['folder']} — unneeded files: {', '.join(r['extras'])}")
		if r["tmdb_id"] is not None:
			local_tmdb_ids.add(r["tmdb_id"])
			folder_to_tmdb_id[r["folder"]] = r["tmdb_id"]
		else:
			not_found_on_tmdb.append({"folder": r["folder"], "title": r["title"], "year": r["year"]})
			print(f"  [WARN] {r['folder']} — not found on TMDB")

	# ── Pass 2: parallel collection gap check ─────────────────────────────────
	tmdb_ids_to_check = list(folder_to_tmdb_id.values())
	p2_total = len(tmdb_ids_to_check)
	frozen_local = frozenset(local_tmdb_ids)
	today_str = datetime.now().strftime("%Y-%m-%d")
	print(f"\n  Pass 2/2: Checking collections for gaps ({_WORKERS} workers, {p2_total} with TMDB IDs)\n", flush=True)

	col_results: list[tuple[str | None, list, list]] = []
	with ThreadPoolExecutor(max_workers=_WORKERS) as executor:
		futures_p2 = {
			executor.submit(_check_movie_collection, tid, frozen_local, api_key, cache, blacklist, today_str): tid
			for tid in tmdb_ids_to_check
		}
		p2_done = 0
		for fut in as_completed(futures_p2):
			col_results.append(fut.result())
			p2_done += 1
			print(f"[PROGRESS] movies_p2 {p2_done}/{p2_total}", flush=True)

	missing: list[dict[str, Any]] = []
	seen_collections: set[str] = set()
	for col_key, col_missing, log_lines in col_results:
		if col_key is None or col_key in seen_collections:
			continue
		seen_collections.add(col_key)
		for line in log_lines:
			print(line)
		missing.extend(col_missing)

	return {
		"total": total,
		"total_size": total_size,
		"titles_on_disk": titles_on_disk,
		"missing": missing,
		"multiple_videos": multiple_videos,
		"unneeded_files": unneeded_files,
		"not_found_on_tmdb": not_found_on_tmdb,
	}


# ─── Series checker ────────────────────────────────────────────────────────────

def check_series(series_roots: list[str], api_key: str | None, cache: dict[str, Any], blacklist: dict[str, list], series_filter: str | None = None) -> SeriesResult:
	print("\n" + "═" * 60)
	print("  SERIES — Season & episode completeness check")
	print("═" * 60)

	all_show_folders = list(iter_dirs(series_roots))
	if not all_show_folders:
		print("  [SKIP] No series folders found.")
		return {
			"total_shows": 0, "total_seasons": 0, "total_episodes": 0, "total_size": 0,
			"shows_on_disk": [], "missing": [], "multiple_videos": [], "unneeded_files": [], "not_found_on_tmdb": [],
		}

	shows_on_disk = [{"title": t, "year": y} for t, y in (parse_name_year(f.name) for f in all_show_folders)]

	if series_filter:
		all_show_folders = [d for d in all_show_folders if series_filter.lower() in d.name.lower()]
		if not all_show_folders:
			print(f"  [SKIP] Not found: {series_filter}")
			return {
				"total_shows": 0, "total_seasons": 0, "total_episodes": 0, "total_size": 0,
				"shows_on_disk": [], "missing": [], "multiple_videos": [], "unneeded_files": [], "not_found_on_tmdb": [],
			}

	total = len(all_show_folders)
	today = datetime.now().strftime("%Y-%m-%d")
	print(f"  {total} shows found across {len(series_roots)} drive(s) ({_WORKERS} workers)", flush=True)

	show_results: list[dict[str, Any] | None] = [None] * total
	with ThreadPoolExecutor(max_workers=_WORKERS) as executor:
		futures = {
			executor.submit(_process_show_folder, sf, api_key, cache, blacklist, today): i
			for i, sf in enumerate(all_show_folders)
		}
		done = 0
		for fut in as_completed(futures):
			show_results[futures[fut]] = fut.result()
			done += 1
			print(f"[PROGRESS] series {done}/{total}", flush=True)

	missing: list[dict[str, Any]] = []
	multiple_videos: list[dict[str, Any]] = []
	unneeded_files: list[dict[str, Any]] = []
	not_found_on_tmdb: list[dict[str, Any]] = []
	folder_renames: list[dict[str, Any]] = []
	total_seasons_on_disk = 0
	total_episodes_on_disk = 0
	total_size = 0

	for r in show_results:
		if r is None:
			continue  # blacklisted
		for line in r["log_lines"]:
			print(line)
		if r["folder_rename"]:
			folder_renames.append(r["folder_rename"])
		if r["not_found"]:
			not_found_on_tmdb.append(r["not_found"])
			continue
		missing.extend(r["missing"])
		multiple_videos.extend(r["multiple_videos"])
		unneeded_files.extend(r["unneeded_files"])
		total_size += r["total_size"]
		total_seasons_on_disk += r["seasons_count"]
		total_episodes_on_disk += r["episodes_count"]

	return {
		"total_shows": total,
		"total_seasons": total_seasons_on_disk,
		"total_episodes": total_episodes_on_disk,
		"total_size": total_size,
		"shows_on_disk": shows_on_disk,
		"missing": missing,
		"multiple_videos": multiple_videos,
		"unneeded_files": unneeded_files,
		"not_found_on_tmdb": not_found_on_tmdb,
		"folder_renames": folder_renames,
	}


# ─── Plex sync check ──────────────────────────────────────────────────────────

def _rel_path(fpath: str, roots: list[str]) -> str:
	"""Return path relative to the first matching root, or the full path."""
	for root in roots:
		root = root.rstrip("/")
		if fpath.startswith(root + "/"):
			return fpath[len(root) + 1:]
	return fpath


def check_plex_sync(plex_url: str | None, plex_token: str | None, movies_roots: list[str], series_roots: list[str]) -> PlexSyncResult:
	print("\n" + "═" * 60)
	print("  PLEX SYNC — Cross-checking index against disk")
	print("═" * 60)

	if not plex_url or not plex_token:
		print("  [SKIP] PLEX_URL / PLEX_TOKEN not configured")
		return {"not_indexed": [], "stale": []}

	plex_scan_wait = int(os.environ.get("PLEX_SCAN_WAIT", "15"))
	headers = {"X-Plex-Token": plex_token, "Accept": "application/json"}
	all_roots = [r.rstrip("/") for r in list(movies_roots) + list(series_roots)]

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

	try:
		plex_files = fetch_plex_files()
		print(f"  Plex has {len(plex_files)} files indexed")
	except Exception as e:
		print(f"  [WARN] Could not reach Plex: {e}")
		return {"not_indexed": [], "stale": []}

	disk_files: set[str] = set()
	for root in all_roots:
		p = Path(root)
		if not p.exists():
			continue
		for f in p.rglob("*"):
			if f.is_file() and f.suffix.lower() in VIDEO_EXTS:
				disk_files.add(str(f))

	print(f"  Disk has {len(disk_files)} video files")

	if not (disk_files - plex_files):
		print("  ✓ All disk files indexed by Plex")
		return {"not_indexed": [], "stale": []}

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

	try:
		plex_files = fetch_plex_files()
	except Exception as e:
		print(f"  [WARN] Could not reach Plex after scan: {e}")
		return {"not_indexed": [], "stale": []}

	not_indexed: list[dict[str, str]] = []
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
