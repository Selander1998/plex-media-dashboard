# plex-media-dashboard

NOTE: Frontend is basically just written by Claude, wanted to see what it could do. Pure vibe-coding, just overlooked the major changes that was made.
The Python-scripts included are things i used to manually run previous to them being implemented into this dashboard.
Also, this is very much intended for my personal setup and usecase.

This is a self-hosted dashboard for managing a personal media library. Tracks movies and TV shows on disk, surfaces missing content, monitors qBittorrent downloads, and cross-checks Plex indexing — all from a single web UI.

![Stack](https://img.shields.io/badge/Node.js-20+-green) ![Stack](https://img.shields.io/badge/Python-3.10+-blue) ![Stack](https://img.shields.io/badge/React-19-61dafb)

---

## Features

- **Torrents** — live qBittorrent monitor with pause/resume/delete/rename, speed display, auto-pause on completion, and magnet paste dialog
- **Missing Movies** — lists movies present in your watchlist/collections but absent from disk
- **Missing Series** — lists missing seasons and episodes per show, grouped and collapsible
- **Watchlist** — Plex RSS watchlist synced against your library; hides anything already on disk
- **Warnings** — flags duplicate video files, unneeded extra files, and content not yet indexed by Plex
- **Stats card** — exportable PNG with collection stats (counts, storage, binge time, and more)
- **Swedish / English UI** — full i18n, language toggle in the header
- **Refresh button** — triggers `update.sh` from the UI and reloads the report

---

## Requirements

- Node.js 20+
- Python 3.10+
- qBittorrent with Web UI enabled
- TMDB API key (free — [themoviedb.org](https://www.themoviedb.org/settings/api))
- Plex Media Server (optional — enables library refresh and Plex sync warnings)

---

## Setup

### 1. Clone and install dependencies

```bash
git clone git@github.com:Selander1998/media-dashboard.git
cd media-dashboard
npm install
npm install --prefix client
pip install -r scripts/requirements.txt
```

### 2. Configure the server

Copy the example and fill in your values:

```bash
cp .env.example .env
```

| Variable             | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `QBIT_URL`           | qBittorrent Web UI URL, e.g. `http://192.168.1.10:8080`                  |
| `QBIT_USERNAME`      | qBittorrent username                                                     |
| `QBIT_PASSWORD`      | qBittorrent password                                                     |
| `PORT`               | Port the dashboard runs on (default `3000`)                              |
| `TORRENT_SAVE_PATHS` | Comma-separated paths qBittorrent saves to — used for disk space display |
| `REPORT_PATH`        | Absolute path to `scripts/report.json`                                   |
| `WATCHLIST_PATH`     | Absolute path to `scripts/watchlist.json`                                |
| `BLACKLIST_PATH`     | Absolute path to `scripts/blacklist.txt`                                 |
| `PLEX_URL`           | Plex server URL, e.g. `http://192.168.1.10:32400` (optional)             |
| `PLEX_TOKEN`         | Plex auth token (optional)                                               |
| `DASHBOARD_TOKEN`    | If set, enables HTTP Basic Auth on the dashboard (optional)              |

> **Exposing the dashboard outside your LAN?** Set `DASHBOARD_TOKEN` to a strong password. The browser will prompt once per session and cache the credentials automatically — no login page required.

### 3. Configure the scripts

```bash
cp scripts/.env.example scripts/.env
```

| Variable       | Description                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------- |
| `TMDB_API_KEY` | TMDB API key for movie/series metadata                                                       |
| `MOVIES_ROOTS` | Comma-separated absolute paths to movie library roots                                        |
| `SERIES_ROOTS` | Comma-separated absolute paths to TV library roots                                           |
| `RSS_URLS`     | Comma-separated Plex RSS watchlist URLs (found in Plex account settings under **Watchlist**) |

> `PLEX_URL` and `PLEX_TOKEN` from the root `.env` are also read by the scripts automatically.

### 4. Build the frontend

```bash
npm run build
```

### 5. Run the initial data fetch

```bash
bash scripts/update.sh
```

This generates `scripts/report.json` and `scripts/watchlist.json`, which the server reads.

---

## Running

### Development (hot reload)

```bash
npm run dev
```

Starts the Express server with `--watch` and the Vite dev server concurrently. The frontend proxies API requests to the server automatically.

### Production with PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command to enable autostart
```

The app will be available at `http://localhost:3000` (or whichever `PORT` you set).

---

## Keeping data fresh

`scripts/update.sh` runs both Python scripts and writes fresh JSON files:

```bash
bash scripts/update.sh
```

You can hit the **refresh button** in the dashboard header to trigger this from the UI, or schedule it with cron:

```cron
0 * * * * /absolute/path/to/media-dashboard/scripts/update.sh >> /absolute/path/to/media-dashboard/scripts/update.log 2>&1
```

---

## Adding a language

1. Copy `client/src/locales/en.json` to a new file named after your language code (e.g. `de.json`), translate the values, and set the `"flag"` field to the ISO 3166-1 alpha-2 country code (e.g. `"de"`).

2. Add a matching flag SVG named after the country code (e.g. `de.svg`) to `client/src/locales/`. Flag SVGs in 4:3 format are available at [flagicons.lipis.dev](https://flagicons.lipis.dev).

3. Run `npm run build` and restart the server.

The new language will appear in the header toggle automatically. The language choice is persisted in `localStorage`.

---

r

## Project structure

```
media-dashboard/
├── server.js              # Express API server
├── ecosystem.config.cjs   # PM2 config
├── .env.example           # Server environment template
├── client/                # React frontend (Vite + Tailwind)
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── Torrents.jsx
│       │   ├── Watchlist.jsx
│       │   ├── MissingMovies.jsx
│       │   ├── MissingSeries.jsx
│       │   └── Warnings.jsx
│       ├── exportStats.js     # PNG stats card generator
│       ├── translations.js    # en/sv strings
│       └── LangContext.jsx    # i18n context
└── scripts/
    ├── update.sh          # Runs both scripts below
    ├── plex_checker.py    # Scans library, checks Plex, outputs report.json
    ├── format.py          # Fetches watchlist from TMDB/Plex RSS, outputs watchlist.json
    ├── .env.example       # Scripts environment template
    └── blacklist.txt      # Titles excluded from missing-content reports
```

---

## Finding your Plex token

1. Open Plex Web, play any item
2. Open browser devtools → Network tab
3. Look for any request to your Plex server — the token is the `X-Plex-Token` query parameter

Or follow the [official guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

## Finding your Plex RSS watchlist URL

Plex account settings → **Watchlist** → **RSS Feed** — copy the URL and paste it into `RSS_URLS` in `scripts/.env`.
