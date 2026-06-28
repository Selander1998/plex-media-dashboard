import { readdir, stat, copyFile, unlink, rename as fsRename } from "fs/promises";
import { join, extname, basename } from "path";
import { TORRENT_SAVE_PATHS, MOVIES_ROOTS, SERIES_ROOTS } from "./config.js";

export const MEDIA_EXTS = new Set([".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts"]);
export const SUBTITLE_EXTS = new Set([".srt", ".ass", ".sub", ".ssa", ".vtt"]);
export const SEEDING_STATES = new Set(["uploading", "stalledUP", "queuedUP"]);
export const DONE_STATES = new Set(["pausedUP", "stoppedUP", "uploading", "stalledUP"]);

const QUALITY_RE = /[\s._-]+[\[(\s]*((?:1080|720|2160|480)[pi]|4k|uhd|hdr|blu-?ray|bdrip|webrip|web-?dl|dvdrip|hdtv|x264|x265|h264|h265|hevc|aac|ac3|dts|atmos|proper|repack|extended|remastered|unrated|limited|dubbed|multi).+$/i;
const QUALITY_TAGS_RE = /\b(2160p|1080p|720p|480p|4[Kk]|UHD|BluRay|Blu-Ray|BDRip|BRRip|WEB[-.]?DL|WEBRip|HDTV|DVDRip|REMUX|HDR|DV|x264|x265|HEVC|H\.?26[45]|AVC|AAC|DTS|AC3|Atmos|TrueHD|FLAC|MULTI|DUAL|REPACK|PROPER|EXTENDED|THEATRICAL|DIRECTORS\.?CUT)\b.*/i;

function cleanTitle(raw) {
	return raw
		.replace(/[._-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseTorrentName(dn) {
	const name = dn.replace(/\+/g, " ").trim();

	const episodeMatch = name.match(/^(.+?)[.\s_-]+S(\d{1,2})E(\d{1,2})/i);
	if (episodeMatch) {
		const title = cleanTitle(episodeMatch[1]);
		const s = episodeMatch[2].padStart(2, "0");
		const e = episodeMatch[3].padStart(2, "0");
		return `${title} S${s}E${e}`;
	}

	const seasonMatch = name.match(/^(.+?)[.\s_-]+(?:Season[\s._-]+(\d{1,2})|S(\d{2})(?![eE\d]))/i);
	if (seasonMatch) {
		const title = cleanTitle(seasonMatch[1]);
		const season = (seasonMatch[2] || seasonMatch[3]).padStart(2, "0");
		return `${title} S${season}`;
	}

	const movieMatch = name.match(/^(.+?)[.\s_-]+\(?((?:19|20)\d{2})\)?(?:[-.\s_\]]|$)/);
	if (movieMatch) return `${cleanTitle(movieMatch[1])} (${movieMatch[2]})`;

	return cleanTitle(name.replace(QUALITY_RE, ""));
}

export function extractMagnetHash(url) {
	const m = url.match(/xt=urn:btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
	return m ? m[1].toLowerCase() : null;
}

export function extractMagnetName(url) {
	const m = url.match(/[?&]dn=([^&]+)/);
	return m ? decodeURIComponent(m[1]) : null;
}

export function detectMediaType(name) {
	if (/\bS\d{2}/i.test(name)) return "series";
	if (/\b(?:E|EP|Episode)[._\s]?\d{2,4}\b/i.test(name)) return "series";
	return "movies";
}

function cleanShowName(raw) {
	return raw
		.replace(/[._]+/g, " ")
		.replace(/\s+(?:Season|Series|S)\s*\d+\s*$/i, "")
		.trim();
}

export function parseSeriesInfo(name) {
	const m = name.match(/^(.+?)[._\s]+[Ss](\d+)/);
	if (m) return { showName: cleanShowName(m[1]), season: `Season ${parseInt(m[2], 10)}` };
	const anime = name.match(/^(.+?)[._\s]+(?:[Ee][Pp]?(?:isode)?[._\s]?)(\d{2,4})\b/i);
	if (anime) return { showName: cleanShowName(anime[1]), season: "Season 1" };
	return null;
}

export function parseSeasonFromFilename(fileName) {
	const m = fileName.match(/[Ss](\d+)[Ee]\d+/);
	return m ? parseInt(m[1], 10) : null;
}

export function parseMovieInfo(name) {
	const base = name.replace(/\.(mkv|mp4|avi|mov|wmv|m4v|ts|m2ts)$/i, "");
	const yearRe = /\b((?:19|20)\d{2})\b/g;
	let match;
	while ((match = yearRe.exec(base)) !== null) {
		const rawTitle = base.slice(0, match.index);
		const hasSeparatorDots = !rawTitle.includes(" ");
		let title = hasSeparatorDots
			? rawTitle.replace(/[._]+/g, " ").trim()
			: rawTitle.replace(/\s*\($/, "").trim();
		title = title.replace(/(\d)\s*-\s*/g, "$1 - ").replace(/\s{2,}/g, " ").trim();
		if (title.length > 0) return { title, year: match[1] };
	}
	const stripped = base.replace(QUALITY_TAGS_RE, "").replace(/[._]+/g, " ").trim();
	return { title: stripped || base.replace(/[._]+/g, " ").trim(), year: null };
}

export function normalizeMovieTitle(name) {
	return name
		.replace(/\s*\(\d{4}\)\s*$/, "")
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/[^a-z0-9\s]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function findDestRoot(savePath, roots) {
	const base = TORRENT_SAVE_PATHS.find((p) => savePath.startsWith(p));
	if (!base) return null;
	const mountParts = base.split("/").filter(Boolean).slice(0, 2);
	return roots.find((r) => {
		const rp = r.split("/").filter(Boolean);
		return mountParts.every((p, i) => rp[i] === p);
	}) ?? null;
}

export async function findExistingMovieFolder(cleanName) {
	const year = (cleanName.match(/\((\d{4})\)\s*$/) || [])[1] ?? null;
	const needle = normalizeMovieTitle(cleanName);
	for (const root of MOVIES_ROOTS) {
		let entries;
		try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const entryYear = (entry.name.match(/\((\d{4})\)/) || [])[1] ?? null;
			if (year && entryYear && entryYear !== year) continue;
			if (normalizeMovieTitle(entry.name) === needle) return { root, folderName: entry.name };
		}
	}
	return null;
}

export async function findExistingShowRoot(showName) {
	const needle = showName.toLowerCase();
	for (const root of SERIES_ROOTS) {
		let entries;
		try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const folderClean = entry.name.replace(/\s*\(\d{4}\)\s*$/, "").toLowerCase().trim();
			if (folderClean === needle) return { root, folderName: entry.name };
		}
	}
	return null;
}

export async function walkFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...await walkFiles(full));
		else files.push(full);
	}
	return files;
}

export async function moveFile(src, dest) {
	try {
		await fsRename(src, dest);
	} catch (err) {
		if (err.code !== "EXDEV") throw err;
		console.log(`[process] Cross-device copy (slow): ${basename(src)}`);
		await copyFile(src, dest);
		await unlink(src);
	}
}

export function shortPath(fullPath) {
	for (const root of [...MOVIES_ROOTS, ...SERIES_ROOTS]) {
		if (fullPath.startsWith(root)) {
			const disk = root.split("/").filter(Boolean)[1];
			const rel = fullPath.slice(root.length).replace(/^\//, "");
			return rel ? `${disk}/${rel}` : disk;
		}
	}
	return fullPath;
}
