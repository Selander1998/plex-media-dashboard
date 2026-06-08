import { useLang } from "../LangContext.jsx";
import { translations, availableLangs, flagUrls } from "../translations.js";

const INTERVALS = [
	{ value: 2000, label: "2s" },
	{ value: 5000, label: "5s" },
	{ value: 10000, label: "10s" },
	{ value: 30000, label: "30s" },
];

export default function SettingsPanel({ settings, updateSetting }) {
	const { lang, switchLang, t } = useLang();

	return (
		<div className="absolute right-0 top-full mt-2 w-60 bg-surface border border-border rounded-lg shadow-xl z-50 p-4 flex flex-col gap-4">
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
		</div>
	);
}
