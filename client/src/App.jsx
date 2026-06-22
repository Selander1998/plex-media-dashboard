import { useState, useEffect, useRef } from "react";
import MissingMovies from "./components/MissingMovies.jsx";
import MissingSeries from "./components/MissingSeries.jsx";
import Torrents from "./components/Torrents.jsx";
import Watchlist from "./components/Watchlist.jsx";
import Warnings from "./components/Warnings.jsx";
import QualityReport from "./components/QualityReport.jsx";
import Header from "./components/Header.jsx";
import UpdateModal from "./components/UpdateModal.jsx";
import PasteModal from "./components/PasteModal.jsx";
import ToastList from "./components/ToastList.jsx";
import { LangProvider } from "./LangContext.jsx";
import { useToasts } from "./hooks/useToasts.js";
import { useMediaData } from "./hooks/useMediaData.js";
import { useTorrents } from "./hooks/useTorrents.js";
import { useSavePaths } from "./hooks/useSavePaths.js";
import { useUpdate } from "./hooks/useUpdate.js";
import { useMagnet } from "./hooks/useMagnet.js";
import { useSettings } from "./hooks/useSettings.js";

export default function App() {
	return (
		<LangProvider>
			<AppContent />
		</LangProvider>
	);
}

function AppContent() {
	const [tab, setTab] = useState(() => localStorage.getItem("dashboard_tab") || "torrents");
	const [gitHash, setGitHash] = useState(null);

	useEffect(() => { localStorage.setItem("dashboard_tab", tab); }, [tab]);
	useEffect(() => {
		fetch("/api/version")
			.then((r) => r.json())
			.then((d) => setGitHash(d.hash))
			.catch(() => {});
	}, []);

	const [qualityData, setQualityData] = useState(null);
	const [qualityError, setQualityError] = useState(null);
	const [qualityLoading, setQualityLoading] = useState(false);
	const qualityLoadingRef = useRef(false);

	function loadQualityData() {
		if (qualityLoadingRef.current) return;
		qualityLoadingRef.current = true;
		setQualityLoading(true);
		fetch("/api/quality")
			.then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
			.then((d) => { setQualityData(d); setQualityError(null); setQualityLoading(false); })
			.catch((e) => { setQualityError(e.message); setQualityLoading(false); })
			.finally(() => { qualityLoadingRef.current = false; });
	}

	useEffect(() => {
		if ((tab !== "quality" && tab !== "warnings") || qualityData || qualityLoadingRef.current) return;
		loadQualityData();
	}, [tab, qualityData]);

	const { settings, updateSetting } = useSettings();
	const { toasts, history: notifHistory, unread: notifUnread, pushToast, clearUnread: onNotifRead, clearHistory: onNotifClear } = useToasts();

	const { report, reportError, watchlist, watchlistError, blockedTitles, setBlockedTitles, newItems, loadData } =
		useMediaData();

	const { torrents, transfer, torrentCount, torrentLoading, torrentError, torrentStatsByDrive, fetchTorrents } =
		useTorrents(settings.torrentRefreshInterval);

	const { savePaths, tempPaths, savePathIdx, setSavePathIdx, diskSpace, totalDiskCapacity } = useSavePaths();

	const { refreshing, updateStatus, updateLog, updateStats, noTmdbCache, noQualityCache, tick, timestamps, logRef, handleRefresh, handleAbort, handleClose } = useUpdate({
		onSuccess: () => { loadData(); setQualityData(null); loadQualityData(); },
		onError: (msg) => pushToast(msg, true),
	});

	const { addStatus, pasteMode, setPasteMode, pasteRef, handleAddTorrent, handlePasteInput } = useMagnet({
		savePaths,
		savePathIdx,
		onSuccess: (msg) => pushToast(msg),
		onError: (msg) => pushToast(msg, true),
	});

	// Reload all data when the tab becomes visible again
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

	return (
		<div className="min-h-screen flex flex-col overflow-x-hidden">
			{(refreshing || updateStatus !== null) && (
				<UpdateModal
					updateStatus={updateStatus}
					updateLog={updateLog}
					updateStats={updateStats}
					noTmdbCache={noTmdbCache}
					noQualityCache={noQualityCache}
					tick={tick}
					timestamps={timestamps}
					logRef={logRef}
					onClose={handleClose}
					onAbort={handleAbort}
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
				tempPaths={tempPaths}
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
				settings={settings}
				updateSetting={updateSetting}
				notifHistory={notifHistory}
				notifUnread={notifUnread}
				onNotifRead={onNotifRead}
				onNotifClear={onNotifClear}
				qualityData={qualityData}
			/>

			<main className="flex-1 p-3 sm:p-6 max-w-350 w-full mx-auto">
				{tab === "torrents" && (
					<Torrents
						torrents={torrents}
						transfer={transfer}
						loading={torrentLoading}
						error={torrentError}
						onRefresh={fetchTorrents}
						onToast={pushToast}
						report={report}
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
				{tab === "warnings" && <Warnings report={report} error={reportError} loading={!report && !reportError} qualityData={qualityData} onToast={pushToast} />}
				{tab === "quality" && <QualityReport data={qualityData} error={qualityError} loading={qualityLoading} />}
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
			{gitHash && (
				<span className="fixed bottom-2 right-3 text-xs text-white/20 select-none pointer-events-none">{gitHash}</span>
			)}
		</div>
	);
}
