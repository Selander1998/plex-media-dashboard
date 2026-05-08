import { useLang } from "../LangContext.jsx";

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
		const file   = slash === -1 ? "" : item.path.slice(slash + 1);
		if (!map[folder]) map[folder] = { folder, type: item.type, files: [] };
		if (file) map[folder].files.push(file);
	}
	return Object.values(map).sort((a, b) => a.folder.localeCompare(b.folder));
}

export default function Warnings({ report, error, loading }) {
	const { t } = useLang();

	if (loading) return <div className="text-center py-12 text-slate-400">{t("loading_report")}</div>;
	if (error) return <div className="bg-[#2d1a1a] border border-[#5c2626] rounded-lg p-4 text-red-500">{error}</div>;
	if (!report) return null;

	const movieMultiple  = report.movies?.multiple_videos ?? [];
	const movieUnneeded  = report.movies?.unneeded_files ?? [];
	const seriesMultiple = report.series?.multiple_videos ?? [];
	const seriesUnneeded = report.series?.unneeded_files ?? [];
	const notIndexed = report.plex_sync?.not_indexed ?? [];

	const total = movieMultiple.length + movieUnneeded.length + seriesMultiple.length
		+ seriesUnneeded.length + notIndexed.length;

	if (total === 0) {
		return <div className="text-center py-12 text-slate-400">{t("no_warnings")}</div>;
	}

	return (
		<div className="flex flex-col gap-6">
			{notIndexed.length > 0 && (
				<Section title={t("warn_plex_not_indexed")} count={notIndexed.length} colorClass="text-red-500">
					{groupByFolder(notIndexed).map(({ folder, type, files }) => (
						<Row key={folder} label={folder}>
							<span className="text-slate-500 text-[11px] uppercase tracking-wide mb-0.5">{t(`plex_type_${type}`)}</span>
							<ul className="text-slate-400 text-[12px] list-disc list-inside">
								{files.map((f, i) => <li key={i}>{f}</li>)}
							</ul>
						</Row>
					))}
				</Section>
			)}

	
			{movieMultiple.length > 0 && (
				<Section title={t("warn_movie_multiple")} count={movieMultiple.length} colorClass="text-yellow-500">
					{movieMultiple.map((m, i) => (
						<Row key={i} label={m.folder}>
							<ul className="text-slate-400 text-[12px] list-disc list-inside">
								{m.videos.map((v, j) => <li key={j}>{v}</li>)}
							</ul>
						</Row>
					))}
				</Section>
			)}

			{movieUnneeded.length > 0 && (
				<Section title={t("warn_movie_unneeded")} count={movieUnneeded.length} colorClass="text-orange-500">
					{movieUnneeded.map((m, i) => (
						<Row key={i} label={m.folder}>
							<ul className="text-slate-400 text-[12px] list-disc list-inside">
								{m.files.map((f, j) => <li key={j}>{f}</li>)}
							</ul>
						</Row>
					))}
				</Section>
			)}

			{seriesMultiple.length > 0 && (
				<Section title={t("warn_series_multiple")} count={seriesMultiple.length} colorClass="text-yellow-500">
					{groupByShow(seriesMultiple).map(([show, episodes]) => (
						<Row key={show} label={show}>
							<ul className="text-slate-400 text-[12px] list-none flex flex-col gap-2 mt-1">
								{episodes.map((m, i) => {
									const epLabel = typeof m.season === "number" && m.season > 0
										? `S${String(m.season).padStart(2, "0")}E${String(m.episode).padStart(2, "0")}`
										: t("abs_episode", { n: m.episode });
									return (
										<li key={i}>
											<span className="text-slate-300 font-mono text-[11px]">{epLabel}</span>
											<ul className="list-disc list-inside ml-3 mt-0.5">
												{m.files.map((f, j) => <li key={j}>{f}</li>)}
											</ul>
										</li>
									);
								})}
							</ul>
						</Row>
					))}
				</Section>
			)}

			{seriesUnneeded.length > 0 && (
				<Section title={t("warn_series_unneeded")} count={seriesUnneeded.length} colorClass="text-orange-500">
					{groupByShow(seriesUnneeded).map(([show, items]) => (
						<Row key={show} label={show}>
							<ul className="text-slate-400 text-[12px] list-disc list-inside">
								{items.map((m, i) => <li key={i} className="font-mono">{m.file}</li>)}
							</ul>
						</Row>
					))}
				</Section>
			)}
		</div>
	);
}

function Section({ title, count, colorClass, children }) {
	return (
		<div>
			<div className="flex items-center gap-2 mb-2">
				<h2 className="text-sm font-semibold text-slate-300">{title}</h2>
				<span className={`text-xs font-medium ${colorClass}`}>{count}</span>
			</div>
			<div className="bg-surface border border-border rounded-lg overflow-hidden divide-y divide-border">
				{children}
			</div>
		</div>
	);
}

function Row({ label, children }) {
	return (
		<div className="px-4 py-3 flex flex-col gap-1">
			<span className="text-slate-200 text-[13px] font-medium">{label}</span>
			{children}
		</div>
	);
}
