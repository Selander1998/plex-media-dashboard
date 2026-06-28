import { Router } from "express";
import { readFile, writeFile, unlink } from "fs/promises";
import { resolve } from "path";
import { RENAME_PLAN_PATH, REPORT_PATH, MOVIES_ROOTS, SERIES_ROOTS } from "../lib/config.js";
import { buildRenamePlan, applyRenamePlan } from "../lib/rename.js";
import { refreshPlexLibraries } from "../lib/plex.js";

const router = Router();

router.get("/api/library/renames", async (req, res) => {
	try {
		const data = JSON.parse(await readFile(RENAME_PLAN_PATH, "utf-8"));
		res.json(data);
	} catch {
		res.json(null);
	}
});

router.post("/api/library/renames/scan", async (req, res) => {
	try {
		const plan = await buildRenamePlan();
		await writeFile(RENAME_PLAN_PATH, JSON.stringify(plan));
		res.json(plan);
	} catch (err) {
		res.status(500).json({ error: "Scan failed", detail: err.message });
	}
});

router.post("/api/library/renames/apply", async (req, res) => {
	try {
		const { scope = "all", showFolder } = req.body ?? {};
		const plan = await buildRenamePlan();
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

router.delete("/api/library/file", async (req, res) => {
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

		try {
			const report = JSON.parse(await readFile(REPORT_PATH, "utf-8"));
			let dirty = false;
			for (const section of ["movies", "series"]) {
				if (!report[section]?.multiple_videos) continue;
				const before = report[section].multiple_videos.length;
				report[section].multiple_videos = report[section].multiple_videos
					.map((entry) => ({ ...entry, files: entry.files.filter((f) => resolve(f.full_path) !== abs) }))
					.filter((entry) => entry.files.length > 1);
				if (report[section].multiple_videos.length !== before) dirty = true;
			}
			if (dirty) await writeFile(REPORT_PATH, JSON.stringify(report));
		} catch { /* report missing or malformed */ }

		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

export default router;
