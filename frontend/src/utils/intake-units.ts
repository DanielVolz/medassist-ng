import type { IntakeUnit } from "../types";

type Translate = (key: string, options?: Record<string, unknown>) => string;
export type UnitLabelVariant = "full" | "compact";

export function convertLiquidUsageToMl(usage: number, unit: IntakeUnit | null | undefined): number {
	if (unit === "tsp") return usage * 5;
	if (unit === "tbsp") return usage * 15;
	return usage;
}

export function getLiquidCountUnitLabel(
	unit: IntakeUnit | null | undefined,
	usage: number,
	t: Translate,
	variant: UnitLabelVariant = "full"
): string {
	if (unit === "tsp") {
		return variant === "compact"
			? t("form.blisters.teaspoonsShort")
			: t("form.blisters.teaspoons", { count: Math.abs(usage) });
	}
	if (unit === "tbsp") {
		return variant === "compact"
			? t("form.blisters.tablespoonsShort")
			: t("form.blisters.tablespoons", { count: Math.abs(usage) });
	}
	return t("form.packageAmountUnitMl");
}
