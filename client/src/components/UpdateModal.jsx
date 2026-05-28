import { useLang } from "../LangContext.jsx";
import { updateLogLineClass } from "../utils/updateLog.js";

export default function UpdateModal({ updateStatus, updateLog, updateStats, logRef, onClose }) {
	const { t } = useLang();

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
						className={`text-sm font-medium ${updateStatus === "ok" ? "text-emerald-400" : updateStatus === "error" ? "text-red-400" : "text-slate-200"}`}
					>
						{updateStatus === "ok" ? t("update_done") : updateStatus === "error" ? t("update_failed") : t("updating")}
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
