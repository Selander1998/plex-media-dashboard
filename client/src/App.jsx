import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import MissingMovies from "./components/MissingMovies.jsx";
import MissingSeries from "./components/MissingSeries.jsx";
import Torrents from "./components/Torrents.jsx";
import Watchlist, { diskStatus } from "./components/Watchlist.jsx";
import Warnings from "./components/Warnings.jsx";
import Header from "./components/Header.jsx";
import UpdateModal from "./components/UpdateModal.jsx";
import PasteModal from "./components/PasteModal.jsx";
import ToastList from "./components/ToastList.jsx";
import { LangProvider, useLang } from "./LangContext.jsx";
import { shouldShowUpdateLine, extractUpdateStat } from "./utils/updateLog.js";

export default function App() {
	return (
		<LangProvider>
			<AppContent />
		</LangProvider>
	);
}

const seriesKey = (m) => `${m.show}|${m.type}|${m.season}|${m.episode ?? 0}`;

function AppContent() {
	const { t } = useLang();

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
	const [savePathIdx, setSavePathIdx] = useState(() => parseInt(localStorage.getItem("savePathIdx") ?? "0", 10) || 0);
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

	// ── Data fetching ────────────────────────────────────────────────────────

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
			const prevMovies = new Set(prev.report?.movies?.missing?.map((m) => m.tmdb_id ?? m.title) ?? []);
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
				series: new Set((rData.series?.missing ?? []).filter((m) => !prevSeries.has(seriesKey(m))).map(seriesKey)),
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
			for (const torrent of tData) {
				const drive = torrent.save_path?.split("/").filter(Boolean)[1] ?? "unknown";
				byDrive[drive] = (byDrive[drive] ?? 0) + (torrent.amount_left ?? 0);
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

	// ── Effects ──────────────────────────────────────────────────────────────

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

	// ── Handlers ─────────────────────────────────────────────────────────────

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

	// ── Render ───────────────────────────────────────────────────────────────

	return (
		<div className="min-h-screen flex flex-col">
			{refreshing && (
				<UpdateModal
					updateStatus={updateStatus}
					updateLog={updateLog}
					updateStats={updateStats}
					logRef={logRef}
					onClose={handleCloseUpdate}
				/>
			)}

			<Header
				report={report}
				tab={tab}
				setTab={setTab}
				torrentCount={torrentCount}
				newItems={newItems}
				watchlist={watchlist}
				blockedTitles={blockedTitles}
				savePaths={savePaths}
				savePathIdx={savePathIdx}
				setSavePathIdx={setSavePathIdx}
				diskSpace={diskSpace}
				torrentStatsByDrive={torrentStatsByDrive}
				totalDiskCapacity={totalDiskCapacity}
				addStatus={addStatus}
				onAddTorrent={handleAddTorrent}
				refreshing={refreshing}
				updateStatus={updateStatus}
				onRefresh={handleRefresh}
				onToast={pushToast}
			/>

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
				{tab === "warnings" && <Warnings report={report} error={reportError} loading={!report && !reportError} />}
			</main>

			{pasteMode && (
				<PasteModal
					savePaths={savePaths}
					savePathIdx={savePathIdx}
					pasteRef={pasteRef}
					onPaste={handlePasteInput}
					onClose={() => setPasteMode(false)}
				/>
			)}

			<ToastList toasts={toasts} />
		</div>
	);
}
