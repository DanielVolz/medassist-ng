/**
 * UserFilterModal - Shows medications for a specific person (takenBy filter)
 * Allows clicking through to medication details
 */
import { useTranslation } from "react-i18next";
import { MedicationAvatar } from "../components";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { Coverage, IntakeUnit, Medication, StockThresholds } from "../types";
import { getMedDisplayName, getMedTotal, getStockDisplayCapacity } from "../types";
import { allowsPillFormSelection, isLiquidContainerPackageType, isTubePackageType } from "../types/package-profiles";
import { formatNumber } from "../utils";
import { getSystemLocale } from "../utils/formatters";
import { getIntakeFrequencyText, getMedicationIntakes } from "../utils/intake-schedule";
import { getLiquidCountUnitLabel } from "../utils/intake-units";
import { personTagsMatch } from "../utils/person-tags";
import { getStockStatus } from "../utils/schedule";
import { ModalFrame } from "./ModalFrame";

export interface UserFilterModalProps {
	selectedUser: string | null;
	meds: Medication[];
	coverage: { all: Coverage[] };
	settings: StockThresholds;
	onClose: () => void;
	onClearUser: () => void;
	onOpenMedDetail: (med: Medication) => void;
}

export function UserFilterModal({
	selectedUser,
	meds,
	coverage,
	settings,
	onClose,
	onClearUser,
	onOpenMedDetail,
}: UserFilterModalProps) {
	const { t, i18n } = useTranslation();

	const isLiquidMedication = (med: Medication): boolean => {
		const rawPackageType = med.packageType as unknown as string | null | undefined;
		return (
			isLiquidContainerPackageType(med.packageType) || rawPackageType === "liquid" || med.medicationForm === "liquid"
		);
	};

	const getDiscreteUnitLabel = (med: Medication, count: number): string => {
		if (med.packageType === "inhaler") return count === 1 ? t("common.puff") : t("common.puffs");
		if (med.packageType === "injection") return count === 1 ? t("common.injection") : t("common.injections");
		return count === 1 ? t("common.pill") : t("common.pills");
	};

	const formatIntakeUsageLabel = (med: Medication, usage: number, intakeUnit?: IntakeUnit | null): string => {
		if (isLiquidMedication(med)) {
			return `${formatNumber(usage)} ${getLiquidCountUnitLabel(intakeUnit, usage, t)}`;
		}
		if (isTubePackageType(med.packageType)) {
			return `${formatNumber(usage)} ${t("form.blisters.applications", { count: usage })}`;
		}
		return `${formatNumber(usage)} ${getDiscreteUnitLabel(med, usage)}`;
	};

	const formatStockSummaryLabel = (med: Medication, currentStock: number, packageSize: number): string => {
		if (isLiquidMedication(med)) {
			return `${formatNumber(currentStock)}/${formatNumber(packageSize)} ${t("form.packageAmountUnitMl")}`;
		}
		if (isTubePackageType(med.packageType)) {
			return `${formatNumber(currentStock)}/${formatNumber(packageSize)} ${t("form.packageAmountUnitG")}`;
		}
		return `${formatNumber(currentStock)}/${formatNumber(packageSize)} ${getDiscreteUnitLabel(med, packageSize)}`;
	};

	useEscapeKey(!!selectedUser, onClose);

	if (!selectedUser) return null;

	const userMeds = meds.filter(
		(medication) =>
			!medication.isObsolete && (medication.takenBy || []).some((person) => personTagsMatch(person, selectedUser))
	);

	return (
		<ModalFrame contentClassName="user-meds-modal" onClose={onClose}>
			<div className="user-meds-header">
				<div className="user-avatar">{selectedUser.charAt(0).toUpperCase()}</div>
				<h2>{t("modal.userMedications", { name: selectedUser })}</h2>
			</div>

			<div className="user-meds-list">
				{userMeds.map((med) => {
					const medCoverage = coverage.all.find((c) => c.name === getMedDisplayName(med));
					// Fallback: if no coverage data (e.g. obsolete med), compute basic status from total pills
					const status = medCoverage
						? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings, med.packageType)
						: getStockStatus(null, getMedTotal(med), settings, med.packageType);
					const packageSize = getStockDisplayCapacity(med);
					const currentStock = medCoverage ? medCoverage.medsLeft : getMedTotal(med);

					// Get intakes relevant to this person
					const personIntakes = getMedicationIntakes(med).filter(
						(intake) => intake.takenBy === null || personTagsMatch(intake.takenBy, selectedUser)
					);

					return (
						<div
							key={med.id}
							className="user-med-item clickable"
							onClick={() => {
								onClearUser();
								onOpenMedDetail(med);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									onClearUser();
									onOpenMedDetail(med);
								}
							}}
						>
							<MedicationAvatar name={getMedDisplayName(med)} imageUrl={med.imageUrl} size="sm" />
							<div className="user-med-info">
								<span className="user-med-name">{getMedDisplayName(med)}</span>
								{med.name && med.genericName && <span className="user-med-generic">{med.genericName}</span>}
								{personIntakes.length > 0 && (
									<div className="user-med-intakes">
										{personIntakes.map((intake) => {
											const timeStr = new Date(intake.start).toLocaleTimeString(getSystemLocale(i18n.language), {
												hour: "2-digit",
												minute: "2-digit",
											});
											const intakeKey = `${intake.start}-${intake.usage}-${intake.every}-${intake.scheduleMode ?? "interval"}-${(intake.weekdays ?? []).join("")}-${intake.takenBy ?? ""}`;
											const intakeUnit = "intakeUnit" in intake ? intake.intakeUnit : undefined;
											return (
												<span key={intakeKey} className="user-med-intake-item">
													{formatIntakeUsageLabel(med, intake.usage, intakeUnit)}
													{allowsPillFormSelection(med.packageType) &&
														med.pillWeightMg != null &&
														` (${intake.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"})`}{" "}
													{getIntakeFrequencyText(intake, t)} {t("modal.at")} {timeStr}
												</span>
											);
										})}
									</div>
								)}
							</div>
							<div className="user-med-stats">
								<span className="user-med-pills">{formatStockSummaryLabel(med, currentStock, packageSize)}</span>
								{status && <span className={`status-chip ${status.className}`}>{t(status.label)}</span>}
							</div>
						</div>
					);
				})}
				{userMeds.length === 0 && (
					<div className="user-meds-empty">{t("modal.noMedsForUser", { name: selectedUser })}</div>
				)}
			</div>

			<div className="user-meds-footer">
				<button onClick={onClose}>{t("common.close")}</button>
			</div>
		</ModalFrame>
	);
}
