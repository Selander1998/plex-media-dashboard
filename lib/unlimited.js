import { readFile, writeFile } from "fs/promises";
import { UNLIMITED_STATE_PATH } from "./config.js";
import { qbitFetch } from "./qbit.js";

const _timers = { dl: null, ul: null };
const _state  = { dl: null, ul: null }; // { restoreLimit: bytes, restoreAt: epoch ms }

const QBIT_SET = {
	dl: "/api/v2/transfer/setDownloadLimit",
	ul: "/api/v2/transfer/setUploadLimit",
};

export function getUnlimitedState(type) { return _state[type]; }

async function _persist() {
	await writeFile(UNLIMITED_STATE_PATH, JSON.stringify({ dl: _state.dl, ul: _state.ul })).catch(() => {});
}

async function _doRestore(type) {
	const { restoreLimit } = _state[type];
	await qbitFetch(QBIT_SET[type], {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ limit: String(restoreLimit) }),
	}).catch((e) => console.error(`[unlimited] restore ${type} failed: ${e.message}`));
	_timers[type] = null;
	_state[type] = null;
	await _persist();
	console.log(`[unlimited] ${type} restored to ${restoreLimit} bytes/s`);
}

export async function activateUnlimited(type, minutes, restoreLimit) {
	if (_timers[type]) clearTimeout(_timers[type]);
	const restoreAt = Date.now() + minutes * 60 * 1000;
	_state[type] = { restoreLimit, restoreAt };
	_timers[type] = setTimeout(() => _doRestore(type), minutes * 60 * 1000);
	await _persist();
}

export async function cancelUnlimited(type) {
	if (!_state[type]) return;
	if (_timers[type]) { clearTimeout(_timers[type]); _timers[type] = null; }
	await _doRestore(type);
}

export async function initUnlimitedTimers() {
	let saved;
	try { saved = JSON.parse(await readFile(UNLIMITED_STATE_PATH, "utf-8")); } catch { return; }
	for (const type of ["dl", "ul"]) {
		const s = saved[type];
		if (!s) continue;
		_state[type] = s;
		const msLeft = s.restoreAt - Date.now();
		if (msLeft <= 0) {
			console.log(`[unlimited] ${type} restore was overdue — applying now`);
			await _doRestore(type);
		} else {
			_timers[type] = setTimeout(() => _doRestore(type), msLeft);
			console.log(`[unlimited] ${type} timer resumed (${Math.ceil(msLeft / 1000)}s remaining)`);
		}
	}
}
