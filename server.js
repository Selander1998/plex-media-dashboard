import express from "express";
import { readFile, appendFile, statfs } from "fs/promises";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { execFile } from "child_process";

const app = express();
app.use(express.json());

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

const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || "";
const QBIT_URL = process.env.QBIT_URL || "http://localhost:8080";
const QBIT_USERNAME = process.env.QBIT_USERNAME || "admin";
const QBIT_PASSWORD = process.env.QBIT_PASSWORD || "adminadmin";
const REPORT_PATH = process.env.REPORT_PATH || join(__dirname, "scripts", "report.json");
const WATCHLIST_PATH = process.env.WATCHLIST_PATH || join(__dirname, "scripts", "watchlist.json");
const BLACKLIST_PATH = process.env.BLACKLIST_PATH || join(__dirname, "scripts", "blacklist.txt");
const PORT = process.env.PORT || 3000;
const TORRENT_SAVE_PATHS = (process.env.TORRENT_SAVE_PATHS || "")
	.split(",").map((p) => p.trim()).filter(Boolean);
const PLEX_URL = process.env.PLEX_URL || "";
const PLEX_TOKEN = process.env.PLEX_TOKEN || "";

async function refreshPlexLibraries() {
	if (!PLEX_URL || !PLEX_TOKEN) return;
	try {
		const sectionsRes = await fetch(`${PLEX_URL}/library/sections?X-Plex-Token=${PLEX_TOKEN}`, {
			headers: { Accept: "application/json" },
		});
		const data = await sectionsRes.json();
		const sections = data?.MediaContainer?.Directory ?? [];
		await Promise.all(
			sections.map((s) =>
				fetch(`${PLEX_URL}/library/sections/${s.key}/refresh?X-Plex-Token=${PLEX_TOKEN}`, { method: "GET" })
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
		const s = await statfs(path);
		const available = s.bavail * s.bsize;
		const total = s.blocks * s.bsize;
		res.json({ available, total });
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

app.get("/api/watchlist", async (req, res) => {
	try {
		const data = await readFile(WATCHLIST_PATH, "utf-8");
		res.json(JSON.parse(data));
	} catch (err) {
		res.status(500).json({ error: "Failed to read watchlist", detail: err.message });
	}
});

app.post("/api/blacklist", async (req, res) => {
	const { title } = req.body;
	if (!title || typeof title !== "string") {
		return res.status(400).json({ error: "title required" });
	}
	try {
		await appendFile(BLACKLIST_PATH, `${title.toLowerCase()}\n`, "utf-8");
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to write blacklist", detail: err.message });
	}
});

const UPDATE_SCRIPT = join(__dirname, "scripts", "update.sh");
let updateRunning = false;

app.post("/api/update", (req, res) => {
	if (updateRunning) {
		return res.status(409).json({ error: "Update already running" });
	}
	updateRunning = true;
	execFile(UPDATE_SCRIPT, { timeout: 300_000 }, (err) => {
		updateRunning = false;
		if (err) {
			console.error("[update] failed:", err.message);
			return res.status(500).json({ error: "Update failed", detail: err.message });
		}
		refreshPlexLibraries();
		res.json({ ok: true });
	});
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
let autoPauseSeeding = true;

app.get("/api/qbit/auto-pause", (req, res) => {
	res.json({ enabled: autoPauseSeeding });
});

app.post("/api/qbit/auto-pause", (req, res) => {
	const { enabled } = req.body;
	if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled required" });
	autoPauseSeeding = enabled;
	console.log(`[auto-pause] ${enabled ? "enabled" : "disabled"}`);
	res.json({ enabled: autoPauseSeeding });
});

setInterval(async () => {
	if (!autoPauseSeeding) return;
	try {
		const qres = await qbitFetch("/api/v2/torrents/info");
		const torrents = await qres.json();
		for (const t of torrents) {
			if (SEEDING_STATES.has(t.state)) {
				await qbitFetch("/api/v2/torrents/pause", {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({ hashes: t.hash }),
				});
				console.log(`[auto-pause] paused ${t.name}`);
			}
		}
	} catch (e) {
		console.error("[auto-pause] error:", e.message);
	}
}, 30_000);

// Serve built frontend in production
const clientDist = join(__dirname, "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
	if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
	res.sendFile(join(clientDist, "index.html"));
});

app.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});
