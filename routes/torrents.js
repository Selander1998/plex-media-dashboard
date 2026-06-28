import { Router } from "express";
import { statfs, stat } from "fs/promises";
import { TORRENT_SAVE_PATHS, TORRENT_TEMP_SUBDIR, SERVER_SETTINGS_PATH } from "../lib/config.js";
import { qbitFetch } from "../lib/qbit.js";
import { processingTorrents, processTorrent, autoPauseSeeding, setAutoPause } from "../lib/torrent.js";
import { parseTorrentName, extractMagnetHash, extractMagnetName } from "../lib/media.js";
import { writeFile } from "fs/promises";

const router = Router();

router.get("/api/qbit/save-paths", (req, res) => {
	res.json(TORRENT_SAVE_PATHS);
});

router.get("/api/qbit/temp-paths", (req, res) => {
	if (!TORRENT_TEMP_SUBDIR) return res.json([]);
	res.json(TORRENT_SAVE_PATHS.map((p) => `${p.replace(/\/$/, "")}/${TORRENT_TEMP_SUBDIR}`));
});

router.post("/api/qbit/temp-path", async (req, res) => {
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

router.get("/api/disk-space", async (req, res) => {
	const { path } = req.query;
	if (!path || typeof path !== "string" || !path.startsWith("/")) {
		return res.status(400).json({ error: "Invalid path" });
	}
	if (TORRENT_SAVE_PATHS.length > 0 && !TORRENT_SAVE_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
		return res.status(403).json({ error: "Path not allowed" });
	}
	try {
		const [s, st] = await Promise.all([statfs(path), stat(path)]);
		res.json({ available: s.bavail * s.bsize, total: s.blocks * s.bsize, dev: st.dev });
	} catch (err) {
		res.status(500).json({ error: "Failed to stat path", detail: err.message });
	}
});

router.post("/api/torrents/delete", async (req, res) => {
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

router.post("/api/qbit/download-limit", async (req, res) => {
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

router.post("/api/qbit/upload-limit", async (req, res) => {
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

router.post("/api/torrents/pause", async (req, res) => {
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

router.post("/api/torrents/resume", async (req, res) => {
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

router.post("/api/torrents/add", async (req, res) => {
	const { url, savepath } = req.body;
	if (!url || typeof url !== "string") return res.status(400).json({ error: "url required" });
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
			(async () => {
				for (let i = 0; i < 12; i++) {
					await new Promise((r) => setTimeout(r, 1000));
					try {
						const list = await qbitFetch(`/api/v2/torrents/info?hashes=${hash}`).then((r) => r.json());
						if (!list?.length) continue;
						await qbitFetch("/api/v2/torrents/rename", {
							method: "POST",
							headers: { "Content-Type": "application/x-www-form-urlencoded" },
							body: new URLSearchParams({ hash, name: resolvedName }),
						});
						console.log(`[rename] "${dn}" → "${resolvedName}"`);
						return;
					} catch (e) {
						console.error(`[rename] auto-rename failed: ${e.message}`);
						return;
					}
				}
				console.warn(`[rename] torrent ${hash} not found after retries, skipping rename`);
			})();
		}

		res.json({ ok: true, name: resolvedName });
	} catch (err) {
		console.error("[qbit] /api/torrents/add error:", err.message);
		res.status(500).json({ error: "Failed to add torrent", detail: err.message });
	}
});

router.post("/api/torrents/rename", async (req, res) => {
	const { hash, name } = req.body;
	if (!hash || !name || typeof name !== "string") return res.status(400).json({ error: "hash and name required" });
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

router.post("/api/torrents/process", async (req, res) => {
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

router.get("/api/torrents", async (req, res) => {
	try {
		const qres = await qbitFetch("/api/v2/torrents/info");
		res.json(await qres.json());
	} catch (err) {
		console.error("[qbit] /api/torrents error:", err.message);
		res.status(500).json({ error: "Failed to fetch torrents", detail: err.message });
	}
});

router.get("/api/qbit/transfer", async (req, res) => {
	try {
		const qres = await qbitFetch("/api/v2/transfer/info");
		res.json(await qres.json());
	} catch (err) {
		console.error("[qbit] /api/qbit/transfer error:", err.message);
		res.status(500).json({ error: "Failed to fetch transfer info", detail: err.message });
	}
});

router.get("/api/qbit/auto-pause", (req, res) => {
	res.json({ enabled: autoPauseSeeding });
});

router.post("/api/qbit/auto-pause", (req, res) => {
	const { enabled } = req.body;
	if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled required" });
	setAutoPause(enabled);
	writeFile(SERVER_SETTINGS_PATH, JSON.stringify({ autoPauseSeeding: enabled }, null, 2)).catch(() => {});
	console.log(`[auto-pause] ${enabled ? "enabled" : "disabled"}`);
	res.json({ enabled });
});

export default router;
