import { useState, useEffect } from "react";
import { useLang } from "../LangContext.jsx";
import { translations, availableLangs, flagUrls } from "../translations.js";
import { exportStatsCard } from "../exportStats.js";

const INTERVALS = [
	{ value: 2000, label: "2s" },
	{ value: 5000, label: "5s" },
	{ value: 10000, label: "10s" },
	{ value: 30000, label: "30s" },
	{ value: 60000, label: "60s" },
];

export default function SettingsPanel({ settings, updateSetting, report, locale, onToast }) {
	const { lang, switchLang, t } = useLang();
	const [cacheStatus, setCacheStatus] = useState(null);
	const [qualityCacheStatus, setQualityCacheStatus] = useState(null);
	const [cacheAge, setCacheAge] = useState(null);
	const [qualityCacheAge, setQualityCacheAge] = useState(null);
	const [resolutionThreshold, setResolutionThreshold] = useState(720);
	const [resolutionMax, setResolutionMax] = useState(0);
	const [videoBitrate, setVideoBitrate] = useState(0);
	const [audioBitrate, setAudioBitrate] = useState(0);
	const [autoPause, setAutoPause] = useState(false);

	useEffect(() => {
		fetch("/api/cache").then((r) => r.json()).then((d) => setCacheAge(d.ageDays ?? null)).catch(() => {});
		fetch("/api/quality-cache").then((r) => r.json()).then((d) => setQualityCacheAge(d.ageDays ?? null)).catch(() => {});
		fetch("/api/quality-settings").then((r) => r.json()).then((d) => {
			setResolutionThreshold(d.resolution_threshold ?? 720);
			setResolutionMax(d.resolution_max ?? 0);
			setVideoBitrate(d.video_bitrate_1080p ?? 0);
			setAudioBitrate(d.audio_bitrate_min ?? 0);
		}).catch(() => {});
	}, []);

	async function saveQualitySettings(patch) {
		await fetch("/api/quality-settings", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(patch),
		}).catch(() => {});
	}

	function handleResolutionThreshold(value) {
		setResolutionThreshold(value);
		saveQualitySettings({ resolution_threshold: value });
	}

	function handleResolutionMax(value) {
		setResolutionMax(value);
		saveQualitySettings({ resolution_max: value });
	}

	function handleVideoBitrate(value) {
		setVideoBitrate(value);
		saveQualitySettings({ video_bitrate_1080p: value });
	}

	function handleAudioBitrate(value) {
		setAudioBitrate(value);
		saveQualitySettings({ audio_bitrate_min: value });
	}

	useEffect(() => {
		fetch("/api/qbit/auto-pause")
			.then((r) => r.json())
			.then((d) => setAutoPause(d.enabled))
			.catch(() => {});
	}, []);

	async function toggleAutoPause() {
		const next = !autoPause;
		setAutoPause(next);
		onToast(t(next ? "toast_auto_pause_on" : "toast_auto_pause_off"));
		await fetch("/api/qbit/auto-pause", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: next }),
		});
	}

	function ageLabel(days) {
		if (days == null) return null;
		if (days === 0) return { text: t("cache_age_today"), cls: "text-slate-500" };
		const text = t("cache_age_days", { n: days });
		const cls = days >= 30 ? "text-red-400" : days >= 14 ? "text-amber-400" : "text-slate-500";
		return { text, cls };
	}

	async function handleClearQualityCache() {
		if (qualityCacheStatus === "loading") return;
		setQualityCacheStatus("loading");
		try {
			const res = await fetch("/api/quality-cache", { method: "DELETE" });
			if (!res.ok) throw new Error();
			setQualityCacheStatus("ok");
			onToast(t("toast_quality_cache_cleared"));
		} catch {
			setQualityCacheStatus("error");
			onToast(t("toast_quality_cache_clear_failed"), true);
		} finally {
			setTimeout(() => setQualityCacheStatus(null), 2000);
		}
	}

	async function handleClearCache() {
		if (cacheStatus === "loading") return;
		setCacheStatus("loading");
		try {
			const res = await fetch("/api/cache", { method: "DELETE" });
			if (!res.ok) throw new Error();
			setCacheStatus("ok");
			onToast(t("toast_cache_cleared"));
		} catch {
			setCacheStatus("error");
			onToast(t("toast_cache_clear_failed"), true);
		} finally {
			setTimeout(() => setCacheStatus(null), 2000);
		}
	}

	return (
		<div className="absolute right-0 top-full mt-2 w-64 bg-surface border border-border rounded-lg shadow-xl z-50 p-4 flex flex-col gap-4">
			<div>
				<p className="text-xs text-slate-500 mb-2">{t("settings_language")}</p>
				<div className="flex gap-2">
					{availableLangs.map((l) => (
						<button
							key={l}
							onClick={() => switchLang(l)}
							className={`transition-opacity rounded-sm cursor-pointer ${lang === l ? "opacity-100" : "opacity-30 hover:opacity-60"}`}
						>
							<img src={flagUrls[translations[l].flag]} alt={l} className="w-6 h-auto rounded-sm" />
						</button>
					))}
				</div>
			</div>

			<div>
				<p className="text-xs text-slate-500 mb-2">{t("settings_quality_threshold")}</p>
				<div className="flex gap-1">
					{[480, 720, 1080].map((p) => (
						<button
							key={p}
							onClick={() => handleResolutionThreshold(p)}
							className={`px-2.5 py-1 text-xs rounded cursor-pointer transition-colors ${
								resolutionThreshold === p
									? "bg-indigo-600 text-white"
									: "bg-surface2 text-slate-400 hover:text-slate-200"
							}`}
						>
							{p}p
						</button>
					))}
				</div>
			</div>

			<div>
				<p className="text-xs text-slate-500 mb-2">{t("settings_max_resolution")}</p>
				<div className="flex flex-wrap gap-1">
					{[[0, t("settings_off")], [720, "720p"], [1080, "1080p"], [1440, "1440p"], [2160, "2160p"]].map(([val, label]) => (
						<button
							key={val}
							onClick={() => handleResolutionMax(val)}
							className={`px-2.5 py-1 text-xs rounded cursor-pointer transition-colors ${
								resolutionMax === val
									? "bg-indigo-600 text-white"
									: "bg-surface2 text-slate-400 hover:text-slate-200"
							}`}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			<div className="flex flex-col gap-3">
				<div>
					<div className="flex justify-between text-xs text-slate-500 mb-1">
						<span>{t("settings_video_bitrate")}</span>
						<span className={videoBitrate === 0 ? "text-slate-600" : "text-slate-300"}>{videoBitrate === 0 ? t("settings_off") : `${videoBitrate} kbps`}</span>
					</div>
					<input type="range" min={0} max={4000} step={100} value={videoBitrate}
						onChange={(e) => setVideoBitrate(parseInt(e.target.value))}
						onPointerUp={(e) => handleVideoBitrate(parseInt(e.target.value))}
						className="w-full accent-indigo-500 cursor-pointer" />
				</div>
				<div>
					<div className="flex justify-between text-xs text-slate-500 mb-1">
						<span>{t("settings_audio_bitrate")}</span>
						<span className={audioBitrate === 0 ? "text-slate-600" : "text-slate-300"}>{audioBitrate === 0 ? t("settings_off") : `${audioBitrate} kbps`}</span>
					</div>
					<input type="range" min={0} max={320} step={8} value={audioBitrate}
						onChange={(e) => setAudioBitrate(parseInt(e.target.value))}
						onPointerUp={(e) => handleAudioBitrate(parseInt(e.target.value))}
						className="w-full accent-indigo-500 cursor-pointer" />
				</div>
			</div>

			<div>
				<p className="text-xs text-slate-500 mb-2">{t("settings_refresh")}</p>
				<div className="flex gap-1">
					{INTERVALS.map(({ value, label }) => (
						<button
							key={value}
							onClick={() => updateSetting("torrentRefreshInterval", value)}
							className={`px-2.5 py-1 text-xs rounded cursor-pointer transition-colors ${
								settings.torrentRefreshInterval === value
									? "bg-indigo-600 text-white"
									: "bg-surface2 text-slate-400 hover:text-slate-200"
							}`}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			<div>
				<p className="text-xs text-slate-500 mb-2">Clock format</p>
				<div className="flex gap-1">
					{[{ value: "24h", label: "24h" }, { value: "12h", label: "AM/PM" }].map(({ value, label }) => (
						<button
							key={value}
							onClick={() => updateSetting("clockFormat", value)}
							className={`px-2.5 py-1 text-xs rounded cursor-pointer transition-colors ${
								(settings.clockFormat ?? "24h") === value
									? "bg-indigo-600 text-white"
									: "bg-surface2 text-slate-400 hover:text-slate-200"
							}`}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			<div className="border-t border-border pt-3 flex flex-col gap-2">
				<button
					onClick={toggleAutoPause}
					title={t("auto_pause_title")}
					className="flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
				>
					<span>{t("auto_pause_btn")}</span>
					<span className={`w-7 h-4 rounded-full transition-colors flex items-center px-0.5 ${autoPause ? "bg-green-600" : "bg-slate-600"}`}>
						<span className={`w-3 h-3 rounded-full bg-white transition-transform ${autoPause ? "translate-x-3" : "translate-x-0"}`} />
					</span>
				</button>
				{report && (
					<button
						onClick={() => exportStatsCard(report, locale, t)}
						className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
					>
						<svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
							<path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
						</svg>
						{t("export_stats_title")}
					</button>
				)}
				<div className="flex flex-col gap-0.5">
					<button
						onClick={handleClearCache}
						disabled={cacheStatus === "loading"}
						className={`flex items-center gap-2 text-xs cursor-pointer transition-colors disabled:opacity-40 ${
							cacheStatus === "ok" ? "text-green-400" : cacheStatus === "error" ? "text-red-400" : "text-slate-400 hover:text-slate-200"
						}`}
					>
						<svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
							<path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
						</svg>
						{cacheStatus === "ok" ? t("toast_cache_cleared") : cacheStatus === "error" ? t("toast_cache_clear_failed") : t("clear_cache_title")}
					</button>
					{cacheStatus == null && ageLabel(cacheAge) && (
						<span className={`text-[11px] pl-5 ${ageLabel(cacheAge).cls}`}>{ageLabel(cacheAge).text}</span>
					)}
				</div>
				<div className="flex flex-col gap-0.5">
					<button
						onClick={handleClearQualityCache}
						disabled={qualityCacheStatus === "loading"}
						className={`flex items-center gap-2 text-xs cursor-pointer transition-colors disabled:opacity-40 ${
							qualityCacheStatus === "ok" ? "text-green-400" : qualityCacheStatus === "error" ? "text-red-400" : "text-slate-400 hover:text-slate-200"
						}`}
					>
						<svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
							<path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
						</svg>
						{qualityCacheStatus === "ok" ? t("toast_quality_cache_cleared") : qualityCacheStatus === "error" ? t("toast_quality_cache_clear_failed") : t("clear_quality_cache_title")}
					</button>
					{qualityCacheStatus == null && ageLabel(qualityCacheAge) && (
						<span className={`text-[11px] pl-5 ${ageLabel(qualityCacheAge).cls}`}>{ageLabel(qualityCacheAge).text}</span>
					)}
				</div>
			</div>
		</div>
	);
}
