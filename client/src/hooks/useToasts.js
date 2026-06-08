import { useState, useRef } from "react";

export function useToasts() {
	const [toasts, setToasts] = useState([]);
	const [history, setHistory] = useState([]);
	const [unread, setUnread] = useState(0);
	const toastId = useRef(0);

	function pushToast(name, error = false) {
		const id = ++toastId.current;
		const entry = { id, name, error, time: new Date() };
		setToasts((prev) => [...prev, entry]);
		setHistory((prev) => [entry, ...prev].slice(0, 50));
		setUnread((n) => n + 1);
		setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
	}

	function clearUnread() { setUnread(0); }
	function clearHistory() { setHistory([]); setUnread(0); }

	return { toasts, history, unread, pushToast, clearUnread, clearHistory };
}
