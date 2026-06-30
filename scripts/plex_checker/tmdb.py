"""TMDB API session and all search / fetch helpers."""
from __future__ import annotations

import json
import time
import difflib
from datetime import date
from typing import Any
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

TMDB_BASE = "https://api.themoviedb.org/3"

tmdb_session = requests.Session()
_retries = Retry(total=5, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504])
tmdb_session.mount("https://", HTTPAdapter(max_retries=_retries, pool_connections=10, pool_maxsize=10))


def _cache_key(endpoint: str, params: dict[str, Any]) -> str:
	return endpoint + json.dumps(params, sort_keys=True)


def tmdb_get(endpoint: str, params: dict[str, Any], api_key: str | None, cache: dict[str, Any], delay: float = 0.02) -> Any | None:
	request_params = {**params, "api_key": api_key} if api_key else params
	cache_key = _cache_key(endpoint, params)
	if cache_key in cache:
		return cache[cache_key]
	url = TMDB_BASE + endpoint
	try:
		r = tmdb_session.get(url, params=request_params, timeout=10)
		r.raise_for_status()
		data = r.json()
		cache[cache_key] = data
		if delay > 0:
			time.sleep(delay)
		return data
	except requests.RequestException as e:
		print(f"  [WARN] TMDB request failed: {e}")
		return None


def get_best_match(query: str, results: list[dict[str, Any]]) -> dict[str, Any] | None:
	if not results:
		return None
	best_result = results[0]
	best_score = 0
	for r in results:
		title = r.get("title") or r.get("name", "")
		if not title:
			continue
		score = difflib.SequenceMatcher(None, query.lower(), title.lower()).ratio()
		if score > best_score:
			best_score = score
			best_result = r
	return best_result


def search_movie(title: str, year: int | str | None, api_key: str | None, cache: dict[str, Any]) -> dict[str, Any] | None:
	data = tmdb_get("/search/movie", {"query": title, "year": year}, api_key, cache)
	if data and data.get("results"):
		return get_best_match(title, data["results"])
	data = tmdb_get("/search/movie", {"query": title}, api_key, cache)
	if data and data.get("results"):
		return get_best_match(title, data["results"])
	return None


def get_movie_collection(movie_id: int, api_key: str | None, cache: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
	data = tmdb_get(f"/movie/{movie_id}", {}, api_key, cache)
	if data and data.get("belongs_to_collection"):
		col_id = data["belongs_to_collection"]["id"]
		col_data = tmdb_get(f"/collection/{col_id}", {}, api_key, cache)
		if col_data:
			return col_data.get("parts", []), data["belongs_to_collection"]["name"]
	return [], None


def search_tv(title: str, year: int | str | None, api_key: str | None, cache: dict[str, Any]) -> dict[str, Any] | None:
	data = tmdb_get("/search/tv", {"query": title, "first_air_date_year": year}, api_key, cache)
	if data and data.get("results"):
		return get_best_match(title, data["results"])
	data = tmdb_get("/search/tv", {"query": title}, api_key, cache)
	if data and data.get("results"):
		return get_best_match(title, data["results"])
	return None


def get_tv_details(tv_id: int, api_key: str | None, cache: dict[str, Any]) -> dict[str, Any] | None:
	return tmdb_get(f"/tv/{tv_id}", {}, api_key, cache)


def get_tv_season(tv_id: int, season_number: int, api_key: str | None, cache: dict[str, Any]) -> dict[str, Any] | None:
	data = tmdb_get(f"/tv/{tv_id}/season/{season_number}", {}, api_key, cache)
	if data:
		today = date.today().isoformat()
		has_upcoming = any(
			ep.get("air_date", "") > today
			for ep in data.get("episodes", [])
			if ep.get("air_date")
		)
		if has_upcoming:
			# Don't cache — fetch fresh every run so air date changes are always picked up
			cache.pop(_cache_key(f"/tv/{tv_id}/season/{season_number}", {}), None)
	return data


def has_home_release(movie_id: int, api_key: str | None, cache: dict[str, Any]) -> bool:
	"""Return True if the movie has any digital (4), physical (5), or TV (6) release in any country that is already past."""
	data = tmdb_get(f"/movie/{movie_id}/release_dates", {}, api_key, cache)
	if not data:
		return True  # fail open — assume available if we can't check
	today = date.today().isoformat()
	HOME_TYPES = {4, 5, 6}
	for country in data.get("results", []):
		for rd in country.get("release_dates", []):
			if rd.get("type") in HOME_TYPES:
				rd_date = (rd.get("release_date") or "")[:10]
				if rd_date and rd_date <= today:
					return True
	return False


def get_all_tv_episodes_flat(tv_id: int, total_seasons: int, api_key: str | None, cache: dict[str, Any]) -> dict[int, dict[str, str]]:
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
					"name": ep.get("name", ""),
				}
	return all_eps
