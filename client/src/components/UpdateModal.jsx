import { useLang } from "../LangContext.jsx";
import { updateLogLineClass } from "../utils/updateLog.js";

function secs(start, end) {
	if (!start) return null;
	return Math.floor(((end ?? Date.now()) - start) / 1000);
}

function fmtDuration(s) {
	if (s == null) return null;
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rem = s % 60;
	if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export default function UpdateModal({ updateStatus, updateLog, updateStats, noCache, tick, timestamps, logRef, onClose, onAbort }) {
	const { t } = useLang();
	// tick is read to force re-renders for live timer; timestamps.current holds section start/end times
	void tick;
	const ts = timestamps?.current ?? {};
	const totalElapsed     = secs(ts.updateStart,    ts.endTime);
	const moviesElapsed    = secs(ts.moviesStart,    ts.showsStart     ?? ts.endTime);
	const showsElapsed     = secs(ts.showsStart,     ts.plexStart      ?? ts.watchlistStart ?? ts.endTime);
	const plexElapsed      = secs(ts.plexStart,      ts.watchlistStart ?? ts.endTime);
	const watchlistElapsed = secs(ts.watchlistStart, ts.qualityStart   ?? ts.endTime);
	const qualityElapsed   = secs(ts.qualityStart,   ts.endTime);

	return (
		<div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
			<div className="bg-surface border border-border rounded-xl p-6 flex flex-col gap-4 shadow-xl w-175 max-w-full">
				{/* Title row */}
				<div className="flex items-center gap-2.5">
					{updateStatus === "ok" ? (
						<svg className="w-5 h-5 text-emerald-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
							<path
								fillRule="evenodd"
								d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
								clipRule="evenodd"
							/>
						</svg>
					) : updateStatus === "error" ? (
						<svg className="w-5 h-5 text-red-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
							<path
								fillRule="evenodd"
								d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
								clipRule="evenodd"
							/>
						</svg>
					) : (
						<svg className="w-5 h-5 animate-spin text-indigo-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
							<path
								fillRule="evenodd"
								d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
								clipRule="evenodd"
							/>
						</svg>
					)}
					<span
						className={`text-sm font-medium ${updateStatus === "ok" ? "text-emerald-400" : updateStatus === "error" ? "text-red-400" : updateStatus === "aborted" ? "text-amber-400" : "text-slate-200"}`}
					>
						{updateStatus === "ok" ? t("update_done") : updateStatus === "error" ? t("update_failed") : updateStatus === "aborted" ? "Update cancelled" : t("updating")}
					</span>
					{totalElapsed != null && (
						<span className="text-xs text-slate-500">{fmtDuration(totalElapsed)}</span>
					)}
					{noCache && !updateStatus && (
						<span className="ml-auto text-xs text-amber-400">{t("update_no_cache_warn")}</span>
					)}
					{!updateStatus && onAbort && (
						<button
							onClick={onAbort}
							className="ml-auto text-xs text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
						>
							Cancel
						</button>
					)}
				</div>

				{/* Stats pills */}
				{Object.keys(updateStats).length > 0 && (
					<div className="flex gap-2 flex-wrap">
						{updateStats.movies != null && (
							<span className="px-2.5 py-1 rounded-md bg-indigo-500/15 border border-indigo-800 text-indigo-300 text-xs font-medium flex items-center gap-1.5">
								<span>
									{updateStats.moviesChecked != null
										? `${updateStats.moviesChecked}/${updateStats.movies}`
										: updateStats.movies}{" "}
									{t("update_stat_movies")}
								</span>
								{moviesElapsed != null && <span className="text-indigo-500">{fmtDuration(moviesElapsed)}</span>}
							</span>
						)}
						{updateStats.shows != null && (
							<span className="px-2.5 py-1 rounded-md bg-purple-500/15 border border-purple-800 text-purple-300 text-xs font-medium flex items-center gap-1.5">
								<span>
									{updateStats.seriesChecked != null
										? `${updateStats.seriesChecked}/${updateStats.shows}`
										: updateStats.shows}{" "}
									{t("update_stat_shows")}
								</span>
								{showsElapsed != null && <span className="text-purple-500">{fmtDuration(showsElapsed)}</span>}
							</span>
						)}
						{updateStats.watchlist != null && (
							<span className="px-2.5 py-1 rounded-md bg-teal-500/15 border border-teal-800 text-teal-300 text-xs font-medium flex items-center gap-1.5">
								<span>{updateStats.watchlist} {t("update_stat_watchlist")}</span>
								{watchlistElapsed != null && <span className="text-teal-600">{fmtDuration(watchlistElapsed)}</span>}
							</span>
						)}
						{updateStats.plexFiles != null && (
							<span className="px-2.5 py-1 rounded-md bg-slate-500/15 border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5">
								<span>{updateStats.plexFiles.toLocaleString()} {t("update_stat_plex")}</span>
								{plexElapsed != null && <span className="text-slate-500">{fmtDuration(plexElapsed)}</span>}
							</span>
						)}
						{(updateStats.qualityTotal != null || updateStats.qualityIssues != null) && (
							<span className="px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-800 text-amber-300 text-xs font-medium flex items-center gap-1.5">
								<span>
									{updateStats.qualityChecked != null && updateStats.qualityTotal != null
										? `${updateStats.qualityChecked}/${updateStats.qualityTotal}`
										: updateStats.qualityTotal}{" "}
									files — {updateStats.qualityIssues ?? "…"} issues
								</span>
								{qualityElapsed != null && <span className="text-amber-600">{fmtDuration(qualityElapsed)}</span>}
							</span>
						)}
					</div>
				)}

				{/* Log */}
				<div
					ref={logRef}
					className="w-full bg-black/40 border border-border rounded-lg px-3 py-2.5 text-[11px] font-mono h-80 overflow-y-auto"
				>
					{updateLog.length === 0 ? (
						<span className="text-slate-600">Waiting for output…</span>
					) : (
						updateLog.map((line, i) => (
							<div key={i} className={`leading-relaxed whitespace-pre-wrap break-all ${updateLogLineClass(line)}`}>
								{line}
							</div>
						))
					)}
				</div>

				{/* Close button — only when finished */}
				{updateStatus !== null && (
					<div className="flex justify-end">
						<button
							onClick={onClose}
							className={`px-4 py-1.5 rounded-md border text-sm font-medium cursor-pointer transition-colors ${
								updateStatus === "ok"
									? "bg-emerald-500/15 border-emerald-700 text-emerald-300 hover:bg-emerald-500/25"
									: "bg-red-500/15 border-red-800 text-red-400 hover:bg-red-500/25"
							}`}
						>
							{t("close_btn")}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
