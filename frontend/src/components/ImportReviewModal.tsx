import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ImportPreview } from "../context/AppContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useScrollLock } from "../hooks/useScrollLock";

interface ImportReviewModalProps {
	isOpen: boolean;
	importPreview: ImportPreview | null;
	formattedExportedAt: string;
	importing: boolean;
	exporting: boolean;
	onClose: () => void;
	onBackup: () => void;
	onConfirm: () => void;
}

export function ImportReviewModal({
	isOpen,
	importPreview,
	formattedExportedAt,
	importing,
	exporting,
	onClose,
	onBackup,
	onConfirm,
}: ImportReviewModalProps) {
	const { t } = useTranslation();
	const titleId = "import-review-modal-title";
	const hasExistingData = importPreview?.warnings.replacesExistingData ?? false;
	const hasWarnings = Boolean(
		importPreview?.warnings.replacesExistingData ||
			importPreview?.warnings.regeneratesShareLinks ||
			importPreview?.warnings.containsImages ||
			importPreview?.warnings.containsSensitiveData
	);

	useScrollLock(isOpen);
	useEscapeKey(isOpen, onClose);

	if (!isOpen || !importPreview) {
		return null;
	}

	return (
		<div
			className="modal-overlay"
			onClick={onClose}
			onKeyDown={(event) => {
				if (event.key !== "Escape") {
					event.stopPropagation();
				}
			}}
		>
			<div
				className="modal-content confirm-modal import-review-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				onClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => {
					if (event.key !== "Escape") {
						event.stopPropagation();
					}
				}}
			>
				<button className="modal-close" onClick={onClose} type="button" aria-label={t("common.close")}>
					<X size={20} aria-hidden="true" />
				</button>
				<h2 id={titleId}>{t(hasExistingData ? "exportImport.confirmImport" : "exportImport.confirmImportEmpty")}</h2>
				<div className="import-review-body">
					<p>{t(hasExistingData ? "exportImport.reviewDescription" : "exportImport.reviewDescriptionEmpty")}</p>
					<div className="import-review-summary">
						<div className="action-card">
							<div className="action-card-content">
								<span className="action-card-title">{t("exportImport.incomingData")}</span>
								<span className="action-card-desc">
									{t("exportImport.summaryCounts", {
										medications: importPreview.incoming.medications,
										doses: importPreview.incoming.doseHistory,
										refills: importPreview.incoming.refillHistory,
										shares: importPreview.incoming.shareLinks,
									})}
								</span>
							</div>
							<div className="import-review-meta">
								<span>{t("exportImport.formatVersion", { version: importPreview.version })}</span>
								<span>{t("exportImport.exportedAt", { date: formattedExportedAt })}</span>
								{importPreview.incoming.hasSettings && <span>{t("exportImport.settingsIncluded")}</span>}
								{importPreview.incoming.journalEntries > 0 && (
									<span>{t("exportImport.journalEntries", { count: importPreview.incoming.journalEntries })}</span>
								)}
								{importPreview.incoming.imageCount > 0 && (
									<span>{t("exportImport.imageCount", { count: importPreview.incoming.imageCount })}</span>
								)}
							</div>
						</div>
						<div className="action-card">
							<div className="action-card-content">
								<span className="action-card-title">{t("exportImport.currentData")}</span>
								<span className="action-card-desc">
									{t("exportImport.summaryCounts", {
										medications: importPreview.current.medications,
										doses: importPreview.current.doseHistory,
										refills: importPreview.current.refillHistory,
										shares: importPreview.current.shareLinks,
									})}
								</span>
							</div>
							{importPreview.current.hasSettings && (
								<span className="import-review-meta">{t("exportImport.settingsConfigured")}</span>
							)}
						</div>
					</div>

					{hasWarnings && (
						<div className="import-review-warnings">
							<strong>{t("exportImport.warningListTitle")}</strong>
							<ul>
								{importPreview.warnings.replacesExistingData && <li>{t("exportImport.warningReplaceData")}</li>}
								{importPreview.warnings.regeneratesShareLinks && <li>{t("exportImport.warningShareLinks")}</li>}
								{importPreview.warnings.containsImages && <li>{t("exportImport.warningImages")}</li>}
								{importPreview.warnings.containsSensitiveData && <li>{t("exportImport.warningSensitive")}</li>}
							</ul>
						</div>
					)}

					{hasExistingData ? (
						<p className="warning-text">{t("exportImport.confirmImportWarning")}</p>
					) : (
						<p className="hint-text">{t("exportImport.confirmImportEmptyMessage")}</p>
					)}

					<p className="hint-text">{t("exportImport.backupHint")}</p>
				</div>
				<div className="modal-footer import-review-footer">
					<button type="button" className="ghost" onClick={onClose} disabled={importing || exporting}>
						{t("exportImport.cancelButton")}
					</button>
					<div className="import-review-actions">
						{hasExistingData && (
							<button type="button" className="secondary" onClick={onBackup} disabled={exporting || importing}>
								{exporting ? t("exportImport.exporting") : t("exportImport.backupFirst")}
							</button>
						)}
						<button
							type="button"
							className={hasExistingData ? "danger" : "primary"}
							onClick={onConfirm}
							disabled={importing}
						>
							{importing
								? t("exportImport.importing")
								: t(hasExistingData ? "exportImport.confirmButton" : "exportImport.confirmButtonEmpty")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
