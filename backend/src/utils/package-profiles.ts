export const PACKAGE_TYPES = ["blister", "bottle", "tube", "liquid_container", "inhaler", "injection"] as const;

export type PackageType = (typeof PACKAGE_TYPES)[number];

const PACKAGE_TYPE_SET = new Set<string>(PACKAGE_TYPES);

export function normalizePackageType(packageType?: string | null): PackageType {
	if (packageType && PACKAGE_TYPE_SET.has(packageType)) {
		return packageType as PackageType;
	}
	return "blister";
}

export function isTubePackageType(packageType?: string | null): boolean {
	return normalizePackageType(packageType) === "tube";
}

export function isLiquidContainerPackageType(packageType?: string | null): boolean {
	return normalizePackageType(packageType) === "liquid_container";
}

export function isPackageAmountPackageType(packageType?: string | null): boolean {
	const normalized = normalizePackageType(packageType);
	return normalized === "tube" || normalized === "liquid_container";
}

export function isDiscreteCountPackageType(packageType?: string | null): boolean {
	const normalized = normalizePackageType(packageType);
	return normalized === "bottle" || normalized === "inhaler" || normalized === "injection";
}

export function isAmountBasedPackageType(packageType?: string | null): boolean {
	return isPackageAmountPackageType(packageType) || isDiscreteCountPackageType(packageType);
}

export function getPlannerUnitKind(packageType?: string | null): "pills" | "ml" | "units" | "puffs" | "injections" {
	const normalized = normalizePackageType(packageType);
	if (normalized === "tube") return "units";
	if (normalized === "liquid_container") return "ml";
	if (normalized === "inhaler") return "puffs";
	if (normalized === "injection") return "injections";
	return "pills";
}
