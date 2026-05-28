export function shouldShowUpdateLine(line) {
	const trimmed = line.trim();
	if (/^═+$/.test(trimmed)) return false; // pure decorator ════
	if (/^\s*\[\d+\/\d+\]/.test(trimmed)) return false; // [12/142] progress counters
	if (/^\s*✓ .+\(\d{4}\)(\s+\[.*\])?$/.test(trimmed)) return false; // ✓ Movie Title (2020) collection parts
	if (/^\s*✓ Season \d+: complete/.test(trimmed)) return false; // ✓ Season 03: complete
	return true;
}

export function extractUpdateStat(line, prev) {
	let m;
	if ((m = line.match(/(\d[\d,]*) movies? found/i))) return { ...prev, movies: parseInt(m[1].replace(/,/g, "")) };
	if ((m = line.match(/(\d[\d,]*) shows? found/i))) return { ...prev, shows: parseInt(m[1].replace(/,/g, "")) };
	if ((m = line.match(/✓\s+(\d[\d,]*) unique watchlist/i)))
		return { ...prev, watchlist: parseInt(m[1].replace(/,/g, "")) };
	if ((m = line.match(/Plex has (\d[\d,]*) files? indexed/i)))
		return { ...prev, plexFiles: parseInt(m[1].replace(/,/g, "")) };
	return prev;
}

export function updateLogLineClass(line) {
	if (/[✗✕]/.test(line) || /\bMISSING\b/.test(line) || /^ERROR/.test(line.trim())) return "text-red-400";
	if (/\[WARN\]/.test(line)) return "text-amber-400";
	if (/[↻]/.test(line)) return "text-indigo-400";
	if (/[✓]/.test(line)) return "text-emerald-400";
	if (/^\s*~/.test(line)) return "text-slate-500";
	if (/[A-Z]{3,}.*—/.test(line) || /^Plex Media Checker/.test(line.trim())) return "text-slate-100 font-medium";
	if (/^\[\d{2}:\d{2}:\d{2}\]/.test(line.trim())) return "text-slate-300";
	return "text-slate-400";
}
