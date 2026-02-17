/**
 * MedDetailModal - Medication detail view with nested modals
 * Displays medication information, stock, schedules, and provides refill/edit functionality
 *
 * Can work in two modes:
 * 1. Context mode: Uses useAppContext() for all state (when no props provided)
 * 2. Props mode: Accepts all required data as props (for gradual adoption)
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lightbox, MedicationAvatar } from "../components";
import type { Coverage, Medication, RefillEntry, StockThresholds } from "../types";
import { getMedTotal, getPackageSize } from "../types";
import { formatNumber, generateICS, getExpiryClass, getSystemLocale } from "../utils";
import { getStockStatus } from "../utils/schedule";

// =============================================================================
// Local Helper Functions
// =============================================================================

/**
 * Calculate blister stock - divides current pills into full blisters and partial
 */
function getBlisterStock(
	currentPills: number,
	pillsPerBlister: number,
	_originalLooseTablets: number,
	_originalTotalPills: number
): { fullBlisters: number; openBlisterPills: number; loosePills: number } {
	if (pillsPerBlister <= 0 || pillsPerBlister === 1) {
		return { fullBlisters: 0, openBlisterPills: 0, loosePills: currentPills };
	}
	const fullBlisters = Math.floor(currentPills / pillsPerBlister);
	const openBlisterPills = currentPills % pillsPerBlister;
	return { fullBlisters, openBlisterPills, loosePills: 0 };
}

/**
 * Format full blisters column
 */
function formatFullBlisters(fullBlisters: number, t: (key: string) => string): string {
	if (fullBlisters === 0) return "—";
	return `${fullBlisters} ${fullBlisters === 1 ? t("common.blister") : t("common.blisters")}`;
}

/**
 * Format open blister column
 */
function formatOpenBlisterAndLoose(
	openBlisterPills: number,
	_loosePills: number,
	pillsPerBlister: number,
	t: (key: string) => string
): string {
	if (openBlisterPills > 0) {
		return `${openBlisterPills} ${t("common.of")} ${pillsPerBlister} ${t("common.pills")}`;
	}
	return "—";
}

// =============================================================================
// Props Interface
// =============================================================================

export interface MedDetailModalProps {
	// Required
	selectedMed: Medication | null;
	coverage: { all: Coverage[] };
	settings: StockThresholds;
	// Modal state
	showImageLightbox: boolean;
	showRefillModal: boolean;
	showEditStockModal: boolean;
	// Modal actions
	onClose: () => void;
	onOpenImageLightbox: () => void;
	onCloseImageLightbox: () => void;
	onOpenRefillModal: () => void;
	onCloseRefillModal: () => void;
	onOpenEditStockModal: () => void;
	onCloseEditStockModal: () => void;
	// Refill state
	refillPacks: number;
	onRefillPacksChange: (value: number) => void;
	refillLoose: number;
	onRefillLooseChange: (value: number) => void;
	usePrescriptionRefill: boolean;
	onUsePrescriptionRefillChange: (value: boolean) => void;
	refillSaving: boolean;
	refillHistory: RefillEntry[];
	refillHistoryExpanded: boolean;
	onRefillHistoryExpandedChange: (value: boolean) => void;
	onSubmitRefill: (medId: number, usePrescription?: boolean) => Promise<void>;
	// Edit stock state
	editStockFullBlisters: number;
	onEditStockFullBlistersChange: (value: number) => void;
	editStockPartialBlisterPills: number;
	onEditStockPartialBlisterPillsChange: (value: number) => void;
	editStockSaving: boolean;
	onSubmitStockCorrection: (medId: number) => Promise<void>;
}

export function MedDetailModal({
	selectedMed,
	coverage,
	settings,
	showImageLightbox,
	showRefillModal,
	showEditStockModal,
	onClose,
	onOpenImageLightbox,
	onCloseImageLightbox,
	onOpenRefillModal,
	onCloseRefillModal,
	onOpenEditStockModal,
	onCloseEditStockModal,
	refillPacks,
	onRefillPacksChange,
	refillLoose,
	onRefillLooseChange,
	usePrescriptionRefill,
	onUsePrescriptionRefillChange,
	refillSaving,
	refillHistory,
	refillHistoryExpanded,
	onRefillHistoryExpandedChange,
	onSubmitRefill,
	editStockFullBlisters,
	onEditStockFullBlistersChange,
	editStockPartialBlisterPills,
	onEditStockPartialBlisterPillsChange,
	editStockSaving,
	onSubmitStockCorrection,
}: MedDetailModalProps) {
	const { t, i18n } = useTranslation();
	const [editStockFullInput, setEditStockFullInput] = useState("0");
	const [editStockPartialInput, setEditStockPartialInput] = useState("0");

	const parseStockInput = (value: string): number => {
		const parsed = Number.parseInt(value, 10);
		return Number.isNaN(parsed) ? 0 : parsed;
	};

	useEffect(() => {
		if (showEditStockModal) {
			setEditStockFullInput(String(editStockFullBlisters));
			setEditStockPartialInput(String(editStockPartialBlisterPills));
		}
	}, [showEditStockModal, editStockFullBlisters, editStockPartialBlisterPills]);

	if (!selectedMed) return null;

	const medCoverage = coverage.all.find((c) => c.name === selectedMed.name);
	const packageSize = getPackageSize(selectedMed);
	const currentStock = medCoverage ? Math.round(medCoverage.medsLeft) : getMedTotal(selectedMed);
	const status = medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
	const fallbackTextClass = status?.className === "warning" ? "warning-text" : "success-text";
	const textClass = status?.className === "danger" ? "danger-text" : fallbackTextClass;
	const stock = getBlisterStock(currentStock, selectedMed.pillsPerBlister, selectedMed.looseTablets, packageSize);
	const fullForBounds = Math.max(0, parseStockInput(editStockFullInput));

	return (
		<div
			className="modal-overlay"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div
				className="modal-content med-detail-modal"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<button className="modal-close" onClick={onClose}>
					×
				</button>

				<div className="med-detail-body">
					{/* Header */}
					<div className="med-detail-header">
						<div
							className={`med-detail-avatar-wrapper ${selectedMed.imageUrl ? "clickable" : ""}`}
							onClick={() => selectedMed.imageUrl && onOpenImageLightbox()}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									if (selectedMed.imageUrl) onOpenImageLightbox();
								}
							}}
						>
							<MedicationAvatar name={selectedMed.name} imageUrl={selectedMed.imageUrl} size="lg" />
							{selectedMed.imageUrl && <span className="expand-icon">🔍</span>}
						</div>
						<div className="med-detail-titles">
							<h2>{selectedMed.name}</h2>
							{selectedMed.genericName && <span className="med-generic-name">{selectedMed.genericName}</span>}
							{selectedMed.takenBy && (selectedMed.takenBy || []).length > 0 && (
								<span className="med-taken-by">
									{t("modal.for")}{" "}
									{selectedMed.takenBy.map((person, index) => (
										<span key={person}>
											{index > 0 && ", "}
											{person}
											{selectedMed.intakes?.some(
												(intake) => intake.takenBy === person && intake.intakeRemindersEnabled
											) && <span className="taken-by-badge">🔔</span>}
										</span>
									))}
								</span>
							)}
						</div>
					</div>

					{/* Stock Info Section */}
					<div className="med-detail-section">
						<h3>{t("modal.stockInfo")}</h3>
						<div className="med-detail-grid">
							{selectedMed.packageType === "blister" && (
								<>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("table.fullBlisters")}</span>
										<span className={`med-detail-value ${textClass}`}>{formatFullBlisters(stock.fullBlisters, t)}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("table.openBlister")}</span>
										<span className={`med-detail-value ${textClass}`}>
											{formatOpenBlisterAndLoose(
												stock.openBlisterPills,
												stock.loosePills,
												selectedMed.pillsPerBlister ?? 1,
												t
											)}
										</span>
									</div>
								</>
							)}
							<div className={`med-detail-item ${selectedMed.packageType === "bottle" ? "full-width" : "full-width"}`}>
								<span className="med-detail-label">{t("modal.currentStock")}</span>
								<span className={`med-detail-value ${textClass}`}>
									{currentStock} /{" "}
									{selectedMed.packageType === "bottle" ? (selectedMed.totalPills ?? packageSize) : packageSize}
									{currentStock >
										(selectedMed.packageType === "bottle" ? (selectedMed.totalPills ?? packageSize) : packageSize) && (
										<span
											className="info-tooltip tooltip-align-left warning-text"
											data-tooltip={t("tooltips.stockExceedsCapacity")}
										>
											{" "}
											⚠️
										</span>
									)}
								</span>
							</div>
						</div>
					</div>

					{/* Package Details Section */}
					<div className="med-detail-section">
						<h3>
							{t("modal.packageDetails")} (
							{selectedMed.packageType === "bottle" ? t("form.packageTypeBottle") : t("form.packageTypeBlister")})
						</h3>
						<div className="med-detail-grid">
							{selectedMed.packageType === "blister" ? (
								<>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("modal.packs")}</span>
										<span className="med-detail-value">{selectedMed.packCount}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("modal.blistersPerPack")}</span>
										<span className="med-detail-value">{selectedMed.blistersPerPack}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("modal.pillsPerBlister")}</span>
										<span className="med-detail-value">{selectedMed.pillsPerBlister}</span>
									</div>
								</>
							) : (
								<div className="med-detail-item">
									<span className="med-detail-label">{t("form.totalCapacity")}</span>
									<span className="med-detail-value">{(selectedMed.totalPills ?? packageSize) || "—"}</span>
								</div>
							)}
							{selectedMed.pillWeightMg && (
								<div className="med-detail-item">
									<span className="med-detail-label">{t("modal.pillWeight")}</span>
									<span className="med-detail-value">
										{selectedMed.pillWeightMg} {selectedMed.doseUnit ?? "mg"}
									</span>
								</div>
							)}
							{selectedMed.expiryDate && (
								<div className="med-detail-item">
									<span className="med-detail-label">{t("modal.expiryDate")}</span>
									<span
										className={`med-detail-value ${getExpiryClass(selectedMed.expiryDate, settings.expiryWarningDays)}`}
									>
										{new Date(selectedMed.expiryDate).toLocaleDateString(getSystemLocale(i18n.language), {
											day: "2-digit",
											month: "short",
											year: "numeric",
										})}
									</span>
								</div>
							)}
						</div>
					</div>

					{/* Prescription Details Section */}
					{selectedMed.prescriptionEnabled && (
						<div className="med-detail-section">
							<h3>{t("form.sections.prescription")}</h3>
							<div className="med-detail-grid prescription-detail-grid">
								<div className="med-detail-item">
									<span className="med-detail-label">{t("prescription.authorizedRefills")}</span>
									<span className="med-detail-value">{selectedMed.prescriptionAuthorizedRefills ?? "—"}</span>
								</div>
								<div className="med-detail-item">
									<span className="med-detail-label">{t("prescription.remainingRefills")}</span>
									<span className="med-detail-value">{selectedMed.prescriptionRemainingRefills ?? "—"}</span>
								</div>
								<div className="med-detail-item">
									<span className="med-detail-label">{t("prescription.lowThreshold")}</span>
									<span className="med-detail-value">{selectedMed.prescriptionLowRefillThreshold ?? "—"}</span>
								</div>
								<div className="med-detail-item">
									<span className="med-detail-label">{t("prescription.expiryDate")}</span>
									<span className="med-detail-value">
										{selectedMed.prescriptionExpiryDate
											? new Date(selectedMed.prescriptionExpiryDate).toLocaleDateString(
													getSystemLocale(i18n.language),
													{
														day: "2-digit",
														month: "short",
														year: "numeric",
													}
												)
											: "—"}
									</span>
								</div>
							</div>
						</div>
					)}

					{/* Intake Schedule Section */}
					{selectedMed.blisters.length > 0 && (
						<div className="med-detail-section">
							<h3>
								{t("modal.intakeSchedule")}{" "}
								{selectedMed.intakeRemindersEnabled && (
									<span className="reminder-icon info-tooltip" data-tooltip={t("tooltips.intakeReminders")}>
										🔔
									</span>
								)}
							</h3>
							<div className="med-detail-schedules">
								{selectedMed.blisters.map((blister, idx) => {
									// When using new intakes format with per-intake takenBy,
									// each intake already represents one person's dose — don't multiply.
									// For legacy intakes (no per-intake takenBy), multiply by personCount.
									const intake = selectedMed.intakes?.[idx];
									const hasPerIntakeTakenBy = !!intake?.takenBy;
									const personCount = hasPerIntakeTakenBy ? 1 : Math.max(1, selectedMed.takenBy?.length || 1);
									const totalUsage = blister.usage * personCount;
									return (
										<div key={idx} className="med-schedule-item">
											<span className="med-schedule-usage">
												{totalUsage} {totalUsage !== 1 ? t("common.pills") : t("common.pill")}
												{selectedMed.pillWeightMg &&
													` (${totalUsage * selectedMed.pillWeightMg} ${selectedMed.doseUnit ?? "mg"})`}
											</span>
											<span className="med-schedule-freq">
												{blister.every === 1 ? t("common.daily") : t("common.everyNDays", { count: blister.every })}
											</span>
											<span className="med-schedule-time">
												{t("modal.at")}{" "}
												{new Date(blister.start).toLocaleTimeString(getSystemLocale(i18n.language), {
													hour: "2-digit",
													minute: "2-digit",
												})}
											</span>
										</div>
									);
								})}
							</div>
						</div>
					)}

					{/* Coverage Status Section */}
					{medCoverage && status && (
						<div className="med-detail-section">
							<h3 className="section-header-with-badge">
								{t("modal.coverageStatus")}
								<span className={`status-chip small ${status.className}`}>{t(status.label)}</span>
							</h3>
							<div className="med-detail-grid">
								<div className="med-detail-item">
									<span className="med-detail-label">{t("modal.daysLeft")}</span>
									<span className="med-detail-value">
										{medCoverage.daysLeft !== null ? formatNumber(medCoverage.daysLeft) : "—"}
									</span>
								</div>
								<div className="med-detail-item">
									<span className="med-detail-label">{t("modal.runsOut")}</span>
									<span className="med-detail-value">{medCoverage.depletionDate ?? "—"}</span>
								</div>
							</div>
						</div>
					)}

					{/* Notes Section */}
					{selectedMed.notes && (
						<div className="med-detail-section">
							<h3>📝 {t("modal.notes")}</h3>
							<div className="med-notes-content">{selectedMed.notes}</div>
						</div>
					)}

					{/* Refill History Section */}
					{refillHistory.length > 0 && (
						<div className="med-detail-section">
							<h3
								className="section-header-clickable"
								onClick={() => onRefillHistoryExpandedChange(!refillHistoryExpanded)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") onRefillHistoryExpandedChange(!refillHistoryExpanded);
								}}
							>
								{t("refill.history")} ({refillHistory.length})
								<span className="expand-arrow">{refillHistoryExpanded ? "▼" : "▶"}</span>
							</h3>
							{refillHistoryExpanded && (
								<div className="refill-history-list">
									{refillHistory.map((entry) => (
										<div key={entry.id} className="refill-history-item">
											<span className="refill-date">
												{new Date(entry.refillDate).toLocaleDateString(getSystemLocale(i18n.language), {
													day: "2-digit",
													month: "short",
													year: "numeric",
												})}
												,{" "}
												{new Date(entry.refillDate).toLocaleTimeString(getSystemLocale(i18n.language), {
													hour: "2-digit",
													minute: "2-digit",
												})}
											</span>
											<span className="refill-amount">
												{(() => {
													const total =
														selectedMed.packageType === "bottle"
															? entry.loosePillsAdded
															: entry.packsAdded * selectedMed.blistersPerPack * selectedMed.pillsPerBlister +
																entry.loosePillsAdded;
													return `+${total} ${total === 1 ? t("common.pill") : t("common.pills")}`;
												})()}
												{entry.usedPrescription && (
													<span className="refill-prescription-badge" title={t("refill.viaPrescription")}>
														{" "}
														📋
													</span>
												)}
											</span>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="med-detail-footer">
					<button onClick={onClose}>{t("common.close")}</button>
					<div className="footer-actions">
						<button className="success" onClick={onOpenRefillModal}>
							{t("refill.button")}
						</button>
						<button className="info" onClick={onOpenEditStockModal}>
							{t("common.edit")}
						</button>
						{selectedMed.blisters.length > 0 && (
							<button
								className="secondary icon-only"
								onClick={() => generateICS(selectedMed)}
								title={t("modal.exportTooltip")}
							>
								📅
							</button>
						)}
					</div>
				</div>
			</div>

			{/* Image Lightbox */}
			{showImageLightbox && selectedMed.imageUrl && (
				<Lightbox src={`/api/images/${selectedMed.imageUrl}`} alt={selectedMed.name} onClose={onCloseImageLightbox} />
			)}

			{/* Refill Modal */}
			{showRefillModal && (
				<div
					className="modal-overlay"
					onClick={(e) => {
						e.stopPropagation();
						onCloseRefillModal();
					}}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Escape") onCloseRefillModal();
					}}
				>
					<div
						className="modal-content refill-modal"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<button className="modal-close" onClick={onCloseRefillModal}>
							×
						</button>
						<h2>{t("refill.title")}</h2>
						<p className="refill-med-name">{selectedMed.name}</p>

						<div className="refill-form">
							{selectedMed.packageType === "blister" ? (
								<>
									<label>
										{t("refill.packs")}
										<input
											type="number"
											min="0"
											value={refillPacks}
											onChange={(e) => onRefillPacksChange(parseInt(e.target.value, 10) || 0)}
										/>
									</label>
									<label>
										{t("refill.loosePills")}
										<input
											type="number"
											min="0"
											value={refillLoose}
											onChange={(e) => onRefillLooseChange(parseInt(e.target.value, 10) || 0)}
										/>
									</label>
								</>
							) : (
								<label>
									{t("refill.pillsToAdd")}
									<input
										type="number"
										min="0"
										value={refillLoose}
										onChange={(e) => onRefillLooseChange(parseInt(e.target.value, 10) || 0)}
									/>
								</label>
							)}

							{selectedMed.prescriptionEnabled && (
								<div className="refill-prescription-row full">
									<label className="refill-prescription-toggle">
										<input
											type="checkbox"
											checked={usePrescriptionRefill}
											onChange={(e) => onUsePrescriptionRefillChange(e.target.checked)}
											disabled={(Number(selectedMed.prescriptionRemainingRefills) || 0) <= 0}
										/>
										<span className="refill-prescription-label-text">{t("prescription.useForRefill")}</span>
									</label>
									<span className="refill-remaining-badge">
										{t("prescription.remainingRefills")}: {Number(selectedMed.prescriptionRemainingRefills) || 0}
									</span>
								</div>
							)}
						</div>

						<div className="modal-footer">
							<button className="ghost" onClick={onCloseRefillModal}>
								{t("common.cancel")}
							</button>
							<div className="refill-footer-right">
								<button
									className="success"
									onClick={() => onSubmitRefill(selectedMed.id, usePrescriptionRefill)}
									disabled={(refillPacks < 1 && refillLoose < 1) || refillSaving}
								>
									{refillSaving ? t("common.saving") : t("refill.button")}
								</button>
								{(() => {
									const totalRefill =
										selectedMed.packageType === "blister"
											? refillPacks * selectedMed.blistersPerPack * selectedMed.pillsPerBlister + refillLoose
											: refillLoose;
									return totalRefill > 0 ? (
										<span className="refill-preview">
											+{totalRefill} {totalRefill === 1 ? t("common.pill") : t("common.pills")}
										</span>
									) : null;
								})()}
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Edit Stock Modal */}
			{showEditStockModal && (
				<div
					className="modal-overlay"
					onClick={(e) => {
						e.stopPropagation();
						onCloseEditStockModal();
					}}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Escape") onCloseEditStockModal();
					}}
				>
					<div
						className="modal-content edit-stock-modal"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<button className="modal-close" onClick={onCloseEditStockModal}>
							×
						</button>
						<h2>{t("editStock.title")}</h2>
						<p className="edit-stock-med-name">{selectedMed.name}</p>
						<p className="edit-stock-hint">{t("editStock.hint")}</p>

						{(() => {
							const dbTotal = getMedTotal(selectedMed);
							const currentTotal = medCoverage ? Math.round(medCoverage.medsLeft) : dbTotal;
							const isBottle = selectedMed.packageType === "bottle";
							const newTotal = isBottle
								? editStockPartialBlisterPills
								: editStockFullBlisters * selectedMed.pillsPerBlister + editStockPartialBlisterPills;
							const difference = newTotal - currentTotal;
							const negativeFallback = difference < 0 ? "negative" : "";
							const differenceClass = difference > 0 ? "positive" : negativeFallback;

							return (
								<>
									<div className="edit-stock-form">
										{isBottle ? (
											<label>
												{t("editStock.totalPills")}
												<input
													type="number"
													min="0"
													value={editStockPartialInput}
													onChange={(e) => {
														const raw = e.target.value;
														setEditStockPartialInput(raw);
														onEditStockPartialBlisterPillsChange(raw === "" ? 0 : Math.max(0, parseStockInput(raw)));
													}}
													onBlur={() => {
														const normalized = Math.max(0, parseStockInput(editStockPartialInput));
														onEditStockPartialBlisterPillsChange(normalized);
														setEditStockPartialInput(String(normalized));
													}}
												/>
											</label>
										) : (
											<>
												<label>
													{t("editStock.fullBlisters")}{" "}
													{t("editStock.pillsPerBlister", { count: selectedMed.pillsPerBlister })}
													<input
														type="number"
														min="0"
														value={editStockFullInput}
														onChange={(e) => {
															const raw = e.target.value;
															setEditStockFullInput(raw);
															onEditStockFullBlistersChange(raw === "" ? 0 : Math.max(0, parseStockInput(raw)));
														}}
														onBlur={() => {
															const normalized = Math.max(0, parseStockInput(editStockFullInput));
															onEditStockFullBlistersChange(normalized);
															setEditStockFullInput(String(normalized));
														}}
													/>
												</label>
												<label>
													{t("editStock.partialBlisterPills")}
													<input
														type="number"
														min={fullForBounds > 0 ? -(selectedMed.pillsPerBlister - 1) : 0}
														max={selectedMed.pillsPerBlister}
														value={editStockPartialInput}
														onChange={(e) => {
															const raw = e.target.value;
															setEditStockPartialInput(raw);
															if (raw === "") {
																onEditStockPartialBlisterPillsChange(0);
																return;
															}
															const val = parseStockInput(raw);
															const min = fullForBounds > 0 ? -(selectedMed.pillsPerBlister - 1) : 0;
															const max = selectedMed.pillsPerBlister;
															onEditStockPartialBlisterPillsChange(Math.max(min, Math.min(val, max)));
														}}
														onBlur={() => {
															const min = fullForBounds > 0 ? -(selectedMed.pillsPerBlister - 1) : 0;
															const max = selectedMed.pillsPerBlister;
															const normalized = Math.max(min, Math.min(parseStockInput(editStockPartialInput), max));
															onEditStockPartialBlisterPillsChange(normalized);
															setEditStockPartialInput(String(normalized));
														}}
													/>
												</label>
											</>
										)}
									</div>

									<div className="edit-stock-summary">
										<div className="summary-row">
											<span>{t("editStock.currentTotal")}:</span>
											<span>
												{currentTotal} {currentTotal === 1 ? t("common.pill") : t("common.pills")}
											</span>
										</div>
										<div className="summary-row">
											<span>{t("editStock.newTotal")}:</span>
											<span>
												{newTotal} {newTotal === 1 ? t("common.pill") : t("common.pills")}
											</span>
										</div>
										<div className={`summary-row difference ${differenceClass}`}>
											<span>{t("editStock.difference")}:</span>
											<span>
												{difference > 0 ? "+" : ""}
												{difference} {Math.abs(difference) === 1 ? t("common.pill") : t("common.pills")}
											</span>
										</div>
									</div>
								</>
							);
						})()}

						<div className="modal-footer">
							<button className="ghost" onClick={onCloseEditStockModal}>
								{t("common.cancel")}
							</button>
							<button
								className="info"
								onClick={() => onSubmitStockCorrection(selectedMed.id)}
								disabled={editStockSaving}
							>
								{editStockSaving ? t("editStock.saving") : t("editStock.save")}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
