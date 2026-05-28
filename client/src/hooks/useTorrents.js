import { useState, useCallback, useEffect } from "react";

export function useTorrents() {
	const [torrents, setTorrents] = useState([]);
	const [transfer, setTransfer] = useState(null);
	const [torrentCount, setTorrentCount] = useState(null);
	const [torrentLoading, setTorrentLoading] = useState(true);
	const [torrentError, setTorrentError] = useState(null);
	const [torrentStatsByDrive, setTorrentStatsByDrive] = useState({});

	const fetchTorrents = useCallback(async () => {
		if (document.visibilityState !== "visible") return;
		try {
			const [tRes, xRes] = await Promise.all([fetch("/api/torrents"), fetch("/api/qbit/transfer")]);
			const [tData, xData] = await Promise.all([tRes.json(), xRes.json()]);
			if (!Array.isArray(tData)) throw new Error(tData.detail || tData.error || "Bad response");
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
		const id = setInterval(fetchTorrents, 5000);
		return () => clearInterval(id);
	}, [fetchTorrents]);

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
