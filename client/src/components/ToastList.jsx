import { useLang } from "../LangContext.jsx";

export default function ToastList({ toasts }) {
	const { t } = useLang();

	if (toasts.length === 0) return null;

	return (
		<div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end">
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`flex items-center gap-2.5 rounded-lg px-4 py-3 shadow-xl text-sm animate-fade-in border ${toast.error ? "bg-red-950/60 border-red-800" : "bg-surface border-border"}`}
				>
					{toast.error ? (
						<svg className="w-4 h-4 shrink-0 text-red-400" viewBox="0 0 20 20" fill="currentColor">
							<path
								fillRule="evenodd"
								d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
								clipRule="evenodd"
							/>
						</svg>
					) : (
						<svg className="w-4 h-4 shrink-0 text-green-400" viewBox="0 0 20 20" fill="currentColor">
							<path
								fillRule="evenodd"
								d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
								clipRule="evenodd"
							/>
						</svg>
					)}
					<span className="text-slate-200">{toast.name ?? t("toast_torrent_added")}</span>
				</div>
			))}
		</div>
	);
}
