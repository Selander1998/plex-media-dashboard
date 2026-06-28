import { Router } from "express";
import { spawn } from "child_process";
import { UPDATE_SCRIPT } from "../lib/config.js";
import { refreshPlexLibraries } from "../lib/plex.js";

const router = Router();
const updateState = { running: false, child: null, aborted: false };

router.post("/api/update", (req, res) => {
	if (updateState.running) return res.status(409).json({ error: "Update already running" });
	updateState.running = true;
	updateState.aborted = false;

	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.flushHeaders();
	res.socket?.setNoDelay(true);

	let clientConnected = true;
	req.on("close", () => {
		clientConnected = false;
		updateState.running = false;
		updateState.child = null;
	});
	const send = (payload) => {
		if (clientConnected) res.write(`data: ${JSON.stringify(payload)}\n\n`);
	};

	const child = spawn("bash", [UPDATE_SCRIPT], {
		timeout: 3_600_000,
		env: { ...process.env, PYTHONUNBUFFERED: "1" },
		detached: true,
	});
	updateState.child = child;
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
		updateState.running = false;
		updateState.child = null;
		try {
			if (tail.trim()) send({ line: tail.trim() });
			if (updateState.aborted) {
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
		updateState.running = false;
		updateState.child = null;
		console.error("[update] spawn error:", err.message);
		send({ error: true });
		res.end();
	});
});

router.post("/api/update/abort", (req, res) => {
	if (!updateState.running || !updateState.child) return res.status(409).json({ error: "No update running" });
	updateState.aborted = true;
	try {
		process.kill(-updateState.child.pid, "SIGTERM");
	} catch {
		updateState.child.kill("SIGTERM");
	}
	res.json({ ok: true });
});

export default router;
