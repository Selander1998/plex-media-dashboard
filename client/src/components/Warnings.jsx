import { useState } from "react";
import { useLang } from "../LangContext.jsx";
import { countWarnings, issueType } from "../utils/warningUtils.js";
import { Section, Row } from "./ui/Section.jsx";

const STRUCTURAL_TYPES = new Set(["corrupt_or_unreadable", "no_video_stream", "no_audio_stream"]);

function structuralLabel(issue, t) {
	const type = issueType(issue);
	if (type === "corrupt_or_unreadable") return t("quality_issue_corrupt");
	if (type === "no_video_stream") return t("quality_issue_no_video");
	if (type === "no_audio_stream") return t("quality_issue_no_audio");
	if (type === "bad_codec") return `${t("quality_issue_bad_codec")}: ${issue.slice(10).toUpperCase()}`;
	if (type === "bad_audio_codec") return `${t("quality_issue_bad_audio_codec")}: ${issue.slice(16).toUpperCase()}`;
	return issue;
}

function extractQualityWarnings(qualityData) {
	const corruptMovies = [], corruptSeries = [], badCodecMovies = [], badCodecSeries = [];
	for (const [items, corruptList, codecList] of [
		[qualityData.movies ?? [], corruptMovies, badCodecMovies],
		[qualityData.series ?? [], corruptSeries, badCodecSeries],
	]) {
		for (const item of items) {
			const corrupt = item.issues.filter((i) => STRUCTURAL_TYPES.has(issueType(i)));
			const codec = item.issues.filter((i) => issueType(i) === "bad_codec" || issueType(i) === "bad_audio_codec");
			if (corrupt.length) corruptList.push({ path: item.path, full_path: item.full_path, issues: corrupt });
			if (codec.length) codecList.push({ path: item.path, full_path: item.full_path, issues: codec });
		}
	}
	return { corruptMovies, corruptSeries, badCodecMovies, badCodecSeries };
}

function extractEpisodeTag(filePath) {
	const basename = filePath.slice(filePath.lastIndexOf("/") + 1);
	const m = basename.match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
	if (!m) return null;
	return `S${m[1].padStart(2, "0")}E${m[2].padStart(2, "0")}`;
}

function groupQualityByFolder(items) {
	const map = {};
	for (const item of items) {
		const slash = item.path.indexOf("/");
		const folder = slash === -1 ? item.path : item.path.slice(0, slash);
		const file = slash === -1 ? "" : item.path.slice(slash + 1);
		if (!map[folder]) map[folder] = [];
		map[folder].push({ file, full_path: item.full_path, issues: item.issues });
	}
	return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
}

function groupByShow(items) {
	const map = {};
	for (const item of items) {
		if (!map[item.show]) map[item.show] = [];
		map[item.show].push(item);
	}
	return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
}

function groupByFolder(items) {
	const map = {};
	for (const item of items) {
		const slash = item.path.indexOf("/");
		const folder = slash === -1 ? item.path : item.path.slice(0, slash);
		const file = slash === -1 ? "" : item.path.slice(slash + 1);
		if (!map[folder]) map[folder] = { folder, type: item.type, files: [] };
		if (file) map[folder].files.push(file);
	}
	return Object.values(map).sort((a, b) => a.folder.localeCompare(b.folder));
}

function formatSize(bytes) {
	if (!bytes) return "?";
	if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
	if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
	return `${(bytes / 1e3).toFixed(0)} KB`;
}

function MultipleVideoRow({ files, suggestedKeep, onToast, onReportRefresh }) {
	const [deletedPaths, setDeletedPaths] = useState(new Set());
	const [pending, setPending] = useState(false);
	const { t } = useLang();

	const visible = files.filter((f) => !deletedPaths.has(f.full_path));
	if (visible.length === 0) return null;
	if (visible.length === 1) return (
		<p className="text-slate-500 text-[11px] font-mono">{visible[0].name}</p>
	);

	async function deleteFile(full_path) {
		const res = await fetch("/api/library/file", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ fullPath: full_path }),
		});
		if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
		setDeletedPaths((prev) => new Set(prev).add(full_path));
	}

	async function handleKeep(keepPath) {
		setPending(true);
		try {
			for (const f of visible) {
				if (f.full_path !== keepPath) {
					await deleteFile(f.full_path);
					onToast?.(f.name.split("/").pop() + " deleted");
				}
			}
			onReportRefresh?.();
		} catch (err) {
			onToast?.(err.message, true);
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="flex flex-col gap-1.5">
			{visible.map((f) => {
				const isRecommended = suggestedKeep && f.full_path === suggestedKeep;
				return (
					<div
						key={f.full_path}
						className={`flex items-center gap-2 rounded border px-3 py-2 ${isRecommended ? "border-emerald-800 bg-emerald-950/20" : "border-border bg-surface2"}`}
					>
						<div className="flex flex-col gap-0.5 flex-1 min-w-0">
							<span className={`text-[12px] font-mono truncate ${isRecommended ? "text-slate-100" : "text-slate-200"}`}>{f.name}</span>
							<div className="flex items-center gap-2">
								<span className="text-slate-500 text-[11px]">{formatSize(f.size)}</span>
								{isRecommended && (
									<span className="text-[10px] font-medium text-emerald-400">{t("multi_video_recommended")}</span>
								)}
							</div>
						</div>
						<button
							onClick={() => handleKeep(f.full_path)}
							disabled={pending}
							className={`shrink-0 text-[11px] px-2 py-0.5 rounded border disabled:opacity-40 cursor-pointer transition-colors ${
								isRecommended
									? "border-emerald-700 bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60"
									: "border-slate-700 bg-surface text-slate-400 hover:border-green-800 hover:bg-green-950/40 hover:text-green-400"
							}`}
						>
							{pending ? "…" : t("keep_btn")}
						</button>
					</div>
				);
			})}
		</div>
	);
}

export default function Warnings({ report, error, loading, qualityData, onToast, onReportRefresh }) {
	const { t } = useLang();
	const [pendingDelete, setPendingDelete] = useState(null);
	const [deletedPaths, setDeletedPaths] = useState(new Set());

	async function handleDeleteFile(full_path, skipConfirm = false) {
		if (!skipConfirm && pendingDelete !== full_path) {
			setPendingDelete(full_path);
			return;
		}
		if (!skipConfirm) setPendingDelete(null);
		else setPendingDelete(full_path);
		try {
			const res = await fetch("/api/quality-file", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ full_path }),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
			setDeletedPaths((prev) => new Set(prev).add(full_path));
			onToast?.(t("toast_file_deleted", { name: full_path.split("/").pop() }));
		} catch (err) {
			onToast?.(err.message, true);
		} finally {
			setPendingDelete(null);
		}
	}

	if (loading) return <div className="text-center py-12 text-slate-400">{t("loading_report")}</div>;
	if (error)
		return (
			<div className="bg-[#2d1a1a] border border-[#5c2626] rounded-lg p-4 text-red-500">
				{error}
			</div>
		);
	if (!report) return null;

	const movieMultiple = report.movies?.multiple_videos ?? [];
	const movieUnneeded = report.movies?.unneeded_files ?? [];
	const movieNotOnTmdb = report.movies?.not_found_on_tmdb ?? [];
	const seriesMultiple = report.series?.multiple_videos ?? [];
	const seriesUnneeded = report.series?.unneeded_files ?? [];
	const seriesNotOnTmdb = report.series?.not_found_on_tmdb ?? [];
	const seriesFolderRenames = report.series?.folder_renames ?? [];
	const notIndexed = report.plex_sync?.not_indexed ?? [];

	const { corruptMovies, corruptSeries, badCodecMovies, badCodecSeries } =
		qualityData ? extractQualityWarnings(qualityData) : { corruptMovies: [], corruptSeries: [], badCodecMovies: [], badCodecSeries: [] };

	if (countWarnings(report, qualityData) === 0) {
		return <div className="text-center py-12 text-slate-400">{t("no_warnings")}</div>;
	}

	return (
		<div className="flex flex-col gap-6">
			{notIndexed.length > 0 && (
				<Section
					title={t("warn_plex_not_indexed")}
					count={notIndexed.length}
					colorClass="text-red-500">
					{groupByFolder(notIndexed).map(({ folder, type, files }) => (
						<Row key={folder} label={folder}>
							<span className="text-slate-500 text-[11px] uppercase tracking-wide mb-0.5">
								{t(`plex_type_${type}`)}
							</span>
							<ul className="text-slate-400 text-[12px] list-disc list-inside">
								{files.map((f, i) => (
									<li key={i}>{f}</li>
								))}
							</ul>
						</Row>
					))}
				</Section>
			)}

			{corruptMovies.length > 0 && (
				<Section title={t("warn_movie_corrupt")} count={corruptMovies.length} colorClass="text-red-500">
					{groupQualityByFolder(corruptMovies).map(([folder, files]) => (
						<Row key={folder} label={folder}>
							<ul className="flex flex-col gap-1.5">
								{files.filter(({ full_path }) => !deletedPaths.has(full_path)).map(({ file, full_path, issues }, i) => (
									<li key={i} className="flex flex-col gap-0.5">
										{file && <span className="text-slate-500 text-[11px] font-mono">{file}</span>}
										<div className="flex items-center gap-3">
											<div className="flex flex-wrap gap-2">
												{issues.map((issue, j) => (
													<span key={j} className="text-red-400 text-[11px]">{structuralLabel(issue, t)}</span>
												))}
											</div>
											<DeleteButton full_path={full_path} pending={pendingDelete === full_path} onDelete={handleDeleteFile} />
										</div>
									</li>
								))}
							</ul>
						</Row>
					))}
				</Section>
			)}

			{corruptSeries.length > 0 && (
				<Section title={t("warn_series_corrupt")} count={corruptSeries.length} colorClass="text-red-500">
					{groupQualityByFolder(corruptSeries).map(([folder, files]) => (
						<Row key={folder} label={folder}>
							<ul className="flex flex-col gap-1.5">
								{files.filter(({ full_path }) => !deletedPaths.has(full_path)).map(({ file, full_path, issues }, i) => {
									const epTag = file ? extractEpisodeTag(file) : null;
									const basename = file ? file.slice(file.lastIndexOf("/") + 1) : null;
									return (
										<li key={i} className="flex flex-col gap-0.5">
											<div className="flex items-center gap-2 min-w-0">
												{epTag && <span className="text-slate-200 font-mono text-[11px] bg-surface2 border border-border px-1.5 py-0.5 rounded shrink-0">{epTag}</span>}
												{basename && <span className="text-slate-500 text-[11px] font-mono truncate">{basename}</span>}
											</div>
											<div className="flex items-center gap-3">
												<div className="flex flex-wrap gap-2">
													{issues.map((issue, j) => (
														<span key={j} className="text-red-400 text-[11px]">{structuralLabel(issue, t)}</span>
													))}
												</div>
												<DeleteButton full_path={full_path} pending={pendingDelete === full_path} onDelete={handleDeleteFile} />
											</div>
										</li>
									);
								})}
							</ul>
						</Row>
					))}
				</Section>
			)}

			{badCodecMovies.length > 0 && (
				<Section title={t("warn_movie_bad_codec")} count={badCodecMovies.length} colorClass="text-amber-500">
					{groupQualityByFolder(badCodecMovies).map(([folder, files]) => (
						<Row key={folder} label={folder}>
							<ul className="flex flex-col gap-1.5">
								{files.filter(({ full_path }) => !deletedPaths.has(full_path)).map(({ file, full_path, issues }, i) => (
									<li key={i} className="flex flex-col gap-0.5">
										{file && <span className="text-slate-500 text-[11px] font-mono">{file}</span>}
										<div className="flex items-center gap-3">
											<div className="flex flex-wrap gap-2">
												{issues.map((issue, j) => (
													<span key={j} className="text-amber-400 text-[11px]">{structuralLabel(issue, t)}</span>
												))}
											</div>
											<DeleteButton full_path={full_path} pending={pendingDelete === full_path} onDelete={handleDeleteFile} />
										</div>
									</li>
								))}
							</ul>
						</Row>
					))}
				</Section>
			)}

			{badCodecSeries.length > 0 && (
				<Section title={t("warn_series_bad_codec")} count={badCodecSeries.length} colorClass="text-amber-500">
					{groupQualityByFolder(badCodecSeries).map(([folder, files]) => (
						<Row key={folder} label={folder}>
							<ul className="flex flex-col gap-1.5">
								{files.filter(({ full_path }) => !deletedPaths.has(full_path)).map(({ file, full_path, issues }, i) => {
									const epTag = file ? extractEpisodeTag(file) : null;
									const basename = file ? file.slice(file.lastIndexOf("/") + 1) : null;
									return (
										<li key={i} className="flex flex-col gap-0.5">
											<div className="flex items-center gap-2 min-w-0">
												{epTag && <span className="text-slate-200 font-mono text-[11px] bg-surface2 border border-border px-1.5 py-0.5 rounded shrink-0">{epTag}</span>}
												{basename && <span className="text-slate-500 text-[11px] font-mono truncate">{basename}</span>}
											</div>
											<div className="flex items-center gap-3">
												<div className="flex flex-wrap gap-2">
													{issues.map((issue, j) => (
														<span key={j} className="text-amber-400 text-[11px]">{structuralLabel(issue, t)}</span>
													))}
												</div>
												<DeleteButton full_path={full_path} pending={pendingDelete === full_path} onDelete={handleDeleteFile} />
											</div>
										</li>
									);
								})}
							</ul>
						</Row>
					))}
				</Section>
			)}

			{movieNotOnTmdb.length > 0 && (
				<Section
					title={t("warn_movie_not_on_tmdb")}
					count={movieNotOnTmdb.length}
					colorClass="text-amber-500">
					{movieNotOnTmdb.map((m, i) => (
						<Row key={i} label={m.folder}>
							<span className="text-slate-500 text-[11px]">{t("warn_tmdb_hint")}</span>
						</Row>
					))}
				</Section>
			)}

			{seriesFolderRenames.length > 0 && (
				<Section
					title={t("warn_series_missing_year")}
					count={seriesFolderRenames.length}
					colorClass="text-amber-500">
					{seriesFolderRenames.map((r, i) => (
						<FolderRenameRow
							key={i}
							currentName={r.current_name}
							currentPath={r.current_path}
							suggestedName={r.suggested_name}
							onToast={onToast}
							onReportRefresh={onReportRefresh}
						/>
					))}
				</Section>
			)}

			{seriesNotOnTmdb.length > 0 && (
				<Section
					title={t("warn_series_not_on_tmdb")}
					count={seriesNotOnTmdb.length}
					colorClass="text-amber-500">
					{seriesNotOnTmdb.map((m, i) => (
						<Row key={i} label={m.folder}>
							<span className="text-slate-500 text-[11px]">{t("warn_tmdb_hint")}</span>
						</Row>
					))}
				</Section>
			)}

			{movieMultiple.length > 0 && (
				<Section
					title={t("warn_movie_multiple")}
					count={movieMultiple.length}
					colorClass="text-yellow-500">
					{movieMultiple.map((m, i) => (
						<Row key={i} label={m.folder}>
							<MultipleVideoRow
								files={m.files}
								suggestedKeep={m.suggested_keep ?? null}
								onToast={onToast}
								onReportRefresh={onReportRefresh}
							/>
						</Row>
					))}
				</Section>
			)}

			{movieUnneeded.length > 0 && (
				<Section
					title={t("warn_movie_unneeded")}
					count={movieUnneeded.length}
					colorClass="text-orange-500">
					{movieUnneeded.map((m, i) => (
						<Row key={i} label={m.folder}>
							<ul className="text-slate-400 text-[12px] list-disc list-inside">
								{m.files.map((f, j) => (
									<li key={j}>{f}</li>
								))}
							</ul>
						</Row>
					))}
				</Section>
			)}

			{seriesMultiple.length > 0 && (
				<Section
					title={t("warn_series_multiple")}
					count={seriesMultiple.length}
					colorClass="text-yellow-500">
					{groupByShow(seriesMultiple).map(([show, episodes]) => (
						<Row key={show} label={show}>
							<ul className="flex flex-col gap-3 mt-1">
								{episodes.map((m, i) => {
									const pad = (n) => String(n).padStart(2, "0");
									const epLabel = typeof m.season === "number" && m.season > 0
										? Array.isArray(m.episode)
											? `S${pad(m.season)}E${m.episode.map(pad).join("-E")}`
											: `S${pad(m.season)}E${pad(m.episode)}`
										: t("abs_episode", { n: Array.isArray(m.episode) ? m.episode[0] : m.episode });
									return (
										<li key={i} className="flex flex-col gap-1.5">
											<span className="text-slate-300 font-mono text-[11px]">{epLabel}</span>
											<MultipleVideoRow
												files={m.files}
												suggestedKeep={m.suggested_keep ?? null}
												onToast={onToast}
												onReportRefresh={onReportRefresh}
											/>
										</li>
									);
								})}
							</ul>
						</Row>
					))}
				</Section>
			)}

			{seriesUnneeded.length > 0 && (
				<Section
					title={t("warn_series_unneeded")}
					count={seriesUnneeded.length}
					colorClass="text-orange-500">
					{groupByShow(seriesUnneeded).map(([show, items]) => (
						<Row key={show} label={show}>
							<ul className="text-slate-400 text-[12px] list-disc list-inside">
								{items.map((m, i) => (
									<li key={i} className="font-mono">
										{m.file}
									</li>
								))}
							</ul>
						</Row>
					))}
				</Section>
			)}
		</div>
	);
}

function FolderRenameRow({ currentName, currentPath, suggestedName, onToast, onReportRefresh }) {
	const { t } = useLang();
	const [done, setDone] = useState(false);
	const [pending, setPending] = useState(false);

	if (done) return null;

	async function handleRename() {
		setPending(true);
		try {
			const res = await fetch("/api/library/rename-folder", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ currentPath, suggestedName }),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
			setDone(true);
			onToast?.(t("toast_folder_renamed", { name: suggestedName }));
			onReportRefresh?.();
		} catch (err) {
			onToast?.(err.message, true);
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="flex items-center gap-3 py-1">
			<div className="flex flex-col gap-0.5 flex-1 min-w-0">
				<span className="text-slate-400 text-[12px] font-mono truncate">{currentName}</span>
				<span className="text-emerald-400 text-[12px] font-mono truncate">→ {suggestedName}</span>
			</div>
			<button
				onClick={handleRename}
				disabled={pending}
				className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-emerald-800 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/50 disabled:opacity-40 cursor-pointer transition-colors"
			>
				{pending ? "…" : t("rename_folder_btn")}
			</button>
		</div>
	);
}

function DeleteButton({ full_path, pending, onDelete }) {
	const { t } = useLang();
	return (
		<button
			onClick={() => onDelete(full_path)}
			title={pending ? t("confirm_delete") : t("delete_file")}
			className={`shrink-0 flex items-center gap-1 text-[11px] cursor-pointer transition-colors px-1.5 py-0.5 rounded border ${
				pending
					? "text-red-400 border-red-400/40 bg-red-400/10 hover:bg-red-400/20"
					: "text-slate-500 border-transparent hover:text-red-400 hover:border-red-400/40 hover:bg-red-400/10"
			}`}
		>
			<svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
				<path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
			</svg>
			{pending && <span>{t("confirm_delete")}</span>}
		</button>
	);
}

