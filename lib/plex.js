import { PLEX_URL, PLEX_TOKEN } from "./config.js";

export async function refreshPlexLibraries() {
	if (!PLEX_URL || !PLEX_TOKEN) return;
	try {
		const signal = AbortSignal.timeout(10_000);
		const sectionsRes = await fetch(`${PLEX_URL}/library/sections?X-Plex-Token=${PLEX_TOKEN}`, {
			headers: { Accept: "application/json" },
			signal,
		});
		const data = await sectionsRes.json();
		const sections = data?.MediaContainer?.Directory ?? [];
		await Promise.all(
			sections.map((s) =>
				fetch(`${PLEX_URL}/library/sections/${s.key}/refresh?X-Plex-Token=${PLEX_TOKEN}`, { method: "GET", signal })
			)
		);
		console.log(`[plex] refreshed ${sections.length} librar${sections.length === 1 ? "y" : "ies"}`);
	} catch (err) {
		console.error("[plex] refresh failed:", err.message);
	}
}
