export const PACKAGE_TYPES = ["blister", "bottle", "tube", "liquid_container"] as const;

export type PackageType = (typeof PACKAGE_TYPES)[number];

export type PackageProfile = {
	value: PackageType;
	labelKey: string;
	amountBased: boolean;
	plannerUnitKind: "pills" | "ml" | "units";
	allowsPillFormSelection: boolean;
};

export const PACKAGE_PROFILES: PackageProfile[] = [
	{
		value: "blister",
		labelKey: "form.packageTypeBlister",
		amountBased: false,
		plannerUnitKind: "pills",
		allowsPillFormSelection: true,
	},
	{
		value: "bottle",
		labelKey: "form.packageTypeBottle",
		amountBased: true,
		plannerUnitKind: "pills",
		allowsPillFormSelection: true,
	},
	{
		value: "tube",
		labelKey: "form.packageTypeTube",
		amountBased: true,
		plannerUnitKind: "units",
		allowsPillFormSelection: false,
	},
	{
		value: "liquid_container",
		labelKey: "form.packageTypeLiquidContainer",
		amountBased: true,
		plannerUnitKind: "ml",
		allowsPillFormSelection: false,
	},
];

const PACKAGE_TYPE_SET = new Set<string>(PACKAGE_TYPES);
const PROFILE_BY_TYPE = new Map(PACKAGE_PROFILES.map((profile) => [profile.value, profile] as const));

export function normalizePackageType(packageType?: string | null): PackageType {
	if (packageType && PACKAGE_TYPE_SET.has(packageType)) {
		return packageType as PackageType;
	}
	return "blister";
}

export function getPackageProfile(packageType?: string | null): PackageProfile {
	return PROFILE_BY_TYPE.get(normalizePackageType(packageType)) ?? PACKAGE_PROFILES[0];
}

export function isTubePackageType(packageType?: string | null): boolean {
	return normalizePackageType(packageType) === "tube";
}

export function isLiquidContainerPackageType(packageType?: string | null): boolean {
	return normalizePackageType(packageType) === "liquid_container";
}

export function isAmountBasedPackageType(packageType?: string | null): boolean {
	return getPackageProfile(packageType).amountBased;
}

export function allowsPillFormSelection(packageType?: string | null): boolean {
	return getPackageProfile(packageType).allowsPillFormSelection;
}
