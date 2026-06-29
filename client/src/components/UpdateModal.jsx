import { useLang } from "../LangContext.jsx";
import { updateLogLineClass } from "../utils/updateLog.js";

const PHASE_DONE = [
	(s) => s.movies != null,
	(s) => s.shows != null,
	(s) => s.plexFiles != null,
	(s) => s.watchlist != null,
	(s) => s.qualityTotal != null,
];
const PHASE_KEYS = ["phase_movies", "phase_series", "phase_plex", "phase_watchlist", "phase_quality"];

function PillStatus({ done }) {
	return <span className={done ? "text-emerald-400" : "text-red-400"}>{done ? "✓" : "✗"}</span>;
}

function UpdateErrorContext({ updateLog, t }) {
	const exceptionLines = updateLog
		.filter((line) => /^Traceback/i.test(line.trim()) || /^(Error|Exception):/i.test(line.trim()) || /^ERROR\b/.test(line.trim()))
		.slice(-5);

	if (!exceptionLines.length) return null;

	return (
		<div className="bg-red-500/10 border border-red-800 rounded-lg px-3 py-2.5 flex flex-col gap-1">
			{exceptionLines.map((line, i) => (
				<span key={i} className="text-[11px] font-mono text-red-300 leading-relaxed">{line}</span>
			))}
		</div>
	);
}

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

export default function UpdateModal({ updateStatus, updateLog, updateStats, noTmdbCache, noQualityCache, tick, timestamps, logRef, onClose, onAbort }) {
	const { t } = useLang();
	// tick is read to force re-renders for live timer; timestamps.current holds section start/end times
	void tick;
	const ts = timestamps?.current ?? {};
	const pending = updateStatus === "aborted" ? "—" : "…";
	const totalElapsed     = secs(ts.updateStart,    ts.endTime);
	const moviesElapsed    = secs(ts.moviesStart,    ts.showsStart     ?? ts.endTime);
	const showsElapsed     = secs(ts.showsStart,     ts.plexStart      ?? ts.watchlistStart ?? ts.endTime);
	const plexElapsed      = secs(ts.plexStart,      ts.watchlistStart ?? ts.endTime);
	const watchlistElapsed = secs(ts.watchlistStart, ts.qualityStart   ?? ts.endTime);
	const qualityElapsed   = secs(ts.qualityStart,   ts.renameStart ?? ts.endTime);
	const renameElapsed    = secs(ts.renameStart,    ts.endTime);

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
					) : updateStatus === "aborted" ? (
						<svg className="w-5 h-5 text-amber-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
							<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
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
						{updateStatus === "ok" ? t("update_done") : updateStatus === "error" ? t("update_failed") : updateStatus === "aborted" ? t("update_cancelled") : t("updating")}
					</span>
					{totalElapsed != null && (
						<span className="text-xs text-slate-500">{fmtDuration(totalElapsed)}</span>
					)}
					{updateStatus === "error" && (
						<span className="text-xs text-slate-500">
							{PHASE_DONE.every((fn) => fn(updateStats))
								? t("update_error_unknown")
								: t("update_failed_during", { phase: t(PHASE_KEYS[PHASE_DONE.findIndex((fn) => !fn(updateStats))]) })}
						</span>
					)}
				</div>

				{/* Cache warnings — shown only while update is running */}
				{(noTmdbCache || noQualityCache) && !updateStatus && (
					<div className="flex flex-col gap-1.5">
						{noTmdbCache && (
							<div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-800/50 rounded-lg">
								<svg className="w-3.5 h-3.5 shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
									<path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
								</svg>
								<span className="text-xs text-amber-400">{t("update_no_tmdb_cache_warn")}</span>
							</div>
						)}
						{noQualityCache && (
							<div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-800/50 rounded-lg">
								<svg className="w-3.5 h-3.5 shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
									<path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
								</svg>
								<span className="text-xs text-amber-400">{t("update_no_quality_cache_warn")}</span>
							</div>
						)}
					</div>
				)}

				{/* Exception lines — only shown when Python tracebacks are present */}
				{updateStatus === "error" && <UpdateErrorContext updateLog={updateLog} t={t} />}

				{/* Stats pills — always visible */}
				<div className="flex gap-2 flex-wrap">
					<span className="px-2.5 py-1 rounded-md bg-indigo-500/15 border border-indigo-800 text-indigo-300 text-xs font-medium flex items-center gap-1.5">
						{updateStats.moviesCheckedP2 != null ? (
							<span className="flex items-center gap-1.5">
								<span>{updateStats.movies} {t("update_stat_movies")}</span>
								<span className="text-indigo-500">·</span>
								<span className="text-indigo-400 font-normal">{updateStats.moviesCheckedP2}/{updateStats.moviesP2} {t("update_stat_collections")}</span>
							</span>
						) : (
							<span>
								{updateStats.moviesChecked != null
									? `${updateStats.moviesChecked}/${updateStats.movies}`
									: (updateStats.movies ?? pending)}{" "}
								{t("update_stat_movies")}
							</span>
						)}
						{moviesElapsed != null && <span className="text-indigo-500">{fmtDuration(moviesElapsed)}</span>}
						{updateStatus === "error" && <PillStatus done={updateStats.movies != null} />}
					</span>
					<span className="px-2.5 py-1 rounded-md bg-purple-500/15 border border-purple-800 text-purple-300 text-xs font-medium flex items-center gap-1.5">
						<span>
							{updateStats.seriesChecked != null
								? `${updateStats.seriesChecked}/${updateStats.shows}`
								: (updateStats.shows ?? pending)}{" "}
							{t("update_stat_shows")}
						</span>
						{showsElapsed != null && <span className="text-purple-500">{fmtDuration(showsElapsed)}</span>}
						{updateStatus === "error" && <PillStatus done={updateStats.shows != null} />}
					</span>
					<span className="px-2.5 py-1 rounded-md bg-teal-500/15 border border-teal-800 text-teal-300 text-xs font-medium flex items-center gap-1.5">
						<span>{updateStats.watchlist ?? pending} {t("update_stat_watchlist")}</span>
						{watchlistElapsed != null && <span className="text-teal-600">{fmtDuration(watchlistElapsed)}</span>}
						{updateStatus === "error" && <PillStatus done={updateStats.watchlist != null} />}
					</span>
					<span className="px-2.5 py-1 rounded-md bg-slate-500/15 border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5">
						<span>{updateStats.plexFiles != null ? updateStats.plexFiles.toLocaleString() : pending} {t("update_stat_plex")}</span>
						{plexElapsed != null && <span className="text-slate-500">{fmtDuration(plexElapsed)}</span>}
						{updateStatus === "error" && <PillStatus done={updateStats.plexFiles != null} />}
					</span>
					<span className="px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-800 text-amber-300 text-xs font-medium flex items-center gap-1.5">
						<span>
							{updateStats.qualityChecked != null && updateStats.qualityTotal != null
								? `${updateStats.qualityChecked}/${updateStats.qualityTotal}`
								: (updateStats.qualityTotal ?? pending)}{" "}
							{t("update_quality_files")}
						</span>
						{qualityElapsed != null && <span className="text-amber-600">{fmtDuration(qualityElapsed)}</span>}
						{updateStatus === "error" && <PillStatus done={updateStats.qualityTotal != null} />}
					</span>
					{(updateStats.renamePlan != null || ts.renameStart) && (
						<span className="px-2.5 py-1 rounded-md bg-slate-500/15 border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5">
							<span>{updateStats.renamePlan != null ? updateStats.renamePlan : pending} {t("phase_rename")}</span>
							{renameElapsed != null && <span className="text-slate-500">{fmtDuration(renameElapsed)}</span>}
						</span>
					)}
				</div>

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

				{/* Primary action button — Cancel while running, Close when done */}
				<div className="flex justify-end">
					{updateStatus !== null ? (
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
					) : onAbort ? (
						<button
							onClick={onAbort}
							className="px-4 py-1.5 rounded-md border border-slate-700 text-sm font-medium text-slate-400 hover:border-red-700 hover:text-red-400 transition-colors cursor-pointer"
						>
							{t("update_cancel_btn")}
						</button>
					) : null}
				</div>
			</div>
		</div>
	);
}
