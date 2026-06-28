import { useState } from "react";
import StatCard from "./StatCard.jsx";
import { useLang } from "../LangContext.jsx";

function Arrow() {
	return <span className="text-slate-600 shrink-0 text-xs">→</span>;
}

function NameChange({ from, to }) {
	return (
		<div className="flex items-center gap-2 text-xs font-mono min-w-0">
			<span className="text-slate-400 truncate">{from}</span>
			<Arrow />
			<span className="text-emerald-400 truncate">{to}</span>
		</div>
	);
}

function ShowSection({ show, onApply, applying }) {
	const { t } = useLang();
	const [open, setOpen] = useState(false);
	const changed = show.seasons.reduce(
		(a, s) => a + s.episodes.filter((e) => e.episodeChanged).length + (s.seasonFolderChanged ? 1 : 0),
		0
	);
	const hasMissingTitles = show.seasons.some((s) => s.episodes.some((e) => !e.title));
	const isApplying = applying === show.showFolder;

	return (
		<div className="border border-border rounded-lg overflow-hidden">
			<div className="flex items-center bg-surface">
				<button
					className="flex-1 flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors text-left cursor-pointer min-w-0"
					onClick={() => setOpen((v) => !v)}
				>
					<span className="font-medium text-sm text-slate-200 truncate">{show.showNameClean ?? show.showName}</span>
					<div className="flex items-center gap-2 shrink-0 ml-2">
						{hasMissingTitles && (
							<span className="text-[10px] text-amber-500">{t("lib_badge_missing_titles")}</span>
						)}
						<span className="text-xs text-slate-500">{t(changed !== 1 ? "lib_changes_many" : "lib_changes_one", { n: changed })}</span>
						<svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
					</div>
				</button>
				<button
					onClick={() => onApply(show.showFolder)}
					disabled={applying !== null}
					className="px-3 py-2.5 border-l border-border text-xs font-medium text-purple-300 hover:bg-purple-500/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
				>
					{isApplying ? "…" : t("lib_rename_btn")}
				</button>
			</div>
			{open && (
				<div className="border-t border-border divide-y divide-border">
					{show.seasons.map((season) => (
						<div key={season.seasonFolderCurrent} className="px-4 py-3 flex flex-col gap-2">
							{season.seasonFolderChanged && (
								<div className="flex items-center gap-2">
									<span className="text-[10px] uppercase tracking-wider text-slate-600 w-14 shrink-0">{t("lib_label_folder")}</span>
									<NameChange from={season.displayCurrent} to={season.displayDesired} />
								</div>
							)}
							{season.episodes.filter((e) => e.episodeChanged).map((ep) => (
								<div key={ep.nameCurrent} className="flex items-center gap-2">
									<span className="text-[10px] uppercase tracking-wider text-slate-600 w-14 shrink-0">
										S{String(ep.epInfo.season).padStart(2, "0")}E{String(ep.epInfo.episode).padStart(2, "0")}
									</span>
									<NameChange from={ep.nameCurrent} to={ep.nameDesired} />
									{!ep.title && <span className="text-[10px] text-amber-500 shrink-0">{t("lib_badge_no_title")}</span>}
								</div>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function MovieSection({ movie }) {
	const { t } = useLang();
	return (
		<div className="border border-border rounded-lg px-4 py-3 flex flex-col gap-2">
			{movie.folderChanged && (
				<div className="flex items-center gap-2">
					<span className="text-[10px] uppercase tracking-wider text-slate-600 w-14 shrink-0">{t("lib_label_folder")}</span>
					<NameChange from={movie.displayCurrent} to={movie.displayDesired} />
				</div>
			)}
			{movie.files.filter((f) => f.fileChanged).map((f) => (
				<div key={f.nameCurrent} className="flex items-center gap-2">
					<span className="text-[10px] uppercase tracking-wider text-slate-600 w-14 shrink-0">{t("lib_label_file")}</span>
					<NameChange from={f.nameCurrent} to={f.nameDesired} />
				</div>
			))}
		</div>
	);
}

function TrashButton({ onClick, deleting }) {
	const { t } = useLang();
	return (
		<button
			onClick={onClick}
			disabled={deleting}
			className="shrink-0 p-1 text-slate-600 hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40"
			title={t("lib_delete_file")}
		>
			{deleting
				? <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8v8z" /></svg>
				: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
		</button>
	);
}

export default function LibraryRename({ data, loading, onRefresh, onDataChange }) {
	const { t } = useLang();
	const [applying, setApplying] = useState(null);
	const [result, setResult] = useState(null);
	const [error, setError] = useState(null);
	const [filter, setFilter] = useState("all");
	const [missingTitleOnly, setMissingTitleOnly] = useState(false);
	const [warningsOpen, setWarningsOpen] = useState(false);
	const [deleting, setDeleting] = useState(null);

	async function deleteFile(fullPath, onRemove) {
		setDeleting(fullPath);
		try {
			const res = await fetch("/api/library/file", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ fullPath }),
			});
			if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? res.statusText); }
			onRemove();
		} catch (e) {
			setError(e.message);
		} finally {
			setDeleting(null);
		}
	}

	async function apply(scope, showFolder = null) {
		const key = showFolder ?? scope;
		setApplying(key);
		setError(null);
		try {
			const res = await fetch("/api/library/renames/apply", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(showFolder ? { scope: "series", showFolder } : { scope }),
			});
			const d = await res.json();
			if (!res.ok) throw new Error(d.error ?? res.statusText);
			setResult({ ...d, scope: showFolder ? "show" : scope, showFolder });
			onDataChange(null);
		} catch (e) {
			setError(e.message);
		} finally {
			setApplying(null);
		}
	}

	const stats = data?.stats;
	const warnings = data?.warnings ?? { unparseable: [], tmdbShowsNotFound: [], multipleVideos: [] };
	const warningCount = warnings.unparseable.length + warnings.tmdbShowsNotFound.length + (warnings.multipleVideos?.length ?? 0);
	const movieChanges = stats ? stats.movieFolders + stats.movieFiles : 0;
	const seriesChanges = stats ? stats.seasonFolders + stats.episodeFiles : 0;

	const allShows = data?.shows ?? [];
	const filteredShows = missingTitleOnly
		? allShows.filter((s) => s.seasons.some((se) => se.episodes.some((e) => !e.title)))
		: allShows;

	return (
		<div className="flex flex-col gap-6">
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<StatCard label={t("lib_movie_folders")} value={stats?.movieFolders ?? "—"} />
				<StatCard label={t("lib_movie_files")} value={stats?.movieFiles ?? "—"} />
				<StatCard label={t("lib_season_folders")} value={stats?.seasonFolders ?? "—"} />
				<StatCard label={t("lib_episode_files")} value={stats?.episodeFiles ?? "—"} />
			</div>

			{/* Controls */}
			<div className="flex items-center gap-3 flex-wrap">
				<button
					onClick={onRefresh}
					disabled={loading || applying !== null}
					className="px-4 py-1.5 rounded-md border border-indigo-700 bg-indigo-500/15 text-indigo-300 text-sm font-medium hover:bg-indigo-500/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
				>
					{loading ? t("lib_scanning") : data ? t("lib_rescan") : t("lib_scan")}
				</button>

				{movieChanges > 0 && (
					<button
						onClick={() => apply("movies")}
						disabled={applying !== null || loading}
						className="px-4 py-1.5 rounded-md border border-sky-700 bg-sky-500/15 text-sky-300 text-sm font-medium hover:bg-sky-500/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{applying === "movies" ? t("lib_renaming") : t("lib_rename_movies", { n: movieChanges })}
					</button>
				)}

				{seriesChanges > 0 && (
					<button
						onClick={() => apply("series")}
						disabled={applying !== null || loading}
						className="px-4 py-1.5 rounded-md border border-purple-700 bg-purple-500/15 text-purple-300 text-sm font-medium hover:bg-purple-500/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{applying === "series" ? t("lib_renaming") : t("lib_rename_series", { n: seriesChanges })}
					</button>
				)}

				{stats?.total > 0 && (
					<button
						onClick={() => apply("all")}
						disabled={applying !== null || loading}
						className="px-4 py-1.5 rounded-md border border-emerald-700 bg-emerald-500/15 text-emerald-300 text-sm font-medium hover:bg-emerald-500/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{applying === "all" ? t("lib_renaming") : t("lib_rename_all", { n: stats.total })}
					</button>
				)}

				{data && stats?.total === 0 && (
					<span className="text-sm text-emerald-400">{t("lib_already_named")}</span>
				)}
			</div>

			{error && (
				<div className="bg-red-500/10 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>
			)}

			{result && (
				<div className={`border rounded-lg px-4 py-3 text-sm ${result.failed > 0 ? "bg-amber-500/10 border-amber-800 text-amber-300" : "bg-emerald-500/10 border-emerald-700 text-emerald-300"}`}>
					{t("lib_renames_applied", { ok: result.ok, s: result.ok !== 1 ? "s" : "" })}
					{result.scope === "show" && result.showFolder && ` ${t("lib_renames_for_show", { show: result.showFolder.split("/").pop() })}`}
					{result.failed > 0 && ` · ${t("lib_failed", { n: result.failed })}`}
					{result.errors?.length > 0 && (
						<ul className="mt-2 text-xs font-mono space-y-1">
							{result.errors.map((e, i) => <li key={i} className="text-red-400">{e.from}: {e.error}</li>)}
						</ul>
					)}
				</div>
			)}

			{/* Warnings */}
			{warningCount > 0 && (
				<div className="border border-amber-800/50 rounded-lg overflow-hidden">
					<button
						className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/15 transition-colors text-left cursor-pointer"
						onClick={() => setWarningsOpen((v) => !v)}
					>
						<span className="text-sm font-medium text-amber-400">{t(warningCount !== 1 ? "lib_warnings_many" : "lib_warnings_one", { n: warningCount })}</span>
						<svg className={`w-3.5 h-3.5 text-amber-500 transition-transform ${warningsOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
					</button>
					{warningsOpen && (
						<div className="border-t border-amber-800/40 px-4 py-3 flex flex-col gap-3">
							{warnings.tmdbShowsNotFound.length > 0 && (
								<div className="flex flex-col gap-1.5">
									<span className="text-xs font-semibold text-amber-500 uppercase tracking-wider">{t("lib_warn_tmdb")}</span>
									{warnings.tmdbShowsNotFound.map((show) => (
										<span key={show} className="text-xs text-slate-400 font-mono pl-2">{show}</span>
									))}
								</div>
							)}
							{warnings.multipleVideos?.length > 0 && (
								<div className="flex flex-col gap-1.5">
									<span className="text-xs font-semibold text-amber-500 uppercase tracking-wider">{t("lib_warn_multiple")}</span>
									{warnings.multipleVideos.map((entry) => (
										<div key={entry.folder ?? entry} className="flex flex-col gap-1 pl-2">
											<span className="text-xs text-slate-500 font-mono">{entry.folder ?? entry}</span>
											{entry.files?.map((f) => (
												<div key={f.fullPath} className="flex items-center gap-1 pl-2">
													<span className="text-xs text-slate-400 font-mono flex-1 truncate">{f.name}</span>
													<TrashButton
														deleting={deleting === f.fullPath}
														onClick={() => deleteFile(f.fullPath, () => onDataChange((prev) => ({
															...prev,
															warnings: {
																...prev.warnings,
																multipleVideos: prev.warnings.multipleVideos
																	.map((mv) => mv.folder === entry.folder
																		? { ...mv, files: mv.files.filter((x) => x.fullPath !== f.fullPath) }
																		: mv)
																	.filter((mv) => mv.files?.length > 1),
															},
														})))}
													/>
												</div>
											))}
										</div>
									))}
								</div>
							)}
							{warnings.unparseable.length > 0 && (
								<div className="flex flex-col gap-1.5">
									<span className="text-xs font-semibold text-amber-500 uppercase tracking-wider">{t("lib_warn_no_episode_info")}</span>
									{warnings.unparseable.map((w, i) => (
										<div key={i} className="flex items-center gap-1 pl-2">
											<span className="text-xs text-slate-400 font-mono flex-1 truncate">{w.show} / {w.season} / {w.file}</span>
											{w.fullPath && (
												<TrashButton
													deleting={deleting === w.fullPath}
													onClick={() => deleteFile(w.fullPath, () => onDataChange((prev) => ({
														...prev,
														warnings: {
															...prev.warnings,
															unparseable: prev.warnings.unparseable.filter((_, j) => j !== i),
														},
													})))}
												/>
											)}
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* Preview list */}
			{stats?.total > 0 && (
				<>
					<div className="flex items-center gap-2 flex-wrap">
						{[["all", t("lib_filter_all")], ["movies", t("lib_filter_movies")], ["shows", t("lib_filter_shows")]].map(([id, label]) => (
							<button
								key={id}
								onClick={() => setFilter(id)}
								className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
									filter === id
										? "bg-indigo-500/20 border-indigo-700 text-indigo-300"
										: "border-transparent text-slate-500 hover:text-slate-300"
								}`}
							>
								{label}
							</button>
						))}
						{(filter === "all" || filter === "shows") && allShows.some((s) => s.seasons.some((se) => se.episodes.some((e) => !e.title))) && (
							<button
								onClick={() => setMissingTitleOnly((v) => !v)}
								className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
									missingTitleOnly
										? "bg-amber-500/20 border-amber-700 text-amber-300"
										: "border-transparent text-slate-500 hover:text-amber-400"
								}`}
							>
								{t("lib_missing_titles")}
							</button>
						)}
					</div>

					{(filter === "all" || filter === "movies") && data?.movies?.length > 0 && (
						<div className="flex flex-col gap-2">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("lib_filter_movies")}</h3>
							{data.movies.map((m) => <MovieSection key={m.folderCurrent} movie={m} />)}
						</div>
					)}

					{(filter === "all" || filter === "shows") && filteredShows.length > 0 && (
						<div className="flex flex-col gap-2">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
								{t("lib_tv_shows")}{missingTitleOnly && ` — ${filteredShows.length} ${t("lib_badge_missing_titles")}`}
							</h3>
							{filteredShows.map((s) => (
								<ShowSection
									key={s.showFolder}
									show={s}
									onApply={(folder) => apply("series", folder)}
									applying={applying}
								/>
							))}
						</div>
					)}

					{(filter === "all" || filter === "shows") && missingTitleOnly && filteredShows.length === 0 && (
						<p className="text-sm text-slate-500">{t("lib_no_missing_titles")}</p>
					)}
				</>
			)}
		</div>
	);
}
