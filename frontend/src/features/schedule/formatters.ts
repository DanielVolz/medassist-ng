import type { TranslationFunction } from "../../i18n/types";
import type { IntakeUnit } from "../../types";
import { isLiquidContainerPackageType, isTubePackageType } from "../../types";
import { formatNumber } from "../../utils/formatters";
import { convertLiquidUsageToMl, getLiquidCountUnitLabel, type UnitLabelVariant } from "../../utils/intake-units";

type MedicationLike = { packageType?: string | null; medicationForm?: string | null } | undefined;

function formatLiquidUsageLabel(
	usage: number,
	unit: IntakeUnit | null | undefined,
	t: TranslationFunction,
	variant: UnitLabelVariant = "full"
): string {
	const normalizedUsage = Number(usage);
	if (!Number.isFinite(normalizedUsage) || normalizedUsage <= 0) {
		return `0 ${t("form.packageAmountUnitMl")}`;
	}

	if (unit === "ml" || unit == null) {
		return `${formatNumber(normalizedUsage)} ${t("form.packageAmountUnitMl")}`;
	}

	const mlTotal = convertLiquidUsageToMl(normalizedUsage, unit);
	return `${formatNumber(normalizedUsage)} ${getLiquidCountUnitLabel(unit, normalizedUsage, t, variant)} ${formatNumber(mlTotal)} ${t("form.packageAmountUnitMl")}`;
}

function getTubeUnitLabel(
	med: MedicationLike,
	value: number,
	t: TranslationFunction,
	variant: UnitLabelVariant = "full"
): string {
	if (isLiquidContainerPackageType(med?.packageType) || med?.medicationForm === "liquid") {
		return t("form.packageAmountUnitMl");
	}
	if (variant === "compact") return t("form.blisters.applicationsShort");
	return t("form.blisters.applications", { count: Math.abs(value) });
}

function getDiscreteUnitLabel(
	med: MedicationLike,
	value: number,
	t: TranslationFunction,
	variant: UnitLabelVariant = "full"
): string {
	if (med?.packageType === "inhaler") return value === 1 ? t("common.puff") : t("common.puffs");
	if (med?.packageType === "injection") {
		if (variant === "compact") return value === 1 ? t("common.injectionShort") : t("common.injectionsShort");
		return value === 1 ? t("common.injection") : t("common.injections");
	}
	if (variant === "compact") return value === 1 ? t("common.pillShort") : t("common.pillsShort");
	return value === 1 ? t("common.pill") : t("common.pills");
}

export function formatScheduleDoseUsageLabel(
	med: MedicationLike,
	usage: number,
	t: TranslationFunction,
	intakeUnit?: IntakeUnit | null,
	options?: { variant?: UnitLabelVariant }
): string {
	const variant = options?.variant ?? "full";
	if (isLiquidContainerPackageType(med?.packageType)) {
		return formatLiquidUsageLabel(usage, intakeUnit, t, variant);
	}

	if (isTubePackageType(med?.packageType)) {
		return `${usage} ${getTubeUnitLabel(med, usage, t, variant)}`;
	}

	return `${usage} ${getDiscreteUnitLabel(med, usage, t, variant)}`;
}

export function formatScheduleTotalUsageLabel(
	med: MedicationLike,
	total: number,
	t: TranslationFunction,
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

	return `${total} ${getDiscreteUnitLabel(med, total, t)}`;
}
