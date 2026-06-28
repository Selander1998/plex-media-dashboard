import { NTFY_URL, NTFY_USER, NTFY_PASS } from "./config.js";

export function toAscii(str) {
	return String(str ?? "")
		.replace(/[''‚‛′‵]/g, "'")
		.replace(/[""„‟″‶]/g, '"')
		.replace(/[–—―]/g, " - ")
		.replace(/…/g, "...")
		.replace(/[^\x00-\xFF]/g, "");
}

export function sendNtfy({ title, body, tags = "", priority = "default" }) {
	if (!NTFY_URL) return;
	fetch(NTFY_URL, {
		method: "POST",
		headers: {
			"Authorization": "Basic " + Buffer.from(`${NTFY_USER}:${NTFY_PASS}`).toString("base64"),
			"Title": toAscii(title),
			"Tags": tags,
			"Priority": priority,
		},
		body: toAscii(body),
	}).catch((e) => console.error("[ntfy] error:", e.message));
}
