import { useState, useRef } from "react";

export function useToasts() {
	const [toasts, setToasts] = useState([]);
	const toastId = useRef(0);

	function pushToast(name, error = false) {
		const id = ++toastId.current;
		setToasts((prev) => [...prev, { id, name, error }]);
		setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 4000);
	}

	return { toasts, pushToast };
}
