// Media Dashboard — Express backend
// Required env vars: QBIT_URL, QBIT_USERNAME, QBIT_PASSWORD, REPORT_PATH, WATCHLIST_PATH
// Optional env vars: TMDB_API_KEY, NTFY_URL, MOVIES_ROOTS (colon-separated), SERIES_ROOTS (colon-separated),
//   WEATHER_LAT, WEATHER_LON, DASHBOARD_TOKEN, PORT (default 3000)
// Domains: qBittorrent proxy & auto-processing, library rename planning/execution,
//   quality checking, report serving, Plex sync, NTFY notifications, weather

import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { DASHBOARD_TOKEN, PORT } from "./lib/config.js";
import torrentRoutes from "./routes/torrents.js";
import mediaRoutes from "./routes/media.js";
import updateRoutes from "./routes/update.js";
import libraryRoutes from "./routes/library.js";
import settingsRoutes from "./routes/settings.js";
import { pollTorrents } from "./lib/torrent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

app.use(torrentRoutes);
app.use(mediaRoutes);
app.use(updateRoutes);
app.use(libraryRoutes);
app.use(settingsRoutes);

const clientDist = join(__dirname, "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
	if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
	res.sendFile(join(clientDist, "index.html"));
});

pollTorrents();
setInterval(pollTorrents, 30_000);

app.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
	if (!DASHBOARD_TOKEN) {
		console.warn("⚠️  DASHBOARD_TOKEN is not set — the API is unauthenticated. Set it in .env if this server is reachable outside your LAN.");
	}
});
