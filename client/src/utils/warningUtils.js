export function issueType(issue) {
	const colon = issue.indexOf(":");
	return colon === -1 ? issue : issue.slice(0, colon);
}

const STRUCTURAL_TYPES = new Set(["corrupt_or_unreadable", "no_video_stream", "no_audio_stream", "bad_codec", "bad_audio_codec"]);

function hasStructural(item) {
	return item.issues.some((i) => STRUCTURAL_TYPES.has(issueType(i)));
}

export function countWarnings(report, qualityData) {
	if (!report) return 0;
	const qualityWarnings = qualityData
		? (qualityData.movies ?? []).filter(hasStructural).length + (qualityData.series ?? []).filter(hasStructural).length
		: 0;
	return (
		(report.movies?.multiple_videos?.length ?? 0) +
		(report.movies?.unneeded_files?.length ?? 0) +
		(report.movies?.not_found_on_tmdb?.length ?? 0) +
		(report.series?.multiple_videos?.length ?? 0) +
		(report.series?.unneeded_files?.length ?? 0) +
		(report.series?.not_found_on_tmdb?.length ?? 0) +
		(report.series?.folder_renames?.length ?? 0) +
		(report.plex_sync?.not_indexed?.length ?? 0) +
		qualityWarnings
	);
}
