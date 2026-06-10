import { useState, useEffect, useRef, Fragment } from "react";
import StatCard from "./StatCard.jsx";
import { useLang } from "../LangContext.jsx";

function formatBytes(bytes) {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec) {
	if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
	return `${formatBytes(bytesPerSec)}/s`;
}

function formatKbps(kbps, tr) {
	if (kbps === 0) return tr("unlimited");
	if (kbps < 1024) return `${kbps} KB/s`;
	return `${(kbps / 1024).toFixed(1)} MB/s`;
}

function formatAddedDate(ts, tr, lang) {
	const d = new Date(ts * 1000);
	const diffDays = Math.floor((Date.now() - d) / 86400000);
	if (diffDays === 0) return tr("today");
	if (diffDays === 1) return tr("yesterday");
	if (diffDays < 7) return tr("days_ago", { n: diffDays });
	return d.toLocaleDateString(lang === "sv" ? "sv-SE" : "en-US", {
		day: "numeric",
		month: "short",
	});
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

function SpeedSlider({ label, limitBytes, endpoint, colorClass, accentClass, currentSpeed, tr }) {
	const MAX_KBPS = 102400;
	const [kbps, setKbps] = useState(0);
	const initialized = useRef(false);

	useEffect(() => {
		if (!initialized.current && limitBytes !== undefined) {
			setKbps(Math.round((limitBytes || 0) / 1024));
			initialized.current = true;
		}
	}, [limitBytes]);

	function handleChange(e) {
		setKbps(Number(e.target.value));
	}

	function handleRelease(e) {
		const v = Number(e.target.value);
		fetch(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ limit: v * 1024 }),
		});
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
				className={`flex-1 min-w-0 h-1 cursor-pointer ${accentClass}`}
				onPointerUp={handleRelease}
			/>
			<span className="text-xs text-slate-500 w-14 sm:w-24 text-right shrink-0 tabular-nums">
				{formatKbps(kbps, tr)}
			</span>
		</div>
	);
}

export default function Torrents({ torrents, transfer, loading, error, onRefresh, onToast }) {
	const { t: tr, lang } = useLang();
	const locale = lang === "sv" ? "sv-SE" : "en-US";

	const [filter, setFilter] = useState("all");
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
			onToast?.(name);
			setTimeout(onRefresh, 500);
		} catch {
			onToast?.(tr("toast_rename_failed"), true);
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
					/>
					<SpeedSlider
						label="↑"
						limitBytes={transfer.up_rate_limit}
						endpoint="/api/qbit/upload-limit"
						colorClass="text-green-400"
						accentClass="accent-green-500"
						currentSpeed={transfer.up_info_speed ?? totalUl}
						tr={tr}
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
							onClick={() => setFilter(f.value)}
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
														{formatBytes(totalSize)}
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
																	t.name
																)}
															</td>
															<td className="px-3 py-2.5 text-slate-400 text-[13px] group-hover:bg-surface2 hidden sm:table-cell">
																{formatBytes(t.size)}
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
																{t.added_on ? formatAddedDate(t.added_on, tr, lang) : "—"}
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
