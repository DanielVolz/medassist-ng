import { Archive, Bell, Eye, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Medication } from "../../types";
import { getMedDisplayName, getMedTotal, getStockDisplayCapacity, isAmountBasedPackageType } from "../../types";
import { formatDate, formatDateTime } from "../../utils/formatters";
import { getIntakeFrequencyText, getMedicationIntakes } from "../../utils/intake-schedule";
import { MedicationAvatar } from "../MedicationAvatar";

type MedicationListSectionProps = {
	orderedMeds: Medication[];
	obsoleteMeds: Medication[];
	editingId: number | null;
	showObsolete: boolean;
	coverageByMed: Record<string, { medsLeft: number }>;
	onNewEntry: () => void;
	onOpenReport: () => void;
	onEdit: (med: Medication) => void;
	onView: (med: Medication) => void;
	onMarkObsolete: (med: Medication) => void;
	onDelete: (med: Medication) => void;
	onReactivate: (medId: number) => void;
	onToggleObsolete: () => void;
	onImagePreview: (med: Medication) => void;
	getMedicationPackageTypeLabel: (med: Medication) => string;
	getMedicationStockSuffix: (med: Medication) => string;
	getMedicationUsageUnitLabel: (med: Medication, usage: number) => string;
};

export function MedicationListSection({
	orderedMeds,
	obsoleteMeds,
	editingId,
	showObsolete,
	coverageByMed,
	onNewEntry,
	onOpenReport,
	onEdit,
	onView,
	onMarkObsolete,
	onDelete,
	onReactivate,
	onToggleObsolete,
	onImagePreview,
	getMedicationPackageTypeLabel,
	getMedicationStockSuffix,
	getMedicationUsageUnitLabel,
}: MedicationListSectionProps) {
	const { t } = useTranslation();

	const renderImageAvatar = (med: Medication) => (
		<span
			className={med.imageUrl ? "med-avatar-clickable" : undefined}
			onClick={() => med.imageUrl && onImagePreview(med)}
			onKeyDown={(e) => {
				if ((e.key === "Enter" || e.key === " ") && med.imageUrl) {
					onImagePreview(med);
				}
			}}
		>
			<MedicationAvatar name={getMedDisplayName(med)} imageUrl={med.imageUrl} size="lg" />
		</span>
	);

	return (
		<article className="card">
			<div className="card-head">
				<h2>{t("medications.list.title")}</h2>
				<div className="card-head-actions">
					<button type="button" className="btn primary small" onClick={onNewEntry}>
						+ {t("form.newEntry")}
					</button>
					<button type="button" className="btn ghost small" onClick={onOpenReport}>
						{t("report.button")}
					</button>
				</div>
			</div>
			<div className="med-groups">
				<div className="med-group med-group-active">
					<div className="med-grid">
						{orderedMeds.map((med) => {
							const displayName = getMedDisplayName(med);
							const stockDisplayCapacity = getStockDisplayCapacity(med);
							const currentStock = coverageByMed[displayName]
								? Math.round(coverageByMed[displayName].medsLeft)
								: getMedTotal(med);

							return (
								<div key={med.id} className={`med-row${editingId === med.id ? " editing" : ""}`}>
									<div className="med-header">
										<div className="med-info">
											<div className="med-name-row">
												{renderImageAvatar(med)}
												<div className="med-name-block">
													<div className="med-name">{displayName}</div>
													{med.name && med.genericName && <div className="med-generic-name">{med.genericName}</div>}
												</div>
											</div>
											<div className="med-actions">
												{editingId !== med.id && (
													<button
														className="info icon-only tooltip-trigger"
														onClick={() => onEdit(med)}
														aria-label={t("common.edit")}
														data-tooltip={t("common.edit")}
													>
														<Pencil size={18} aria-hidden="true" />
													</button>
												)}
												<button
													type="button"
													className="btn-obsolete"
													onClick={() => onMarkObsolete(med)}
													aria-label={t("medications.list.markObsolete")}
												>
													<Archive size={16} aria-hidden="true" />
													<span>{t("medications.list.markObsolete")}</span>
												</button>
												<button
													type="button"
													className="danger icon-only tooltip-trigger"
													onClick={() => onDelete(med)}
													aria-label={t("common.delete")}
													data-tooltip={t("common.delete")}
												>
													<Trash2 size={18} aria-hidden="true" />
												</button>
											</div>
											<div className="med-details">
												<span>
													{t("medications.details.type")}: <strong>{getMedicationPackageTypeLabel(med)}</strong>
												</span>
												{!isAmountBasedPackageType(med.packageType) ? (
													<>
														<span>
															{t("medications.details.packs")}: <strong>{med.packCount}</strong>
														</span>
														<span>
															{t("medications.details.blisters")}: <strong>{med.blistersPerPack}</strong>
														</span>
														<span>
															{t("medications.details.pillsPerBlister")}: <strong>{med.pillsPerBlister}</strong>
														</span>
														<span>
															{t("medications.details.loose")}: <strong>{med.looseTablets}</strong>
														</span>
													</>
												) : (
													<span>
														{t("medications.details.totalCapacity")}:{" "}
														<strong>{med.totalPills ?? med.looseTablets}</strong>
													</span>
												)}
											</div>
											{med.prescriptionEnabled && (
												<div className="med-total">
													{t("prescription.remainingRefills")}: <strong>{med.prescriptionRemainingRefills ?? 0}</strong>
												</div>
											)}
											<div className="med-total">
												{t("medications.details.stock")}: {currentStock} / {stockDisplayCapacity}
												{getMedicationStockSuffix(med)}
												{currentStock > stockDisplayCapacity ? (
													<span
														className="info-tooltip tooltip-align-left warning-text"
														data-tooltip={t("tooltips.stockExceedsCapacity")}
													>
														{" "}
														⚠️
													</span>
												) : null}
											</div>
										</div>
									</div>
									<div className="blister-list">
										{getMedicationIntakes(med).map((intake) => (
											<div
												key={`${med.id}-${intake.start}-${intake.usage}-${intake.takenBy ?? "none"}`}
												className="blister-row-simple"
											>
												{intake.usage} {getMedicationUsageUnitLabel(med, intake.usage)} ·
												{getIntakeFrequencyText(intake, t)} · {t("form.blisters.from")} {formatDateTime(intake.start)}
												{intake.takenBy && <span className="blister-taken-by"> · {intake.takenBy}</span>}
												{intake.intakeRemindersEnabled && (
													<span className="blister-reminder-icon" title={t("form.blisters.remindTooltip")}>
														{" "}
														<Bell size={12} aria-hidden="true" />
													</span>
												)}
											</div>
										))}
									</div>
								</div>
							);
						})}
					</div>
				</div>
				{obsoleteMeds.length > 0 && (
					<div className="med-group med-group-obsolete">
						<button
							type="button"
							className="med-group-head med-group-head-toggle"
							onClick={onToggleObsolete}
							aria-expanded={showObsolete}
						>
							<h3 className="med-group-title">
								{showObsolete ? "▼" : "▶"} {t("medications.list.obsoleteTitle", { count: obsoleteMeds.length })}
							</h3>
						</button>
						{showObsolete && (
							<div className="med-grid med-grid-obsolete">
								{obsoleteMeds.map((med) => (
									<div key={med.id} className="med-row obsolete-row">
										<div className="med-header">
											<div className="med-info">
												<div className="med-name-row">
													{renderImageAvatar(med)}
													<div className="med-name-block">
														<div className="med-name">{getMedDisplayName(med)}</div>
														{med.name && med.genericName && <div className="med-generic-name">{med.genericName}</div>}
													</div>
												</div>
												<div className="med-actions">
													<button
														className="info icon-only tooltip-trigger"
														onClick={() => onView(med)}
														aria-label={t("common.view")}
														data-tooltip={t("common.view")}
													>
														<Eye size={18} aria-hidden="true" />
													</button>
													<button
														className="danger icon-only tooltip-trigger"
														onClick={() => onDelete(med)}
														aria-label={t("common.delete")}
														data-tooltip={t("common.delete")}
													>
														<Trash2 size={18} aria-hidden="true" />
													</button>
													<button className="success" onClick={() => onReactivate(med.id)}>
														{t("medications.list.reactivate")}
													</button>
												</div>
												<div className="med-details">
													{med.medicationStartDate && (
														<span style={{ gridColumn: "1 / -1" }}>
															{t("medications.list.started")}: <strong>{formatDate(med.medicationStartDate)}</strong>
														</span>
													)}
													<span style={{ gridColumn: "1 / -1" }}>
														{t("medications.list.obsoleteSince")}: <strong>{formatDate(med.obsoleteAt)}</strong>
													</span>
												</div>
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</article>
	);
}
