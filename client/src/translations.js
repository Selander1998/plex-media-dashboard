const jsonModules = import.meta.glob("./locales/*.json", { eager: true });
const svgModules  = import.meta.glob("./locales/*.svg",  { eager: true, query: "?url", import: "default" });

export const translations = Object.fromEntries(
	Object.entries(jsonModules).map(([path, mod]) => {
		const lang = path.match(/\/([^/]+)\.json$/)[1];
		return [lang, mod.default ?? mod];
	}),
);

export const flagUrls = Object.fromEntries(
	Object.entries(svgModules).map(([path, url]) => {
		const code = path.match(/\/([^/]+)\.svg$/)[1];
		return [code, url];
	}),
);

export const availableLangs = Object.keys(translations).sort();
