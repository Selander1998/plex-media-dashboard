import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

export const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

export const QBIT_URL = process.env.QBIT_URL || "http://localhost:8080";
export const QBIT_USERNAME = process.env.QBIT_USERNAME || "admin";
export const QBIT_PASSWORD = process.env.QBIT_PASSWORD || "adminadmin";

export const REPORT_PATH = process.env.REPORT_PATH || join(ROOT_DIR, "scripts", "report.json");
export const WATCHLIST_PATH = process.env.WATCHLIST_PATH || join(ROOT_DIR, "scripts", "watchlist.json");
// All data files live in the same directory as REPORT_PATH (set REPORT_PATH to change the whole data dir)
export const QUALITY_REPORT_PATH = join(dirname(REPORT_PATH), "quality_report.json");
export const QUALITY_CACHE_PATH = join(dirname(REPORT_PATH), "quality_cache.json");
export const QUALITY_SETTINGS_PATH = join(dirname(REPORT_PATH), "quality_settings.json");
export const SERVER_SETTINGS_PATH = join(dirname(REPORT_PATH), "server_settings.json");
export const RENAME_PLAN_PATH = join(dirname(REPORT_PATH), "rename_plan.json");
export const UNLIMITED_STATE_PATH = join(dirname(REPORT_PATH), "unlimited_state.json");
export const QUALITY_BLOCKS_PATH = join(dirname(REPORT_PATH), "quality_blocks.json");
export const PLEX_BLACKLIST_PATH = join(dirname(REPORT_PATH), "plex_blacklist.json");
export const TMDB_CACHE_PATH = join(dirname(REPORT_PATH), "plex_checker_cache.json");

export const PORT = process.env.PORT || 3000;
export const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || "";
export const TORRENT_SAVE_PATHS = (process.env.TORRENT_SAVE_PATHS || "")
	.split(",").map((p) => p.trim()).filter(Boolean);
export const TORRENT_TEMP_SUBDIR = process.env.TORRENT_TEMP_SUBDIR || "";
export const PLEX_URL = process.env.PLEX_URL || "";
export const PLEX_TOKEN = process.env.PLEX_TOKEN || "";
export const NTFY_URL = process.env.NTFY_URL || "";
export const NTFY_USER = process.env.NTFY_USER || "";
export const NTFY_PASS = process.env.NTFY_PASS || "";
export const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
export const MOVIES_ROOTS = (process.env.MOVIES_ROOTS || "").split(",").map((p) => p.trim()).filter(Boolean);
export const SERIES_ROOTS = (process.env.SERIES_ROOTS || "").split(",").map((p) => p.trim()).filter(Boolean);
export const UPDATE_SCRIPT = join(ROOT_DIR, "scripts", "update.sh");

export const GIT_HASH = (() => {
	try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); }
	catch { return "unknown"; }
})();
