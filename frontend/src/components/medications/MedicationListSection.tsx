import { ActionIcon } from "@mantine/core";
import { Archive, Bell, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Medication } from "../../types";
import { getMedDisplayName, getMedTotal, getStockDisplayCapacity, isAmountBasedPackageType } from "../../types";
import { SectionCard } from "../../ui/components/SectionCard";
import { AppButton } from "../../ui/primitives/AppButton";
import { AppTooltip, AppTooltipTrigger } from "../../ui/primitives/AppTooltip";
import { formatDate, formatDateTime } from "../../utils/formatters";
import { getIntakeFrequencyText, getMedicationIntakes } from "../../utils/intake-schedule";
import { MedicationAvatar } from "../MedicationAvatar";
import classes from "./MedicationListSection.module.css";

/** Map a stock fill percentage to a meter color level. */
function getStockFillLevel(pct: number): "danger" | "warning" | "ok" {
	if (pct <= 15) return "danger";
	if (pct <= 40) return "warning";
	return "ok";
}

function cx(...classNames: Array<string | false | null | undefined>) {
	return classNames.filter(Boolean).join(" ");
}

type MedicationListSectionProps = {
	orderedMeds: Medication[];
	obsoleteMeds: Medication[];
	editingId: number | null;
	isCompact?: boolean;
	showObsolete: boolean;
	coverageByMed: Record<string, { medsLeft: number }>;
	onNewEntry: (trigger: HTMLElement) => void;
	onOpenReport: (trigger: HTMLElement) => void;
	onEdit: (med: Medication, trigger: HTMLElement) => void;
	onRecordNow?: (med: Medication) => void;
	canRecordNow?: (med: Medication) => boolean;
	onView: (med: Medication, trigger: HTMLElement) => void;
	onMarkObsolete: (med: Medication, trigger: HTMLElement) => void;
	onDelete: (med: Medication, trigger: HTMLElement) => void;
	onReactivate: (medId: number, trigger: HTMLElement) => void;
	onToggleObsolete: () => void;
	onImagePreview: (med: Medication, trigger: HTMLElement) => void;
	getMedicationPackageTypeLabel: (med: Medication) => string;
	getMedicationStockSuffix: (med: Medication) => string;
	getMedicationUsageUnitLabel: (med: Medication, usage: number) => string;
};

export function MedicationListSection({
	orderedMeds,
	obsoleteMeds,
	editingId,
	isCompact = false,
	showObsolete,
	coverageByMed,
	onNewEntry,
	onOpenReport,
	onEdit,
	onRecordNow,
	canRecordNow,
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

	const renderImageAvatar = (med: Medication) => {
		const displayName = getMedDisplayName(med);

		if (!med.imageUrl) {
			return (
				<span className={classes.imagePreviewStatic}>
					<MedicationAvatar name={displayName} imageUrl={med.imageUrl} size="lg" />
				</span>
			);
		}

		return (
			<button
				type="button"
				aria-label={t("medications.list.actionPreviewImage", { name: displayName })}
				className={cx(classes.imagePreviewButton, "med-avatar-clickable")}
				data-testid="medication-image-preview"
				onClick={(e) => {
					e.stopPropagation();
					onImagePreview(med, e.currentTarget);
				}}
			>
				<MedicationAvatar name={displayName} imageUrl={med.imageUrl} size="lg" />
			</button>
		);
	};

	return (
		<SectionCard
			title={t("medications.list.title")}
			actions={
				<div className={classes.headerActions}>
					<AppButton
						type="button"
						tone="primary"
						leftSection={<Plus size={16} aria-hidden="true" />}
						onClick={(event) => onNewEntry(event.currentTarget)}
						data-medication-create="true"
					>
						{t("form.newEntry")}
					</AppButton>
					<AppButton type="button" tone="secondary" onClick={(event) => onOpenReport(event.currentTarget)}>
						{t("report.button")}
					</AppButton>
				</div>
			}
		>
			<div className={classes.groups}>
				<div className={classes.group}>
					<ul className={cx(classes.grid, isCompact && classes.gridCompact)} aria-label={t("medications.list.title")}>
						{orderedMeds.map((med) => {
							const displayName = getMedDisplayName(med);
							const medicationIntakes = getMedicationIntakes(med);
							const stockDisplayCapacity = getStockDisplayCapacity(med);
							const currentStock = coverageByMed[displayName] ? coverageByMed[displayName].medsLeft : getMedTotal(med);
							const fillPct =
								stockDisplayCapacity > 0
									? Math.max(0, Math.min(100, Math.round((currentStock / stockDisplayCapacity) * 100)))
									: 0;
							const fillLevel = getStockFillLevel(fillPct);

							return (
								<li
									key={med.id}
									className={cx(classes.medicationRow, editingId === med.id && classes.medicationRowEditing)}
									tabIndex={-1}
									aria-labelledby={`medication-row-name-${med.id}`}
									data-medication-id={med.id}
									data-testid="medication-row"
								>
									<div className={classes.header}>
										<div className={classes.info}>
											<div className={classes.nameRow}>
												{renderImageAvatar(med)}
												<div className={classes.nameBlock}>
													<div id={`medication-row-name-${med.id}`} className={classes.name}>
														{displayName}
													</div>
													{med.name && med.genericName && <div className={classes.genericName}>{med.genericName}</div>}
												</div>
											</div>
											<div className={classes.actions}>
												{editingId !== med.id && (
													<AppTooltip label={t("common.edit")}>
														<ActionIcon
															type="button"
															className={cx(classes.actionIcon, classes.actionBrand)}
															color="gray"
															variant="default"
															onClick={(event) => onEdit(med, event.currentTarget)}
															aria-label={t("medications.list.actionEdit", { name: displayName })}
														>
															<Pencil size={18} aria-hidden="true" />
														</ActionIcon>
													</AppTooltip>
												)}
												<AppButton
													type="button"
													tone="secondary"
													className={cx(classes.actionButton, classes.actionWarning)}
													leftSection={<Archive size={16} aria-hidden="true" />}
													onClick={(event) => onMarkObsolete(med, event.currentTarget)}
													aria-label={t("medications.list.actionMarkObsolete", { name: displayName })}
												>
													{t("medications.list.markObsolete")}
												</AppButton>
												<AppTooltip label={t("common.delete")}>
													<ActionIcon
														type="button"
														className={cx(classes.actionIcon, classes.actionDanger)}
														color="gray"
														variant="default"
														onClick={(event) => onDelete(med, event.currentTarget)}
														aria-label={t("medications.list.actionDelete", { name: displayName })}
													>
														<Trash2 size={18} aria-hidden="true" />
													</ActionIcon>
												</AppTooltip>
											</div>
											<div className={classes.details}>
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
														{t("medications.details.totalCapacity")}: <strong>{stockDisplayCapacity}</strong>
													</span>
												)}
											</div>
											{med.prescriptionEnabled && (
												<div className={classes.total}>
													{t("prescription.remainingRefills")}: <strong>{med.prescriptionRemainingRefills ?? 0}</strong>
												</div>
											)}
											<div className={classes.total}>
												{t("medications.details.stock")}: {currentStock} / {stockDisplayCapacity}
												{getMedicationStockSuffix(med)}
												{currentStock > stockDisplayCapacity ? (
													<AppTooltipTrigger label={t("tooltips.stockExceedsCapacity")} className="warning-text">
														{" "}
														⚠️
													</AppTooltipTrigger>
												) : null}
											</div>
											<div className={classes.stockMeter} aria-hidden="true">
												<span
													className={classes.stockMeterFill}
													data-level={fillLevel}
													style={{ width: `${fillPct}%` }}
												/>
											</div>
										</div>
									</div>
									<div className={classes.blisterList}>
										{medicationIntakes.length === 0 && (
											<div className={cx(classes.blisterRowSimple, classes.noRegularSchedule)}>
												<span>{t("form.blisters.noRegularSchedule")}</span>
												{canRecordNow?.(med) ? (
													<AppButton
														type="button"
														tone="primary"
														size="xs"
														leftSection={<Plus size={14} aria-hidden="true" />}
														onClick={() => onRecordNow?.(med)}
														aria-label={t("medications.list.actionRecordNow", { name: displayName })}
													>
														{t("dose.take")}
													</AppButton>
												) : null}
											</div>
										)}
										{medicationIntakes.map((intake) => (
											<div
												key={`${med.id}-${intake.start}-${intake.usage}-${intake.takenBy ?? "none"}`}
												className={classes.blisterRowSimple}
											>
												<span className={classes.blisterSummary}>
													{intake.usage} {getMedicationUsageUnitLabel(med, intake.usage)}
													{", "}
													{getIntakeFrequencyText(intake, t)}, {t("form.blisters.from")} {formatDateTime(intake.start)}
												</span>
												{intake.takenBy && <span className={classes.blisterTakenBy}>{intake.takenBy}</span>}
												{intake.intakeRemindersEnabled && (
													<AppTooltipTrigger label={t("form.blisters.remindTooltip")} className="blister-reminder-icon">
														{" "}
														<Bell size={12} aria-hidden="true" />
													</AppTooltipTrigger>
												)}
											</div>
										))}
									</div>
								</li>
							);
						})}
					</ul>
				</div>
				{obsoleteMeds.length > 0 && (
					<div className={cx(classes.group, classes.groupObsolete)}>
						<h3 className={classes.groupTitle}>
							<button
								type="button"
								className={cx(classes.groupHead, classes.groupHeadToggle)}
								onClick={onToggleObsolete}
								aria-expanded={showObsolete}
								aria-controls="obsolete-medications-list"
								data-obsolete-toggle="true"
							>
								<span aria-hidden="true">{showObsolete ? "▼" : "▶"}</span>{" "}
								<span id="obsolete-medications-heading">
									{t("medications.list.obsoleteTitle", { count: obsoleteMeds.length })}
								</span>
							</button>
						</h3>
						<ul
							id="obsolete-medications-list"
							className={cx(classes.grid, isCompact && classes.gridCompact)}
							aria-labelledby="obsolete-medications-heading"
							hidden={!showObsolete}
						>
							{obsoleteMeds.map((med) => (
								<li
									key={med.id}
									className={cx(classes.medicationRow, classes.obsoleteRow)}
									tabIndex={-1}
									aria-labelledby={`medication-row-name-${med.id}`}
									data-medication-id={med.id}
									data-testid="medication-row"
								>
									<div className={classes.header}>
										<div className={classes.info}>
											<div className={classes.nameRow}>
												{renderImageAvatar(med)}
												<div className={classes.nameBlock}>
													<div id={`medication-row-name-${med.id}`} className={classes.name}>
														{getMedDisplayName(med)}
													</div>
													{med.name && med.genericName && <div className={classes.genericName}>{med.genericName}</div>}
												</div>
											</div>
											<div className={classes.actions}>
												<AppTooltip label={t("common.view")}>
													<ActionIcon
														type="button"
														className={cx(classes.actionIcon, classes.actionBrand)}
														color="gray"
														variant="default"
														onClick={(event) => onView(med, event.currentTarget)}
														aria-label={t("medications.list.actionView", { name: getMedDisplayName(med) })}
													>
														<Eye size={18} aria-hidden="true" />
													</ActionIcon>
												</AppTooltip>
												<AppTooltip label={t("common.delete")}>
													<ActionIcon
														type="button"
														className={cx(classes.actionIcon, classes.actionDanger)}
														color="gray"
														variant="default"
														onClick={(event) => onDelete(med, event.currentTarget)}
														aria-label={t("medications.list.actionDelete", { name: getMedDisplayName(med) })}
													>
														<Trash2 size={18} aria-hidden="true" />
													</ActionIcon>
												</AppTooltip>
												<AppButton
													type="button"
													tone="secondary"
													className={cx(classes.actionButton, classes.actionSuccess)}
													onClick={(event) => onReactivate(med.id, event.currentTarget)}
													aria-label={t("medications.list.actionReactivate", { name: getMedDisplayName(med) })}
												>
													{t("medications.list.reactivate")}
												</AppButton>
											</div>
											<div className={classes.details}>
												{med.medicationStartDate && (
													<span className={classes.fullDetail}>
														{t("medications.list.started")}: <strong>{formatDate(med.medicationStartDate)}</strong>
													</span>
												)}
												<span className={classes.fullDetail}>
													{t("medications.list.obsoleteSince")}: <strong>{formatDate(med.obsoleteAt)}</strong>
												</span>
											</div>
										</div>
									</div>
								</li>
							))}
						</ul>
					</div>
				)}
			</div>
		</SectionCard>
	);
}
