import { useState, useEffect } from "react";
import StatCard from "./StatCard.jsx";
import { normalizeName, findTorrentsForTitle, torrentBadgeProps } from "../torrentUtils.js";
import { useLang } from "../LangContext.jsx";

function getMissingItems(item, report) {
	if (!report || item.category.toUpperCase() === "MOVIE") return [];
	const norm = normalizeName(item.title);
	return (report.series?.missing ?? []).filter((m) => normalizeName(m.show) === norm);
}

export function diskStatus(item, report) {
	if (!report) return null;
	const norm = normalizeName(item.title);
	const isMovie = item.category.toUpperCase() === "MOVIE";

	if (isMovie) {
		const list = report.movies?.titles_on_disk ?? [];
		return list.some((e) => normalizeName(e.title) === norm) ? "complete" : null;
	} else {
		const list = report.series?.shows_on_disk ?? [];
		if (!list.some((e) => normalizeName(e.title) === norm)) return null;
		const hasMissing = (report.series?.missing ?? []).some((m) => normalizeName(m.show) === norm);
		return hasMissing ? "incomplete" : "complete";
	}
}

export default function Watchlist({ data, error, loading, report, newTitles = new Set(), blockedTitles = new Set(), onBlock, onToast }) {
	const { t } = useLang();
	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState("all");
	const [torrents, setTorrents] = useState([]);

	useEffect(() => {
		fetch("/api/torrents")
			.then((r) => r.json())
			.then((d) => setTorrents(Array.isArray(d) ? d : []))
			.catch(() => {});
	}, []);

	if (loading) return <div className="text-center py-12 text-slate-400">{t("loading_watchlist")}</div>;
	if (error)
		return (
			<div className="bg-[#2d1a1a] border border-[#5c2626] rounded-lg p-4 text-red-500">
				{error}
			</div>
		);
	if (!data) return null;

	async function blockItem(title) {
		onBlock?.(title);
		onToast?.(t("toast_blacklisted", { title }));
		try {
			await fetch("/api/blacklist", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title }),
			});
		} catch {
			// best-effort — item is already hidden locally
		}
	}

	const visibleItems = data.items.filter((i) => !blockedTitles.has(i.title.toLowerCase()) && diskStatus(i, report) !== "complete");

	const items = visibleItems.filter((item) => {
		if (search && !item.title.toLowerCase().includes(search.toLowerCase())) return false;
		if (typeFilter === "movie" && item.category.toUpperCase() !== "MOVIE") return false;
		if (typeFilter === "tv" && item.category.toUpperCase() !== "TV") return false;
		return true;
	});

	const movieCount = visibleItems.filter((i) => i.category.toUpperCase() === "MOVIE").length;
	const tvCount = visibleItems.filter((i) => i.category.toUpperCase() !== "MOVIE").length;

	return (
		<div>
			<div className="flex gap-4 mb-5 flex-wrap">
				<StatCard label={t("wl_total")} value={visibleItems.length} />
				<StatCard label={t("wl_movies")} value={movieCount} colorClass="text-indigo-400" />
				<StatCard label={t("wl_series")} value={tvCount} colorClass="text-purple-400" />
			</div>

			<div className="flex gap-2.5 mb-5 flex-wrap items-center">
				<input
					type="text"
					placeholder={t("wl_search")}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="bg-surface border border-border rounded-md px-3 py-1.5 text-slate-200 text-[13px] flex-[1_1_200px] max-w-100 outline-none focus:border-indigo-500 transition-colors"
				/>
				<div className="flex gap-1">
					{[
						{ value: "all", label: t("wl_filter_all") },
						{ value: "movie", label: t("wl_filter_movies") },
						{ value: "tv", label: t("wl_filter_tv") },
					].map((f) => (
						<button
							key={f.value}
							onClick={() => setTypeFilter(f.value)}
							className={`px-3 py-1.5 rounded-md border text-xs cursor-pointer transition-colors ${
								typeFilter === f.value
									? "bg-indigo-500 border-indigo-500 text-white"
									: "bg-surface border-border text-slate-400 hover:text-slate-200"
							}`}>
							{f.label}
						</button>
					))}
				</div>
			</div>

			{items.length === 0 ? (
				<div className="text-center py-12 text-slate-400">{t("wl_no_results")}</div>
			) : (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
					{items.map((item) => (
						<WatchlistCard
							key={item.title}
							item={item}
							onBlock={blockItem}
							matchedTorrents={findTorrentsForTitle(item.title, torrents)}
							diskStatus={diskStatus(item, report)}
							missingItems={getMissingItems(item, report)}
							isNew={newTitles.has(item.title)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function WatchlistCard({ item, onBlock, matchedTorrents = [], diskStatus = null, missingItems = [], isNew = false }) {
	const { t } = useLang();
	const [expanded, setExpanded] = useState(false);
	const isMovie = item.category.toUpperCase() === "MOVIE";
	const cardCls = diskStatus === "incomplete"
		? "bg-yellow-950/20 border-yellow-900"
		: "bg-surface border-border";

	const pad = (n) => String(n).padStart(2, "0");
	const missingSeasons = missingItems.filter((m) => m.type === "season_missing");
	const missingEpisodes = missingItems.filter((m) => m.type === "episode");

	return (
		<div className={`border rounded-lg px-4 py-3.5 flex flex-col gap-1.5 group ${cardCls}`}>
			<div className="flex items-start gap-2">
				<span className="text-sm font-semibold text-slate-200 leading-snug flex-1">{item.title}</span>
				<div className="flex items-center gap-1 shrink-0">
					{diskStatus === "incomplete" && missingItems.length > 0 && (
						<button
							onClick={() => setExpanded((e) => !e)}
							className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-medium text-yellow-400 border-yellow-800 bg-yellow-950/40 cursor-pointer hover:bg-yellow-900/40 transition-colors">
							{t("badge_incomplete")}
							<svg
								className={`w-2.5 h-2.5 transition-transform ${expanded ? "rotate-180" : ""}`}
								viewBox="0 0 20 20"
								fill="currentColor">
								<path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
							</svg>
						</button>
					)}
					{diskStatus === "incomplete" && missingItems.length === 0 && (
						<span className="px-1.5 py-0.5 rounded border text-[10px] font-medium text-yellow-400 border-yellow-800 bg-yellow-950/40">
							{t("badge_incomplete")}
						</span>
					)}
					{matchedTorrents.map((tor) => {
						const { label, cls } = torrentBadgeProps(tor, t);
						return (
							<span key={tor.hash} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${cls}`}>
								{label}
							</span>
						);
					})}
					{isNew && (
						<span className="px-1.5 py-0.5 rounded border text-[10px] font-medium text-teal-400 border-teal-800 bg-teal-950/40">
							{t("badge_new")}
						</span>
					)}
					<span
						className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
							isMovie
								? "bg-indigo-500/20 text-indigo-400"
								: "bg-purple-500/20 text-purple-400"
						}`}>
						{isMovie ? t("badge_movie") : t("badge_series")}
					</span>
				</div>
			</div>
			<div className="flex items-center justify-between text-xs text-slate-400">
				<span>{item.year}</span>
				<div className="flex items-center gap-2">
					{item.link && item.link !== "No link" && (
						<a href={item.link} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">
							{t("plex_link")}
						</a>
					)}
					<button
						onClick={() => onBlock(item.title)}
						className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all cursor-pointer"
						title={t("block_btn")}>
						✕
					</button>
				</div>
			</div>
			{expanded && missingItems.length > 0 && (
				<div className="border-t border-yellow-900/50 pt-2 mt-0.5 flex flex-col gap-1">
					{missingSeasons.map((m) => (
						<div key={`s${m.season}`} className="flex items-center gap-2 text-[11px]">
							<span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-800">
								{t("full_season_badge")}
							</span>
							<span className="text-slate-300">{t("season_label", { n: m.season })}</span>
							{m.first_air_date && <span className="text-slate-500 ml-auto">{m.first_air_date}</span>}
						</div>
					))}
					{missingEpisodes.map((m) => (
						<div key={`s${m.season}e${m.episode}`} className="flex items-center gap-2 text-[11px]">
							<span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-800">
								{t("episode_badge")}
							</span>
							<span className="text-slate-300 font-mono">{`S${pad(m.season)}E${pad(m.episode)}`}</span>
							{(m.air_date || m.first_air_date) && (
								<span className="text-slate-500 ml-auto">{m.air_date || m.first_air_date}</span>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
