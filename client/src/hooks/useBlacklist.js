import { useLang } from "../LangContext.jsx";

export function useBlacklist({ onBlock, onToast } = {}) {
	const { t } = useLang();

	async function blockTitle(title) {
		onBlock?.(title);
		onToast?.(t("toast_blacklisted", { title }));
		try {
			await fetch("/api/blacklist", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title }),
			});
		} catch {
			// best-effort — item is already hidden locally
		}
	}

	return { blockTitle };
}
