import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { useLang } from "../LangContext.jsx";
import { shouldShowUpdateLine, extractUpdateStat } from "../utils/updateLog.js";

export function useUpdate({ onSuccess, onError } = {}) {
	const { t } = useLang();
	const tRef = useRef(t);
	tRef.current = t;

	const onSuccessRef = useRef(onSuccess);
	const onErrorRef = useRef(onError);
	onSuccessRef.current = onSuccess;
	onErrorRef.current = onError;

	const [refreshing, setRefreshing] = useState(false);
	const [updateStatus, setUpdateStatus] = useState(null);
	const [updateLog, setUpdateLog] = useState([]);
	const [updateStats, setUpdateStats] = useState({});
	const [noCache, setNoCache] = useState(false);
	const [tick, setTick] = useState(0);
	const logRef = useRef(null);
	const timestamps = useRef({});

	useEffect(() => {
		if (!refreshing) return;
		const id = setInterval(() => setTick((n) => n + 1), 1000);
		return () => clearInterval(id);
	}, [refreshing]);

	useEffect(() => {
		if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
	}, [updateLog]);

	async function handleRefresh() {
		if (refreshing) return;
		const cacheCheck = await fetch("/api/cache").then((r) => r.json()).catch(() => ({ exists: true }));
		timestamps.current = { updateStart: Date.now() };
		flushSync(() => {
			setRefreshing(true);
			setUpdateStatus(null);
			setUpdateLog([]);
			setUpdateStats({});
			setNoCache(!cacheCheck.exists);
			setTick(0);
		});
		try {
			const res = await fetch("/api/update", { method: "POST" });
			if (!res.ok) throw new Error();

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let success = false;

			outer: while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split("\n\n");
				buffer = parts.pop();
				const newLines = [];
				for (const part of parts) {
					const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
					if (!dataLine) continue;
					const payload = JSON.parse(dataLine.slice(6));
					if (payload.done) {
						success = true;
						break;
					}
					if (payload.error) throw new Error();
					if (payload.line) {
						const line = payload.line;
						setUpdateStats((prev) => extractUpdateStat(line, prev));
						if (!timestamps.current.moviesStart && /\d+ movies? found/i.test(line))
							timestamps.current.moviesStart = Date.now();
						if (!timestamps.current.showsStart && /\d+ shows? found/i.test(line))
							timestamps.current.showsStart = Date.now();
						if (!timestamps.current.plexStart && /Plex has \d+ files? indexed/i.test(line))
							timestamps.current.plexStart = Date.now();
						if (!timestamps.current.watchlistStart && /Running watchlist formatter/i.test(line))
							timestamps.current.watchlistStart = Date.now();
						if (shouldShowUpdateLine(line)) newLines.push(line);
					}
				}
				if (newLines.length) {
					flushSync(() => setUpdateLog((prev) => [...prev, ...newLines]));
				}
				if (success) break outer;
			}

			if (!success) throw new Error();
			timestamps.current.endTime = Date.now();
			await onSuccessRef.current?.();
			setUpdateStatus("ok");
		} catch {
			setUpdateStatus("error");
			onErrorRef.current?.(tRef.current("toast_update_failed"));
		}
		// Modal stays open — user must click Close
	}

	function handleClose() {
		setRefreshing(false);
		setUpdateStatus(null);
		setUpdateLog([]);
		setUpdateStats({});
		setNoCache(false);
		setTick(0);
		timestamps.current = {};
	}

	return {
		refreshing,
		updateStatus,
		updateLog,
		updateStats,
		noCache,
		tick,
		timestamps,
		logRef,
		handleRefresh,
		handleClose,
	};
}
