import { readFile, writeFile, stat, mkdir, unlink, readdir, rename as fsRename } from "fs/promises";
import { join, extname, basename, resolve } from "path";
import {
	MOVIES_ROOTS, SERIES_ROOTS, QUALITY_SETTINGS_PATH, QUALITY_REPORT_PATH,
	REPORT_PATH, SERVER_SETTINGS_PATH, TORRENT_SAVE_PATHS, QUALITY_BLOCKS_PATH,
} from "./config.js";
import { qbitFetch } from "./qbit.js";
import { sendNtfy } from "./ntfy.js";
import { refreshPlexLibraries } from "./plex.js";
import { checkVideoQuality } from "./quality.js";
import { fetchTmdbEpisodeTitle, buildEpisodeFilename, parseEpisodeInfo, FEATURETTE_RE } from "./rename.js";
import {
	MEDIA_EXTS, SUBTITLE_EXTS, SEEDING_STATES, DONE_STATES,
	detectMediaType, parseSeriesInfo, parseSeasonFromFilename,
	parseMovieInfo, findDestRoot, findExistingMovieFolder, findExistingShowRoot,
	walkFiles, moveFile, shortPath,
} from "./media.js";

export const processingTorrents = new Set();
export let autoPauseSeeding = true;
export let autoMove = true;

export function setAutoPause(val) { autoPauseSeeding = val; }
export function setAutoMove(val) { autoMove = val; }

// Load persisted settings
readFile(SERVER_SETTINGS_PATH, "utf-8").then((d) => {
	const s = JSON.parse(d);
	if (typeof s.autoPauseSeeding === "boolean") autoPauseSeeding = s.autoPauseSeeding;
	if (typeof s.autoMove === "boolean") autoMove = s.autoMove;
}).catch(() => {});

const prevTorrentStates = new Map();
let firstPoll = true;
const SERVER_START_EPOCH = Math.floor(Date.now() / 1000);

async function _readBlocks() {
	try { return JSON.parse(await readFile(QUALITY_BLOCKS_PATH, "utf-8")); } catch { return []; }
}
async function _writeBlocks(blocks) {
	await writeFile(QUALITY_BLOCKS_PATH, JSON.stringify(blocks)).catch(() => {});
}
export async function addQualityBlock(hash, name, issues) {
	const blocks = (await _readBlocks()).filter((b) => b.hash !== hash);
	blocks.push({ hash, name, issues, blockedAt: Date.now() });
	await _writeBlocks(blocks);
}
export async function removeQualityBlock(hash) {
	await _writeBlocks((await _readBlocks()).filter((b) => b.hash !== hash));
}

export async function processTorrent(torrent, { force = false } = {}) {
	const { hash, name, content_path, save_path } = torrent;
	const type = detectMediaType(name);
	const roots = type === "series" ? SERIES_ROOTS : MOVIES_ROOTS;
	const destRoot = findDestRoot(save_path, roots);

	if (!destRoot) {
		const msg = `No ${type} destination configured for ${save_path}`;
		console.error(`[process] ${msg}`);
		sendNtfy({ title: "Processing failed", body: `${name}\n${msg}`, tags: "warning", priority: "high" });
		return;
	}

	const contentStat = await stat(content_path).catch(() => null);
	if (!contentStat) {
		const msg = `Content path not found: ${content_path}`;
		console.error(`[process] ${msg}`);
		sendNtfy({ title: "Processing failed", body: `${name}\n${msg}`, tags: "warning", priority: "high" });
		return;
	}

	const allFiles = contentStat.isDirectory() ? await walkFiles(content_path) : [content_path];
	const isSample = (f) => /\bsample\b/i.test(basename(f));
	const allVideoFiles = allFiles.filter((f) => MEDIA_EXTS.has(extname(f).toLowerCase()) && !isSample(f));
	const subtitleFiles = allFiles.filter((f) => SUBTITLE_EXTS.has(extname(f).toLowerCase()) && !isSample(f));

	// For series: narrow to files that will actually be processed (root level or Season ## subfolders only).
	// This ensures the quality gate and "no video files" check only consider real episode files.
	const isProcessableSeriesFile = (f) => {
		if (!contentStat.isDirectory()) return true;
		const rel = f.slice(content_path.length + 1);
		const slashIdx = rel.indexOf("/");
		if (slashIdx !== -1) {
			const subdir = rel.slice(0, slashIdx);
			if (!/^season\s*\d+$/i.test(subdir) && !/^s\d+$/i.test(subdir)) return false;
		}
		const fname = basename(f);
		return parseEpisodeInfo(fname) != null && !FEATURETTE_RE.test(fname);
	};
	const videoFiles = type === "series" ? allVideoFiles.filter(isProcessableSeriesFile) : allVideoFiles;
	const filteredSubtitleFiles = type === "series" ? subtitleFiles.filter(isProcessableSeriesFile) : subtitleFiles;

	if (videoFiles.length === 0) {
		const msg = "No video files found in downloaded content";
		console.error(`[process] ${msg}: ${content_path}`);
		sendNtfy({ title: "Processing failed", body: `${name}\n${msg}`, tags: "warning", priority: "high" });
		return;
	}

	// --- Quality gate: check every video file before touching the library ---
	if (!force) {
		let qSettings = {};
		try { qSettings = JSON.parse(await readFile(QUALITY_SETTINGS_PATH, "utf-8")); } catch { /* use defaults */ }

		const badFiles = [];
		for (const f of videoFiles) {
			const fileSize = await stat(f).then((s) => s.size).catch(() => 0);
			if (fileSize < 50 * 1024 * 1024) {
				console.log(`[process] Skipping quality check for small file (${Math.round(fileSize/1024/1024)}MB): ${basename(f)}`);
				continue;
			}
			console.log(`[process] Quality checking: ${basename(f)}`);
			const issues = await checkVideoQuality(f, qSettings);
			if (issues.length > 0) badFiles.push({ file: basename(f), issues });
		}

		if (badFiles.length > 0) {
			const allIssues = badFiles.flatMap(({ issues }) => issues);
			const lines = badFiles.map(({ file, issues }) => `• ${file}: ${issues.join(", ")}`).join("\n");
			console.log(`[process] Quality gate blocked "${name}":\n${lines}`);
			await addQualityBlock(hash, name, allIssues);
			sendNtfy({
				title: "Quality check failed — not added",
				body: `${name}\n${lines}\nTorrent kept in queue for review`,
				tags: "warning",
				priority: "high",
			});
			return;
		}
	}
	await removeQualityBlock(hash);

	const movieInfo = type === "movies" ? parseMovieInfo(name) : null;
	const cleanMovieName = movieInfo
		? (movieInfo.year ? `${movieInfo.title} (${movieInfo.year})` : movieInfo.title)
		: null;

	const seriesInfo = type === "series" ? parseSeriesInfo(name) : null;
	if (type === "series" && !seriesInfo) {
		const msg = "Could not parse show name from torrent name";
		console.error(`[process] ${msg}: "${name}"`);
		sendNtfy({ title: "Processing failed", body: `${name}\n${msg}`, tags: "warning", priority: "high" });
		return;
	}

	let crossDiskNote = "";
	let seriesShowRoot = null;
	if (type === "series") {
		const existing = await findExistingShowRoot(seriesInfo.showName);
		if (existing && existing.root !== destRoot) {
			const fromDisk = destRoot.split("/").filter(Boolean)[1];
			const toDisk = existing.root.split("/").filter(Boolean)[1];
			crossDiskNote = `Followed show from ${fromDisk} → ${toDisk}`;
			console.log(`[process] ${crossDiskNote} for "${existing.folderName}"`);
		}
		seriesShowRoot = existing
			? join(existing.root, existing.folderName)
			: join(destRoot, seriesInfo.showName);
	}

	let movieDestFolder = null;
	let oldFilesToDelete = [];
	let oldFileIssues = [];
	if (type === "movies") {
		const existingMovie = await findExistingMovieFolder(cleanMovieName ?? name);
		if (existingMovie && existingMovie.root !== destRoot) {
			const fromDisk = destRoot.split("/").filter(Boolean)[1];
			const toDisk = existingMovie.root.split("/").filter(Boolean)[1];
			console.log(`[process] Movie already on ${toDisk}, redirecting from ${fromDisk}: "${existingMovie.folderName}"`);
		}
		movieDestFolder = existingMovie
			? join(existingMovie.root, existingMovie.folderName)
			: join(destRoot, cleanMovieName ?? name);
		const folderExists = await stat(movieDestFolder).then((s) => s.isDirectory()).catch(() => false);
		if (folderExists) {
			const oldVideos = (await walkFiles(movieDestFolder))
				.filter((f) => MEDIA_EXTS.has(extname(f).toLowerCase()));
			if (oldVideos.length > 0) {
				let qualityFlagged = false;
				try {
					const qReport = JSON.parse(await readFile(QUALITY_REPORT_PATH, "utf-8"));
					const flaggedPaths = new Set((qReport.movies ?? []).map((m) => resolve(m.full_path)));
					qualityFlagged = oldVideos.some((f) => flaggedPaths.has(resolve(f)));
					if (qualityFlagged) {
						for (const oldFile of oldVideos) {
							const entry = (qReport.movies ?? []).find((m) => resolve(m.full_path) === resolve(oldFile));
							if (entry) oldFileIssues.push(...entry.issues);
						}
					}
				} catch { /* report missing — treat as clean */ }

				if (!qualityFlagged) {
					const label = cleanMovieName ?? name;
					const msg = "Already in library with no quality issues — not replaced";
					console.log(`[process] Skipping replacement for "${label}": existing file is clean`);
					sendNtfy({
						title: "Duplicate not replaced",
						body: `${label}\n${msg}\nNew file: ${shortPath(content_path)}`,
						tags: "warning",
						priority: "high",
					});
					return;
				}
				oldFilesToDelete = oldVideos;
			}
		}
	}

	console.log(`[process] "${name}" → ${type === "series" ? seriesShowRoot : movieDestFolder} (${videoFiles.length} video, ${subtitleFiles.length} sub)`);

	let addedVideoCount = 0;
	let skippedVideoCount = 0;
	let addedEpisodeTags = [];
	try {
		if (type === "series") {
			for (const f of [...videoFiles, ...filteredSubtitleFiles]) {
				const fname = basename(f);
				const epInfo = parseEpisodeInfo(fname);

				const seasonNum = parseSeasonFromFilename(fname);
				const seasonLabel = seasonNum != null ? `Season ${seasonNum}` : seriesInfo.season;
				const targetDir = basename(seriesShowRoot) === seasonLabel
					? seriesShowRoot
					: join(seriesShowRoot, seasonLabel);

				if (epInfo) {
					const ep1Tag = `s${String(epInfo.season).padStart(2, "0")}e${String(epInfo.episode).padStart(2, "0")}`;
					const ep2Tag = epInfo.episode2 != null
						? `s${String(epInfo.season).padStart(2, "0")}e${String(epInfo.episode2).padStart(2, "0")}`
						: null;
					let dirEntries = [];
					try { dirEntries = await readdir(targetDir); } catch { /* dir doesn't exist yet */ }
					const ep1Exists = dirEntries.some((n) => n.toLowerCase().includes(ep1Tag));
					const ep2Exists = ep2Tag == null || dirEntries.some((n) => n.toLowerCase().includes(ep2Tag));
					if (ep1Exists && ep2Exists) {
						const label = ep2Tag
							? `S${String(epInfo.season).padStart(2,"0")}E${String(epInfo.episode).padStart(2,"0")}E${String(epInfo.episode2).padStart(2,"0")}`
							: `S${String(epInfo.season).padStart(2,"0")}E${String(epInfo.episode).padStart(2,"0")}`;
						console.log(`[process] skip existing ${label}: ${basename(f)}`);
						if (MEDIA_EXTS.has(extname(f).toLowerCase())) skippedVideoCount++;
						continue;
					}
				}

				await mkdir(targetDir, { recursive: true });
				const movedPath = join(targetDir, basename(f));
				await moveFile(f, movedPath);
				if (MEDIA_EXTS.has(extname(f).toLowerCase())) {
					addedVideoCount++;
					if (epInfo) {
						const epTag = epInfo.episode2 != null
							? `S${String(epInfo.season).padStart(2,"0")}E${String(epInfo.episode).padStart(2,"0")}E${String(epInfo.episode2).padStart(2,"0")}`
							: `S${String(epInfo.season).padStart(2,"0")}E${String(epInfo.episode).padStart(2,"0")}`;
						addedEpisodeTags.push(epTag);
					}
				}

				const ext = extname(basename(f)).toLowerCase();
				if (epInfo && (MEDIA_EXTS.has(ext) || SUBTITLE_EXTS.has(ext))) {
					const epTitle = await fetchTmdbEpisodeTitle(seriesInfo.showName, epInfo.season, epInfo.episode);
					const newFilename = buildEpisodeFilename(seriesInfo.showName, epInfo.season, epInfo.episode, epTitle, epInfo.episode2) + ext;
					await fsRename(movedPath, join(targetDir, newFilename)).catch((err) =>
						console.warn(`[process] episode rename failed: ${err.message}`)
					);
				}
			}
		} else {
			await mkdir(movieDestFolder, { recursive: true });
			for (const f of [...videoFiles, ...subtitleFiles]) {
				let destName = basename(f);
				if (cleanMovieName && videoFiles.length === 1 && MEDIA_EXTS.has(extname(f).toLowerCase())) {
					destName = cleanMovieName + extname(f).toLowerCase();
				}
				await moveFile(f, join(movieDestFolder, destName));
			}
		}
	} catch (err) {
		const msg = `Failed to move files: ${err.message}`;
		console.error(`[process] ${msg}`);
		sendNtfy({ title: "Processing failed", body: `${name}\n${msg}`, tags: "warning", priority: "high" });
		return;
	}

	for (const f of oldFilesToDelete) await unlink(f).catch(() => {});
	if (oldFilesToDelete.length) {
		console.log(`[process] Deleted ${oldFilesToDelete.length} replaced file(s)`);
		try {
			const qReport = JSON.parse(await readFile(QUALITY_REPORT_PATH, "utf-8"));
			const deletedAbs = new Set(oldFilesToDelete.map((f) => resolve(f)));
			qReport.movies = (qReport.movies ?? []).filter((m) => !deletedAbs.has(resolve(m.full_path)));
			qReport.series = (qReport.series ?? []).filter((m) => !deletedAbs.has(resolve(m.full_path)));
			await writeFile(QUALITY_REPORT_PATH, JSON.stringify(qReport));
		} catch { /* quality report missing or malformed */ }
	}

	try {
		const report = JSON.parse(await readFile(REPORT_PATH, "utf-8"));
		let dirty = false;
		if (type === "movies" && movieInfo && report.movies?.missing) {
			const norm = (s) => s.toLowerCase().trim();
			const before = report.movies.missing.length;
			report.movies.missing = report.movies.missing.filter(
				(m) => !(norm(m.title) === norm(movieInfo.title) && String(m.year) === String(movieInfo.year))
			);
			if (report.movies.missing.length !== before) dirty = true;
		}
		if (type === "series" && seriesInfo && addedEpisodeTags.length > 0 && report.series?.missing) {
			const addedEps = new Set();
			for (const tag of addedEpisodeTags) {
				const m = tag.match(/S(\d+)E(\d+)(?:E(\d+))?/i);
				if (!m) continue;
				const sn = parseInt(m[1], 10);
				addedEps.add(`${sn}:${parseInt(m[2], 10)}`);
				if (m[3]) addedEps.add(`${sn}:${parseInt(m[3], 10)}`);
			}
			const showNorm = seriesInfo.showName.toLowerCase();
			const before = report.series.missing.length;
			report.series.missing = report.series.missing.filter((m) => {
				if (m.type !== "episode") return true;
				if (m.show.toLowerCase() !== showNorm) return true;
				return !addedEps.has(`${m.season}:${m.episode}`);
			});
			if (report.series.missing.length !== before) dirty = true;
		}
		if (dirty) await writeFile(REPORT_PATH, JSON.stringify(report));
	} catch { /* report missing or malformed */ }

	if (type !== "series" || addedVideoCount > 0) {
		await qbitFetch("/api/v2/torrents/delete", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ hashes: hash, deleteFiles: "true" }),
		}).catch((err) => console.error(`[process] torrent delete failed: ${err.message}`));
	} else {
		console.log(`[process] all episodes already in library — leaving torrent "${name}"`);
	}

	await refreshPlexLibraries().catch(() => {});
	console.log(`[process] done: "${name}"`);

	const subLine = subtitleFiles.length > 0 ? ` · ${subtitleFiles.length} subtitle${subtitleFiles.length > 1 ? "s" : ""}` : "";
	let ntfyTitle, ntfyBody;
	if (type === "series") {
		const seriesLabel = `${seriesInfo.showName} · ${seriesInfo.season}`;
		if (addedVideoCount === 0) {
			ntfyTitle = "No new episodes — already in library";
			ntfyBody = [seriesLabel, `${skippedVideoCount} episode${skippedVideoCount !== 1 ? "s" : ""} already present`, crossDiskNote].filter(Boolean).join("\n");
		} else {
			ntfyTitle = addedVideoCount > 1 ? "Episodes added to library" : "Episode added to library";
			const epListLine = addedEpisodeTags.length > 0 && addedEpisodeTags.length <= 6
				? addedEpisodeTags.join(", ")
				: `${addedVideoCount} episode${addedVideoCount !== 1 ? "s" : ""}${subLine}`;
			const skipNote = skippedVideoCount > 0 ? `${skippedVideoCount} already present — skipped` : null;
			ntfyBody = [seriesLabel, epListLine, skipNote, crossDiskNote, `→ ${shortPath(seriesShowRoot)}/`].filter(Boolean).join("\n");
		}
	} else {
		ntfyTitle = oldFilesToDelete.length > 0 ? "Movie replaced (quality upgrade)" : "Movie added to library";
		const oldIssuesLine = oldFileIssues.length > 0 ? `Fixed: ${oldFileIssues.join(", ")}` : null;
		ntfyBody = [
			cleanMovieName ?? name,
			oldIssuesLine,
			`1 video file${subLine}`,
			`→ ${shortPath(movieDestFolder)}/`,
		].filter(Boolean).join("\n");
	}

	sendNtfy({ title: ntfyTitle, body: ntfyBody, tags: "white_check_mark" });
}

export async function pollTorrents() {
	try {
		const qres = await qbitFetch("/api/v2/torrents/info");
		const torrents = await qres.json();

		for (const t of torrents) {
			const prev = prevTorrentStates.get(t.hash);
			const newlyDone = prev && !DONE_STATES.has(prev) && DONE_STATES.has(t.state);
			const recentlyCompleted = t.completion_on > 0 && t.completion_on > SERVER_START_EPOCH - 86400;
			const missedWhileDown = firstPoll && !prev && DONE_STATES.has(t.state)
				&& recentlyCompleted
				&& await stat(t.content_path).then(() => true).catch(() => false);

			if ((newlyDone || missedWhileDown) && (MOVIES_ROOTS.length || SERIES_ROOTS.length) && !processingTorrents.has(t.hash)) {
				if (autoMove) {
					processingTorrents.add(t.hash);
					processTorrent(t)
						.catch((e) => console.error(`[process] error for "${t.name}": ${e.message}`))
						.finally(() => processingTorrents.delete(t.hash));
				} else {
					console.log(`[auto-move] skipped processing "${t.name}" — auto-move is disabled`);
				}
			}

			if (autoPauseSeeding && SEEDING_STATES.has(t.state) && !processingTorrents.has(t.hash)) {
				await qbitFetch("/api/v2/torrents/pause", {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({ hashes: t.hash }),
				});
				console.log(`[auto-pause] paused ${t.name}`);
			}
		}

		for (const t of torrents) prevTorrentStates.set(t.hash, t.state);
		firstPoll = false;
	} catch (e) {
		console.error("[auto-pause] error:", e.message);
	}
}
