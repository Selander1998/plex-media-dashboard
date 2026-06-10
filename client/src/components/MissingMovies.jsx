import { useState } from "react";
import StatCard from "./StatCard.jsx";
import { findTorrentsForTitle, torrentBadgeProps } from "../torrentUtils.js";
import { useLang } from "../LangContext.jsx";

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
				{data.multiple_videos?.length > 0 && (
					<StatCard label={t("stat_multiple_versions")} value={data.multiple_videos.length} colorClass="text-yellow-500" />
				)}
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
				collections.map((col) => (
					<div key={col} className="mb-5">
						<div className="text-[13px] font-semibold text-slate-400 uppercase tracking-[0.6px] mb-3 mt-7 first:mt-0">
							{col}
						</div>
						<div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
							{byCollection[col].map((m) => (
								<MovieCard
									key={m.tmdb_id}
									movie={m}
									onBlacklist={onBlock}
									matchedTorrents={findTorrentsForTitle(m.title, torrents)}
									isNew={newKeys.has(m.tmdb_id ?? m.title)}
									onToast={onToast}
								/>
							))}
						</div>
					</div>
				))
			)}

			{data.multiple_videos?.length > 0 && (
				<>
					<div className="text-[13px] font-semibold text-yellow-500 uppercase tracking-[0.6px] mb-3 mt-8">
						{t("multiple_videos_title")}
					</div>
					<div className="bg-surface border border-border rounded-lg overflow-hidden divide-y divide-border">
						{data.multiple_videos.map((m) => (
							<div key={m.folder} className="px-4 py-3 flex flex-col gap-1">
								<span className="text-slate-200 text-[13px] font-medium">{m.folder}</span>
								<ul className="text-slate-400 text-[12px] list-disc list-inside">
									{m.videos.map((v) => (
										<li key={v}>{v}</li>
									))}
								</ul>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	);
}

function MovieCard({ movie, onBlacklist, matchedTorrents = [], isNew = false, onToast }) {
	const { t } = useLang();
	const [pending, setPending] = useState(false);

	async function handleBlacklist() {
		setPending(true);
		try {
			const res = await fetch("/api/blacklist", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: movie.title }),
			});
			if (res.ok) {
				onBlacklist(movie.title);
				onToast?.(t("toast_blacklisted", { title: movie.title }));
			}
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="bg-surface border border-border rounded-lg px-4 py-3.5 flex flex-col gap-1.5 group">
			<div className="flex items-start gap-2">
				<span className="text-sm font-semibold text-slate-200 flex-1 leading-snug">{movie.title}</span>
				{isNew && (
					<span className="shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-medium text-teal-400 border-teal-800 bg-teal-950/40">
						{t("badge_new")}
					</span>
				)}
				{matchedTorrents.map((tor) => {
					const { label, cls } = torrentBadgeProps(tor, t);
					return (
						<span key={tor.hash} className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-medium ${cls}`}>
							{label}
						</span>
					);
				})}
			</div>
			<div className="flex items-center justify-between text-xs text-slate-400">
				<span>
					{movie.year}
					{movie.tmdb_id && (
						<>
							{" · "}
							<a href={`https://www.themoviedb.org/movie/${movie.tmdb_id}`} target="_blank" rel="noreferrer">
								TMDB
							</a>
						</>
					)}
				</span>
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
		</div>
	);
}
