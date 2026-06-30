import { spawn } from "child_process";

const BAD_CODECS = new Set(["mpeg1video", "mpeg2video", "h263", "xvid", "divx", "wmv1", "wmv2", "rv10", "rv20", "msmpeg4v2", "msmpeg4v3"]);
const BAD_AUDIO_CODECS = new Set(["mp3", "wmav1", "wmav2", "wmapro", "wmavoice"]);
const EFFICIENT_CODECS = new Set(["hevc", "h265", "x265", "av1", "vp9"]);
// [minHeight, multiplier] — multipliers are relative to 1080p (1.0); used to scale the 1080p bitrate threshold
const BITRATE_RATIOS = [[2160, 4.0], [1080, 1.0], [720, 0.4], [0, 0.2]];

export function ffprobeFile(filePath) {
	return new Promise((resolve) => {
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), 30_000);
		const proc = spawn(
			"ffprobe",
			["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath],
			{ signal: ac.signal }
		);
		let stdout = "";
		proc.stdout.on("data", (d) => { stdout += d; });
		proc.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) return resolve(null);
			try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
		});
		proc.on("error", () => { clearTimeout(timer); resolve(null); });
	});
}

export async function checkVideoQuality(filePath, settings = {}) {
	const { resolution_threshold = 0, resolution_max = 0, video_bitrate_1080p = 0, audio_bitrate_min = 0 } = settings;
	const data = await ffprobeFile(filePath);
	if (!data) return ["corrupt_or_unreadable"];

	const streams = data.streams ?? [];
	const fmt = data.format ?? {};
	const issues = [];

	const video = streams.find((s) => s.codec_type === "video");
	const audio = streams.find((s) => s.codec_type === "audio");
	if (!video) return ["no_video_stream"];

	const codec = (video.codec_name ?? "").toLowerCase();
	if (BAD_CODECS.has(codec)) issues.push(`bad_codec:${codec}`);

	const height = video.height ?? 0;
	if (resolution_threshold > 0 && height && height < resolution_threshold)
		issues.push(`low_resolution:${video.width}x${height}`);
	if (resolution_max > 0 && height && height > resolution_max)
		issues.push(`high_resolution:${video.width}x${height}`);

	if (video_bitrate_1080p > 0 && height) {
		const ratio = (BITRATE_RATIOS.find(([h]) => height >= h) ?? BITRATE_RATIOS.at(-1))[1];
		let threshold = Math.floor(video_bitrate_1080p * ratio);
		if (EFFICIENT_CODECS.has(codec)) threshold = Math.floor(threshold / 2);
		const vbr = Math.floor(parseInt(video.bit_rate || fmt.bit_rate || "0", 10) / 1000);
		if (vbr > 0 && vbr < threshold) issues.push(`low_video_bitrate:${vbr}kbps`);
	}

	if (!audio) {
		issues.push("no_audio_stream");
	} else {
		const audioCodec = (audio.codec_name ?? "").toLowerCase();
		if (BAD_AUDIO_CODECS.has(audioCodec)) issues.push(`bad_audio_codec:${audioCodec}`);
		if (audio_bitrate_min > 0) {
			const abr = Math.floor(parseInt(audio.bit_rate || "0", 10) / 1000);
			if (abr > 0 && abr < audio_bitrate_min) issues.push(`low_audio_bitrate:${abr}kbps`);
		}
	}

	return issues;
}
