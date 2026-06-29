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
	const [noTmdbCache, setNoTmdbCache] = useState(false);
	const [noQualityCache, setNoQualityCache] = useState(false);
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
		const [cacheCheck, qualityCacheCheck] = await Promise.all([
			fetch("/api/cache").then((r) => r.json()).catch(() => ({ exists: true })),
			fetch("/api/quality-cache").then((r) => r.json()).catch(() => ({ exists: true })),
		]);
		timestamps.current = { updateStart: Date.now() };
		flushSync(() => {
			setRefreshing(true);
			setUpdateStatus(null);
			setUpdateLog([]);
			setUpdateStats({});
			setNoTmdbCache(!cacheCheck.exists);
			setNoQualityCache(!qualityCacheCheck.exists);
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
					if (payload.aborted) {
						timestamps.current.endTime = Date.now();
						setUpdateStatus("aborted");
						setRefreshing(false);
						return;
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
						if (!timestamps.current.qualityStart && /Running quality checker/i.test(line))
							timestamps.current.qualityStart = Date.now();
						if (!timestamps.current.renameStart && /Running library rename scan/i.test(line))
							timestamps.current.renameStart = Date.now();
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
			setUpdateStatus("ok");
			onSuccessRef.current?.()?.catch(() => {});
		} catch {
			setUpdateStatus("error");
			onErrorRef.current?.(tRef.current("toast_update_failed"));
		}
		// Modal stays open — user must click Close
	}

	async function handleAbort() {
		await fetch("/api/update/abort", { method: "POST" }).catch(() => {});
	}

	function handleClose() {
		setRefreshing(false);
		setUpdateStatus(null);
		setUpdateLog([]);
		setUpdateStats({});
		setNoTmdbCache(false);
		setNoQualityCache(false);
		setTick(0);
		timestamps.current = {};
	}

	return {
		refreshing,
		updateStatus,
		updateLog,
		updateStats,
		noTmdbCache,
		noQualityCache,
		tick,
		timestamps,
		logRef,
		handleRefresh,
		handleAbort,
		handleClose,
	};
}
