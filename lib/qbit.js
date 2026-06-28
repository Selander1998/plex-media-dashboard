import { QBIT_URL, QBIT_USERNAME, QBIT_PASSWORD } from "./config.js";

let qbitCookie = null;
let loginBackoffUntil = 0;
const LOGIN_COOLDOWN_MS = 30_000;

async function qbitLogin() {
	const now = Date.now();
	if (now < loginBackoffUntil) {
		const wait = Math.ceil((loginBackoffUntil - now) / 1000);
		throw new Error(`qBittorrent login on cooldown — retry in ${wait}s`);
	}

	const res = await fetch(`${QBIT_URL}/api/v2/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ username: QBIT_USERNAME, password: QBIT_PASSWORD }),
	});
	const body = await res.text();
	console.log(`[qbit] login response: ${res.status} "${body.trim()}"`);
	if (body.trim() !== "Ok.") {
		qbitCookie = null;
		loginBackoffUntil = Date.now() + LOGIN_COOLDOWN_MS;
		return false;
	}
	const setCookie = res.headers.get("set-cookie");
	if (setCookie) qbitCookie = setCookie.split(";")[0];
	return !!qbitCookie;
}

export async function qbitFetch(path, options = {}) {
	if (!qbitCookie) {
		const ok = await qbitLogin();
		if (!ok) throw new Error("qBittorrent login failed — check credentials");
	}

	const buildOpts = () => ({
		...options,
		headers: { Cookie: qbitCookie, Referer: QBIT_URL, ...options.headers },
	});

	let res = await fetch(`${QBIT_URL}${path}`, buildOpts());

	if (res.status === 403) {
		const ok = await qbitLogin();
		if (!ok) throw new Error("qBittorrent login failed — check credentials");
		res = await fetch(`${QBIT_URL}${path}`, buildOpts());
	}

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`qBittorrent returned ${res.status}: ${text}`);
	}

	return res;
}
