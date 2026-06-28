export function formatBytes(bytes, zeroLabel = "—") {
	if (bytes == null || bytes < 0) return "—";
	if (bytes === 0) return zeroLabel;
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
