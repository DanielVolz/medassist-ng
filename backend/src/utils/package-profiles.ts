export const PACKAGE_TYPES = ["blister", "bottle", "tube", "liquid_container"] as const;

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

export function isAmountBasedPackageType(packageType?: string | null): boolean {
	const normalized = normalizePackageType(packageType);
	return normalized === "bottle" || normalized === "tube" || normalized === "liquid_container";
}

export function getPlannerUnitKind(packageType?: string | null): "pills" | "ml" | "units" {
	const normalized = normalizePackageType(packageType);
	if (normalized === "tube") return "units";
	if (normalized === "liquid_container") return "ml";
	return "pills";
}
