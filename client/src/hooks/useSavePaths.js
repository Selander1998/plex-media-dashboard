import { useState, useEffect } from "react";

export function useSavePaths() {
	const [savePaths, setSavePaths] = useState([]);
	const [savePathIdx, setSavePathIdx] = useState(() => parseInt(localStorage.getItem("savePathIdx") ?? "0", 10) || 0);
	const [diskSpace, setDiskSpace] = useState(null);
	const [totalDiskCapacity, setTotalDiskCapacity] = useState(null);

	useEffect(() => {
		fetch("/api/qbit/save-paths")
			.then((r) => r.json())
			.then((d) => Array.isArray(d) && d.length > 0 && setSavePaths(d))
			.catch(() => {});
	}, []);

	useEffect(() => {
		if (!savePaths[savePathIdx]) return;
		const path = encodeURIComponent(savePaths[savePathIdx]);
		fetch(`/api/disk-space?path=${path}`)
			.then((r) => r.json())
			.then((d) => d.available != null && setDiskSpace(d))
			.catch(() => {});
	}, [savePaths, savePathIdx]);

	useEffect(() => {
		if (savePaths.length === 0) return;
		Promise.all(
			savePaths.map((p) =>
				fetch(`/api/disk-space?path=${encodeURIComponent(p)}`)
					.then((r) => r.json())
					.catch(() => null),
			),
		).then((results) => {
			const seen = new Set();
			const total = results.reduce((sum, d) => {
				if (!d || d.total == null) return sum;
				const key = d.dev ?? d.total;
				if (seen.has(key)) return sum;
				seen.add(key);
				return sum + d.total;
			}, 0);
			if (total > 0) setTotalDiskCapacity(total);
		});
	}, [savePaths]);

	return { savePaths, savePathIdx, setSavePathIdx, diskSpace, totalDiskCapacity };
}
