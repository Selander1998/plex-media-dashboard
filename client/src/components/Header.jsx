import { useState } from "react";
import { useLang } from "../LangContext.jsx";
import { translations, availableLangs, flagUrls } from "../translations.js";
import { exportStatsCard } from "../exportStats.js";
import { diskStatus } from "./Watchlist.jsx";
import { formatBytes } from "../utils/format.js";

const TABS = [
	{ id: "torrents", key: "tab_torrents" },
	{ id: "watchlist", key: "tab_watchlist" },
	{ id: "missing_movies", key: "tab_missing_movies" },
	{ id: "missing_series", key: "tab_missing_series" },
	{ id: "warnings", key: "tab_warnings" },
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
}) {
	const { lang, switchLang, t } = useLang();
	const locale = lang === "sv" ? "sv-SE" : "en-US";
	const [cacheStatus, setCacheStatus] = useState(null);

	async function handleClearCache() {
		if (cacheStatus === "loading") return;
		setCacheStatus("loading");
		try {
			const res = await fetch("/api/cache", { method: "DELETE" });
			if (!res.ok) throw new Error();
			setCacheStatus("ok");
			onToast(t("toast_cache_cleared"));
		} catch {
			setCacheStatus("error");
			onToast(t("toast_cache_clear_failed"), true);
		} finally {
			setTimeout(() => setCacheStatus(null), 2000);
		}
	}

	return (
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
									<span className="text-slate-200 font-medium">
										{formatBytes((report.movies.total_size ?? 0) + (report.series.total_size ?? 0))}
									</span>
									{totalDiskCapacity > 0 && <span className="text-slate-500"> / {formatBytes(totalDiskCapacity)}</span>}
								</span>
							</>
						)}
					</div>
				)}
				<div className="flex items-center gap-3">
					{/* Language toggle */}
					<div className="flex items-center gap-1.5">
						{availableLangs.map((l) => (
							<button
								key={l}
								onClick={() => switchLang(l)}
								title={l.toUpperCase()}
								className={`cursor-pointer transition-opacity rounded-sm ${
									lang === l ? "opacity-100" : "opacity-30 hover:opacity-60"
								}`}
							>
								<img src={flagUrls[translations[l].flag]} alt={l} className="w-5 h-auto rounded-sm" />
							</button>
						))}
					</div>

					{/* Save path + disk space */}
					{savePaths.length > 1 && (
						<button
							onClick={() => {
								const next = (savePathIdx + 1) % savePaths.length;
								setSavePathIdx(next);
								localStorage.setItem("savePathIdx", next);
								const name = savePaths[next].split("/").filter(Boolean)[1] ?? savePaths[next];
								onToast(t("toast_saving_to", { name }));
							}}
							title={`${t("saving_to")} ${savePaths[savePathIdx]}`}
							className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
						>
							<svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
								<path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8H6a1 1 0 100 2h8a1 1 0 00.894-.553l1-2a1 1 0 00-.341-1.341zM2 14a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2z" />
							</svg>
							<span>
								{t("saving_to")} {savePaths[savePathIdx].split("/").filter(Boolean)[1] ?? savePaths[savePathIdx]}
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

					{/* Clear TMDB cache */}
					<button
						onClick={handleClearCache}
						disabled={cacheStatus === "loading"}
						title={t("clear_cache_title")}
						className={`cursor-pointer transition-colors disabled:opacity-40 ${
							cacheStatus === "ok"
								? "text-green-400"
								: cacheStatus === "error"
									? "text-red-400"
									: "text-slate-500 hover:text-slate-300"
						}`}
					>
						<svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
							<path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
						</svg>
					</button>

					{/* Export stats card */}
					{report && (
						<button
							onClick={() => exportStatsCard(report, locale, t)}
							title={t("export_stats_title")}
							className="cursor-pointer text-slate-500 hover:text-slate-300 transition-colors"
						>
							<svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
								<path
									fillRule="evenodd"
									d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
									clipRule="evenodd"
								/>
							</svg>
						</button>
					)}

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
							<path
								fillRule="evenodd"
								d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
								clipRule="evenodd"
							/>
						</svg>
					</button>
				</div>
			</div>

			{/* Tab navigation */}
			<nav className="flex px-6 mt-2">
				{TABS.map((tabDef) => (
					<button
						key={tabDef.id}
						className={`flex items-center gap-1.5 px-4 py-2 border-b-2 text-sm cursor-pointer transition-colors bg-transparent ${
							tab === tabDef.id ? "text-slate-200 border-indigo-500" : "text-slate-400 border-transparent hover:text-slate-200"
						}`}
						onClick={() => setTab(tabDef.id)}
					>
						{t(tabDef.key)}

						{tabDef.id === "torrents" && torrentCount !== null && (
							<span
								className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${
									tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"
								}`}
							>
								{torrentCount}
							</span>
						)}

						{tabDef.id === "missing_movies" && report && (
							<span
								className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${
									tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"
								}`}
							>
								{report?.movies?.missing?.filter((m) => !blockedTitles.has(m.title.toLowerCase())).length ?? 0}
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
								}`}
							>
								{watchlist?.items?.filter(
									(i) => !blockedTitles.has(i.title.toLowerCase()) && diskStatus(i, report) !== "complete",
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
								}`}
							>
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
										className={`text-[11px] px-1.5 py-px rounded-full min-w-5 text-center ${tab === tabDef.id ? "bg-indigo-500 text-white" : "bg-surface2 text-slate-400"}`}
									>
										{count}
									</span>
								) : null;
							})()}
					</button>
				))}
			</nav>
		</header>
	);
}
