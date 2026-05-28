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
	const logRef = useRef(null);

	useEffect(() => {
		if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
	}, [updateLog]);

	async function handleRefresh() {
		if (refreshing) return;
		flushSync(() => {
			setRefreshing(true);
			setUpdateStatus(null);
			setUpdateLog([]);
			setUpdateStats({});
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
						setUpdateStats((prev) => extractUpdateStat(payload.line, prev));
						if (shouldShowUpdateLine(payload.line)) newLines.push(payload.line);
					}
				}
				if (newLines.length) {
					flushSync(() => setUpdateLog((prev) => [...prev, ...newLines]));
				}
				if (success) break outer;
			}

			if (!success) throw new Error();
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
	}

	return {
		refreshing,
		updateStatus,
		updateLog,
		updateStats,
		logRef,
		handleRefresh,
		handleClose,
	};
}
