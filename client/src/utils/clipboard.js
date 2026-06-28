export function copyText(text) {
	if (navigator.clipboard && window.isSecureContext) {
		return navigator.clipboard.writeText(text);
	}
	const el = document.createElement("textarea");
	el.value = text;
	el.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
	document.body.appendChild(el);
	el.select();
	document.execCommand("copy");
	document.body.removeChild(el);
	return Promise.resolve();
}
