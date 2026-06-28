import { useState } from "react";
import StatCard from "./StatCard.jsx";
import { findTorrentsForTitle, bestTorrentBadge } from "../torrentUtils.js";
import { useLang } from "../LangContext.jsx";
import { copyText } from "../utils/clipboard.js";
import { useBlacklist } from "../hooks/useBlacklist.js";

export default function MissingMovies({
	data,
	error,
	loading,
	newKeys = new Set(),
	torrents = [],
	blockedTitles = new Set(),
	onBlock,
	onToast,
}) {
	const { t } = useLang();
	const [search, setSearch] = useState("");

	if (loading) return <div className="text-center py-12 text-slate-400">{t("loading_report")}</div>;
	if (error) return <div className="bg-[#2d1a1a] border border-[#5c2626] rounded-lg p-4 text-red-500">{error}</div>;
	if (!data) return null;

	const visibleMissing = data.missing.filter((m) => !blockedTitles.has(m.title.toLowerCase()));

	const missing = visibleMissing.filter(
		(m) =>
			!search ||
			m.title.toLowerCase().includes(search.toLowerCase()) ||
			(m.collection || "").toLowerCase().includes(search.toLowerCase()),
	);

	const byCollection = missing.reduce((acc, m) => {
		const col = m.collection || "Uncategorized";
		if (!acc[col]) acc[col] = [];
		acc[col].push(m);
		return acc;
	}, {});

	const collections = Object.keys(byCollection).sort();

	return (
		<div>
			<div className="flex gap-4 mb-5 flex-wrap">
				{data.total != null && <StatCard label={t("stat_movies_on_disk")} value={data.total} colorClass="text-slate-200" />}
				<StatCard label={t("stat_missing_movies")} value={visibleMissing.length} colorClass="text-red-500" />
				<StatCard label={t("stat_affected_collections")} value={collections.length} />
				{data.unneeded_files?.length > 0 && (
					<StatCard label={t("stat_unneeded_files")} value={data.unneeded_files.length} colorClass="text-yellow-500" />
				)}
			</div>

			<input
				type="text"
				placeholder={t("search_movies")}
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				className="bg-surface border border-border rounded-md px-3 py-1.5 text-slate-200 text-[13px] w-full max-w-100 mb-5 outline-none focus:border-indigo-500 transition-colors"
			/>

			{missing.length === 0 ? (
				<div className="text-center py-12 text-slate-400">
					{search ? t("no_missing_movies_search") : t("no_missing_movies")}
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
					{collections.map((col) => (
						<div key={col}>
							<div className="text-[13px] font-semibold text-slate-400 uppercase tracking-[0.6px] mb-3">
								{col}
							</div>
							<div className="bg-surface border border-border rounded-lg overflow-hidden divide-y divide-border">
								{byCollection[col].map((m) => (
									<MovieRow
										key={m.tmdb_id ?? m.title}
										movie={m}
										onBlacklist={onBlock}
										matchedTorrents={findTorrentsForTitle(m.title, torrents)}
										isNew={newKeys.has(m.tmdb_id ?? m.title)}
										onToast={onToast}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			)}

		</div>
	);
}

function MovieRow({ movie, onBlacklist, matchedTorrents = [], isNew = false, onToast }) {
	const [copied, setCopied] = useState(false);
	function handleCopy(e) {
		e.stopPropagation();
		copyText(movie.title);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}
	const { t } = useLang();
	const { blockTitle } = useBlacklist({ onBlock: onBlacklist, onToast });
	const [pending, setPending] = useState(false);

	async function handleBlacklist() {
		setPending(true);
		try {
			await blockTitle(movie.title);
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="px-3.5 py-2.5 flex items-center gap-2 group hover:bg-surface2">
			<span
				onClick={handleCopy}
				className={`text-[13px] flex-1 min-w-0 leading-snug cursor-pointer select-none transition-colors ${copied ? "text-teal-400" : "text-slate-200"}`}
			>
				{movie.title}{copied && <span className="ml-1.5 text-[11px]">✓</span>}
			</span>
			<div className="flex items-center gap-1.5 shrink-0">
				{isNew && (
					<span className="px-1.5 py-0.5 rounded border text-[10px] font-medium text-teal-400 border-teal-800 bg-teal-950/40">
						{t("badge_new")}
					</span>
				)}
				{(() => {
					const badge = bestTorrentBadge(matchedTorrents, t);
					return badge ? (
						<span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.cls}`}>
							{badge.label}
						</span>
					) : null;
				})()}
				<span className="text-[11px] text-slate-500 whitespace-nowrap">
					{movie.year}
					{movie.tmdb_id && (
						<> · <a href={`https://www.themoviedb.org/movie/${movie.tmdb_id}`} target="_blank" rel="noreferrer" className="hover:text-slate-300">TMDB</a></>
					)}
				</span>
				<button
					onClick={handleBlacklist}
					disabled={pending}
					title={t("blacklist_btn")}
					className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-surface2 disabled:opacity-30 cursor-pointer"
				>
					<svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
						<path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
					</svg>
				</button>
			</div>
		</div>
	);
}
