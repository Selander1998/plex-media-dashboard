import { Router } from "express";
import { readFile, writeFile, unlink, stat } from "fs/promises";
import { resolve } from "path";
import {
	TMDB_CACHE_PATH, QUALITY_CACHE_PATH, QUALITY_SETTINGS_PATH, QUALITY_REPORT_PATH, GIT_HASH, NTFY_URL,
} from "../lib/config.js";
import { sendNtfy } from "../lib/ntfy.js";

const router = Router();

const DEFAULT_QUALITY_SETTINGS = { resolution_threshold: 720, resolution_max: 0, video_bitrate_1080p: 0, audio_bitrate_min: 0 };

router.get("/api/version", (_req, res) => res.json({ hash: GIT_HASH }));

router.post("/api/notify", async (req, res) => {
	if (!NTFY_URL) return res.status(503).json({ error: "NTFY_URL not configured" });
	const { title } = req.body;
	sendNtfy({ title: "Download complete", body: title || "Torrent finished", tags: "white_check_mark" });
	res.json({ ok: true });
});

router.get("/api/cache", async (_req, res) => {
	try {
		const s = await stat(TMDB_CACHE_PATH);
		res.json({ exists: true, ageDays: Math.floor((Date.now() - s.mtimeMs) / 86_400_000) });
	} catch {
		res.json({ exists: false });
	}
});

router.delete("/api/cache", async (_req, res) => {
	try {
		await unlink(TMDB_CACHE_PATH);
		res.json({ ok: true });
	} catch (e) {
		if (e.code === "ENOENT") return res.json({ ok: true });
		res.status(500).json({ error: e.message });
	}
});

router.get("/api/quality-cache", async (_req, res) => {
	try {
		const s = await stat(QUALITY_CACHE_PATH);
		res.json({ exists: true, ageDays: Math.floor((Date.now() - s.mtimeMs) / 86_400_000) });
	} catch {
		res.json({ exists: false });
	}
});

router.delete("/api/quality-cache", async (_req, res) => {
	try {
		await unlink(QUALITY_CACHE_PATH);
		res.json({ ok: true });
	} catch (e) {
		if (e.code === "ENOENT") return res.json({ ok: true });
		res.status(500).json({ error: e.message });
	}
});

router.get("/api/quality-settings", async (_req, res) => {
	try {
		const data = JSON.parse(await readFile(QUALITY_SETTINGS_PATH, "utf-8"));
		res.json({ ...DEFAULT_QUALITY_SETTINGS, ...data });
	} catch {
		res.json(DEFAULT_QUALITY_SETTINGS);
	}
});

router.post("/api/quality-settings", async (req, res) => {
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

router.delete("/api/quality-file", async (req, res) => {
	const { full_path } = req.body ?? {};
	if (!full_path || typeof full_path !== "string") return res.status(400).json({ error: "full_path required" });
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

export default router;
