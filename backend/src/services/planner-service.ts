import { getPlannerUnitKind, isAmountBasedPackageType } from "../utils/package-profiles.js";

export { escapeHtml } from "../utils/html.js";
export { getDeliveryError, type MailDeliveryInfo } from "./notifications/delivery-result.js";

export function isContainerPackage(packageType?: string): boolean {
	return isAmountBasedPackageType(packageType);
}

export function getPlannerUnit(
	packageType: string | undefined,
	tr: { common: { units: string; ml: string; pills: string; puffs?: string; injections?: string } }
): string {
	const unitKind = getPlannerUnitKind(packageType);
	if (unitKind === "units") return tr.common.units;
	if (unitKind === "ml") return tr.common.ml;
	if (unitKind === "puffs") return tr.common.puffs ?? tr.common.pills;
	if (unitKind === "injections") return tr.common.injections ?? tr.common.pills;
	return tr.common.pills;
}

export function formatPlannerQuantity(
	packageType: string | undefined,
	count: number,
	tr: { common: { units: string; ml: string; pills: string; puffs?: string; injections?: string } }
): string {
	return `${count} ${getPlannerUnit(packageType, tr)}`;
}
