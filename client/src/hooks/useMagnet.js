import { useState, useRef } from "react";
import { useLang } from "../LangContext.jsx";

export function useMagnet({ savePaths, savePathIdx, onSuccess, onError } = {}) {
	const { t } = useLang();
	const tRef = useRef(t);
	tRef.current = t;

	const [addStatus, setAddStatus] = useState(null);
	const [pasteMode, setPasteMode] = useState(false);
	const pasteRef = useRef(null);

	async function submitMagnet(url) {
		if (!url.startsWith("magnet:?")) {
			setAddStatus("invalid");
			onError?.(tRef.current("toast_no_magnet"));
			setTimeout(() => setAddStatus(null), 2000);
			return;
		}
		setAddStatus("loading");
		const savepath = savePaths[savePathIdx];
		try {
			const res = await fetch("/api/torrents/add", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url, ...(savepath ? { savepath } : {}) }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error();
			setAddStatus("ok");
			onSuccess?.(tRef.current("toast_torrent_added", { name: data.name }));
		} catch {
			setAddStatus("error");
			onError?.(tRef.current("toast_add_failed"));
		} finally {
			setTimeout(() => setAddStatus(null), 2000);
		}
	}

	function handleAddTorrent() {
		if (addStatus === "loading") return;
		setPasteMode(true);
		setTimeout(() => pasteRef.current?.focus(), 30);
	}

	function handlePasteInput(e) {
		e.preventDefault();
		const url = e.clipboardData.getData("text").trim();
		setPasteMode(false);
		submitMagnet(url);
	}

	return {
		addStatus,
		pasteMode,
		setPasteMode,
		pasteRef,
		handleAddTorrent,
		handlePasteInput,
	};
}
