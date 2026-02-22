import { useTranslation } from "react-i18next";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useScrollLock } from "../hooks/useScrollLock";

interface ExportModalProps {
	isOpen: boolean;
	onClose: () => void;
	onExport: (includeImages: boolean) => void;
	exporting: boolean;
}

export default function ExportModal({ isOpen, onClose, onExport, exporting }: ExportModalProps) {
	const { t } = useTranslation();

	useScrollLock(isOpen);
	useEscapeKey(isOpen, onClose);

	if (!isOpen) return null;

	return (
		<div
			className="modal-overlay"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClose();
				}
			}}
		>
			<div
				className="modal-content"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key !== "Escape") e.stopPropagation();
				}}
				style={{ maxWidth: "450px" }}
			>
				<button className="modal-close" onClick={onClose}>
					×
				</button>
				<h2 style={{ marginBottom: "16px", paddingRight: "2rem" }}>{t("exportImport.exportOptions")}</h2>
				<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
					<button
						type="button"
						className="action-card"
						onClick={() => {
							onClose();
							onExport(true);
						}}
						disabled={exporting}
						style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)", borderRadius: "8px" }}
					>
						<div className="action-card-content" style={{ flex: 1 }}>
							<span className="action-card-title">{t("exportImport.exportWithImages")}</span>
							<span className="action-card-desc">{t("exportImport.exportWithImagesDesc")}</span>
						</div>
					</button>
					<button
						type="button"
						className="action-card"
						onClick={() => {
							onClose();
							onExport(false);
						}}
						disabled={exporting}
						style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)", borderRadius: "8px" }}
					>
						<div className="action-card-content" style={{ flex: 1 }}>
							<span className="action-card-title">{t("exportImport.exportDataOnly")}</span>
							<span className="action-card-desc">{t("exportImport.exportDataOnlyDesc")}</span>
						</div>
					</button>
				</div>
				<div className="modal-footer" style={{ padding: "1rem 0 0 0", borderTop: "none", justifyContent: "flex-end" }}>
					<button type="button" className="ghost" onClick={onClose}>
						{t("common.close")}
					</button>
				</div>
			</div>
		</div>
	);
}
