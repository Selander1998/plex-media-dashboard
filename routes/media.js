import { Router } from "express";
import { readFile, stat, writeFile } from "fs/promises";
import { REPORT_PATH, WATCHLIST_PATH, QUALITY_REPORT_PATH, PLEX_BLACKLIST_PATH } from "../lib/config.js";

const router = Router();

router.get("/api/report", async (req, res) => {
	try {
		const [data, s] = await Promise.all([readFile(REPORT_PATH, "utf-8"), stat(REPORT_PATH)]);
		res.json({ ...JSON.parse(data), _mtime: s.mtimeMs });
	} catch (err) {
		res.status(500).json({ error: "Failed to read report", detail: err.message });
	}
});

router.get("/api/report/mtime", async (_req, res) => {
	try {
		const s = await stat(REPORT_PATH);
		res.json({ mtime: s.mtimeMs });
	} catch {
		res.json({ mtime: 0 });
	}
});

router.get("/api/quality", async (req, res) => {
	try {
		const [data, s] = await Promise.all([readFile(QUALITY_REPORT_PATH, "utf-8"), stat(QUALITY_REPORT_PATH)]);
		res.json({ ...JSON.parse(data), mtime: s.mtimeMs });
	} catch (err) {
		res.status(404).json({ error: "Quality report not found — run update first", detail: err.message });
	}
});

router.get("/api/quality/mtime", async (_req, res) => {
	try {
		const s = await stat(QUALITY_REPORT_PATH);
		res.json({ mtime: s.mtimeMs });
	} catch {
		res.json({ mtime: 0 });
	}
});

router.get("/api/watchlist", async (req, res) => {
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

router.get("/api/blacklist", async (req, res) => {
	try {
		const bl = await readPlexBlacklist();
		res.json(bl.watchlist);
	} catch (err) {
		res.status(500).json({ error: "Failed to read blacklist", detail: err.message });
	}
});

router.post("/api/blacklist", async (req, res) => {
	const { title } = req.body;
	if (!title || typeof title !== "string") return res.status(400).json({ error: "title required" });
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

// Weather — Open-Meteo, cached 30 min
let weatherCache = { data: null, fetchedAt: 0, lat: null, lon: null };

router.get("/api/weather", async (req, res) => {
	const lat = parseFloat(req.query.lat);
	const lon = parseFloat(req.query.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: "lat and lon required" });
	const age = Date.now() - weatherCache.fetchedAt;
	if (weatherCache.data && age < 30 * 60 * 1000 && weatherCache.lat === lat && weatherCache.lon === lon) {
		return res.json(weatherCache.data);
	}
	try {
		const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&wind_speed_unit=ms&timezone=Europe%2FStockholm`;
		const r = await fetch(url);
		if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
		const body = await r.json();
		const payload = {
			temp: body.current.temperature_2m,
			code: body.current.weather_code,
			wind: body.current.wind_speed_10m,
			time: body.current.time,
		};
		weatherCache = { data: payload, fetchedAt: Date.now(), lat, lon };
		res.json(payload);
	} catch (err) {
		res.status(502).json({ error: err.message });
	}
});

export default router;
