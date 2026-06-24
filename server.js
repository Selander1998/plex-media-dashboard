import express from "express";
import { readFile, writeFile, statfs, stat, unlink, copyFile, mkdir, readdir, rename as fsRename } from "fs/promises";
import { fileURLToPath } from "url";
import { join, dirname, resolve, basename, extname } from "path";
import { spawn, execSync } from "child_process";

const app = express();
app.use(express.json());

const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || "";

if (DASHBOARD_TOKEN) {
	app.use((req, res, next) => {
		const auth = req.headers.authorization;
		if (auth && auth.startsWith("Basic ")) {
			const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
			const password = decoded.slice(decoded.indexOf(":") + 1);
			if (password === DASHBOARD_TOKEN) return next();
		}
		res.set("WWW-Authenticate", 'Basic realm="Media Dashboard"');
		res.status(401).send("Unauthorized");
	});
}
const __dirname = dirname(fileURLToPath(import.meta.url));

const QBIT_URL = process.env.QBIT_URL || "http://localhost:8080";
const QBIT_USERNAME = process.env.QBIT_USERNAME || "admin";
const QBIT_PASSWORD = process.env.QBIT_PASSWORD || "adminadmin";
const REPORT_PATH = process.env.REPORT_PATH || join(__dirname, "scripts", "report.json");
const WATCHLIST_PATH = process.env.WATCHLIST_PATH || join(__dirname, "scripts", "watchlist.json");
const QUALITY_REPORT_PATH = join(dirname(REPORT_PATH), "quality_report.json");
const QUALITY_CACHE_PATH = join(dirname(REPORT_PATH), "quality_cache.json");
const QUALITY_SETTINGS_PATH = join(dirname(REPORT_PATH), "quality_settings.json");
const SERVER_SETTINGS_PATH = join(dirname(REPORT_PATH), "server_settings.json");
const RENAME_PLAN_PATH = join(dirname(REPORT_PATH), "rename_plan.json");
const PLEX_BLACKLIST_PATH = join(dirname(REPORT_PATH), "plex_blacklist.json");
const TMDB_CACHE_PATH = join(dirname(REPORT_PATH), "plex_checker_cache.json");
const PORT = process.env.PORT || 3000;
const TORRENT_SAVE_PATHS = (process.env.TORRENT_SAVE_PATHS || "")
	.split(",").map((p) => p.trim()).filter(Boolean);
const TORRENT_TEMP_SUBDIR = process.env.TORRENT_TEMP_SUBDIR || "";
const PLEX_URL = process.env.PLEX_URL || "";
const PLEX_TOKEN = process.env.PLEX_TOKEN || "";
const NTFY_URL = process.env.NTFY_URL || "";
const NTFY_USER = process.env.NTFY_USER || "";
const NTFY_PASS = process.env.NTFY_PASS || "";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";

const GIT_HASH = (() => {
	try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); }
	catch { return "unknown"; }
})();

async function refreshPlexLibraries() {
	if (!PLEX_URL || !PLEX_TOKEN) return;
	try {
		const signal = AbortSignal.timeout(10_000);
		const sectionsRes = await fetch(`${PLEX_URL}/library/sections?X-Plex-Token=${PLEX_TOKEN}`, {
			headers: { Accept: "application/json" },
			signal,
		});
		const data = await sectionsRes.json();
		const sections = data?.MediaContainer?.Directory ?? [];
		await Promise.all(
			sections.map((s) =>
				fetch(`${PLEX_URL}/library/sections/${s.key}/refresh?X-Plex-Token=${PLEX_TOKEN}`, { method: "GET", signal })
			)
		);
		console.log(`[plex] refreshed ${sections.length} librar${sections.length === 1 ? "y" : "ies"}`);
	} catch (err) {
		console.error("[plex] refresh failed:", err.message);
	}
}

let qbitCookie = null;
let loginBackoffUntil = 0;
const LOGIN_COOLDOWN_MS = 30_000;

function cleanTitle(raw) {
	return raw
		.replace(/[._-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

const QUALITY_RE = /[\s._-]+[\[(\s]*((?:1080|720|2160|480)[pi]|4k|uhd|hdr|blu-?ray|bdrip|webrip|web-?dl|dvdrip|hdtv|x264|x265|h264|h265|hevc|aac|ac3|dts|atmos|proper|repack|extended|remastered|unrated|limited|dubbed|multi).+$/i;

function parseTorrentName(dn) {
	const name = dn.replace(/\+/g, " ").trim();

	// Single episode: S##E##
	const episodeMatch = name.match(/^(.+?)[.\s_-]+S(\d{1,2})E(\d{1,2})/i);
	if (episodeMatch) {
		const title = cleanTitle(episodeMatch[1]);
		const s = episodeMatch[2].padStart(2, "0");
		const e = episodeMatch[3].padStart(2, "0");
		return `${title} S${s}E${e}`;
	}

	// Season pack: "Season N" or "S##" not followed by E/digit
	const seasonMatch = name.match(/^(.+?)[.\s_-]+(?:Season[\s._-]+(\d{1,2})|S(\d{2})(?![eE\d]))/i);
	if (seasonMatch) {
		const title = cleanTitle(seasonMatch[1]);
		const season = (seasonMatch[2] || seasonMatch[3]).padStart(2, "0");
		return `${title} S${season}`;
	}

	// Movie: year (handles "Title (2023)", "Title.2023.", "Title 2023 ")
	const movieMatch = name.match(/^(.+?)[.\s_-]+\(?((?:19|20)\d{2})\)?(?:[-.\s_\]]|$)/);
	if (movieMatch) {
		return `${cleanTitle(movieMatch[1])} (${movieMatch[2]})`;
	}

	return cleanTitle(name.replace(QUALITY_RE, ""));
}

function extractMagnetHash(url) {
	const m = url.match(/xt=urn:btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
	return m ? m[1].toLowerCase() : null;
}

function extractMagnetName(url) {
	const m = url.match(/[?&]dn=([^&]+)/);
	return m ? decodeURIComponent(m[1]) : null;
}

async function qbitLogin() {
	const now = Date.now();
	if (now < loginBackoffUntil) {
		const wait = Math.ceil((loginBackoffUntil - now) / 1000);
		throw new Error(`qBittorrent login on cooldown — retry in ${wait}s`);
	}

	const res = await fetch(`${QBIT_URL}/api/v2/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			username: QBIT_USERNAME,
			password: QBIT_PASSWORD,
		}),
	});
	const body = await res.text();
	console.log(`[qbit] login response: ${res.status} "${body.trim()}"`);
	if (body.trim() !== "Ok.") {
		qbitCookie = null;
		loginBackoffUntil = Date.now() + LOGIN_COOLDOWN_MS;
		return false;
	}
	const setCookie = res.headers.get("set-cookie");
	if (setCookie) {
		qbitCookie = setCookie.split(";")[0];
	}
	return !!qbitCookie;
}

async function qbitFetch(path, options = {}) {
	if (!qbitCookie) {
		const ok = await qbitLogin();
		if (!ok) throw new Error("qBittorrent login failed — check credentials");
	}

	const buildOpts = () => ({
		...options,
		headers: { Cookie: qbitCookie, Referer: QBIT_URL, ...options.headers },
	});

	let res = await fetch(`${QBIT_URL}${path}`, buildOpts());

	if (res.status === 403) {
		const ok = await qbitLogin();
		if (!ok) throw new Error("qBittorrent login failed — check credentials");
		res = await fetch(`${QBIT_URL}${path}`, buildOpts());
	}

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`qBittorrent returned ${res.status}: ${text}`);
	}

	return res;
}

app.get("/api/qbit/save-paths", (req, res) => {
	res.json(TORRENT_SAVE_PATHS);
});

app.get("/api/qbit/temp-paths", (req, res) => {
	if (!TORRENT_TEMP_SUBDIR) return res.json([]);
	res.json(TORRENT_SAVE_PATHS.map(p => `${p.replace(/\/$/, "")}/${TORRENT_TEMP_SUBDIR}`));
});

app.post("/api/qbit/temp-path", async (req, res) => {
	const { path } = req.body;
	try {
		const prefs = path
			? { temp_path_enabled: true, temp_path: path }
			: { temp_path_enabled: false };
		await qbitFetch("/api/v2/app/setPreferences", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ json: JSON.stringify(prefs) }),
		});
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to set temp path", detail: err.message });
	}
});

app.get("/api/disk-space", async (req, res) => {
	const { path } = req.query;
	if (!path || typeof path !== "string" || !path.startsWith("/")) {
		return res.status(400).json({ error: "Invalid path" });
	}
	if (
		TORRENT_SAVE_PATHS.length > 0 &&
		!TORRENT_SAVE_PATHS.some((p) => path === p || path.startsWith(p + "/"))
	) {
		return res.status(403).json({ error: "Path not allowed" });
	}
	try {
		const [s, st] = await Promise.all([statfs(path), stat(path)]);
		const available = s.bavail * s.bsize;
		const total = s.blocks * s.bsize;
		res.json({ available, total, dev: st.dev });
	} catch (err) {
		res.status(500).json({ error: "Failed to stat path", detail: err.message });
	}
});

app.get("/api/report", async (req, res) => {
	try {
		const data = await readFile(REPORT_PATH, "utf-8");
		res.json(JSON.parse(data));
	} catch (err) {
		res.status(500).json({ error: "Failed to read report", detail: err.message });
	}
});

app.get("/api/quality", async (req, res) => {
	try {
		const [data, s] = await Promise.all([readFile(QUALITY_REPORT_PATH, "utf-8"), stat(QUALITY_REPORT_PATH)]);
		res.json({ ...JSON.parse(data), mtime: s.mtimeMs });
	} catch (err) {
		res.status(404).json({ error: "Quality report not found — run update first", detail: err.message });
	}
});

app.get("/api/quality/mtime", async (_req, res) => {
	try {
		const s = await stat(QUALITY_REPORT_PATH);
		res.json({ mtime: s.mtimeMs });
	} catch {
		res.json({ mtime: 0 });
	}
});

app.get("/api/watchlist", async (req, res) => {
	try {
		const data = await readFile(WATCHLIST_PATH, "utf-8");
		res.json(JSON.parse(data));
	} catch (err) {
		res.status(500).json({ error: "Failed to read watchlist", detail: err.message });
	}
});

async function readPlexBlacklist() {
	try {
		const raw = await readFile(PLEX_BLACKLIST_PATH, "utf-8");
		const bl = JSON.parse(raw);
		bl.watchlist ??= [];
		return bl;
	} catch {
		return { watchlist: [], shows: [], episodes: [], seasons: [], movies: [] };
	}
}

app.get("/api/blacklist", async (req, res) => {
	try {
		const bl = await readPlexBlacklist();
		res.json(bl.watchlist);
	} catch (err) {
		res.status(500).json({ error: "Failed to read blacklist", detail: err.message });
	}
});

app.post("/api/blacklist", async (req, res) => {
	const { title } = req.body;
	if (!title || typeof title !== "string") {
		return res.status(400).json({ error: "title required" });
	}
	try {
		const bl = await readPlexBlacklist();
		const normalized = title.toLowerCase();
		if (!bl.watchlist.includes(normalized)) {
			bl.watchlist.push(normalized);
			await writeFile(PLEX_BLACKLIST_PATH, JSON.stringify(bl, null, 2), "utf-8");
		}
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to write blacklist", detail: err.message });
	}
});

const UPDATE_SCRIPT = join(__dirname, "scripts", "update.sh");
let updateRunning = false;
let updateChild = null;
let updateAborted = false;

app.post("/api/update", (req, res) => {
	if (updateRunning) {
		return res.status(409).json({ error: "Update already running" });
	}
	updateRunning = true;
	updateAborted = false;

	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.flushHeaders();
	res.socket?.setNoDelay(true);

	const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

	const child = spawn("bash", [UPDATE_SCRIPT], {
		timeout: 3_600_000,
		env: { ...process.env, PYTHONUNBUFFERED: "1" },
		detached: true,
	});
	updateChild = child;
	let tail = "";

	const flush = (chunk) => {
		tail += chunk.toString();
		const lines = tail.split("\n");
		tail = lines.pop();
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed) send({ line: trimmed });
		}
	};

	child.stdout.on("data", flush);
	child.stderr.on("data", flush);

	child.on("close", async (code) => {
		updateRunning = false;
		updateChild = null;
		try {
			if (tail.trim()) send({ line: tail.trim() });
			if (updateAborted) {
				send({ aborted: true });
			} else if (code === 0) {
				await refreshPlexLibraries();
				send({ done: true });
			} else {
				send({ error: true });
			}
		} catch (err) {
			console.error("[update] close handler:", err.message);
			try { send({ error: true }); } catch {}
		} finally {
			res.end();
		}
	});

	child.on("error", (err) => {
		updateRunning = false;
		updateChild = null;
		console.error("[update] spawn error:", err.message);
		send({ error: true });
		res.end();
	});
});

app.post("/api/update/abort", (req, res) => {
	if (!updateRunning || !updateChild) {
		return res.status(409).json({ error: "No update running" });
	}
	updateAborted = true;
	try {
		process.kill(-updateChild.pid, "SIGTERM");
	} catch {
		updateChild.kill("SIGTERM");
	}
	res.json({ ok: true });
});

app.post("/api/torrents/delete", async (req, res) => {
	const { hash } = req.body;
	if (!hash) return res.status(400).json({ error: "hash required" });
	try {
		await qbitFetch("/api/v2/torrents/delete", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ hashes: hash, deleteFiles: "true" }),
		});
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to delete torrent", detail: err.message });
	}
});

app.post("/api/qbit/download-limit", async (req, res) => {
	const { limit } = req.body;
	try {
		await qbitFetch("/api/v2/transfer/setDownloadLimit", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ limit: String(limit ?? 0) }),
		});
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to set download limit", detail: err.message });
	}
});

app.post("/api/qbit/upload-limit", async (req, res) => {
	const { limit } = req.body;
	try {
		await qbitFetch("/api/v2/transfer/setUploadLimit", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ limit: String(limit ?? 0) }),
		});
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to set upload limit", detail: err.message });
	}
});

app.post("/api/torrents/pause", async (req, res) => {
	const { hash } = req.body;
	if (!hash) return res.status(400).json({ error: "hash required" });
	try {
		await qbitFetch("/api/v2/torrents/pause", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ hashes: hash }),
		});
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to pause torrent", detail: err.message });
	}
});

app.post("/api/torrents/resume", async (req, res) => {
	const { hash } = req.body;
	if (!hash) return res.status(400).json({ error: "hash required" });
	try {
		await qbitFetch("/api/v2/torrents/resume", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ hashes: hash }),
		});
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to resume torrent", detail: err.message });
	}
});

app.post("/api/torrents/add", async (req, res) => {
	const { url, savepath } = req.body;
	if (!url || typeof url !== "string") {
		return res.status(400).json({ error: "url required" });
	}
	try {
		const params = { urls: url };
		if (savepath && typeof savepath === "string") params.savepath = savepath;
		await qbitFetch("/api/v2/torrents/add", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(params),
		});

		const hash = extractMagnetHash(url);
		const dn = extractMagnetName(url);
		let resolvedName = null;
		if (hash && dn) {
			resolvedName = parseTorrentName(dn);
			setTimeout(async () => {
				try {
					await qbitFetch("/api/v2/torrents/rename", {
						method: "POST",
						headers: { "Content-Type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams({ hash, name: resolvedName }),
					});
					console.log(`[rename] "${dn}" → "${resolvedName}"`);
				} catch (e) {
					console.error(`[rename] auto-rename failed: ${e.message}`);
				}
			}, 2000);
		}

		res.json({ ok: true, name: resolvedName });
	} catch (err) {
		console.error("[qbit] /api/torrents/add error:", err.message);
		res.status(500).json({ error: "Failed to add torrent", detail: err.message });
	}
});

app.post("/api/torrents/rename", async (req, res) => {
	const { hash, name } = req.body;
	if (!hash || !name || typeof name !== "string") {
		return res.status(400).json({ error: "hash and name required" });
	}
	try {
		await qbitFetch("/api/v2/torrents/rename", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ hash, name: name.trim() }),
		});
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to rename torrent", detail: err.message });
	}
});

app.post("/api/torrents/process", async (req, res) => {
	const { hash } = req.body ?? {};
	if (!hash) return res.status(400).json({ error: "hash required" });
	if (processingTorrents.has(hash)) return res.status(409).json({ error: "Already processing" });
	try {
		const qres = await qbitFetch("/api/v2/torrents/info");
		const torrents = await qres.json();
		const torrent = torrents.find((t) => t.hash === hash);
		if (!torrent) return res.status(404).json({ error: "Torrent not found" });
		processingTorrents.add(hash);
		processTorrent(torrent)
			.catch((e) => console.error(`[process] error for "${torrent.name}": ${e.message}`))
			.finally(() => processingTorrents.delete(hash));
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to start processing", detail: err.message });
	}
});

app.get("/api/torrents", async (req, res) => {
	try {
		const qres = await qbitFetch("/api/v2/torrents/info");
		const data = await qres.json();
		res.json(data);
	} catch (err) {
		console.error("[qbit] /api/torrents error:", err.message);
		res.status(500).json({ error: "Failed to fetch torrents", detail: err.message });
	}
});

app.get("/api/qbit/transfer", async (req, res) => {
	try {
		const qres = await qbitFetch("/api/v2/transfer/info");
		const data = await qres.json();
		res.json(data);
	} catch (err) {
		console.error("[qbit] /api/qbit/transfer error:", err.message);
		res.status(500).json({ error: "Failed to fetch transfer info", detail: err.message });
	}
});

const SEEDING_STATES = new Set(["uploading", "stalledUP", "queuedUP"]);
const DONE_STATES = new Set(["pausedUP", "stoppedUP", "uploading", "stalledUP"]);
let autoPauseSeeding = true;

// === Torrent auto-process ===
const MEDIA_EXTS = new Set([".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts"]);
const SUBTITLE_EXTS = new Set([".srt", ".ass", ".sub", ".ssa", ".vtt"]);
const MOVIES_ROOTS = (process.env.MOVIES_ROOTS || "").split(",").map((p) => p.trim()).filter(Boolean);
const SERIES_ROOTS = (process.env.SERIES_ROOTS || "").split(",").map((p) => p.trim()).filter(Boolean);
const processingTorrents = new Set();

function detectMediaType(name) {
	if (/\bS\d{2}/i.test(name)) return "series";
	if (/\b(?:E|EP|Episode)[._\s]?\d{2,4}\b/i.test(name)) return "series";
	return "movies";
}

function cleanShowName(raw) {
	return raw
		.replace(/[._]+/g, " ")
		.replace(/\s+(?:Season|Series|S)\s*\d+\s*$/i, "") // strip trailing "Season 22" / "S22"
		.trim();
}

function parseSeriesInfo(name) {
	// Standard S##[E##]
	const m = name.match(/^(.+?)[._\s]+[Ss](\d+)/);
	if (m) return { showName: cleanShowName(m[1]), season: `Season ${parseInt(m[2], 10)}` };
	// Anime absolute: Show.Name.Episode.047 or Show.Name.EP047
	const anime = name.match(/^(.+?)[._\s]+(?:[Ee][Pp]?(?:isode)?[._\s]?)(\d{2,4})\b/i);
	if (anime) return { showName: cleanShowName(anime[1]), season: "Season 1" };
	return null;
}

function parseSeasonFromFilename(fileName) {
	const m = fileName.match(/[Ss](\d+)[Ee]\d+/);
	return m ? parseInt(m[1], 10) : null;
}

const QUALITY_TAGS_RE = /\b(2160p|1080p|720p|480p|4[Kk]|UHD|BluRay|Blu-Ray|BDRip|BRRip|WEB[-.]?DL|WEBRip|HDTV|DVDRip|REMUX|HDR|DV|x264|x265|HEVC|H\.?26[45]|AVC|AAC|DTS|AC3|Atmos|TrueHD|FLAC|MULTI|DUAL|REPACK|PROPER|EXTENDED|THEATRICAL|DIRECTORS\.?CUT)\b.*/i;

function parseMovieInfo(name) {
	const base = name.replace(/\.(mkv|mp4|avi|mov|wmv|m4v|ts|m2ts)$/i, "");
	const yearRe = /\b((?:19|20)\d{2})\b/g;
	let match;
	while ((match = yearRe.exec(base)) !== null) {
		const rawTitle = base.slice(0, match.index);
		// If the slice before the year has no spaces, dots/underscores are word separators — replace them.
		// If it already has spaces, dots are part of the title (e.g. "Dr.", "2.5") — leave them alone.
		const hasSeparatorDots = !rawTitle.includes(" ");
		let title = hasSeparatorDots
			? rawTitle.replace(/[._]+/g, " ").trim()
			: rawTitle.replace(/\s*\($/, "").trim();
		// Normalize digit-dash-word ("3-Word", "3 -Word") → "3 - Word" (subtitle separator)
		// Does not affect compound words like "Spider-Man" where letter precedes the dash.
		title = title.replace(/(\d)\s*-\s*/g, "$1 - ").replace(/\s{2,}/g, " ").trim();
		if (title.length > 0) return { title, year: match[1] };
	}
	// No year with content before it — strip quality tags and clean up
	const stripped = base.replace(QUALITY_TAGS_RE, "").replace(/[._]+/g, " ").trim();
	return { title: stripped || base.replace(/[._]+/g, " ").trim(), year: null };
}

function findDestRoot(savePath, roots) {
	const base = TORRENT_SAVE_PATHS.find((p) => savePath.startsWith(p));
	if (!base) return null;
	const mountParts = base.split("/").filter(Boolean).slice(0, 2); // ["mnt", "diskname"]
	return roots.find((r) => {
		const rp = r.split("/").filter(Boolean);
		return mountParts.every((p, i) => rp[i] === p);
	}) ?? null;
}

function sendNtfy({ title, body, tags = "", priority = "default" }) {
	if (!NTFY_URL) return;
	fetch(NTFY_URL, {
		method: "POST",
		headers: {
			"Authorization": "Basic " + Buffer.from(`${NTFY_USER}:${NTFY_PASS}`).toString("base64"),
			"Title": title,
			"Tags": tags,
			"Priority": priority,
		},
		body,
	}).catch((e) => console.error("[ntfy] error:", e.message));
}

function shortPath(fullPath) {
	for (const root of [...MOVIES_ROOTS, ...SERIES_ROOTS]) {
		if (fullPath.startsWith(root)) {
			const disk = root.split("/").filter(Boolean)[1];
			const rel = fullPath.slice(root.length).replace(/^\//, "");
			return rel ? `${disk}/${rel}` : disk;
		}
	}
	return fullPath;
}

async function findExistingShowRoot(showName) {
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

async function walkFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...await walkFiles(full));
		else files.push(full);
	}
	return files;
}

const BAD_CODECS = new Set(["mpeg1video", "mpeg2video", "h263", "xvid", "divx", "wmv1", "wmv2", "rv10", "rv20", "msmpeg4v2", "msmpeg4v3"]);
const EFFICIENT_CODECS = new Set(["hevc", "h265", "x265", "av1", "vp9"]);
const BITRATE_RATIOS = [[2160, 4.0], [1080, 1.0], [720, 0.4], [0, 0.2]];

async function ffprobeFile(filePath) {
	return new Promise((resolve) => {
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), 30_000);
		const proc = spawn(
			"ffprobe",
			["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath],
			{ signal: ac.signal }
		);
		let stdout = "";
		proc.stdout.on("data", (d) => { stdout += d; });
		proc.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) return resolve(null);
			try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
		});
		proc.on("error", () => { clearTimeout(timer); resolve(null); });
	});
}

async function checkVideoQuality(filePath, settings = {}) {
	const { resolution_threshold = 0, resolution_max = 0, video_bitrate_1080p = 0, audio_bitrate_min = 0 } = settings;
	const data = await ffprobeFile(filePath);
	if (!data) return ["corrupt_or_unreadable"];

	const streams = data.streams ?? [];
	const fmt = data.format ?? {};
	const issues = [];

	const video = streams.find((s) => s.codec_type === "video");
	const audio = streams.find((s) => s.codec_type === "audio");
	if (!video) return ["no_video_stream"];

	const codec = (video.codec_name ?? "").toLowerCase();
	if (BAD_CODECS.has(codec)) issues.push(`bad_codec:${codec}`);

	const height = video.height ?? 0;
	if (resolution_threshold > 0 && height && height < resolution_threshold)
		issues.push(`low_resolution:${video.width}x${height}`);
	if (resolution_max > 0 && height && height > resolution_max)
		issues.push(`high_resolution:${video.width}x${height}`);

	if (video_bitrate_1080p > 0 && height) {
		const ratio = BITRATE_RATIOS.find(([h]) => height >= h)[1];
		let threshold = Math.floor(video_bitrate_1080p * ratio);
		if (EFFICIENT_CODECS.has(codec)) threshold = Math.floor(threshold / 2);
		const vbr = Math.floor(parseInt(video.bit_rate || fmt.bit_rate || "0", 10) / 1000);
		if (vbr > 0 && vbr < threshold) issues.push(`low_video_bitrate:${vbr}kbps`);
	}

	if (!audio) {
		issues.push("no_audio_stream");
	} else if (audio_bitrate_min > 0) {
		const abr = Math.floor(parseInt(audio.bit_rate || "0", 10) / 1000);
		if (abr > 0 && abr < audio_bitrate_min) issues.push(`low_audio_bitrate:${abr}kbps`);
	}

	return issues;
}

async function moveFile(src, dest) {
	try {
		await fsRename(src, dest);
	} catch (err) {
		if (err.code !== "EXDEV") throw err;
		console.log(`[process] Cross-device copy (slow): ${basename(src)}`);
		await copyFile(src, dest);
		await unlink(src);
	}
}

async function processTorrent(torrent) {
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
	const videoFiles = allFiles.filter((f) => MEDIA_EXTS.has(extname(f).toLowerCase()) && !isSample(f));
	const subtitleFiles = allFiles.filter((f) => SUBTITLE_EXTS.has(extname(f).toLowerCase()) && !isSample(f));

	if (videoFiles.length === 0) {
		const msg = "No video files found in downloaded content";
		console.error(`[process] ${msg}: ${content_path}`);
		sendNtfy({ title: "Processing failed", body: `${name}\n${msg}`, tags: "warning", priority: "high" });
		return;
	}

	// --- Quality gate: check every video file before touching the library ---
	{
		let qSettings = {};
		try { qSettings = JSON.parse(await readFile(QUALITY_SETTINGS_PATH, "utf-8")); } catch { /* use defaults */ }

		const badFiles = [];
		for (const f of videoFiles) {
			console.log(`[process] Quality checking: ${basename(f)}`);
			const issues = await checkVideoQuality(f, qSettings);
			if (issues.length > 0) badFiles.push({ file: basename(f), issues });
		}

		if (badFiles.length > 0) {
			const lines = badFiles.map(({ file, issues }) => `• ${file}: ${issues.join(", ")}`).join("\n");
			console.log(`[process] Quality gate blocked "${name}":\n${lines}`);
			sendNtfy({
				title: "Quality check failed — not added",
				body: `${name}\n${lines}\nTorrent kept in queue for review`,
				tags: "warning",
				priority: "high",
			});
			return; // Torrent untouched — user reviews manually
		}
	}

	// --- Pre-compute type-specific metadata ---
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

	// For series: resolve the root (follow show to existing disk if present)
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
		// Use the actual on-disk folder name (preserves year suffix like "(1999)")
		seriesShowRoot = existing
			? join(existing.root, existing.folderName)
			: join(destRoot, seriesInfo.showName);
	}

	// For movies: check for existing folder and quality-flag gate
	let movieDestFolder = null;
	let oldFilesToDelete = [];
	if (type === "movies") {
		movieDestFolder = join(destRoot, cleanMovieName ?? name);
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
				// Defer deletion until after the new files are confirmed moved
				oldFilesToDelete = oldVideos;
			}
		}
	}

	// --- Move files ---
	console.log(`[process] "${name}" → ${type === "series" ? seriesShowRoot : movieDestFolder} (${videoFiles.length} video, ${subtitleFiles.length} sub)`);

	let addedVideoCount = 0;
	let skippedVideoCount = 0;
	try {
		if (type === "series") {
			for (const f of [...videoFiles, ...subtitleFiles]) {
				// Route each file to its own season folder based on the file's S##E## tag
				const seasonNum = parseSeasonFromFilename(basename(f));
				const seasonLabel = seasonNum != null ? `Season ${seasonNum}` : seriesInfo.season;
				// Guard: seriesShowRoot shouldn't already end with the season folder
				const targetDir = basename(seriesShowRoot) === seasonLabel
					? seriesShowRoot
					: join(seriesShowRoot, seasonLabel);

				// Skip if this S##E## already exists in the target directory
				const epInfo = parseEpisodeInfo(basename(f));
				if (epInfo) {
					const sTag = `s${String(epInfo.season).padStart(2, "0")}e${String(epInfo.episode).padStart(2, "0")}`;
					let dirEntries = [];
					try { dirEntries = await readdir(targetDir); } catch { /* dir doesn't exist yet — no conflict */ }
					if (dirEntries.some((n) => n.toLowerCase().includes(sTag))) {
						console.log(`[process] skip existing S${String(epInfo.season).padStart(2, "0")}E${String(epInfo.episode).padStart(2, "0")}: ${basename(f)}`);
						if (MEDIA_EXTS.has(extname(f).toLowerCase())) skippedVideoCount++;
						continue;
					}
				}

				await mkdir(targetDir, { recursive: true });
				const movedPath = join(targetDir, basename(f));
				await moveFile(f, movedPath);
				if (MEDIA_EXTS.has(extname(f).toLowerCase())) addedVideoCount++;

				// Rename to Plex format: Show - SXXEXX - Title.ext
				const ext = extname(basename(f)).toLowerCase();
				if (MEDIA_EXTS.has(ext) || SUBTITLE_EXTS.has(ext)) {
					if (epInfo) {
						const epTitle = await fetchTmdbEpisodeTitle(seriesInfo.showName, epInfo.season, epInfo.episode);
						const newFilename = buildEpisodeFilename(seriesInfo.showName, epInfo.season, epInfo.episode, epTitle) + ext;
						await fsRename(movedPath, join(targetDir, newFilename)).catch((err) =>
							console.warn(`[process] episode rename failed: ${err.message}`)
						);
					}
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
		return; // Torrent preserved — source files intact for manual recovery
	}

	// New files confirmed moved — now safe to delete old quality-flagged files
	for (const f of oldFilesToDelete) await unlink(f).catch(() => {});
	if (oldFilesToDelete.length) {
		console.log(`[process] Deleted ${oldFilesToDelete.length} replaced file(s)`);
		// Remove replaced paths from quality report so the UI reflects the fix immediately
		try {
			const qReport = JSON.parse(await readFile(QUALITY_REPORT_PATH, "utf-8"));
			const deletedAbs = new Set(oldFilesToDelete.map((f) => resolve(f)));
			qReport.movies = (qReport.movies ?? []).filter((m) => !deletedAbs.has(resolve(m.full_path)));
			qReport.series = (qReport.series ?? []).filter((m) => !deletedAbs.has(resolve(m.full_path)));
			await writeFile(QUALITY_REPORT_PATH, JSON.stringify(qReport));
		} catch { /* quality report missing or malformed — leave as-is */ }
	}

	await qbitFetch("/api/v2/torrents/delete", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ hashes: hash, deleteFiles: "true" }),
	}).catch((err) => console.error(`[process] torrent delete failed: ${err.message}`));

	await refreshPlexLibraries().catch(() => {});
	console.log(`[process] done: "${name}"`);

	// --- Notification ---
	const subLine = subtitleFiles.length > 0 ? ` · ${subtitleFiles.length} subtitle${subtitleFiles.length > 1 ? "s" : ""}` : "";

	let ntfyTitle, ntfyBody;
	if (type === "series") {
		const seriesLabel = `${seriesInfo.showName} · ${seriesInfo.season}`;
		if (addedVideoCount === 0) {
			ntfyTitle = "No new episodes — already in library";
			ntfyBody = [seriesLabel, `${skippedVideoCount} episode${skippedVideoCount !== 1 ? "s" : ""} already present`, crossDiskNote].filter(Boolean).join("\n");
		} else {
			ntfyTitle = addedVideoCount > 1 ? "Episodes added to library" : "Episode added to library";
			const addedWord = `${addedVideoCount} episode${addedVideoCount !== 1 ? "s" : ""}${subLine}`;
			const skipNote = skippedVideoCount > 0 ? `${skippedVideoCount} already present — skipped` : null;
			ntfyBody = [seriesLabel, addedWord, skipNote, crossDiskNote, `→ ${shortPath(seriesShowRoot)}/`].filter(Boolean).join("\n");
		}
	} else {
		ntfyTitle = "Movie added to library";
		ntfyBody = [
			cleanMovieName ?? name,
			`1 video file${subLine}`,
			`→ ${shortPath(movieDestFolder)}/`,
		].filter(Boolean).join("\n");
	}

	sendNtfy({ title: ntfyTitle, body: ntfyBody, tags: "white_check_mark" });
}
// === Library rename ===

function sanitizeFilename(str) {
	return str.replace(/[/\\:*?"<>|]/g, "").replace(/\s{2,}/g, " ").trim();
}

function pad2(n) { return String(n).padStart(2, "0"); }

function parseEpisodeInfo(filename) {
	const m = filename.match(/[Ss](\d+)[Ee](\d+)/);
	return m ? { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) } : null;
}

function normalizeSeasonFolderName(name) {
	const m = name.match(/^[Ss](?:eason\s*)?(\d+)$/i);
	return m ? `Season ${parseInt(m[1], 10)}` : null;
}

// In-memory TMDB caches (persist for server lifetime)
const _tmdbShowIdCache = new Map();
const _tmdbSeasonCache = new Map(); // "showId:season" → Map<episodeNum, title>

async function fetchTmdbShowId(showName) {
	if (!TMDB_API_KEY) return null;
	if (_tmdbShowIdCache.has(showName)) return _tmdbShowIdCache.get(showName);
	try {
		const res = await fetch(
			`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(showName)}`,
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

async function fetchTmdbEpisodeTitle(showName, season, episode) {
	if (!TMDB_API_KEY) return null;
	const showId = await fetchTmdbShowId(showName);
	if (!showId) return null;
	const seasonKey = `${showId}:${season}`;
	if (!_tmdbSeasonCache.has(seasonKey)) {
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
	return _tmdbSeasonCache.get(seasonKey).get(episode) ?? null;
}

function buildEpisodeFilename(showName, season, episode, title) {
	const base = `${showName} - S${pad2(season)}E${pad2(episode)}`;
	return title ? `${base} - ${sanitizeFilename(title)}` : base;
}

async function buildRenamePlan() {
	const movies = [];
	const shows = [];
	const warnings = { unparseable: [], tmdbShowsNotFound: [], multipleVideos: [] };

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
				// Multiple video files — renaming would produce duplicate targets; skip and warn
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
	for (const root of SERIES_ROOTS) {
		let showEntries;
		try { showEntries = await readdir(root, { withFileTypes: true }); } catch { continue; }
		for (const showEntry of showEntries) {
			if (!showEntry.isDirectory()) continue;
			const showFolder = join(root, showEntry.name);
			const showName = showEntry.name;
			// Strip year suffix and clean separators for episode filenames and TMDB queries.
			// The folder name stays as-is; only the PREFIX used inside episode filenames changes.
			const showNameClean = showName.replace(/[._]+/g, " ").replace(/\s*\(\d{4}\)\s*$/, "").trim();
			const seasons = [];

			// Check TMDB show lookup once per show (result is cached)
			const tmdbId = await fetchTmdbShowId(showNameClean);
			if (!tmdbId && !warnings.tmdbShowsNotFound.includes(showNameClean)) {
				warnings.tmdbShowsNotFound.push(showNameClean);
			}

			let seasonEntries;
			try { seasonEntries = await readdir(showFolder, { withFileTypes: true }); } catch { continue; }
			for (const seasonEntry of seasonEntries) {
				if (!seasonEntry.isDirectory()) continue;
				const seasonFolderCurrent = join(showFolder, seasonEntry.name);
				const normalized = normalizeSeasonFolderName(seasonEntry.name);
				if (!normalized) continue; // skip non-season folders (Specials etc)
				const seasonFolderDesired = join(showFolder, normalized);
				const seasonFolderChanged = seasonEntry.name !== normalized;

				const episodes = [];
				let epEntries;
				try { epEntries = await readdir(seasonFolderCurrent, { withFileTypes: true }); } catch { continue; }
				for (const epEntry of epEntries) {
					if (!epEntry.isFile()) continue;
					let ext = extname(epEntry.name).toLowerCase();
					if (!MEDIA_EXTS.has(ext) && !SUBTITLE_EXTS.has(ext)) continue;
					// Preserve language tag on subtitle files (e.g. .en.srt → keep ".en.srt")
					if (SUBTITLE_EXTS.has(ext)) {
						const inner = extname(epEntry.name.slice(0, -ext.length)).toLowerCase();
						if (/^\.[a-z]{2,3}$/.test(inner)) ext = inner + ext;
					}
					const epInfo = parseEpisodeInfo(epEntry.name);
					if (!epInfo) {
						warnings.unparseable.push({ show: showNameClean, season: seasonEntry.name, file: epEntry.name, fullPath: join(seasonFolderCurrent, epEntry.name) });
						continue;
					}
					const title = await fetchTmdbEpisodeTitle(showNameClean, epInfo.season, epInfo.episode);
					const nameDesired = buildEpisodeFilename(showNameClean, epInfo.season, epInfo.episode, title) + ext;
					// episodeChanged = the file itself needs renaming (independent of season folder)
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

app.get("/api/library/renames", async (req, res) => {
	try {
		const data = JSON.parse(await readFile(RENAME_PLAN_PATH, "utf-8"));
		res.json(data);
	} catch {
		res.json(null);
	}
});

app.post("/api/library/renames/scan", async (req, res) => {
	try {
		const plan = await buildRenamePlan();
		await writeFile(RENAME_PLAN_PATH, JSON.stringify(plan));
		res.json(plan);
	} catch (err) {
		res.status(500).json({ error: "Scan failed", detail: err.message });
	}
});

async function applyRenamePlan(plan, scope = "all") {
	let ok = 0; let failed = 0; const errors = [];
	const attempt = async (from, to) => {
		try { await fsRename(from, to); ok++; }
		catch (err) { failed++; errors.push({ from: basename(from), error: err.message }); }
	};

	if (scope === "all" || scope === "movies") {
		for (const movie of plan.movies) {
			if (movie.folderChanged) await attempt(movie.folderCurrent, movie.folderDesired);
			for (const file of movie.files) {
				if (!file.fileChanged) continue;
				await attempt(join(movie.folderDesired, file.nameCurrent), join(movie.folderDesired, file.nameDesired));
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

app.post("/api/library/renames/apply", async (req, res) => {
	try {
		const { scope = "all", showFolder } = req.body ?? {};
		const plan = await buildRenamePlan();
		// When showFolder is provided, narrow the plan to that one show only
		const effectivePlan = showFolder
			? { ...plan, movies: [], shows: plan.shows.filter((s) => s.showFolder === showFolder) }
			: plan;
		const result = await applyRenamePlan(effectivePlan, showFolder ? "series" : scope);
		await refreshPlexLibraries().catch(() => {});
		await unlink(RENAME_PLAN_PATH).catch(() => {});
		res.json({ ...result, tmdbFailed: plan.stats.tmdbFailed });
	} catch (err) {
		res.status(500).json({ error: "Apply failed", detail: err.message });
	}
});

app.delete("/api/library/file", async (req, res) => {
	try {
		const { fullPath } = req.body ?? {};
		if (!fullPath) return res.status(400).json({ error: "fullPath required" });
		const allRoots = [...MOVIES_ROOTS, ...SERIES_ROOTS];
		const abs = resolve(fullPath);
		if (!allRoots.some((r) => abs.startsWith(resolve(r) + "/"))) {
			return res.status(403).json({ error: "Path is outside media roots" });
		}
		await unlink(abs);
		await refreshPlexLibraries().catch(() => {});
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

readFile(SERVER_SETTINGS_PATH, "utf-8").then((d) => {
	const s = JSON.parse(d);
	if (typeof s.autoPauseSeeding === "boolean") autoPauseSeeding = s.autoPauseSeeding;
}).catch(() => {});
const prevTorrentStates = new Map();

app.get("/api/qbit/auto-pause", (req, res) => {
	res.json({ enabled: autoPauseSeeding });
});

app.post("/api/qbit/auto-pause", (req, res) => {
	const { enabled } = req.body;
	if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled required" });
	autoPauseSeeding = enabled;
	writeFile(SERVER_SETTINGS_PATH, JSON.stringify({ autoPauseSeeding }, null, 2)).catch(() => {});
	console.log(`[auto-pause] ${enabled ? "enabled" : "disabled"}`);
	res.json({ enabled: autoPauseSeeding });
});

let firstPoll = true;

async function pollTorrents() {
	try {
		const qres = await qbitFetch("/api/v2/torrents/info");
		const torrents = await qres.json();

		for (const t of torrents) {
			const prev = prevTorrentStates.get(t.hash);
			const newlyDone = prev && !DONE_STATES.has(prev) && DONE_STATES.has(t.state);
			// On first poll after startup, catch torrents that finished while the server was down.
			// Guard: only process if content_path still exists (files not yet moved to library).
			const missedWhileDown = firstPoll && !prev && DONE_STATES.has(t.state)
				&& await stat(t.content_path).then(() => true).catch(() => false);

			if ((newlyDone || missedWhileDown) && (MOVIES_ROOTS.length || SERIES_ROOTS.length) && !processingTorrents.has(t.hash)) {
				processingTorrents.add(t.hash);
				processTorrent(t)
					.catch((e) => console.error(`[process] error for "${t.name}": ${e.message}`))
					.finally(() => processingTorrents.delete(t.hash));
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

pollTorrents();
setInterval(pollTorrents, 30_000);

app.get("/api/version", (_req, res) => res.json({ hash: GIT_HASH }));

app.post("/api/notify", async (req, res) => {
	if (!NTFY_URL) return res.status(503).json({ error: "NTFY_URL not configured" });
	const { title } = req.body;
	try {
		await fetch(NTFY_URL, {
			method: "POST",
			headers: {
				"Authorization": "Basic " + Buffer.from(`${NTFY_USER}:${NTFY_PASS}`).toString("base64"),
				"Title": "Download complete",
				"Tags": "white_check_mark",
			},
			body: title || "Torrent finished",
		});
		res.json({ ok: true });
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

app.get("/api/cache", async (_req, res) => {
	try {
		const s = await stat(TMDB_CACHE_PATH);
		const ageDays = Math.floor((Date.now() - s.mtimeMs) / 86_400_000);
		res.json({ exists: true, ageDays });
	} catch {
		res.json({ exists: false });
	}
});

app.delete("/api/cache", async (_req, res) => {
	try {
		await unlink(TMDB_CACHE_PATH);
		res.json({ ok: true });
	} catch (e) {
		if (e.code === "ENOENT") return res.json({ ok: true });
		res.status(500).json({ error: e.message });
	}
});

app.get("/api/quality-cache", async (_req, res) => {
	try {
		const s = await stat(QUALITY_CACHE_PATH);
		const ageDays = Math.floor((Date.now() - s.mtimeMs) / 86_400_000);
		res.json({ exists: true, ageDays });
	} catch {
		res.json({ exists: false });
	}
});

app.delete("/api/quality-cache", async (_req, res) => {
	try {
		await unlink(QUALITY_CACHE_PATH);
		res.json({ ok: true });
	} catch (e) {
		if (e.code === "ENOENT") return res.json({ ok: true });
		res.status(500).json({ error: e.message });
	}
});

const DEFAULT_QUALITY_SETTINGS = { resolution_threshold: 720, resolution_max: 0, video_bitrate_1080p: 0, audio_bitrate_min: 0 };

app.get("/api/quality-settings", async (_req, res) => {
	try {
		const data = JSON.parse(await readFile(QUALITY_SETTINGS_PATH, "utf-8"));
		res.json({ ...DEFAULT_QUALITY_SETTINGS, ...data });
	} catch {
		res.json(DEFAULT_QUALITY_SETTINGS);
	}
});

app.post("/api/quality-settings", async (req, res) => {
	try {
		const current = JSON.parse(await readFile(QUALITY_SETTINGS_PATH, "utf-8").catch(() => "{}"));
		const ALLOWED = new Set(Object.keys(DEFAULT_QUALITY_SETTINGS));
		const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED.has(k)));
		const updated = { ...DEFAULT_QUALITY_SETTINGS, ...current, ...patch };
		await writeFile(QUALITY_SETTINGS_PATH, JSON.stringify(updated, null, 2));
		res.json(updated);
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

app.delete("/api/quality-file", async (req, res) => {
	const { full_path } = req.body ?? {};
	if (!full_path || typeof full_path !== "string") {
		return res.status(400).json({ error: "full_path required" });
	}
	const target = resolve(full_path);
	try {
		const data = JSON.parse(await readFile(QUALITY_REPORT_PATH, "utf-8"));
		const allowed = [...(data.movies ?? []), ...(data.series ?? [])].some(
			(item) => resolve(item.full_path) === target
		);
		if (!allowed) return res.status(403).json({ error: "Path not in quality report" });
		await unlink(target);
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to delete file", detail: err.message });
	}
});

// Serve built frontend in production
const clientDist = join(__dirname, "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
	if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
	res.sendFile(join(clientDist, "index.html"));
});

app.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
	if (!DASHBOARD_TOKEN) {
		console.warn("⚠️  DASHBOARD_TOKEN is not set — the API is unauthenticated. Set it in .env if this server is reachable outside your LAN.");
	}
});
