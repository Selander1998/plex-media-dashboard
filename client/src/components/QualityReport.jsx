import { useState } from "react";
import { useLang } from "../LangContext.jsx";

const FILTERS = [
	{ id: "all", labelKey: "quality_filter_all" },
	{ id: "low_resolution", labelKey: "quality_issue_low_res" },
	{ id: "low_video_bitrate", labelKey: "quality_issue_low_video_bitrate" },
	{ id: "low_audio_bitrate", labelKey: "quality_issue_low_audio_bitrate" },
];

const METRIC_TYPES = new Set(["low_resolution", "low_video_bitrate", "low_audio_bitrate"]);

function isMetricIssue(issue) {
	const type = issue.indexOf(":") === -1 ? issue : issue.slice(0, issue.indexOf(":"));
	return METRIC_TYPES.has(type);
}

function toMetricItems(items) {
	return items
		.map((item) => ({ ...item, issues: item.issues.filter(isMetricIssue) }))
		.filter((item) => item.issues.length > 0);
}

function issueType(issue) {
	const colon = issue.indexOf(":");
	return colon === -1 ? issue : issue.slice(0, colon);
}

function parseIssue(issue, t) {
	if (issue === "corrupt_or_unreadable") return { label: t("quality_issue_corrupt"), color: "text-red-500" };
	if (issue === "no_video_stream") return { label: t("quality_issue_no_video"), color: "text-red-500" };
	if (issue === "no_audio_stream") return { label: t("quality_issue_no_audio"), color: "text-amber-500" };
	if (issue.startsWith("bad_codec:")) return { label: `${t("quality_issue_bad_codec")}: ${issue.slice(10).toUpperCase()}`, color: "text-amber-500" };
	if (issue.startsWith("low_resolution:")) return { label: `${t("quality_issue_low_res")}: ${issue.slice(15)}`, color: "text-yellow-500" };
	if (issue.startsWith("low_video_bitrate:")) return { label: `${t("quality_issue_low_video_bitrate")}: ${issue.slice(18)}`, color: "text-yellow-500" };
	if (issue.startsWith("low_audio_bitrate:")) return { label: `${t("quality_issue_low_audio_bitrate")}: ${issue.slice(18)}`, color: "text-slate-400" };
	return { label: issue, color: "text-slate-400" };
}

function sortValue(item, filter) {
	if (filter === "low_video_bitrate" || filter === "low_audio_bitrate") {
		const issue = item.issues.find((i) => i.startsWith(filter + ":"));
		return issue ? parseInt(issue.replace(/[^0-9]/g, "")) : Infinity;
	}
	const issue = item.issues.find((i) => i.startsWith("low_resolution:"));
	if (!issue) return Infinity;
	const [w, h] = issue.slice(15).split("x").map(Number);
	return w * h;
}

const SORTABLE_FILTERS = new Set(["low_resolution", "low_video_bitrate", "low_audio_bitrate"]);

function filterItems(items, filter, sortDir) {
	const filtered = filter === "all"
		? items
		: items
			.map((item) => ({ ...item, issues: item.issues.filter((i) => issueType(i) === filter) }))
			.filter((item) => item.issues.length > 0);

	if (!SORTABLE_FILTERS.has(filter)) return filtered;
	return [...filtered].sort((a, b) => {
		const diff = sortValue(a, filter) - sortValue(b, filter);
		return sortDir === "worst" ? diff : -diff;
	});
}

function groupByFolder(items, sortByQuality = false) {
	const map = new Map();
	for (const item of items) {
		const slash = item.path.indexOf("/");
		const folder = slash === -1 ? item.path : item.path.slice(0, slash);
		const file = slash === -1 ? "" : item.path.slice(slash + 1);
		if (!map.has(folder)) map.set(folder, []);
		map.get(folder).push({ file, issues: item.issues });
	}
	const entries = [...map.entries()];
	if (!sortByQuality) entries.sort(([a], [b]) => a.localeCompare(b));
	return entries;
}

function Section({ title, count, children }) {
	return (
		<div>
			<div className="flex items-center gap-2 mb-2">
				<h2 className="text-sm font-semibold text-slate-300">{title}</h2>
				<span className="text-xs font-medium text-amber-500">{count}</span>
			</div>
			<div className="bg-surface border border-border rounded-lg overflow-hidden divide-y divide-border">
				{children}
			</div>
		</div>
	);
}

export default function QualityReport({ data, error, loading }) {
	const { t, lang } = useLang();
	const locale = lang === "sv" ? "sv-SE" : "en-US";
	const [filter, setFilter] = useState("all");
	const [sortDir, setSortDir] = useState("worst");

	if (loading) return <div className="text-center py-12 text-slate-400">{t("loading_report")}</div>;
	if (error)
		return (
			<div className="bg-[#2d1a1a] border border-[#5c2626] rounded-lg p-4 text-red-400">
				{error}
			</div>
		);
	if (!data) return null;

	const allMovies = toMetricItems(data.movies ?? []);
	const allSeries = toMetricItems(data.series ?? []);

	if (allMovies.length + allSeries.length === 0)
		return <div className="text-center py-12 text-slate-400">{t("no_quality_issues")}</div>;

	const movies = filterItems(allMovies, filter, sortDir);
	const series = filterItems(allSeries, filter, sortDir);
	const sortByQuality = SORTABLE_FILTERS.has(filter);
	const movieGroups = groupByFolder(movies, sortByQuality);
	const seriesGroups = groupByFolder(series, sortByQuality);

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-center gap-1.5">
				{FILTERS.map(({ id, labelKey }) => (
					<button
						key={id}
						onClick={() => setFilter(id)}
						className={`px-2.5 py-1 text-xs rounded cursor-pointer transition-colors ${
							filter === id
								? "bg-indigo-600 text-white"
								: "bg-surface2 text-slate-400 hover:text-slate-200"
						}`}
					>
						{t(labelKey)}
					</button>
				))}
				{SORTABLE_FILTERS.has(filter) && (
					<button
						onClick={() => setSortDir((d) => d === "worst" ? "best" : "worst")}
						className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded cursor-pointer transition-colors bg-surface2 text-slate-400 hover:text-slate-200"
					>
						{sortDir === "worst" ? `↓ ${t("quality_sort_worst")}` : `↑ ${t("quality_sort_best")}`}
					</button>
				)}
			</div>

			{movies.length > 0 && (
				<Section title={t("quality_movies_section")} count={movies.length}>
					{movieGroups.map(([folder, files]) => (
						<div key={folder} className="px-4 py-3 flex flex-col gap-1">
							<span className="text-slate-200 text-[13px] font-medium">{folder}</span>
							<ul className="flex flex-col gap-1 mt-0.5">
								{files.map(({ file, issues }, i) => (
									<li key={i} className="flex flex-col gap-0.5">
										{file && <span className="text-slate-500 text-[11px] font-mono">{file}</span>}
										<div className="flex flex-wrap gap-1.5">
											{issues.map((issue, j) => {
												const { label, color } = parseIssue(issue, t);
												return (
													<span key={j} className={`text-[11px] ${color}`}>
														{label}
													</span>
												);
											})}
										</div>
									</li>
								))}
							</ul>
						</div>
					))}
				</Section>
			)}

			{series.length > 0 && (
				<Section title={t("quality_series_section")} count={series.length}>
					{seriesGroups.map(([folder, files]) => (
						<div key={folder} className="px-4 py-3 flex flex-col gap-1">
							<span className="text-slate-200 text-[13px] font-medium">{folder}</span>
							<ul className="flex flex-col gap-1 mt-0.5">
								{files.map(({ file, issues }, i) => (
									<li key={i} className="flex flex-col gap-0.5">
										{file && <span className="text-slate-500 text-[11px] font-mono">{file}</span>}
										<div className="flex flex-wrap gap-1.5">
											{issues.map((issue, j) => {
												const { label, color } = parseIssue(issue, t);
												return (
													<span key={j} className={`text-[11px] ${color}`}>
														{label}
													</span>
												);
											})}
										</div>
									</li>
								))}
							</ul>
						</div>
					))}
				</Section>
			)}

			{movies.length === 0 && series.length === 0 && (
				<div className="text-center py-12 text-slate-400">{t("no_quality_issues")}</div>
			)}

			{data.generated && (
				<p className="text-center text-[11px] text-slate-600">
					{t("quality_last_scanned")}: {new Date(data.generated).toLocaleString(locale)}
				</p>
			)}
		</div>
	);
}
