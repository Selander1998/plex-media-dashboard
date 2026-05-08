export function normalizeName(s) {
	return s
		.toLowerCase()
		.replace(/['''ʼ]/g, "")
		.replace(/[^a-z0-9 ]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function findTorrentsForTitle(title, torrents) {
	const norm = normalizeName(title);
	return torrents.filter((t) => {
		const tNorm = normalizeName(t.name);
		if (!tNorm.startsWith(norm)) return false;
		const rest = tNorm.slice(norm.length);
		return rest === "" || /^\s+\d{4}/.test(rest) || /^\s+s\d{2}/i.test(rest) || /^\s+season\s+\d+/i.test(rest);
	});
}

export function torrentBadgeProps(torrent, t) {
	const pct = torrent.progress === 1 ? 100 : Math.floor(torrent.progress * 100);
	if (["downloading", "stalledDL", "metaDL", "queuedDL"].includes(torrent.state))
		return { label: t("tbadge_downloading", { pct }), cls: "text-blue-400 border-blue-800 bg-blue-950/40" };
	if (["uploading", "stalledUP"].includes(torrent.state))
		return { label: t("tbadge_seeding"), cls: "text-green-400 border-green-800 bg-green-950/40" };
	if (torrent.state === "pausedUP" || torrent.state === "stoppedUP")
		return { label: t("tbadge_done"), cls: "text-slate-300 border-slate-600 bg-slate-800/40" };
	if (torrent.state === "pausedDL" || torrent.state === "stoppedDL")
		return { label: t("tbadge_paused_dl", { pct }), cls: "text-slate-400 border-slate-600 bg-slate-800/40" };
	if (torrent.state === "error")
		return { label: t("tbadge_error"), cls: "text-red-400 border-red-800 bg-red-950/40" };
	return { label: torrent.state, cls: "text-slate-400 border-slate-600 bg-slate-800/40" };
}
