import { createContext, useContext, useState } from "react";
import { translations } from "./translations.js";

const LangContext = createContext(null);

export function LangProvider({ children }) {
	const [lang, setLang] = useState(() => localStorage.getItem("lang") || "en");

	function t(key, vars = {}) {
		const str = translations[lang]?.[key] ?? translations.en[key] ?? key;
		return Object.entries(vars).reduce(
			(s, [k, v]) => s.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v)),
			str,
		);
	}

	function switchLang(newLang) {
		setLang(newLang);
		localStorage.setItem("lang", newLang);
	}

	const locale = lang === "sv" ? "sv-SE" : "en-US";

	return (
		<LangContext.Provider value={{ lang, locale, switchLang, t }}>
			{children}
		</LangContext.Provider>
	);
}

export function useLang() {
	return useContext(LangContext);
}
