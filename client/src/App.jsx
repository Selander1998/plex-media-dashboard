import { useState, useEffect } from "react";
import MissingMovies from "./components/MissingMovies.jsx";
import MissingSeries from "./components/MissingSeries.jsx";
import Torrents from "./components/Torrents.jsx";
import Watchlist from "./components/Watchlist.jsx";
import Warnings from "./components/Warnings.jsx";
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

export default function App() {
	return (
		<LangProvider>
			<AppContent />
		</LangProvider>
	);
}

function AppContent() {
	const [tab, setTab] = useState("torrents");
	const [gitHash, setGitHash] = useState(null);
	useEffect(() => {
		fetch("/api/version")
			.then((r) => r.json())
			.then((d) => setGitHash(d.hash))
			.catch(() => {});
	}, []);

	const { toasts, pushToast } = useToasts();

	const { report, reportError, watchlist, watchlistError, blockedTitles, setBlockedTitles, newItems, loadData } =
		useMediaData();

	const { torrents, transfer, torrentCount, torrentLoading, torrentError, torrentStatsByDrive, fetchTorrents } =
		useTorrents();

	const { savePaths, tempPaths, savePathIdx, setSavePathIdx, diskSpace, totalDiskCapacity } = useSavePaths();

	const { refreshing, updateStatus, updateLog, updateStats, noCache, tick, timestamps, logRef, handleRefresh, handleClose } = useUpdate({
		onSuccess: loadData,
		onError: (msg) => pushToast(msg, true),
	});

	const { addStatus, pasteMode, setPasteMode, pasteRef, handleAddTorrent, handlePasteInput } = useMagnet({
		savePaths,
		savePathIdx,
		onSuccess: (name) => pushToast(name),
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
			{refreshing && (
				<UpdateModal
					updateStatus={updateStatus}
					updateLog={updateLog}
					updateStats={updateStats}
					noCache={noCache}
					tick={tick}
					timestamps={timestamps}
					logRef={logRef}
					onClose={handleClose}
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
			{gitHash && (
				<span className="fixed bottom-2 right-3 text-xs text-white/20 select-none pointer-events-none">{gitHash}</span>
			)}
		</div>
	);
}
