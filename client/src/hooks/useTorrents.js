import { useState, useCallback, useEffect, useRef } from "react";

const DONE_STATES = new Set(["pausedUP", "stoppedUP", "uploading", "stalledUP"]);

export function useTorrents(refreshInterval = 5000) {
	const [torrents, setTorrents] = useState([]);
	const [transfer, setTransfer] = useState(null);
	const [torrentCount, setTorrentCount] = useState(null);
	const [torrentLoading, setTorrentLoading] = useState(true);
	const [torrentError, setTorrentError] = useState(null);
	const [torrentStatsByDrive, setTorrentStatsByDrive] = useState({});
	const prevStates = useRef(null);

	const fetchTorrents = useCallback(async () => {
		if (document.visibilityState !== "visible") return;
		try {
			const [tRes, xRes] = await Promise.all([fetch("/api/torrents"), fetch("/api/qbit/transfer")]);
			const [tData, xData] = await Promise.all([tRes.json(), xRes.json()]);
			if (!Array.isArray(tData)) throw new Error(tData.detail || tData.error || "Bad response");

			// Detect transitions into a done state and notify
			if (prevStates.current !== null) {
				for (const t of tData) {
					const prev = prevStates.current.get(t.hash);
					if (prev && !DONE_STATES.has(prev) && DONE_STATES.has(t.state)) {
						fetch("/api/notify", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ title: t.name }),
						}).catch(() => {});
					}
				}
			}
			prevStates.current = new Map(tData.map((t) => [t.hash, t.state]));

			setTorrents(tData);
			setTorrentCount(tData.length);
			const byDrive = {};
			for (const torrent of tData) {
				const drive = torrent.save_path?.split("/").filter(Boolean)[1] ?? "unknown";
				byDrive[drive] = (byDrive[drive] ?? 0) + (torrent.amount_left ?? 0);
			}
			setTorrentStatsByDrive(byDrive);
			setTransfer(xData);
			setTorrentError(null);
		} catch (e) {
			setTorrentError(e.message);
		} finally {
			setTorrentLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchTorrents();
		const id = setInterval(fetchTorrents, refreshInterval);
		return () => clearInterval(id);
	}, [fetchTorrents, refreshInterval]);

	return {
		torrents,
		transfer,
		torrentCount,
		torrentLoading,
		torrentError,
		torrentStatsByDrive,
		fetchTorrents,
	};
}
