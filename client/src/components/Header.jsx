import { useState, useRef, useEffect } from "react";
import { useLang } from "../LangContext.jsx";
import { translations, availableLangs, flagUrls } from "../translations.js";
import { diskStatus } from "./Watchlist.jsx";
import { formatBytes } from "../utils/format.js";
import SettingsPanel from "./SettingsPanel.jsx";
import NotificationsPanel from "./NotificationsPanel.jsx";

const TABS = [
	{ id: "torrents", key: "tab_torrents" },
	{ id: "watchlist", key: "tab_watchlist" },
	{ id: "missing_movies", key: "tab_missing_movies" },
	{ id: "missing_series", key: "tab_missing_series" },
	{ id: "warnings", key: "tab_warnings" },
	{ id: "quality", key: "tab_quality" },
	{ id: "library", key: "tab_library" },
];

export default function Header({
	report,
	tab,
	setTab,
	torrentCount,
	newItems,
	watchlist,
	blockedTitles,
	savePaths,
	tempPaths,
	savePathIdx,
	setSavePathIdx,
	diskSpace,
	torrentStatsByDrive,
	totalDiskCapacity,
	addStatus,
	onAddTorrent,
	refreshing,
	updateStatus,
	onRefresh,
	onToast,
	settings,
	updateSetting,
	notifHistory,
	notifUnread,
	onNotifRead,
	onNotifClear,
	qualityData,
	renameData,
}) {
	const { lang, switchLang, t } = useLang();
	const locale = lang === "sv" ? "sv-SE" : "en-US";
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [notifsOpen, setNotifsOpen] = useState(false);
	const settingsRef = useRef(null);
	const notifsRef = useRef(null);

	useEffect(() => {
		function handler(e) {
			if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false);
			if (notifsRef.current && !notifsRef.current.contains(e.target)) setNotifsOpen(false);
		}
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

const totalSize = (report?.movies?.total_size ?? 0) + (report?.series?.total_size ?? 0);
	const hasStorage = report && (report.movies?.total_size || report.series?.total_size);

	return (
		<header className="bg-surface border-b border-border sticky top-0 z-10">

			{/* ── Main row ── */}
			<div className="flex items-center gap-2 sm:gap-4 px-3 sm:px-6 pt-3">
				<h1 className="text-base sm:text-lg font-bold text-slate-200 tracking-tight shrink-0">Plex Media Dashboard</h1>

				{/* Report date — sm+ only */}
				{report?.generated && (
					<span className="hidden sm:inline text-xs text-slate-400 shrink-0">
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

				{/* Storage stats — md+ only, ml-auto pushes actions to the right */}
				{hasStorage && (
					<div className="hidden md:flex ml-auto items-center gap-2 text-xs text-slate-400 mr-4">
						{report.movies?.total_size > 0 && (
							<span title={t("stat_movies_on_disk")}>
								<span className="text-slate-500">{t("header_movies")}</span>{" "}
								<span className="text-slate-300">{formatBytes(report.movies.total_size)}</span>
							</span>
						)}
						{report.movies?.total_size > 0 && report.series?.total_size > 0 && <span className="text-slate-600">·</span>}
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
									<span className="text-slate-200 font-medium">{formatBytes(totalSize)}</span>
									{totalDiskCapacity > 0 && <span className="text-slate-500"> / {formatBytes(totalDiskCapacity)}</span>}
								</span>
							</>
						)}
					</div>
				)}

				{/* Action buttons — ml-auto on mobile (no storage row), md:ml-0 */}
				<div className="flex items-center gap-2 sm:gap-3 ml-auto md:ml-0">

					{/* Save path + disk space */}
					{savePaths.length > 1 && (
						<button
							onClick={() => {
								const next = (savePathIdx + 1) % savePaths.length;
								setSavePathIdx(next);
								localStorage.setItem("savePathIdx", next);
								const name = savePaths[next].split("/").filter(Boolean)[1] ?? savePaths[next];
								onToast(t("toast_saving_to", { name }));
								const temp = tempPaths[next];
								if (tempPaths.length > 0) {
									fetch("/api/qbit/temp-path", {
										method: "POST",
										headers: { "Content-Type": "application/json" },
										body: JSON.stringify({ path: temp || null }),
									});
								}
							}}
							title={`${t("saving_to")} ${savePaths[savePathIdx]}`}
							className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
						>
							<svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
								<path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8H6a1 1 0 100 2h8a1 1 0 00.894-.553l1-2a1 1 0 00-.341-1.341zM2 14a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2z" />
							</svg>
							<span className="hidden sm:inline">
								{t("saving_to")} {savePaths[savePathIdx].split("/").filter(Boolean)[1] ?? savePaths[savePathIdx]}
							</span>
							{diskSpace != null && (
								<span className="hidden sm:inline">
									<span className="text-slate-500 mx-0.5">·</span>
									{t("free")} {formatBytes(diskSpace.available)}
								</span>
							)}
							{(() => {
								const drive = savePaths[savePathIdx]?.split("/").filter(Boolean)[1];
								const pending = drive && torrentStatsByDrive[drive];
								return pending > 0 ? (
									<>
										<span className="text-slate-500 mx-0.5 hidden sm:inline">·</span>
										<span className="text-yellow-500 hidden sm:inline">
											{t("remaining")} {formatBytes(pending)}
										</span>
									</>
								) : null;
							})()}
						</button>
					)}

					{/* Add torrent */}
					<button
						onClick={onAddTorrent}
						disabled={addStatus === "loading"}
						title={t("add_torrent_title")}
						className={`flex items-center gap-1.5 text-xs cursor-pointer transition-colors disabled:opacity-40 ${
							addStatus === "ok"
								? "text-green-400"
								: addStatus === "error" || addStatus === "invalid"
									? "text-red-400"
									: "text-slate-500 hover:text-slate-300"
						}`}
					>
						{addStatus === "ok" ? (
							<svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
								<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
							</svg>
						) : addStatus === "error" || addStatus === "invalid" ? (
							<svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
								<path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
							</svg>
						) : (
							<svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
								<path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
							</svg>
						)}
						<span className="hidden sm:inline">
							{addStatus === "ok"
								? t("torrent_added")
								: addStatus === "error" || addStatus === "invalid"
									? t("torrent_failed")
									: t("add_torrent")}
						</span>
					</button>

					{/* Refresh / run update */}
					<button
						onClick={onRefresh}
						disabled={refreshing}
						title={t("refresh_title")}
						className={`cursor-pointer transition-colors disabled:opacity-40 ${
							updateStatus === "ok"
								? "text-green-400"
								: updateStatus === "error"
									? "text-red-400"
									: "text-slate-500 hover:text-slate-300"
						}`}
					>
						<svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
							<path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
						</svg>
					</button>

					{/* Notifications */}
					<div ref={notifsRef} className="relative flex items-center">
						<button
							onClick={() => { setNotifsOpen((o) => !o); if (!notifsOpen) onNotifRead(); }}
							className="relative cursor-pointer text-slate-500 hover:text-slate-300 transition-colors"
							title={t("notif_title")}
						>
							<svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
								<path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zm0 16a2 2 0 01-2-2h4a2 2 0 01-2 2z" />
							</svg>
							{notifUnread > 0 && (
								<span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-indigo-500 rounded-full text-[9px] text-white flex items-center justify-center leading-none">
									{notifUnread > 9 ? "9+" : notifUnread}
								</span>
							)}
						</button>
						{notifsOpen && <NotificationsPanel history={notifHistory} onClear={onNotifClear} />}
					</div>

					{/* Settings */}
					<div ref={settingsRef} className="relative flex items-center">
						<button
							onClick={() => setSettingsOpen((o) => !o)}
							className="cursor-pointer text-slate-500 hover:text-slate-300 transition-colors"
							title={t("settings_title")}
						>
							<svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
								<path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
							</svg>
						</button>
						{settingsOpen && <SettingsPanel settings={settings} updateSetting={updateSetting} report={report} locale={locale} onToast={onToast} />}
					</div>
				</div>
			</div>

			{/* ── Mobile secondary row: report date + storage stats (md hidden) ── */}
			{report && (
				<div className="md:hidden px-3 pt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
					{report.generated && (
						<span>
							{t("report")}{" "}
							{new Date(report.generated).toLocaleString(locale, {
								month: "2-digit",
								day: "2-digit",
								hour: "2-digit",
								minute: "2-digit",
							})}
						</span>
					)}
					{report.movies?.total_size > 0 && (
						<span>
							<span className="text-slate-500">{t("header_movies")}</span>{" "}
							<span className="text-slate-300">{formatBytes(report.movies.total_size)}</span>
						</span>
					)}
					{report.series?.total_size > 0 && (
						<span>
							<span className="text-slate-500">{t("header_series")}</span>{" "}
							<span className="text-slate-300">{formatBytes(report.series.total_size)}</span>
						</span>
					)}
					{totalSize > 0 && (
						<span>
							<span className="text-slate-500">{t("header_total")}</span>{" "}
							<span className="text-slate-200">{formatBytes(totalSize)}</span>
							{totalDiskCapacity > 0 && <span className="text-slate-500"> / {formatBytes(totalDiskCapacity)}</span>}
						</span>
					)}
				</div>
			)}

			{/* ── Tab navigation ── */}
			<nav className="flex px-3 sm:px-6 mt-1 sm:mt-2 overflow-x-auto">
				{TABS.map((tabDef) => (
					<button
						key={tabDef.id}
						className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 sm:px-4 py-2 border-b-2 text-sm cursor-pointer transition-colors bg-transparent ${
							tab === tabDef.id ? "text-slate-200 border-indigo-500" : "text-slate-400 border-transparent hover:text-slate-200"
						}`}
						onClick={() => setTab(tabDef.id)}
					>
						{t(tabDef.key)}

						{tabDef.id === "torrents" && torrentCount !== null && (
							<span className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"}`}>
								{torrentCount}
							</span>
						)}

						{tabDef.id === "missing_movies" && report && (
							<span className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"}`}>
								{report?.movies?.missing?.filter((m) => !blockedTitles.has(m.title.toLowerCase())).length ?? 0}
							</span>
						)}
						{tabDef.id === "missing_movies" && newItems.movies.size > 0 && (
							<span className="text-[11px] px-1.5 py-px rounded-full text-center bg-teal-900 text-teal-400">
								+{newItems.movies.size}
							</span>
						)}

						{tabDef.id === "watchlist" && watchlist && (() => {
							const count = watchlist.items.filter(
								(i) => !blockedTitles.has(i.title.toLowerCase()) && diskStatus(i, report) !== "complete",
							).length;
							return count > 0 ? (
								<span className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"}`}>
									{count}
								</span>
							) : null;
						})()}
						{tabDef.id === "watchlist" && newItems.watchlist.size > 0 && (
							<span className="text-[11px] px-1.5 py-px rounded-full text-center bg-teal-900 text-teal-400">
								+{newItems.watchlist.size}
							</span>
						)}

						{tabDef.id === "missing_series" && report && (
							<span className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"}`}>
								{report?.series?.missing?.length ?? 0}
							</span>
						)}
						{tabDef.id === "missing_series" && newItems.series.size > 0 && (
							<span className="text-[11px] px-1.5 py-px rounded-full text-center bg-teal-900 text-teal-400">
								+{newItems.series.size}
							</span>
						)}

						{tabDef.id === "quality" && qualityData && (() => {
							const METRIC = new Set(["low_resolution", "high_resolution", "low_video_bitrate", "low_audio_bitrate"]);
							const hasMetric = (item) => item.issues.some((i) => { const t = i.indexOf(":") === -1 ? i : i.slice(0, i.indexOf(":")); return METRIC.has(t); });
							const count = (qualityData.movies ?? []).filter(hasMetric).length + (qualityData.series ?? []).filter(hasMetric).length;
							return count > 0 ? (
								<span className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"}`}>
									{count}
								</span>
							) : null;
						})()}
						{tabDef.id === "warnings" &&
							report &&
							(() => {
								const STRUCTURAL = new Set(["corrupt_or_unreadable", "no_video_stream", "no_audio_stream", "bad_codec"]);
								const hasStructural = (item) => item.issues.some((i) => { const t = i.indexOf(":") === -1 ? i : i.slice(0, i.indexOf(":")); return STRUCTURAL.has(t); });
								const qualityWarnings = qualityData
									? (qualityData.movies ?? []).filter(hasStructural).length + (qualityData.series ?? []).filter(hasStructural).length
									: 0;
								const count =
									(report.movies?.multiple_videos?.length ?? 0) +
									(report.movies?.unneeded_files?.length ?? 0) +
									(report.movies?.not_found_on_tmdb?.length ?? 0) +
									(report.series?.multiple_videos?.length ?? 0) +
									(report.series?.unneeded_files?.length ?? 0) +
									(report.series?.not_found_on_tmdb?.length ?? 0) +
									(report.plex_sync?.not_indexed?.length ?? 0) +
									qualityWarnings;
								return count > 0 ? (
									<span className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"}`}>
										{count}
									</span>
								) : null;
							})()}
						{tabDef.id === "library" && renameData && renameData.stats.total > 0 && (
							<span className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"}`}>
								{renameData.stats.total}
							</span>
						)}
					</button>
				))}
			</nav>
		</header>
	);
}
