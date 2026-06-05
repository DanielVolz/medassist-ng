import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useScrollLock } from "../hooks/useScrollLock";

interface ExportModalProps {
	isOpen: boolean;
	onClose: () => void;
	onExport: (includeImages: boolean, includeSensitive: boolean) => void;
	exporting: boolean;
}

export default function ExportModal({ isOpen, onClose, onExport, exporting }: ExportModalProps) {
	const { t } = useTranslation();
	const [includeSensitive, setIncludeSensitive] = useState(false);

	useScrollLock(isOpen);
	useEscapeKey(isOpen, onClose);
	useEffect(() => {
		if (!isOpen) {
			setIncludeSensitive(false);
		}
	}, [isOpen]);

	if (!isOpen) return null;

	return (
		<div
			className="modal-overlay"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key !== "Escape") e.stopPropagation();
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
							onExport(true, includeSensitive);
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
							onExport(false, includeSensitive);
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
				<div
					className="sensitive-export-confirmation"
					style={{ marginTop: "14px", padding: "12px", border: "1px solid var(--border)", borderRadius: "8px" }}
				>
					<label
						style={{
							display: "flex",
							alignItems: "flex-start",
							gap: "10px",
							cursor: exporting ? "default" : "pointer",
						}}
					>
						<input
							type="checkbox"
							checked={includeSensitive}
							onChange={(event) => setIncludeSensitive(event.target.checked)}
							disabled={exporting}
							aria-describedby={includeSensitive ? "sensitive-export-warning" : undefined}
						/>
						<span>{t("exportImport.includeSensitive")}</span>
					</label>
					{includeSensitive && (
						<p id="sensitive-export-warning" className="warning-text" style={{ margin: "10px 0 0 0" }}>
							{t("exportImport.sensitiveWarning")}
						</p>
					)}
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
