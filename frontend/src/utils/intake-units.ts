import type { IntakeUnit } from "../types";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function convertLiquidUsageToMl(usage: number, unit: IntakeUnit | null | undefined): number {
	if (unit === "tsp") return usage * 5;
	if (unit === "tbsp") return usage * 15;
	return usage;
}

export function getLiquidCountUnitLabel(unit: IntakeUnit | null | undefined, usage: number, t: Translate): string {
	if (unit === "tsp") return t("form.blisters.teaspoons", { count: Math.abs(usage) });
	if (unit === "tbsp") return t("form.blisters.tablespoons", { count: Math.abs(usage) });
	return t("form.packageAmountUnitMl");
}
