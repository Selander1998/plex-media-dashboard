import { useLang } from "../LangContext.jsx";

function timeStr(date) {
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function NotificationsPanel({ history, onClear }) {
	const { t } = useLang();

	return (
		<div className="absolute right-0 top-full mt-2 w-72 bg-surface border border-border rounded-lg shadow-xl z-50 flex flex-col">
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
				<span className="text-xs font-medium text-slate-300">{t("notif_title")}</span>
				{history.length > 0 && (
					<button onClick={onClear} className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer transition-colors">
						{t("notif_clear")}
					</button>
				)}
			</div>
			<div className="max-h-80 overflow-y-auto">
				{history.length === 0 ? (
					<p className="text-xs text-slate-500 px-4 py-3">{t("notif_empty")}</p>
				) : (
					history.map((n) => (
						<div key={n.id} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-border/50 last:border-0">
							<span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${n.error ? "bg-red-400" : "bg-green-400"}`} />
							<span className="text-xs text-slate-300 flex-1 leading-relaxed">{n.name}</span>
							<span className="text-xs text-slate-600 shrink-0">{timeStr(n.time)}</span>
						</div>
					))
				)}
			</div>
		</div>
	);
}
