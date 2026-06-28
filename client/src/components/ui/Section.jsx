export function Section({ title, count, colorClass = "text-amber-500", children }) {
	return (
		<div>
			<div className="flex items-center gap-2 mb-2">
				<h2 className="text-sm font-semibold text-slate-300">{title}</h2>
				<span className={`text-xs font-medium ${colorClass}`}>{count}</span>
			</div>
			<div className="bg-surface border border-border rounded-lg overflow-hidden divide-y divide-border">
				{children}
			</div>
		</div>
	);
}

export function Row({ label, children }) {
	return (
		<div className="px-4 py-3 flex flex-col gap-1">
			<span className="text-slate-200 text-[13px] font-medium">{label}</span>
			{children}
		</div>
	);
}
