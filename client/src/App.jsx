import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import MissingMovies from "./components/MissingMovies.jsx";
import MissingSeries from "./components/MissingSeries.jsx";
import Torrents from "./components/Torrents.jsx";
import Watchlist, { diskStatus } from "./components/Watchlist.jsx";
import Warnings from "./components/Warnings.jsx";
import { LangProvider, useLang } from "./LangContext.jsx";
import { translations, availableLangs, flagUrls } from "./translations.js";
import { exportStatsCard } from "./exportStats.js";

const TABS = [
	{ id: "torrents", key: "tab_torrents" },
	{ id: "watchlist", key: "tab_watchlist" },
	{ id: "missing_movies", key: "tab_missing_movies" },
	{ id: "missing_series", key: "tab_missing_series" },
	{ id: "warnings", key: "tab_warnings" },
];

function formatBytes(bytes) {
	if (!bytes) return "—";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function App() {
	return (
		<LangProvider>
			<AppContent />
		</LangProvider>
	);
}

function shouldShowUpdateLine(line) {
	const t = line.trim();
	if (/^═+$/.test(t)) return false; // pure decorator ════
	if (/^\s*\[\d+\/\d+\]/.test(t)) return false; // [12/142] progress counters
	if (/^\s*✓ .+\(\d{4}\)(\s+\[.*\])?$/.test(t)) return false; // ✓ Movie Title (2020) collection parts
	if (/^\s*✓ Season \d+: complete/.test(t)) return false; // ✓ Season 03: complete
	return true;
}

function extractUpdateStat(line, prev) {
	let m;
	if ((m = line.match(/(\d[\d,]*) movies? found/i)))
		return { ...prev, movies: parseInt(m[1].replace(/,/g, "")) };
	if ((m = line.match(/(\d[\d,]*) shows? found/i)))
		return { ...prev, shows: parseInt(m[1].replace(/,/g, "")) };
	if ((m = line.match(/✓\s+(\d[\d,]*) unique watchlist/i)))
		return { ...prev, watchlist: parseInt(m[1].replace(/,/g, "")) };
	if ((m = line.match(/Plex has (\d[\d,]*) files? indexed/i)))
		return { ...prev, plexFiles: parseInt(m[1].replace(/,/g, "")) };
	return prev;
}

function updateLogLineClass(line) {
	if (/[✗✕]/.test(line) || /\bMISSING\b/.test(line) || /^ERROR/.test(line.trim()))
		return "text-red-400";
	if (/\[WARN\]/.test(line)) return "text-amber-400";
	if (/[↻]/.test(line)) return "text-indigo-400";
	if (/[✓~]/.test(line)) return "text-emerald-400";
	if (/[A-Z]{3,}.*—/.test(line) || /^Plex Media Checker/.test(line.trim()))
		return "text-slate-100 font-medium";
	if (/^\[\d{2}:\d{2}:\d{2}\]/.test(line.trim())) return "text-slate-300";
	return "text-slate-400";
}

function AppContent() {
	const { lang, switchLang, t } = useLang();
	const locale = lang === "sv" ? "sv-SE" : "en-US";

	const [tab, setTab] = useState("torrents");
	const [report, setReport] = useState(null);
	const [reportError, setReportError] = useState(null);
	const [watchlist, setWatchlist] = useState(null);
	const [watchlistError, setWatchlistError] = useState(null);
	const [torrentCount, setTorrentCount] = useState(null);
	const [torrents, setTorrents] = useState([]);
	const [transfer, setTransfer] = useState(null);
	const [torrentLoading, setTorrentLoading] = useState(true);
	const [torrentError, setTorrentError] = useState(null);
	const [refreshing, setRefreshing] = useState(false);
	const [updateStatus, setUpdateStatus] = useState(null);
	const [newItems, setNewItems] = useState({
		watchlist: new Set(),
		movies: new Set(),
		series: new Set(),
	});
	const prevDataRef = useRef(null);
	const [addStatus, setAddStatus] = useState(null);
	const [updateLog, setUpdateLog] = useState([]);
	const [updateStats, setUpdateStats] = useState({});
	const logRef = useRef(null);
	const [blockedTitles, setBlockedTitles] = useState(new Set());
	const [pasteMode, setPasteMode] = useState(false);
	const pasteRef = useRef(null);
	const [savePaths, setSavePaths] = useState([]);
	const [savePathIdx, setSavePathIdx] = useState(
		() => parseInt(localStorage.getItem("savePathIdx") ?? "0", 10) || 0,
	);
	const [diskSpace, setDiskSpace] = useState(null);
	const [totalDiskCapacity, setTotalDiskCapacity] = useState(null);
	const [torrentStatsByDrive, setTorrentStatsByDrive] = useState({});
	const [toasts, setToasts] = useState([]);
	const toastId = useRef(0);

	function pushToast(name, error = false) {
		const id = ++toastId.current;
		setToasts((prev) => [...prev, { id, name, error }]);
		setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 4000);
	}

	const seriesKey = (m) => `${m.show}|${m.type}|${m.season}|${m.episode ?? 0}`;

	const loadData = useCallback(async () => {
		const [rRes, wRes, bRes] = await Promise.all([
			fetch("/api/report"),
			fetch("/api/watchlist"),
			fetch("/api/blacklist"),
		]);
		const [rData, wData, bData] = await Promise.all([rRes.json(), wRes.json(), bRes.json()]);
		setBlockedTitles(new Set(Array.isArray(bData) ? bData : []));

		if (prevDataRef.current) {
			const prev = prevDataRef.current;
			const prevWL = new Set(prev.watchlist?.items?.map((i) => i.title) ?? []);
			const prevMovies = new Set(
				prev.report?.movies?.missing?.map((m) => m.tmdb_id ?? m.title) ?? [],
			);
			const prevSeries = new Set(prev.report?.series?.missing?.map(seriesKey) ?? []);
			setNewItems({
				watchlist: new Set(
					(wData.items ?? [])
						.filter((i) => !prevWL.has(i.title))
						.filter((i) => diskStatus(i, rData) !== "complete")
						.map((i) => i.title),
				),
				movies: new Set(
					(rData.movies?.missing ?? [])
						.filter((m) => !prevMovies.has(m.tmdb_id ?? m.title))
						.map((m) => m.tmdb_id ?? m.title),
				),
				series: new Set(
					(rData.series?.missing ?? []).filter((m) => !prevSeries.has(seriesKey(m))).map(seriesKey),
				),
			});
		}

		prevDataRef.current = { report: rData, watchlist: wData };
		setReport(rData);
		setReportError(null);
		setWatchlist(wData);
		setWatchlistError(null);
	}, []);

	const fetchTorrents = useCallback(async () => {
		if (document.visibilityState !== "visible") return;
		try {
			const [tRes, xRes] = await Promise.all([fetch("/api/torrents"), fetch("/api/qbit/transfer")]);
			const [tData, xData] = await Promise.all([tRes.json(), xRes.json()]);
			if (!Array.isArray(tData)) throw new Error(tData.detail || tData.error || "Bad response");
			setTorrents(tData);
			setTorrentCount(tData.length);
			const byDrive = {};
			for (const t of tData) {
				const drive = t.save_path?.split("/").filter(Boolean)[1] ?? "unknown";
				byDrive[drive] = (byDrive[drive] ?? 0) + (t.amount_left ?? 0);
			}
			setTorrentStatsByDrive(byDrive);
			setTransfer(xData);
			setTorrentError(null);
		} catch (e) {
			setTorrentError(e.message);
		} finally {
			setTorrentLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchTorrents();
		const id = setInterval(fetchTorrents, 5000);
		return () => clearInterval(id);
	}, [fetchTorrents]);

	useEffect(() => {
		const handleVisibility = () => {
			if (document.visibilityState === "visible") {
				fetchTorrents();
				loadData().catch(() => {});
			}
		};
		document.addEventListener("visibilitychange", handleVisibility);
		return () => document.removeEventListener("visibilitychange", handleVisibility);
	}, [fetchTorrents, loadData]);

	useEffect(() => {
		loadData().catch(() => {
			setReportError(t("error_load_report"));
			setWatchlistError(t("error_load_watchlist"));
		});
	}, [loadData]);

	useEffect(() => {
		fetch("/api/qbit/save-paths")
			.then((r) => r.json())
			.then((d) => Array.isArray(d) && d.length > 0 && setSavePaths(d))
			.catch(() => {});
	}, []);

	useEffect(() => {
		if (!savePaths[savePathIdx]) return;
		const path = encodeURIComponent(savePaths[savePathIdx]);
		fetch(`/api/disk-space?path=${path}`)
			.then((r) => r.json())
			.then((d) => d.available != null && setDiskSpace(d))
			.catch(() => {});
	}, [savePaths, savePathIdx]);

	useEffect(() => {
		if (savePaths.length === 0) return;
		Promise.all(
			savePaths.map((p) =>
				fetch(`/api/disk-space?path=${encodeURIComponent(p)}`)
					.then((r) => r.json())
					.catch(() => null),
			),
		).then((results) => {
			const seen = new Set();
			const total = results.reduce((sum, d) => {
				if (!d || d.total == null) return sum;
				const key = d.dev ?? d.total;
				if (seen.has(key)) return sum;
				seen.add(key);
				return sum + d.total;
			}, 0);
			if (total > 0) setTotalDiskCapacity(total);
		});
	}, [savePaths]);

	useEffect(() => {
		if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
	}, [updateLog]);

	async function submitMagnet(url) {
		if (!url.startsWith("magnet:?")) {
			setAddStatus("invalid");
			pushToast(t("toast_no_magnet"), true);
			setTimeout(() => setAddStatus(null), 2000);
			return;
		}
		setAddStatus("loading");
		const savepath = savePaths[savePathIdx];
		try {
			const res = await fetch("/api/torrents/add", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url, ...(savepath ? { savepath } : {}) }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error();
			setAddStatus("ok");
			pushToast(data.name);
		} catch {
			setAddStatus("error");
			pushToast(t("toast_add_failed"), true);
		} finally {
			setTimeout(() => setAddStatus(null), 2000);
		}
	}

	function handleAddTorrent() {
		if (addStatus === "loading") return;
		setPasteMode(true);
		setTimeout(() => pasteRef.current?.focus(), 30);
	}

	function handlePasteInput(e) {
		e.preventDefault();
		const url = e.clipboardData.getData("text").trim();
		setPasteMode(false);
		submitMagnet(url);
	}

	async function handleRefresh() {
		if (refreshing) return;
		flushSync(() => {
			setRefreshing(true);
			setUpdateStatus(null);
			setUpdateLog([]);
			setUpdateStats({});
		});
		try {
			const res = await fetch("/api/update", { method: "POST" });
			if (!res.ok) throw new Error();

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let success = false;

			outer: while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split("\n\n");
				buffer = parts.pop();
				const newLines = [];
				for (const part of parts) {
					const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
					if (!dataLine) continue;
					const payload = JSON.parse(dataLine.slice(6));
					if (payload.done) {
						success = true;
						break;
					}
					if (payload.error) throw new Error();
					if (payload.line) {
						setUpdateStats((prev) => extractUpdateStat(payload.line, prev));
						if (shouldShowUpdateLine(payload.line)) newLines.push(payload.line);
					}
				}
				if (newLines.length) {
					flushSync(() => setUpdateLog((prev) => [...prev, ...newLines]));
				}
				if (success) break outer;
			}

			if (!success) throw new Error();
			await loadData();
			setUpdateStatus("ok");
		} catch {
			setUpdateStatus("error");
			pushToast(t("toast_update_failed"), true);
		}
		// Modal stays open — user must click Close
	}

	function handleCloseUpdate() {
		setRefreshing(false);
		setUpdateStatus(null);
		setUpdateLog([]);
		setUpdateStats({});
	}

	return (
		<div className="min-h-screen flex flex-col">
			{refreshing && (
				<div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
					<div className="bg-surface border border-border rounded-xl p-6 flex flex-col gap-4 shadow-xl w-175 max-w-full">
						{/* Title row */}
						<div className="flex items-center gap-2.5">
							{updateStatus === "ok" ? (
								<svg
									className="w-5 h-5 text-emerald-400 shrink-0"
									viewBox="0 0 20 20"
									fill="currentColor">
									<path
										fillRule="evenodd"
										d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
										clipRule="evenodd"
									/>
								</svg>
							) : updateStatus === "error" ? (
								<svg
									className="w-5 h-5 text-red-400 shrink-0"
									viewBox="0 0 20 20"
									fill="currentColor">
									<path
										fillRule="evenodd"
										d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
										clipRule="evenodd"
									/>
								</svg>
							) : (
								<svg
									className="w-5 h-5 animate-spin text-indigo-400 shrink-0"
									viewBox="0 0 20 20"
									fill="currentColor">
									<path
										fillRule="evenodd"
										d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
										clipRule="evenodd"
									/>
								</svg>
							)}
							<span
								className={`text-sm font-medium ${updateStatus === "ok" ? "text-emerald-400" : updateStatus === "error" ? "text-red-400" : "text-slate-200"}`}>
								{updateStatus === "ok"
									? t("update_done")
									: updateStatus === "error"
										? t("update_failed")
										: t("updating")}
							</span>
						</div>

						{/* Stats pills */}
						{Object.keys(updateStats).length > 0 && (
							<div className="flex gap-2 flex-wrap">
								{updateStats.movies != null && (
									<span className="px-2.5 py-1 rounded-md bg-indigo-500/15 border border-indigo-800 text-indigo-300 text-xs font-medium">
										{updateStats.movies} {t("update_stat_movies")}
									</span>
								)}
								{updateStats.shows != null && (
									<span className="px-2.5 py-1 rounded-md bg-purple-500/15 border border-purple-800 text-purple-300 text-xs font-medium">
										{updateStats.shows} {t("update_stat_shows")}
									</span>
								)}
								{updateStats.watchlist != null && (
									<span className="px-2.5 py-1 rounded-md bg-teal-500/15 border border-teal-800 text-teal-300 text-xs font-medium">
										{updateStats.watchlist} {t("update_stat_watchlist")}
									</span>
								)}
								{updateStats.plexFiles != null && (
									<span className="px-2.5 py-1 rounded-md bg-slate-500/15 border border-slate-700 text-slate-300 text-xs font-medium">
										{updateStats.plexFiles.toLocaleString()} {t("update_stat_plex")}
									</span>
								)}
							</div>
						)}

						{/* Log */}
						<div
							ref={logRef}
							className="w-full bg-black/40 border border-border rounded-lg px-3 py-2.5 text-[11px] font-mono h-80 overflow-y-auto">
							{updateLog.length === 0 ? (
								<span className="text-slate-600">Waiting for output…</span>
							) : (
								updateLog.map((line, i) => (
									<div
										key={i}
										className={`leading-relaxed whitespace-pre-wrap break-all ${updateLogLineClass(line)}`}>
										{line}
									</div>
								))
							)}
						</div>

						{/* Close button — only when finished */}
						{updateStatus !== null && (
							<div className="flex justify-end">
								<button
									onClick={handleCloseUpdate}
									className={`px-4 py-1.5 rounded-md border text-sm font-medium cursor-pointer transition-colors ${
										updateStatus === "ok"
											? "bg-emerald-500/15 border-emerald-700 text-emerald-300 hover:bg-emerald-500/25"
											: "bg-red-500/15 border-red-800 text-red-400 hover:bg-red-500/25"
									}`}>
									{t("close_btn")}
								</button>
							</div>
						)}
					</div>
				</div>
			)}
			<header className="bg-surface border-b border-border sticky top-0 z-10">
				<div className="flex items-center gap-4 px-6 pt-3">
					<h1 className="text-lg font-bold text-slate-200 tracking-tight">Plex Media Dashboard</h1>
					{report?.generated && (
						<span className="text-xs text-slate-400">
							{t("report")}{" "}
							{new Date(report.generated).toLocaleString(locale, {
								year: "numeric",
								month: "2-digit",
								day: "2-digit",
								hour: "2-digit",
								minute: "2-digit",
							})}
						</span>
					)}
					{report && (report.movies?.total_size || report.series?.total_size) && (
						<div className="ml-auto flex items-center gap-2 text-xs text-slate-400 mr-4">
							{report.movies?.total_size > 0 && (
								<span title={t("stat_movies_on_disk")}>
									<span className="text-slate-500">{t("header_movies")}</span>{" "}
									<span className="text-slate-300">{formatBytes(report.movies.total_size)}</span>
								</span>
							)}
							{report.movies?.total_size > 0 && report.series?.total_size > 0 && (
								<span className="text-slate-600">·</span>
							)}
							{report.series?.total_size > 0 && (
								<span title={t("stat_series_on_disk")}>
									<span className="text-slate-500">{t("header_series")}</span>{" "}
									<span className="text-slate-300">{formatBytes(report.series.total_size)}</span>
								</span>
							)}
							{report.movies?.total_size > 0 && report.series?.total_size > 0 && (
								<>
									<span className="text-slate-600">·</span>
									<span>
										<span className="text-slate-500">{t("header_total")}</span>{" "}
										<span className="text-slate-200 font-medium">
											{formatBytes(
												(report.movies.total_size ?? 0) + (report.series.total_size ?? 0),
											)}
										</span>
										{totalDiskCapacity > 0 && (
											<span className="text-slate-500"> / {formatBytes(totalDiskCapacity)}</span>
										)}
									</span>
								</>
							)}
						</div>
					)}
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-1.5">
							{availableLangs.map((l) => (
								<button
									key={l}
									onClick={() => switchLang(l)}
									title={l.toUpperCase()}
									className={`cursor-pointer transition-opacity rounded-sm ${
										lang === l ? "opacity-100" : "opacity-30 hover:opacity-60"
									}`}>
									<img
										src={flagUrls[translations[l].flag]}
										alt={l}
										className="w-5 h-auto rounded-sm"
									/>
								</button>
							))}
						</div>
						{savePaths.length > 1 && (
							<button
								onClick={() => {
									const next = (savePathIdx + 1) % savePaths.length;
									setSavePathIdx(next);
									localStorage.setItem("savePathIdx", next);
									const name = savePaths[next].split("/").filter(Boolean)[1] ?? savePaths[next];
									pushToast(t("toast_saving_to", { name }));
								}}
								title={`${t("saving_to")} ${savePaths[savePathIdx]}`}
								className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer">
								<svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
									<path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8H6a1 1 0 100 2h8a1 1 0 00.894-.553l1-2a1 1 0 00-.341-1.341zM2 14a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2z" />
								</svg>
								<span>
									{t("saving_to")}{" "}
									{savePaths[savePathIdx].split("/").filter(Boolean)[1] ?? savePaths[savePathIdx]}
								</span>
								{diskSpace != null && (
									<>
										<span className="text-slate-500 mx-0.5">·</span>
										<span>
											{t("free")} {formatBytes(diskSpace.available)}
										</span>
									</>
								)}
								{(() => {
									const drive = savePaths[savePathIdx]?.split("/").filter(Boolean)[1];
									const pending = drive && torrentStatsByDrive[drive];
									return pending > 0 ? (
										<>
											<span className="text-slate-500 mx-0.5">·</span>
											<span className="text-yellow-500">
												{t("remaining")} {formatBytes(pending)}
											</span>
										</>
									) : null;
								})()}
							</button>
						)}
						<button
							onClick={handleAddTorrent}
							disabled={addStatus === "loading"}
							title={t("add_torrent_title")}
							className={`flex items-center gap-1.5 text-xs cursor-pointer transition-colors disabled:opacity-40 ${
								addStatus === "ok"
									? "text-green-400"
									: addStatus === "error" || addStatus === "invalid"
										? "text-red-400"
										: "text-slate-500 hover:text-slate-300"
							}`}>
							{addStatus === "ok" ? (
								<svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
									<path
										fillRule="evenodd"
										d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
										clipRule="evenodd"
									/>
								</svg>
							) : addStatus === "error" || addStatus === "invalid" ? (
								<svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
									<path
										fillRule="evenodd"
										d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
										clipRule="evenodd"
									/>
								</svg>
							) : (
								<svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
									<path
										fillRule="evenodd"
										d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
										clipRule="evenodd"
									/>
								</svg>
							)}
							{addStatus === "ok"
								? t("torrent_added")
								: addStatus === "error" || addStatus === "invalid"
									? t("torrent_failed")
									: t("add_torrent")}
						</button>
						{report && (
							<button
								onClick={() => exportStatsCard(report, locale, t)}
								title={t("export_stats_title")}
								className="cursor-pointer text-slate-500 hover:text-slate-300 transition-colors">
								<svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
									<path
										fillRule="evenodd"
										d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
										clipRule="evenodd"
									/>
								</svg>
							</button>
						)}
						<button
							onClick={handleRefresh}
							disabled={refreshing}
							title={t("refresh_title")}
							className={`cursor-pointer transition-colors disabled:opacity-40 ${
								updateStatus === "ok"
									? "text-green-400"
									: updateStatus === "error"
										? "text-red-400"
										: "text-slate-500 hover:text-slate-300"
							}`}>
							<svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
								<path
									fillRule="evenodd"
									d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
									clipRule="evenodd"
								/>
							</svg>
						</button>
					</div>
				</div>
				<nav className="flex px-6 mt-2">
					{TABS.map((tabDef) => (
						<button
							key={tabDef.id}
							className={`flex items-center gap-1.5 px-4 py-2 border-b-2 text-sm cursor-pointer transition-colors bg-transparent ${
								tab === tabDef.id
									? "text-slate-200 border-indigo-500"
									: "text-slate-400 border-transparent hover:text-slate-200"
							}`}
							onClick={() => setTab(tabDef.id)}>
							{t(tabDef.key)}
							{tabDef.id === "torrents" && torrentCount !== null && (
								<span
									className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${
										tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"
									}`}>
									{torrentCount}
								</span>
							)}
							{tabDef.id === "missing_movies" && report && (
								<span
									className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${
										tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"
									}`}>
									{report?.movies?.missing?.filter((m) => !blockedTitles.has(m.title.toLowerCase()))
										.length ?? 0}
								</span>
							)}
							{tabDef.id === "missing_movies" && newItems.movies.size > 0 && (
								<span className="text-[11px] px-1.5 py-px rounded-full text-center bg-teal-900 text-teal-400">
									+{newItems.movies.size}
								</span>
							)}
							{tabDef.id === "watchlist" && watchlist && (
								<span
									className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${
										tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"
									}`}>
									{watchlist?.items?.filter(
										(i) =>
											!blockedTitles.has(i.title.toLowerCase()) &&
											diskStatus(i, report) !== "complete",
									).length ?? 0}
								</span>
							)}
							{tabDef.id === "watchlist" && newItems.watchlist.size > 0 && (
								<span className="text-[11px] px-1.5 py-px rounded-full text-center bg-teal-900 text-teal-400">
									+{newItems.watchlist.size}
								</span>
							)}
							{tabDef.id === "missing_series" && report && (
								<span
									className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${
										tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"
									}`}>
									{report?.series?.missing?.length ?? 0}
								</span>
							)}
							{tabDef.id === "missing_series" && newItems.series.size > 0 && (
								<span className="text-[11px] px-1.5 py-px rounded-full text-center bg-teal-900 text-teal-400">
									+{newItems.series.size}
								</span>
							)}
							{tabDef.id === "warnings" &&
								report &&
								(() => {
									const count =
										(report.movies?.multiple_videos?.length ?? 0) +
										(report.movies?.unneeded_files?.length ?? 0) +
										(report.movies?.not_found_on_tmdb?.length ?? 0) +
										(report.series?.multiple_videos?.length ?? 0) +
										(report.series?.unneeded_files?.length ?? 0) +
										(report.series?.not_found_on_tmdb?.length ?? 0) +
										(report.plex_sync?.not_indexed?.length ?? 0);
									return count > 0 ? (
										<span
											className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"}`}>
											{count}
										</span>
									) : null;
								})()}
						</button>
					))}
				</nav>
			</header>

			<main className="flex-1 p-6 max-w-350 w-full mx-auto">
				{tab === "torrents" && (
					<Torrents
						torrents={torrents}
						transfer={transfer}
						loading={torrentLoading}
						error={torrentError}
						onRefresh={fetchTorrents}
						onToast={pushToast}
					/>
				)}
				{tab === "watchlist" && (
					<Watchlist
						data={watchlist}
						error={watchlistError}
						loading={!watchlist && !watchlistError}
						report={report}
						newTitles={newItems.watchlist}
						blockedTitles={blockedTitles}
						onBlock={(title) => setBlockedTitles((prev) => new Set([...prev, title.toLowerCase()]))}
						onToast={pushToast}
					/>
				)}
				{tab === "missing_movies" && (
					<MissingMovies
						data={report?.movies}
						error={reportError}
						loading={!report && !reportError}
						newKeys={newItems.movies}
						torrents={torrents}
						blockedTitles={blockedTitles}
						onBlock={(title) => setBlockedTitles((prev) => new Set([...prev, title.toLowerCase()]))}
						onToast={pushToast}
					/>
				)}
				{tab === "missing_series" && (
					<MissingSeries
						data={report?.series}
						error={reportError}
						loading={!report && !reportError}
						newKeys={newItems.series}
						onToast={pushToast}
					/>
				)}
				{tab === "warnings" && (
					<Warnings report={report} error={reportError} loading={!report && !reportError} />
				)}
			</main>

			{pasteMode && (
				<div
					className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
					onClick={() => setPasteMode(false)}>
					<div
						className="bg-surface border border-border rounded-xl px-8 py-6 flex flex-col items-center gap-3 shadow-xl"
						onClick={(e) => e.stopPropagation()}>
						<span className="text-slate-300 text-sm font-medium">{t("paste_magnet")}</span>
						{savePaths.length > 0 && (
							<span className="text-slate-500 text-xs">
								{t("paste_saving_to")}{" "}
								{savePaths[savePathIdx].split("/").filter(Boolean)[1] ?? savePaths[savePathIdx]}
							</span>
						)}
						<span className="text-slate-500 text-xs">{t("paste_hint")}</span>
						<input
							ref={pasteRef}
							type="text"
							onPaste={handlePasteInput}
							onKeyDown={(e) => e.key === "Escape" && setPasteMode(false)}
							className="opacity-0 absolute w-0 h-0"
						/>
					</div>
				</div>
			)}

			{toasts.length > 0 && (
				<div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end">
					{toasts.map((toast) => (
						<div
							key={toast.id}
							className={`flex items-center gap-2.5 rounded-lg px-4 py-3 shadow-xl text-sm animate-fade-in border ${toast.error ? "bg-red-950/60 border-red-800" : "bg-surface border-border"}`}>
							{toast.error ? (
								<svg
									className="w-4 h-4 shrink-0 text-red-400"
									viewBox="0 0 20 20"
									fill="currentColor">
									<path
										fillRule="evenodd"
										d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
										clipRule="evenodd"
									/>
								</svg>
							) : (
								<svg
									className="w-4 h-4 shrink-0 text-green-400"
									viewBox="0 0 20 20"
									fill="currentColor">
									<path
										fillRule="evenodd"
										d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
										clipRule="evenodd"
									/>
								</svg>
							)}
							<span className="text-slate-200">{toast.name ?? t("toast_torrent_added")}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
