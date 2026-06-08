import { useState } from "react";

const DEFAULTS = { torrentRefreshInterval: 5000 };

export function useSettings() {
	const [settings, setSettings] = useState(() => {
		try {
			const s = localStorage.getItem("dashboard_settings");
			return s ? { ...DEFAULTS, ...JSON.parse(s) } : DEFAULTS;
		} catch {
			return DEFAULTS;
		}
	});

	function updateSetting(key, value) {
		const next = { ...settings, [key]: value };
		setSettings(next);
		localStorage.setItem("dashboard_settings", JSON.stringify(next));
	}

	return { settings, updateSetting };
}
