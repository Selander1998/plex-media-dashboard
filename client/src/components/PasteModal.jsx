import { useLang } from "../LangContext.jsx";

export default function PasteModal({ savePaths, savePathIdx, pasteRef, onPaste, onClose }) {
	const { t } = useLang();

	return (
		<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
			<div
				className="bg-surface border border-border rounded-xl px-8 py-6 flex flex-col items-center gap-3 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<span className="text-slate-300 text-sm font-medium">{t("paste_magnet")}</span>
				{savePaths.length > 0 && (
					<span className="text-slate-500 text-xs">
						{t("paste_saving_to")} {savePaths[savePathIdx].split("/").filter(Boolean)[1] ?? savePaths[savePathIdx]}
					</span>
				)}
				<span className="text-slate-500 text-xs">{t("paste_hint")}</span>
				<input
					ref={pasteRef}
					type="text"
					onPaste={onPaste}
					onKeyDown={(e) => e.key === "Escape" && onClose()}
					className="opacity-0 absolute w-0 h-0"
				/>
			</div>
		</div>
	);
}
