import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import StatCard from "./StatCard.jsx";
import { useLang } from "../LangContext.jsx";
import { formatBytes } from "../utils/format.js";

function formatSpeed(bytesPerSec) {
	if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
	return `${formatBytes(bytesPerSec, "0 B")}/s`;
}

function formatKbps(kbps, tr) {
	if (kbps === 0) return tr("unlimited");
	if (kbps < 1024) return `${kbps} KB/s`;
	return `${(kbps / 1024).toFixed(1)} MB/s`;
}

function formatAddedDate(ts, tr, locale) {
	const d = new Date(ts * 1000);
	const diffDays = Math.floor((Date.now() - d) / 86400000);
	if (diffDays === 0) return tr("today");
	if (diffDays === 1) return tr("yesterday");
	if (diffDays < 7) return tr("days_ago", { n: diffDays });
	return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

const dotForState = {
	downloading: "blue",
	metaDL: "yellow",
	uploading: "green",
	stalledDL: "yellow",
	stalledUP: "yellow",
	pausedDL: "dim",
	pausedUP: "dim",
	stoppedDL: "dim",
	stoppedUP: "dim",
	queuedDL: "dim",
	queuedUP: "dim",
	checkingDL: "yellow",
	checkingUP: "yellow",
	checkingResumeData: "yellow",
	moving: "yellow",
	error: "red",
	missingFiles: "red",
};

const dotClass = {
	green: "bg-green-500",
	yellow: "bg-yellow-500",
	red: "bg-red-500",
	blue: "bg-blue-500",
	dim: "bg-slate-400",
};

function extractBaseTitle(name) {
	const seriesMatch = name.match(/^(.+?)\s+S\d{1,2}(?:E\d{1,2})?(?:\s|$)/i);
	if (seriesMatch) return seriesMatch[1].trim();
	const seasonMatch = name.match(/^(.+?)\s+Season\s+\d+/i);
	if (seasonMatch) return seasonMatch[1].trim();
	const movieMatch = name.match(/^(.+?)\s+\(\d{4}\)/);
	if (movieMatch) return movieMatch[1].trim();
	return name;
}

const PAUSABLE = new Set([
	"downloading",
	"uploading",
	"stalledDL",
	"stalledUP",
	"queuedDL",
	"queuedUP",
]);
const RESUMABLE = new Set(["pausedDL", "pausedUP", "stoppedDL", "stoppedUP"]);

function SortIcon({ active, dir }) {
	return (
		<span className="inline-flex flex-col gap-px ml-1 align-middle">
			<span
				className={`block w-0 h-0 border-x-[3.5px] border-x-transparent border-b-4 ${active && dir === "asc" ? "border-b-slate-200" : "border-b-slate-600"}`}
			/>
			<span
				className={`block w-0 h-0 border-x-[3.5px] border-x-transparent border-t-4 ${active && dir === "desc" ? "border-t-slate-200" : "border-t-slate-600"}`}
			/>
		</span>
	);
}

function SpeedSlider({ label, limitBytes, endpoint, colorClass, accentClass, currentSpeed, tr, onToast }) {
	const MAX_KBPS = 102400;
	const [kbps, setKbps] = useState(0);
	const initialized = useRef(false);
	const [showInput, setShowInput] = useState(false);
	const [minutesInput, setMinutesInput] = useState("60");
	const [unlimitedUntil, setUnlimitedUntil] = useState(null);
	const [remaining, setRemaining] = useState(null);
	const savedKbps = useRef(null);

	useEffect(() => {
		if (!initialized.current && limitBytes !== undefined) {
			setKbps(Math.round((limitBytes || 0) / 1024));
			initialized.current = true;
		}
	}, [limitBytes]);

	// Sync unlimited state from server on mount (survives page reload)
	useEffect(() => {
		fetch(`${endpoint}/unlimited`)
			.then((r) => r.json())
			.then((d) => {
				if (d.active && d.restoreAt > Date.now()) {
					savedKbps.current = Math.round(d.restoreLimit / 1024);
					setKbps(0);
					setUnlimitedUntil(d.restoreAt);
					setRemaining(Math.ceil((d.restoreAt - Date.now()) / 1000));
				}
			})
			.catch(() => {});
	}, [endpoint]);

	useEffect(() => {
		if (!unlimitedUntil) return;
		const id = setInterval(() => {
			const secs = Math.max(0, Math.ceil((unlimitedUntil - Date.now()) / 1000));
			setRemaining(secs);
			if (secs === 0) {
				setUnlimitedUntil(null);
				setRemaining(null);
				const restore = savedKbps.current ?? 0;
				setKbps(restore);
				// Server already handled the restore — no API call needed here
			}
		}, 1000);
		return () => clearInterval(id);
	}, [unlimitedUntil]);

	function handleChange(e) {
		setKbps(Number(e.target.value));
	}

	async function handleRelease(e) {
		const v = Number(e.target.value);
		try {
			const res = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ limit: v * 1024 }),
			});
			if (!res.ok) throw new Error();
		} catch {
			setKbps(Math.round((limitBytes || 0) / 1024));
			onToast?.(tr("action_failed"), true);
		}
	}

	async function activateUnlimited() {
		const minutes = parseInt(minutesInput, 10);
		if (!minutes || minutes < 1) return;
		savedKbps.current = kbps;
		setShowInput(false);
		try {
			const res = await fetch(`${endpoint}/unlimited`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ minutes, restoreLimit: kbps * 1024 }),
			});
			if (!res.ok) throw new Error();
			const d = await res.json();
			setKbps(0);
			setUnlimitedUntil(d.restoreAt);
			setRemaining(Math.ceil((d.restoreAt - Date.now()) / 1000));
		} catch {
			onToast?.(tr("action_failed"), true);
		}
	}

	async function cancelUnlimited() {
		setUnlimitedUntil(null);
		setRemaining(null);
		const restore = savedKbps.current ?? 0;
		setKbps(restore);
		try {
			await fetch(`${endpoint}/unlimited`, { method: "DELETE" });
		} catch {
			onToast?.(tr("action_failed"), true);
		}
	}

	return (
		<div className="flex items-center gap-2 sm:gap-3 min-w-0">
			<span className={`text-base leading-none w-4 shrink-0 ${colorClass}`}>{label}</span>
			<span className="text-xs text-slate-200 w-14 sm:w-24 shrink-0 tabular-nums">
				{currentSpeed != null ? formatSpeed(currentSpeed) : "—"}
			</span>
			<input
				type="range"
				min={0}
				max={MAX_KBPS}
				step={256}
				value={kbps}
				onChange={handleChange}
				disabled={!!unlimitedUntil}
				className={`flex-1 min-w-0 h-1 ${unlimitedUntil ? "opacity-30 cursor-not-allowed" : `cursor-pointer ${accentClass}`}`}
				onPointerUp={handleRelease}
			/>
			{unlimitedUntil ? (
				<div className="flex items-center gap-1.5 shrink-0">
					<span className="text-xs tabular-nums text-emerald-400 font-medium px-2 py-0.5 rounded border border-emerald-800 bg-emerald-500/10">
						∞ {formatEta(remaining ?? 0)}
					</span>
					<button
						onClick={cancelUnlimited}
						title={tr("unlimited_cancel")}
						className="text-[11px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 hover:border-red-700 hover:text-red-400 transition-colors cursor-pointer"
					>
						✕
					</button>
				</div>
			) : showInput ? (
				<div className="flex items-center gap-1 shrink-0">
					<input
						autoFocus
						type="number"
						min={1}
						value={minutesInput}
						onChange={(e) => setMinutesInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") activateUnlimited();
							if (e.key === "Escape") setShowInput(false);
						}}
						className="w-12 bg-surface2 border border-border rounded px-1.5 py-0.5 text-xs text-slate-200 outline-none focus:border-emerald-600 tabular-nums text-center"
					/>
					<span className="text-[11px] text-slate-500">min</span>
					<button
						onClick={activateUnlimited}
						className="text-[11px] px-1.5 py-0.5 rounded border border-emerald-800 text-emerald-400 hover:bg-emerald-900/30 transition-colors cursor-pointer"
					>
						✓
					</button>
					<button
						onClick={() => setShowInput(false)}
						className="text-[11px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
					>
						✕
					</button>
				</div>
			) : (
				<div className="flex items-center gap-1.5 shrink-0">
					<span className="text-xs text-slate-500 w-14 sm:w-20 text-right tabular-nums">
						{formatKbps(kbps, tr)}
					</span>
					<button
						onClick={() => setShowInput(true)}
						title={tr("unlimited_btn")}
						className="px-1.5 py-0.5 rounded border border-slate-700 text-[11px] text-slate-400 hover:border-emerald-700 hover:text-emerald-400 transition-colors cursor-pointer"
					>
						∞
					</button>
				</div>
			)}
		</div>
	);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function buildDiskData(report) {
	const movies = new Set();
	const shows = new Set();
	const missingSeasons = new Set();
	const missingEpisodes = new Set();
	for (const { title } of report?.movies?.titles_on_disk ?? []) movies.add(norm(title));
	for (const { title } of report?.series?.shows_on_disk ?? []) shows.add(norm(title));
	for (const entry of report?.series?.missing ?? []) {
		const key = norm(entry.show);
		if (entry.type === "season_missing") missingSeasons.add(`${key}:${entry.season}`);
		else if (entry.type === "episode") missingEpisodes.add(`${key}:${entry.season}:${entry.episode}`);
	}
	return { movies, shows, missingSeasons, missingEpisodes };
}

function parseTorrentName(name) {
	const epMatch = name.match(/^(.+?)\s+S(\d{1,2})E(\d{1,2})(?:\s|$)/i);
	if (epMatch) return { title: epMatch[1].trim(), season: parseInt(epMatch[2]), episode: parseInt(epMatch[3]) };
	const sMatch = name.match(/^(.+?)\s+S(\d{1,2})(?:\s|$)/i);
	if (sMatch) return { title: sMatch[1].trim(), season: parseInt(sMatch[2]), episode: null };
	const seasonMatch = name.match(/^(.+?)\s+Season\s+(\d+)/i);
	if (seasonMatch) return { title: seasonMatch[1].trim(), season: parseInt(seasonMatch[2]), episode: null };
	const movieMatch = name.match(/^(.+?)\s+\(\d{4}\)/);
	if (movieMatch) return { title: movieMatch[1].trim(), season: null, episode: null };
	return { title: name, season: null, episode: null };
}

export default function Torrents({ torrents, transfer, loading, error, onRefresh, onToast, report, qualityBlocks = [], onQualityBlocksChange }) {
	const { t: tr, locale } = useLang();

	const [filter, setFilter] = useState(() => localStorage.getItem("torrent_filter") || "all");
	const [sortKey, setSortKey] = useState("progress");
	const [sortDir, setSortDir] = useState("desc");
	const [search, setSearch] = useState("");
	const [pending, setPending] = useState(new Set());
	const [confirmDelete, setConfirmDelete] = useState(new Set());
	const [expandedHash, setExpandedHash] = useState(null);
	const [actionError, setActionError] = useState(null);
	const [renamingHash, setRenamingHash] = useState(null);
	const [renameValue, setRenameValue] = useState("");
	const [expandedGroups, setExpandedGroups] = useState(new Set());

	const diskData = useMemo(() => buildDiskData(report), [report]);
	function isOnDisk(torrentName) {
		const { title, season, episode } = parseTorrentName(torrentName);
		const key = norm(title);
		if (season !== null) {
			if (!diskData.shows.has(key)) return false;
			if (diskData.missingSeasons.has(`${key}:${season}`)) return false;
			if (episode !== null && diskData.missingEpisodes.has(`${key}:${season}:${episode}`)) return false;
			return true;
		}
		return diskData.movies.has(key);
	}

	const COLUMNS = [
		{ label: tr("col_name"),     key: "name",     defaultDir: "asc",  cls: "" },
		{ label: tr("col_size"),     key: "size",     defaultDir: "desc", cls: "hidden sm:table-cell" },
		{ label: tr("col_progress"), key: "progress", defaultDir: "desc", cls: "" },
		{ label: tr("col_status"),   key: null,                           cls: "" },
		{ label: tr("col_down"),     key: "dlspeed",  defaultDir: "desc", cls: "hidden sm:table-cell" },
		{ label: tr("col_up"),       key: "upspeed",  defaultDir: "desc", cls: "hidden md:table-cell" },
		{ label: tr("col_eta"),      key: "eta",      defaultDir: "asc",  cls: "hidden lg:table-cell" },
		{ label: tr("col_added"),    key: "added_on", defaultDir: "desc", cls: "hidden lg:table-cell" },
		{ label: tr("col_disk"),     key: null,                           cls: "hidden lg:table-cell" },
		{ label: "",                 key: null,                           cls: "" },
	];

	const filters = [
		{ value: "all", label: tr("filter_all") },
		{ value: "downloading", label: tr("filter_downloading") },
		{ value: "seeding", label: tr("filter_seeding") },
		{ value: "completed", label: tr("filter_completed") },
		{ value: "paused", label: tr("filter_paused") },
		{ value: "error", label: tr("filter_error") },
	];

	const qualityBlockMap = useMemo(() => new Map(qualityBlocks.map((b) => [b.hash, b])), [qualityBlocks]);

	async function handleProcessAnyway(hash) {
		setPending((p) => new Set([...p, hash]));
		try {
			const res = await fetch(`/api/quality-blocks/${hash}/process`, { method: "POST" });
			if (!res.ok) throw new Error();
			onQualityBlocksChange?.((prev) => prev.filter((b) => b.hash !== hash));
			onToast?.(tr("toast_process_anyway"));
			setTimeout(onRefresh, 800);
		} catch {
			onToast?.(tr("action_failed"), true);
		} finally {
			setPending((p) => { const n = new Set(p); n.delete(hash); return n; });
		}
	}

	async function handleDismissBlock(hash) {
		await fetch(`/api/quality-blocks/${hash}`, { method: "DELETE" }).catch(() => {});
		onQualityBlocksChange?.((prev) => prev.filter((b) => b.hash !== hash));
	}

async function handleAction(action, hash) {
		setPending((p) => new Set([...p, hash]));
		try {
			const res = await fetch(`/api/torrents/${action}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ hash }),
			});
			if (!res.ok) {
				const { detail } = await res.json().catch(() => ({}));
				setActionError(detail || tr("action_failed"));
				setTimeout(() => setActionError(null), 3000);
				return;
			}
			setTimeout(onRefresh, 800);
		} catch {
			setActionError(tr("network_error"));
			setTimeout(() => setActionError(null), 3000);
		} finally {
			setPending((p) => {
				const n = new Set(p);
				n.delete(hash);
				return n;
			});
		}
	}

	function handleDeleteClick(e, hash) {
		e.stopPropagation();
		if (confirmDelete.has(hash)) {
			handleAction("delete", hash);
			setConfirmDelete((s) => {
				const n = new Set(s);
				n.delete(hash);
				return n;
			});
		} else {
			setConfirmDelete((s) => new Set([...s, hash]));
			setTimeout(
				() =>
					setConfirmDelete((s) => {
						const n = new Set(s);
						n.delete(hash);
						return n;
					}),
				2500,
			);
		}
	}

	function startRename(e, hash, currentName) {
		e.stopPropagation();
		setRenamingHash(hash);
		setRenameValue(currentName);
	}

	async function handleRename(hash) {
		const name = renameValue.trim();
		setRenamingHash(null);
		if (!name) return;
		try {
			await fetch("/api/torrents/rename", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ hash, name }),
			});
			onToast?.(tr("toast_renamed", { name }));
			setTimeout(onRefresh, 500);
		} catch {
			onToast?.(tr("toast_rename_failed", { name }), true);
		}
	}

	function handleSort(key, defaultDir) {
		if (!key) return;
		if (key === sortKey) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortKey(key);
			setSortDir(defaultDir ?? "asc");
		}
	}

	const filtered = torrents
		.filter((t) => {
			if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
			if (filter === "all") return true;
			if (filter === "downloading") return t.state === "downloading";
			if (filter === "seeding") return ["uploading", "stalledUP", "queuedUP"].includes(t.state);
			if (filter === "completed") return t.progress === 1;
			if (filter === "paused") return t.state.includes("paused") || t.state.includes("stopped");
			if (filter === "error") return t.state === "error" || t.state === "missingFiles";
			return true;
		})
		.sort((a, b) => {
			let cmp = 0;
			if (sortKey === "name") cmp = a.name.localeCompare(b.name);
			else if (sortKey === "progress") cmp = a.progress - b.progress;
			else if (sortKey === "dlspeed") cmp = a.dlspeed - b.dlspeed;
			else if (sortKey === "upspeed") cmp = a.upspeed - b.upspeed;
			else if (sortKey === "size") cmp = a.size - b.size;
			else if (sortKey === "eta") cmp = a.eta - b.eta;
			else if (sortKey === "added_on") cmp = a.added_on - b.added_on;
			return sortDir === "desc" ? -cmp : cmp;
		});

	const groups = (() => {
		const map = new Map();
		for (const t of filtered) {
			const base = extractBaseTitle(t.name);
			if (!map.has(base)) map.set(base, []);
			map.get(base).push(t);
		}
		return Array.from(map.values());
	})();

	function toggleGroup(base) {
		setExpandedGroups((prev) => {
			const next = new Set(prev);
			next.has(base) ? next.delete(base) : next.add(base);
			return next;
		});
	}

	const downloading = torrents.filter((t) => t.dlspeed > 0);
	const totalDl = downloading.reduce((s, t) => s + t.dlspeed, 0);
	const totalUl = torrents.reduce((s, t) => s + t.upspeed, 0);
	const stalledCount = torrents.filter(
		(t) => t.state === "stalledDL" || t.state === "stalledUP",
	).length;
	const metaCount = torrents.filter((t) => t.state === "metaDL").length;
	const queuedCount = torrents.filter(
		(t) => t.state === "queuedDL" || t.state === "queuedUP",
	).length;
	const pausedCount = torrents.filter((t) =>
		["pausedDL", "pausedUP", "stoppedDL", "stoppedUP"].includes(t.state),
	).length;
	const errorCount = torrents.filter(
		(t) => t.state === "error" || t.state === "missingFiles",
	).length;

	if (loading)
		return <div className="text-center py-12 text-slate-400">{tr("loading_torrents")}</div>;
	if (error)
		return (
			<div className="bg-[#2d1a1a] border border-[#5c2626] rounded-lg p-4 text-red-500">
				{tr("error_torrents", { msg: error })}
			</div>
		);

	return (
		<div>
			<div className="flex gap-4 mb-4 flex-wrap">
				<StatCard label={tr("stat_total")} value={torrents.length} />
				<StatCard
					label={tr("stat_downloading")}
					value={downloading.length}
					colorClass="text-blue-500"
				/>
				{metaCount > 0 && (
					<StatCard label={tr("stat_metadata")} value={metaCount} colorClass="text-indigo-400" />
				)}
				{stalledCount > 0 && (
					<StatCard label={tr("stat_stalled")} value={stalledCount} colorClass="text-yellow-500" />
				)}
				{queuedCount > 0 && (
					<StatCard label={tr("stat_queued")} value={queuedCount} colorClass="text-slate-400" />
				)}
				{pausedCount > 0 && (
					<StatCard label={tr("stat_paused")} value={pausedCount} colorClass="text-slate-400" />
				)}
				{errorCount > 0 && (
					<StatCard label={tr("stat_error")} value={errorCount} colorClass="text-red-500" />
				)}
			</div>

			{actionError && (
				<div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-2 mb-4 text-red-400 text-[13px]">
					{actionError}
				</div>
			)}

			{transfer && (
				<div className="bg-surface border border-border rounded-lg px-3 sm:px-4 py-3 mb-4 flex flex-col gap-2.5">
					<SpeedSlider
						label="↓"
						limitBytes={transfer.dl_rate_limit}
						endpoint="/api/qbit/download-limit"
						colorClass="text-blue-400"
						accentClass="accent-blue-500"
						currentSpeed={transfer.dl_info_speed ?? totalDl}
						tr={tr}
						onToast={onToast}
					/>
					<SpeedSlider
						label="↑"
						limitBytes={transfer.up_rate_limit}
						endpoint="/api/qbit/upload-limit"
						colorClass="text-green-400"
						accentClass="accent-green-500"
						currentSpeed={transfer.up_info_speed ?? totalUl}
						tr={tr}
						onToast={onToast}
					/>
				</div>
			)}

			<div className="mb-4 flex flex-col gap-2">
				<div className="flex gap-2 items-center">
					<input
						type="text"
						placeholder={tr("search_torrents")}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="bg-surface border border-border rounded-md px-3 py-1.5 text-slate-200 text-[13px] flex-1 min-w-0 outline-none focus:border-indigo-500 transition-colors"
					/>
				</div>
				<div className="flex gap-1 w-full overflow-x-auto">
					{filters.map((f) => (
						<button
							key={f.value}
							onClick={() => { setFilter(f.value); localStorage.setItem("torrent_filter", f.value); }}
							className={`shrink-0 px-3 py-1.5 rounded-md border text-xs cursor-pointer transition-colors ${
								filter === f.value
									? "bg-indigo-500 border-indigo-500 text-white"
									: "bg-surface border-border text-slate-400 hover:text-slate-200"
							}`}>
							{f.label}
						</button>
					))}
				</div>
			</div>

			{filtered.length === 0 ? (
				<div className="text-center py-12 text-slate-400">{tr("no_torrents")}</div>
			) : (
				<div className="bg-surface border border-border rounded-lg overflow-hidden">
					<table className="w-full border-collapse">
						<thead className="border-b border-border">
							<tr>
								{COLUMNS.map(({ label, key, defaultDir, cls }) => (
									<th
										key={label}
										onClick={() => handleSort(key, defaultDir)}
										className={`text-left text-[11px] font-semibold uppercase tracking-[0.5px] px-3 py-2 select-none ${cls} ${
											key
												? "cursor-pointer text-slate-400 hover:text-slate-200 transition-colors"
												: "text-slate-400"
										}`}>
										{label}
										{key && <SortIcon active={sortKey === key} dir={sortDir} />}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{groups.map((groupTorrents) => {
								const base = extractBaseTitle(groupTorrents[0].name);
								const isGroup = groupTorrents.length > 1;
								const isCollapsed = isGroup && !expandedGroups.has(base);

								const groupHeader = isGroup
									? (() => {
											const totalSize = groupTorrents.reduce((s, t) => s + t.size, 0);
											const totalDone = groupTorrents.reduce((s, t) => s + t.size * t.progress, 0);
											const groupPct =
												totalSize > 0 ? Math.floor((totalDone / totalSize) * 100) : 0;
											const groupDl = groupTorrents.reduce((s, t) => s + t.dlspeed, 0);
											const groupUl = groupTorrents.reduce((s, t) => s + t.upspeed, 0);
											const drive =
												groupTorrents[0].save_path?.split("/").filter(Boolean)[1] ?? "—";
											const sameDrive = groupTorrents.every(
												(t) => t.save_path?.split("/").filter(Boolean)[1] === drive,
											);
											return (
												<tr
													key={`group-${base}`}
													onClick={() => toggleGroup(base)}
													className="cursor-pointer bg-surface2 hover:bg-surface2/80 border-b border-border">
													<td className="px-3 py-2 text-slate-200 text-[13px] max-w-80">
														<div className="flex items-center gap-2">
															<svg
																className={`shrink-0 w-3 h-3 text-slate-400 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
																viewBox="0 0 20 20"
																fill="currentColor">
																<path
																	fillRule="evenodd"
																	d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
																/>
															</svg>
															<span className="font-semibold">{base}</span>
															<span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">
																{groupTorrents.length}
															</span>
														</div>
													</td>
													<td className="px-3 py-2 text-slate-400 text-[13px] hidden sm:table-cell">
														{formatBytes(totalSize, "0 B")}
													</td>
													<td className="px-3 py-2 text-[13px] min-w-20 sm:min-w-25">
														<div className="flex items-center gap-2">
															<span className="text-xs text-slate-400 w-8.5">{groupPct}%</span>
															<div className="h-1 rounded-sm bg-surface overflow-hidden flex-1">
																<div
																	className={`h-full rounded-sm transition-[width] duration-300 ${groupPct === 100 ? "bg-green-500" : "bg-indigo-500"}`}
																	style={{ width: `${groupPct}%` }}
																/>
															</div>
														</div>
													</td>
													<td className="px-3 py-2 text-slate-500 text-[13px]">
														{groupDl > 0 && (
															<span className="text-blue-500 mr-3">{formatSpeed(groupDl)}</span>
														)}
														{groupUl > 0 && (
															<span className="text-green-500 hidden md:inline">{formatSpeed(groupUl)}</span>
														)}
													</td>
													<td className="px-3 py-2 hidden md:table-cell" />
													<td className="px-3 py-2 hidden lg:table-cell" />
													<td className="px-3 py-2 hidden lg:table-cell" />
													<td className="px-3 py-2 text-slate-500 text-[12px] hidden lg:table-cell">
														{sameDrive ? drive : "—"}
													</td>
													<td className="px-3 py-2" />
												</tr>
											);
										})()
									: null;

								const torrentRows =
									!isGroup || !isCollapsed
										? groupTorrents.map((t) => {
												const dot = dotForState[t.state] ?? "dim";
												const stateLabel =
													tr(`state_${t.state}`) !== `state_${t.state}`
														? tr(`state_${t.state}`)
														: t.state;
												const done = t.progress === 1;
												const pct = done ? 100 : Math.floor(t.progress * 100);
												const isExpanded = expandedHash === t.hash;
												const isConfirming = confirmDelete.has(t.hash);

												return (
													<Fragment key={t.hash}>
														<tr
															className="group cursor-pointer"
															onClick={() => setExpandedHash(isExpanded ? null : t.hash)}>
															<td className="px-3 py-2.5 text-slate-200 text-[13px] max-w-48 sm:max-w-80 wrap-break-word group-hover:bg-surface2">
																{renamingHash === t.hash ? (
																	<input
																		autoFocus
																		value={renameValue}
																		onChange={(e) => setRenameValue(e.target.value)}
																		onKeyDown={(e) => {
																			if (e.key === "Enter") handleRename(t.hash);
																			if (e.key === "Escape") setRenamingHash(null);
																			e.stopPropagation();
																		}}
																		onClick={(e) => e.stopPropagation()}
																		onBlur={() => setRenamingHash(null)}
																		className="bg-surface2 border border-indigo-500 rounded px-2 py-0.5 text-[13px] text-slate-200 outline-none w-full"
																	/>
																) : (
																	<span className="flex flex-col gap-0.5">
																		<span>{t.name}</span>
																		{isOnDisk(t.name) && (
																			<span className="text-[10px] font-medium text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-1.5 py-0.5 self-start">
																				{tr("badge_on_disk")}
																			</span>
																		)}
																	</span>
																)}
															</td>
															<td className="px-3 py-2.5 text-slate-400 text-[13px] group-hover:bg-surface2 hidden sm:table-cell">
																{formatBytes(t.size, "0 B")}
															</td>
															<td className="px-3 py-2.5 text-[13px] min-w-20 sm:min-w-25 group-hover:bg-surface2">
																<div className="flex items-center gap-2">
																	<span className="text-xs text-slate-400 w-8.5">{pct}%</span>
																	<div className="h-1 rounded-sm bg-surface2 overflow-hidden flex-1">
																		<div
																			className={`h-full rounded-sm transition-[width] duration-300 ${done ? "bg-green-500" : "bg-indigo-500"}`}
																			style={{ width: `${pct}%` }}
																		/>
																	</div>
																</div>
															</td>
															<td className="px-3 py-2.5 text-[13px] group-hover:bg-surface2">
																<span
																	className={`inline-block w-2 h-2 rounded-full mr-1.5 ${dotClass[dot]}`}
																/>
																{stateLabel}
															</td>
															<td className="px-3 py-2.5 text-blue-500 text-[13px] group-hover:bg-surface2 hidden sm:table-cell">
																{t.dlspeed > 0 ? (
																	formatSpeed(t.dlspeed)
																) : (
																	<span className="text-slate-400">—</span>
																)}
															</td>
															<td className="px-3 py-2.5 text-green-500 text-[13px] group-hover:bg-surface2 hidden md:table-cell">
																{t.upspeed > 0 ? (
																	formatSpeed(t.upspeed)
																) : (
																	<span className="text-slate-400">—</span>
																)}
															</td>
															<td className="px-3 py-2.5 text-slate-400 text-[13px] group-hover:bg-surface2 hidden lg:table-cell">
																{done ? "—" : formatEta(t.eta)}
															</td>
															<td className="px-3 py-2.5 text-slate-400 text-[13px] group-hover:bg-surface2 whitespace-nowrap hidden lg:table-cell">
																{t.added_on ? formatAddedDate(t.added_on, tr, locale) : "—"}
															</td>
															<td className="px-3 py-2.5 text-slate-500 text-[12px] group-hover:bg-surface2 whitespace-nowrap hidden lg:table-cell">
																{t.save_path
																	? (t.save_path.split("/").filter(Boolean)[1] ?? "—")
																	: "—"}
															</td>
															<td className="px-3 py-2.5 group-hover:bg-surface2 text-right">
																<div className="flex gap-1.5 justify-end">
																	<button
																		onClick={(e) => startRename(e, t.hash, t.name)}
																		title={tr("rename_btn")}
																		className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[11px] border border-border text-slate-400 hover:text-slate-200 hover:border-slate-400 cursor-pointer transition-all">
																		✎
																	</button>
																	{PAUSABLE.has(t.state) && (
																		<button
																			onClick={(e) => {
																				e.stopPropagation();
																				handleAction("pause", t.hash);
																			}}
																			disabled={pending.has(t.hash)}
																			title={tr("pause_btn")}
																			className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[11px] border border-border text-slate-400 hover:text-slate-200 hover:border-slate-400 cursor-pointer transition-all disabled:opacity-30">
																			⏸
																		</button>
																	)}
																	{RESUMABLE.has(t.state) && (
																		<button
																			onClick={(e) => {
																				e.stopPropagation();
																				handleAction("resume", t.hash);
																			}}
																			disabled={pending.has(t.hash)}
																			title={tr("resume_btn")}
																			className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[11px] border border-border text-slate-400 hover:text-slate-200 hover:border-slate-400 cursor-pointer transition-all disabled:opacity-30">
																			▶
																		</button>
																	)}
																	<button
																		onClick={(e) => handleDeleteClick(e, t.hash)}
																		disabled={pending.has(t.hash)}
																		title={tr("delete_btn")}
																		className={`px-2 py-0.5 rounded text-[11px] border cursor-pointer transition-all disabled:opacity-30 ${
																			isConfirming
																				? "border-red-500 text-red-400 bg-red-500/10"
																				: "opacity-0 group-hover:opacity-100 border-border text-slate-400 hover:text-red-400 hover:border-red-500"
																		}`}>
																		{isConfirming ? tr("confirm_delete") : "✕"}
																	</button>
																</div>
															</td>
														</tr>
														{qualityBlockMap.has(t.hash) && (() => {
															const block = qualityBlockMap.get(t.hash);
															return (
																<tr>
																	<td colSpan={10} className="bg-red-950/30 border-b border-red-900/40 px-3 sm:px-4 py-2.5">
																		<div className="flex flex-wrap items-start gap-2">
																			<div className="flex-1 min-w-0">
																				<span className="text-xs text-red-400 font-medium">Quality blocked: </span>
																				<span className="text-xs text-red-300/80">{block.issues.join(", ")}</span>
																			</div>
																			<div className="flex gap-1.5 shrink-0">
																				<button
																					onClick={() => handleProcessAnyway(t.hash)}
																					disabled={pending.has(t.hash)}
																					className="px-2 py-0.5 rounded text-[11px] border border-amber-600 text-amber-400 hover:bg-amber-600/20 cursor-pointer transition-all disabled:opacity-30">
																					Process anyway
																				</button>
																				<button
																					onClick={() => handleDismissBlock(t.hash)}
																					className="px-2 py-0.5 rounded text-[11px] border border-border text-slate-500 hover:text-slate-300 hover:border-slate-500 cursor-pointer transition-all">
																					Dismiss
																				</button>
																			</div>
																		</div>
																	</td>
																</tr>
															);
														})()}
														{isExpanded && (
															<tr>
																<td
																	colSpan={10}
																	className="bg-surface2 border-b border-border px-3 sm:px-4 py-3">
																	<div className="grid grid-cols-[auto_1fr] gap-x-3 sm:gap-x-4 gap-y-1.5 text-[12px]">
																		<span className="text-slate-500">{tr("saved_in")}</span>
																		<span className="text-slate-300 font-mono break-all">
																			{t.save_path}
																		</span>
																		{t.tracker && (
																			<>
																				<span className="text-slate-500">{tr("tracker")}</span>
																				<span className="text-slate-300 break-all">
																					{t.tracker}
																				</span>
																			</>
																		)}
																		<span className="text-slate-500">{tr("ratio")}</span>
																		<span className="text-slate-300">{t.ratio.toFixed(3)}</span>
																		<span className="text-slate-500">{tr("seeds_leeches")}</span>
																		<span className="text-slate-300">
																			{t.num_seeds} / {t.num_leechs}
																		</span>
																		<span className="text-slate-500">{tr("col_added")}</span>
																		<span className="text-slate-300">
																			{new Date(t.added_on * 1000).toLocaleString(locale)}
																		</span>
																	</div>
																</td>
															</tr>
														)}
													</Fragment>
												);
											})
										: [];

								return (
									<Fragment key={base}>
										{groupHeader}
										{torrentRows}
									</Fragment>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function formatEta(seconds) {
	if (seconds < 0 || seconds >= 8640000) return "∞";
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}
