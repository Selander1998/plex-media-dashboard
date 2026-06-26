import { useState, useEffect } from "react";
import StatCard from "./StatCard.jsx";
import { normalizeName, findTorrentsForTitle, bestTorrentBadge } from "../torrentUtils.js";
import { useLang } from "../LangContext.jsx";
import { copyText } from "../utils/clipboard.js";

export default function MissingSeries({ data, error, loading, newKeys = new Set(), onToast }) {
	const { t } = useLang();
	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState("all");
	const [expanded, setExpanded] = useState(new Set());
	const [blacklisted, setBlacklisted] = useState(new Set());
	const [torrents, setTorrents] = useState([]);

	useEffect(() => {
		fetch("/api/torrents")
			.then((r) => r.json())
			.then((d) => setTorrents(Array.isArray(d) ? d : []))
			.catch(() => {});
	}, []);

	if (loading) return <div className="text-center py-12 text-slate-400">{t("loading_report")}</div>;
	if (error) return <div className="bg-[#2d1a1a] border border-[#5c2626] rounded-lg p-4 text-red-500">{error}</div>;
	if (!data) return null;

	function onBlacklist(show) {
		setBlacklisted((prev) => new Set([...prev, show]));
	}

	const missing = data.missing.filter((m) => {
		if (blacklisted.has(m.show)) return false;
		if (search && !m.show.toLowerCase().includes(search.toLowerCase())) return false;
		if (typeFilter === "seasons" && m.type !== "season_missing") return false;
		if (typeFilter === "episodes" && m.type !== "episode") return false;
		return true;
	});

	const byShow = missing.reduce((acc, m) => {
		if (!acc[m.show]) acc[m.show] = [];
		acc[m.show].push(m);
		return acc;
	}, {});

	const shows = Object.keys(byShow).sort();

	const seasonCount = data.missing.filter((m) => m.type === "season_missing").length;
	const episodeCount = data.missing.filter((m) => m.type === "episode").length;
	const showCount = new Set(data.missing.map((m) => m.show)).size;

	const isSearching = !!search || typeFilter !== "all";

	const toggle = (show) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			next.has(show) ? next.delete(show) : next.add(show);
			return next;
		});

	const allExpanded = shows.length > 0 && shows.every((s) => expanded.has(s));
	const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(shows));

	return (
		<div>
			<div className="flex gap-4 mb-5 flex-wrap">
				{data.total_shows != null && (
					<StatCard label={t("stat_series_on_disk")} value={data.total_shows} colorClass="text-slate-200" />
				)}
				{data.total_seasons != null && <StatCard label={t("stat_seasons")} value={data.total_seasons} />}
				{data.total_episodes != null && <StatCard label={t("stat_episodes")} value={data.total_episodes} />}

				<StatCard label={t("stat_missing_seasons")} value={seasonCount} colorClass="text-red-500" />
				<StatCard label={t("stat_missing_episodes")} value={episodeCount} colorClass="text-yellow-500" />
				<StatCard label={t("stat_affected_series")} value={showCount} colorClass="text-orange-500" />

			</div>

			<div className="flex gap-2.5 mb-5 flex-wrap items-center">
				<input
					type="text"
					placeholder={t("search_series")}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="bg-surface border border-border rounded-md px-3 py-1.5 text-slate-200 text-[13px] flex-[1_1_200px] max-w-100 outline-none focus:border-indigo-500 transition-colors"
				/>
				<div className="flex gap-1">
					{[
						{ value: "all", label: t("filter_all") },
						{ value: "seasons", label: t("filter_seasons") },
						{ value: "episodes", label: t("filter_episodes") },
					].map((f) => (
						<button
							key={f.value}
							onClick={() => setTypeFilter(f.value)}
							className={`px-3 py-1.5 rounded-md border text-xs cursor-pointer transition-colors ${
								typeFilter === f.value
									? "bg-indigo-500 border-indigo-500 text-white"
									: "bg-surface border-border text-slate-400 hover:text-slate-200"
							}`}
						>
							{f.label}
						</button>
					))}
				</div>
				{!isSearching && shows.length > 0 && (
					<button
						onClick={toggleAll}
						className="px-3 py-1.5 rounded-md border border-border bg-surface text-slate-400 text-xs cursor-pointer hover:text-slate-200 transition-colors ml-auto"
					>
						{allExpanded ? t("collapse_all") : t("expand_all")}
					</button>
				)}
			</div>

			{shows.length === 0 ? (
				<div className="text-center py-12 text-slate-400">{isSearching ? t("no_results") : t("no_missing_series")}</div>
			) : (
				<div className="flex flex-col gap-2">
					{shows.map((show) => (
						<ShowSection
							key={show}
							show={show}
							items={byShow[show]}
							expanded={isSearching || expanded.has(show)}
							onToggle={() => toggle(show)}
							showToggle={!isSearching}
							onBlacklist={onBlacklist}
							matchedTorrents={findTorrentsForTitle(show, torrents)}
							newKeys={newKeys}
							onToast={onToast}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function torrentCoversSeason(name, season) {
	const pad = (n) => String(n).padStart(2, "0");
	if (new RegExp(`s${pad(season)}(?![e\\d])`, "i").test(normalizeName(name))) return true;
	const range = /[Ss](\d+)\s*[-–]\s*[Ss](\d+)/.exec(name);
	return !!range && season >= parseInt(range[1], 10) && season <= parseInt(range[2], 10);
}

function rowTorrents(m, matchedTorrents) {
	const pad = (n) => String(n).padStart(2, "0");
	if (m.type === "season_missing") {
		return matchedTorrents.filter((t) => torrentCoversSeason(t.name, m.season));
	}
	const tag = `s${pad(m.season)}e${pad(m.episode)}`;
	return matchedTorrents.filter((t) => normalizeName(t.name).includes(tag) || torrentCoversSeason(t.name, m.season));
}

const seriesKey = (m) => `${m.show}|${m.type}|${m.season}|${m.episode ?? 0}`;

function compressEpisodes(episodes) {
	const pad = (n) => "E" + String(n).padStart(2, "0");
	const sorted = [...episodes].sort((a, b) => a - b);
	const ranges = [];
	let start = sorted[0],
		end = sorted[0];
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i] === end + 1) {
			end = sorted[i];
		} else {
			ranges.push(start === end ? pad(start) : `${pad(start)}–${pad(end)}`);
			start = end = sorted[i];
		}
	}
	ranges.push(start === end ? pad(start) : `${pad(start)}–${pad(end)}`);
	return ranges.join(", ");
}

function ShowSection({
	show,
	items,
	expanded,
	onToggle,
	showToggle,
	onBlacklist,
	matchedTorrents = [],
	newKeys = new Set(),
	onToast,
}) {
	const { t } = useLang();
	const [pending, setPending] = useState(false);
	const [copied, setCopied] = useState(false);
	function handleCopy(e) {
		e.stopPropagation();
		copyText(show);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}
	const seasonCount = items.filter((m) => m.type === "season_missing").length;
	const episodeCount = items.filter((m) => m.type === "episode").length;
	const tmdbId = items.find((m) => m.tmdb_id)?.tmdb_id;
	const hasNew = items.some((m) => newKeys.has(seriesKey(m)));

	async function handleBlacklist(e) {
		e.stopPropagation();
		setPending(true);
		try {
			const res = await fetch("/api/blacklist", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: show }),
			});
			if (res.ok) {
				onBlacklist(show);
				onToast?.(t("toast_blacklisted", { title: show }));
			}
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="bg-surface border border-border rounded-lg overflow-hidden">
			<button
				onClick={showToggle ? onToggle : undefined}
				className={`w-full flex items-center gap-3 px-4 py-3 text-left ${
					showToggle ? "cursor-pointer hover:bg-surface2" : "cursor-default"
				} transition-colors group`}
			>
				{showToggle && (
					<svg
						className={`shrink-0 w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fillRule="evenodd"
							d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
						/>
					</svg>
				)}
				<span
					onClick={handleCopy}
					className={`font-semibold text-sm flex-1 cursor-pointer select-none transition-colors ${copied ? "text-teal-400" : "text-slate-200"}`}
				>
					{show}{copied && <span className="ml-1.5 text-[11px] font-normal">✓</span>}
				</span>
				<div className="flex items-center gap-3 text-xs shrink-0">
					{hasNew && (
						<span className="px-1.5 py-0.5 rounded border text-[10px] font-medium text-teal-400 border-teal-800 bg-teal-950/40">
							{t("badge_new")}
						</span>
					)}
					{(() => {
						const badge = bestTorrentBadge(matchedTorrents, t);
						return badge ? (
							<span
								onClick={(e) => e.stopPropagation()}
								className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.cls}`}
							>
								{badge.label}
							</span>
						) : null;
					})()}
					{seasonCount > 0 && (
						<span className="text-red-500">
							{seasonCount} {t(seasonCount === 1 ? "word_season" : "word_seasons")}
						</span>
					)}
					{episodeCount > 0 && (
						<span className="text-yellow-500">
							{episodeCount} {t(episodeCount === 1 ? "word_episode" : "word_episodes")}
						</span>
					)}
					{tmdbId && (
						<a
							href={`https://www.themoviedb.org/tv/${tmdbId}`}
							target="_blank"
							rel="noreferrer"
							onClick={(e) => e.stopPropagation()}
							className="text-indigo-500"
						>
							TMDB
						</a>
					)}
					<button
						onClick={handleBlacklist}
						disabled={pending}
						title={t("blacklist_btn")}
						className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-surface2 disabled:opacity-30 cursor-pointer"
					>
						<svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
							<path
								fillRule="evenodd"
								d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z"
								clipRule="evenodd"
							/>
						</svg>
					</button>
				</div>
			</button>

			{expanded &&
				(() => {
					const bySeasonNum = {};
					for (const m of items) {
						if (!bySeasonNum[m.season]) bySeasonNum[m.season] = { full: null, episodes: [] };
						if (m.type === "season_missing") bySeasonNum[m.season].full = m;
						else bySeasonNum[m.season].episodes.push(m);
					}
					const seasons = Object.keys(bySeasonNum)
						.map(Number)
						.sort((a, b) => a - b);
					return (
						<div className="border-t border-border divide-y divide-border">
							{seasons.map((s) => {
								const { full, episodes } = bySeasonNum[s];
								const pad2 = (n) => String(n).padStart(2, "0");
								const isNewSeason = full ? newKeys.has(seriesKey(full)) : episodes.some((m) => newKeys.has(seriesKey(m)));
								const seasonTorrents = full
									? rowTorrents(full, matchedTorrents)
									: matchedTorrents.filter((tor) => torrentCoversSeason(tor.name, s));
								const airDate = full
									? full.first_air_date || full.air_date
									: episodes[0]?.first_air_date || episodes[0]?.air_date;
								return (
									<div key={s} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface2">
										<span className="text-slate-400 text-[13px] shrink-0 w-20">{t("season_label", { n: pad2(s) })}</span>
										<div className="flex items-center gap-2 flex-wrap flex-1">
											{full ? (
												<span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-800">
													{t("season_missing_full")}
												</span>
											) : (
												<span className="text-yellow-500 font-mono text-[12px]">
													{compressEpisodes(episodes.map((m) => m.episode))}
												</span>
											)}
											{isNewSeason && (
												<span className="px-1.5 py-0.5 rounded border text-[10px] font-medium text-teal-400 border-teal-800 bg-teal-950/40">
													{t("badge_new")}
												</span>
											)}
											{(() => {
												const badge = bestTorrentBadge(seasonTorrents, t);
												return badge ? (
													<span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.cls}`}>
														{badge.label}
													</span>
												) : null;
											})()}
										</div>
										{airDate && <span className="text-slate-500 text-[12px] shrink-0">{airDate}</span>}
									</div>
								);
							})}
						</div>
					);
				})()}
		</div>
	);
}
