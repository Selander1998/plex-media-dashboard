export default function StatCard({ label, value, colorClass = "text-slate-200" }) {
	return (
		<div className="bg-surface border border-border rounded-lg px-4.5 py-3 min-w-32.5">
			<div className="text-[11px] text-slate-400 uppercase tracking-[0.5px] mb-1">{label}</div>
			<div className={`text-[22px] font-bold ${colorClass}`}>{value}</div>
		</div>
	);
}
