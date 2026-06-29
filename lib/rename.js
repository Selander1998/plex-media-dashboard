import { readFile, readdir, writeFile, rename as fsRename } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import { TMDB_API_KEY, MOVIES_ROOTS, SERIES_ROOTS, RENAME_PLAN_PATH, TMDB_CACHE_PATH } from "./config.js";
import { MEDIA_EXTS, SUBTITLE_EXTS, parseMovieInfo } from "./media.js";

export function sanitizeFilename(str) {
	return str.replace(/[/\\:*?"<>|]/g, "").replace(/\s{2,}/g, " ").trim();
}

const FEATURETTE_RE = /inside[.\s_-]the[.\s_-]episode|deleted[.\s_-]scene|behind[.\s_-]the[.\s_-]scenes?|making[.\s_-]of|featurette/i;

function pad2(n) { return String(n).padStart(2, "0"); }

export function parseEpisodeInfo(filename) {
	const m = filename.match(/[Ss](\d+)[Ee](\d+)(?:[Ee](\d+))?/);
	if (!m) return null;
	return {
		season: parseInt(m[1], 10),
		episode: parseInt(m[2], 10),
		episode2: m[3] != null ? parseInt(m[3], 10) : null,
	};
}

function normalizeSeasonFolderName(name) {
	const m = name.match(/^[Ss](?:eason\s*)?(\d+)$/i);
	return m ? `Season ${parseInt(m[1], 10)}` : null;
}

const _tmdbShowIdCache = new Map();
const _tmdbSeasonCache = new Map();

// Loaded once per buildRenamePlan call from the Python checker's TMDB cache.
// Maps lowercase show name → TMDB id, and season key → episode title map.
let _pythonCache = null;
let _pythonNameToId = null;

async function _loadPythonCache() {
	if (_pythonCache !== null) return;
	try {
		_pythonCache = JSON.parse(await readFile(TMDB_CACHE_PATH, "utf-8"));
	} catch {
		_pythonCache = {};
	}
	// Build name → id index from all cached TV search results
	_pythonNameToId = new Map();
	for (const [key, value] of Object.entries(_pythonCache)) {
		if (!key.startsWith("/search/tv")) continue;
		for (const r of value.results ?? []) {
			if (r.id && r.name) _pythonNameToId.set(r.name.toLowerCase(), r.id);
		}
	}
}

async function fetchTmdbShowId(showName) {
	if (!TMDB_API_KEY) return null;
	if (_tmdbShowIdCache.has(showName)) return _tmdbShowIdCache.get(showName);

	// Try Python checker cache first (no network needed)
	if (_pythonNameToId?.has(showName.toLowerCase())) {
		const id = _pythonNameToId.get(showName.toLowerCase());
		_tmdbShowIdCache.set(showName, id);
		return id;
	}

	try {
		const res = await fetch(
			`https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(showName)}&api_key=${TMDB_API_KEY}`,
			{ signal: AbortSignal.timeout(8_000) }
		);
		const data = await res.json();
		const results = data.results ?? [];
		const match = results.find((r) => r.name.toLowerCase() === showName.toLowerCase()) ?? results[0] ?? null;
		const id = match?.id ?? null;
		_tmdbShowIdCache.set(showName, id);
		return id;
	} catch {
		return null;
	}
}

async function _fetchTmdbSeason(showId, season) {
	const seasonKey = `${showId}:${season}`;
	if (_tmdbSeasonCache.has(seasonKey)) return;

	// Try Python checker cache first
	const pythonKey = `/tv/${showId}/season/${season}{}`;
	if (_pythonCache?.[pythonKey]) {
		const map = new Map();
		for (const ep of _pythonCache[pythonKey].episodes ?? []) map.set(ep.episode_number, ep.name);
		_tmdbSeasonCache.set(seasonKey, map);
		return;
	}

	try {
		const res = await fetch(
			`https://api.themoviedb.org/3/tv/${showId}/season/${season}?api_key=${TMDB_API_KEY}`,
			{ signal: AbortSignal.timeout(8_000) }
		);
		const map = new Map();
		if (res.ok) {
			const data = await res.json();
			for (const ep of data.episodes ?? []) map.set(ep.episode_number, ep.name);
		}
		_tmdbSeasonCache.set(seasonKey, map);
	} catch {
		_tmdbSeasonCache.set(seasonKey, new Map());
	}
}

export async function fetchTmdbEpisodeTitle(showName, season, episode) {
	if (!TMDB_API_KEY) return null;
	const showId = await fetchTmdbShowId(showName);
	if (!showId) return null;
	await _fetchTmdbSeason(showId, season);
	return _tmdbSeasonCache.get(`${showId}:${season}`)?.get(episode) ?? null;
}

export function buildEpisodeFilename(showName, season, episode, title, episode2 = null) {
	const epPart = episode2 != null ? `S${pad2(season)}E${pad2(episode)}E${pad2(episode2)}` : `S${pad2(season)}E${pad2(episode)}`;
	const base = `${showName} - ${epPart}`;
	return title ? `${base} - ${sanitizeFilename(title)}` : base;
}

export async function buildRenamePlan() {
	// Reset and reload the Python TMDB cache so each run gets fresh data
	_pythonCache = null;
	_pythonNameToId = null;
	await _loadPythonCache();

	const movies = [];
	const shows = [];
	const warnings = { unparseable: [], tmdbShowsNotFound: [], multipleVideos: [], featurettes: [] };

	// --- Movies ---
	for (const root of MOVIES_ROOTS) {
		let entries;
		try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const folderCurrent = join(root, entry.name);
			const info = parseMovieInfo(entry.name);
			const expectedFolder = info.year
				? `${sanitizeFilename(info.title)} (${info.year})`
				: sanitizeFilename(info.title);
			const folderDesired = join(root, expectedFolder);
			const folderChanged = entry.name !== expectedFolder;

			const files = [];
			let fileEntries;
			try { fileEntries = await readdir(folderCurrent, { withFileTypes: true }); } catch { fileEntries = []; }

			const videoEntries = fileEntries.filter((fe) => fe.isFile() && MEDIA_EXTS.has(extname(fe.name).toLowerCase()));
			if (videoEntries.length > 1) {
				warnings.multipleVideos.push({ folder: entry.name, files: videoEntries.map((fe) => ({ name: fe.name, fullPath: join(folderCurrent, fe.name) })) });
			} else {
				for (const fe of videoEntries) {
					const ext = extname(fe.name).toLowerCase();
					const nameDesired = `${expectedFolder}${ext}`;
					files.push({ nameCurrent: fe.name, nameDesired, fileChanged: fe.name !== nameDesired });
				}
			}

			if (folderChanged || files.some((f) => f.fileChanged)) {
				movies.push({ folderCurrent, folderDesired, folderChanged, displayCurrent: entry.name, displayDesired: expectedFolder, files });
			}
		}
	}

	// --- Series ---

	// Gather all show/season metadata from disk first, then pre-fetch TMDB in parallel.
	const showMeta = [];
	for (const root of SERIES_ROOTS) {
		let showEntries;
		try { showEntries = await readdir(root, { withFileTypes: true }); } catch { continue; }
		for (const showEntry of showEntries) {
			if (!showEntry.isDirectory()) continue;
			const showFolder = join(root, showEntry.name);
			const showNameClean = showEntry.name.replace(/[._]+/g, " ").replace(/\s*\(\d{4}\)\s*$/, "").trim();
			let seasonEntries;
			try { seasonEntries = await readdir(showFolder, { withFileTypes: true }); } catch { continue; }
			const seasonNums = seasonEntries
				.filter((e) => e.isDirectory())
				.map((e) => normalizeSeasonFolderName(e.name))
				.filter(Boolean)
				.map((n) => parseInt(n.replace("Season ", ""), 10));
			showMeta.push({ entry: showEntry, showFolder, showNameClean, seasonNums, seasonEntries });
		}
	}

	// Pre-fetch all show IDs in parallel (cache-hits return immediately, misses hit TMDB concurrently)
	await Promise.allSettled(showMeta.map((s) => fetchTmdbShowId(s.showNameClean)));

	// Pre-fetch all season title maps in parallel
	await Promise.allSettled(showMeta.flatMap((s) => {
		const showId = _tmdbShowIdCache.get(s.showNameClean);
		if (!showId) return [];
		return s.seasonNums.map((n) => _fetchTmdbSeason(showId, n));
	}));

	// Build the rename plan from the now-warm caches (no more awaiting on TMDB)
	for (const { entry: showEntry, showFolder, showNameClean, seasonEntries } of showMeta) {
		const showName = showEntry.name;
		const seasons = [];

		const tmdbId = _tmdbShowIdCache.get(showNameClean) ?? null;
		if (!tmdbId && !warnings.tmdbShowsNotFound.includes(showNameClean)) {
			warnings.tmdbShowsNotFound.push(showNameClean);
		}

		for (const seasonEntry of seasonEntries) {
			if (!seasonEntry.isDirectory()) continue;
			const seasonFolderCurrent = join(showFolder, seasonEntry.name);
			const normalized = normalizeSeasonFolderName(seasonEntry.name);
			if (!normalized) continue;
			const seasonFolderDesired = join(showFolder, normalized);
			const seasonFolderChanged = seasonEntry.name !== normalized;

			const episodes = [];
			let epEntries;
			try { epEntries = await readdir(seasonFolderCurrent, { withFileTypes: true }); } catch { continue; }
			for (const epEntry of epEntries) {
				if (!epEntry.isFile()) continue;
				let ext = extname(epEntry.name).toLowerCase();
				if (!MEDIA_EXTS.has(ext) && !SUBTITLE_EXTS.has(ext)) continue;
				if (SUBTITLE_EXTS.has(ext)) {
					const inner = extname(epEntry.name.slice(0, -ext.length)).toLowerCase();
					if (/^\.[a-z]{2,3}$/.test(inner)) ext = inner + ext;
				}
				if (FEATURETTE_RE.test(epEntry.name)) {
					warnings.featurettes.push({ show: showNameClean, season: seasonEntry.name, file: epEntry.name, fullPath: join(seasonFolderCurrent, epEntry.name) });
					continue;
				}
				const epInfo = parseEpisodeInfo(epEntry.name);
				if (!epInfo) {
					if (MEDIA_EXTS.has(extname(epEntry.name).toLowerCase())) {
						warnings.unparseable.push({ show: showNameClean, season: seasonEntry.name, file: epEntry.name, fullPath: join(seasonFolderCurrent, epEntry.name) });
					}
					continue;
				}
				const title = await fetchTmdbEpisodeTitle(showNameClean, epInfo.season, epInfo.episode);
				const nameDesired = buildEpisodeFilename(showNameClean, epInfo.season, epInfo.episode, title, epInfo.episode2) + ext;
				const epChanged = epEntry.name !== nameDesired;
				episodes.push({ nameCurrent: epEntry.name, nameDesired, episodeChanged: epChanged, epInfo, title: title ?? null });
			}

			if (seasonFolderChanged || episodes.some((e) => e.episodeChanged)) {
				seasons.push({
					seasonFolderCurrent, seasonFolderDesired, seasonFolderChanged,
					displayCurrent: seasonEntry.name, displayDesired: normalized,
					episodes,
				});
			}
		}

		if (seasons.length > 0) shows.push({ showName, showNameClean, showFolder, seasons });
	}

	const statsMovieFolders = movies.filter((m) => m.folderChanged).length;
	const statsMovieFiles = movies.reduce((a, m) => a + m.files.filter((f) => f.fileChanged).length, 0);
	const statsSeasonFolders = shows.reduce((a, s) => a + s.seasons.filter((se) => se.seasonFolderChanged).length, 0);
	const statsEpisodeFiles = shows.reduce((a, s) => a + s.seasons.reduce((b, se) => b + se.episodes.filter((e) => e.episodeChanged).length, 0), 0);
	const statsTmdbFailed = shows.reduce((a, s) => a + s.seasons.reduce((b, se) => b + se.episodes.filter((e) => !e.title).length, 0), 0);
	const movieTotal = statsMovieFolders + statsMovieFiles;
	const seriesTotal = statsSeasonFolders + statsEpisodeFiles;
	const total = movieTotal + seriesTotal;

	return { movies, shows, warnings, stats: { movieFolders: statsMovieFolders, movieFiles: statsMovieFiles, movieTotal, seasonFolders: statsSeasonFolders, episodeFiles: statsEpisodeFiles, seriesTotal, total, tmdbFailed: statsTmdbFailed } };
}

export async function applyRenamePlan(plan, scope = "all") {
	let ok = 0; let failed = 0; const errors = [];
	const attempt = async (from, to) => {
		try { await fsRename(from, to); ok++; }
		catch (err) { failed++; errors.push({ from: basename(from), error: err.message }); }
	};

	if (scope === "all" || scope === "movies") {
		for (const movie of plan.movies) {
			let folderBase = movie.folderCurrent;
			if (movie.folderChanged) {
				const prevFailed = failed;
				await attempt(movie.folderCurrent, movie.folderDesired);
				if (failed === prevFailed) folderBase = movie.folderDesired;
			}
			for (const file of movie.files) {
				if (!file.fileChanged) continue;
				await attempt(join(folderBase, file.nameCurrent), join(folderBase, file.nameDesired));
			}
		}
	}

	if (scope === "all" || scope === "series") {
		for (const show of plan.shows) {
			for (const season of show.seasons) {
				for (const ep of season.episodes) {
					if (!ep.episodeChanged) continue;
					await attempt(join(season.seasonFolderCurrent, ep.nameCurrent), join(season.seasonFolderCurrent, ep.nameDesired));
				}
				if (season.seasonFolderChanged) await attempt(season.seasonFolderCurrent, season.seasonFolderDesired);
			}
		}
	}

	return { ok, failed, errors };
}
