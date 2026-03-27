import type { IntakeUnit } from "../../types";
import { allowsPillFormSelection, isLiquidContainerPackageType, isTubePackageType } from "../../types";
import { formatNumber } from "../../utils/formatters";
import { convertLiquidUsageToMl, getLiquidCountUnitLabel } from "../../utils/intake-units";

type Translate = (key: string, options?: Record<string, unknown>) => string;
type MedicationLike = { packageType?: string | null; medicationForm?: string | null } | undefined;

function formatLiquidUsageLabel(usage: number, unit: IntakeUnit | null | undefined, t: Translate): string {
	const normalizedUsage = Number(usage);
	if (!Number.isFinite(normalizedUsage) || normalizedUsage <= 0) {
		return `0 ${t("form.packageAmountUnitMl")}`;
	}

	if (unit === "ml" || unit == null) {
		return `${formatNumber(normalizedUsage)} ${t("form.packageAmountUnitMl")}`;
	}

	const mlTotal = convertLiquidUsageToMl(normalizedUsage, unit);
	return `${formatNumber(normalizedUsage)} ${getLiquidCountUnitLabel(unit, normalizedUsage, t)} ${formatNumber(mlTotal)} ${t("form.packageAmountUnitMl")}`;
}

function getTubeUnitLabel(med: MedicationLike, value: number, t: Translate): string {
	if (isLiquidContainerPackageType(med?.packageType) || med?.medicationForm === "liquid") {
		return t("form.packageAmountUnitMl");
	}
	return t("form.blisters.applications", { count: Math.abs(value) });
}

export function formatScheduleDoseUsageLabel(
	med: MedicationLike,
	usage: number,
	t: Translate,
	intakeUnit?: IntakeUnit | null
): string {
	if (isLiquidContainerPackageType(med?.packageType)) {
		return formatLiquidUsageLabel(usage, intakeUnit, t);
	}

	if (isTubePackageType(med?.packageType)) {
		return `${usage} ${getTubeUnitLabel(med, usage, t)}`;
	}

	return `${usage} ${usage !== 1 ? t("common.pills") : t("common.pill")}`;
}

export function formatScheduleTotalUsageLabel(
	med: MedicationLike,
	total: number,
	t: Translate,
	doses?: Array<{ usage: number; intakeUnit?: IntakeUnit | null }>,
	fallbackIntakeUnit?: IntakeUnit | null
): string {
	if (isLiquidContainerPackageType(med?.packageType)) {
		if (doses && doses.length > 0) {
			const normalizedDoses = doses.filter((dose) => Number.isFinite(Number(dose.usage)) && Number(dose.usage) > 0);
			if (normalizedDoses.length > 0) {
				const allUnits = new Set(normalizedDoses.map((dose) => dose.intakeUnit ?? "ml"));
				if (allUnits.size === 1) {
					const onlyUnit = normalizedDoses[0]?.intakeUnit ?? "ml";
					const totalUsageInUnit = normalizedDoses.reduce((sum, dose) => sum + Number(dose.usage), 0);
					return formatLiquidUsageLabel(totalUsageInUnit, onlyUnit, t);
				}

				const totalMl = normalizedDoses.reduce(
					(sum, dose) => sum + convertLiquidUsageToMl(Number(dose.usage), dose.intakeUnit ?? "ml"),
					0
				);
				return `${formatNumber(totalMl)} ${t("form.packageAmountUnitMl")}`;
			}
		}

		return formatLiquidUsageLabel(total, fallbackIntakeUnit, t);
	}

	if (isTubePackageType(med?.packageType)) {
		return `${total} ${getTubeUnitLabel(med, total, t)}`;
	}

	if (allowsPillFormSelection(med?.packageType)) {
		return t("common.pillsTotal", { count: total });
	}

	return t("common.pillsTotal", { count: total });
}
