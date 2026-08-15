import { normalizePackageType, type PackageType } from "./package-profiles.js";

export const AS_NEEDED_QUANTITY_UNITS = ["pills", "ml", "puffs", "injections", "application"] as const;

export type AsNeededQuantityUnit = (typeof AS_NEEDED_QUANTITY_UNITS)[number];

export type AsNeededQuantityProfile = {
	unit: AsNeededQuantityUnit;
	defaultQuantity: number;
	uiStep: number;
	wholeUnitsOnly: boolean;
	measurable: boolean;
};

const WHOLE_PILL_PROFILE: AsNeededQuantityProfile = {
	unit: "pills",
	defaultQuantity: 1,
	uiStep: 1,
	wholeUnitsOnly: true,
	measurable: true,
};

const TABLET_PROFILE: AsNeededQuantityProfile = {
	unit: "pills",
	defaultQuantity: 0.5,
	uiStep: 0.5,
	wholeUnitsOnly: false,
	measurable: true,
};

const PROFILES: Record<Exclude<PackageType, "blister" | "bottle">, AsNeededQuantityProfile> = {
	tube: { unit: "application", defaultQuantity: 1, uiStep: 1, wholeUnitsOnly: true, measurable: false },
	liquid_container: { unit: "ml", defaultQuantity: 1, uiStep: 0.1, wholeUnitsOnly: false, measurable: true },
	inhaler: { unit: "puffs", defaultQuantity: 1, uiStep: 1, wholeUnitsOnly: true, measurable: true },
	injection: { unit: "injections", defaultQuantity: 1, uiStep: 1, wholeUnitsOnly: true, measurable: true },
};

export function getAsNeededQuantityProfile(input: {
	packageType?: string | null;
	medicationForm?: string | null;
	pillForm?: string | null;
}): AsNeededQuantityProfile {
	if (input.medicationForm === "topical") return PROFILES.tube;
	if (input.medicationForm === "liquid") return PROFILES.liquid_container;
	const packageType = normalizePackageType(input.packageType);
	if (packageType === "blister" || packageType === "bottle") {
		const pillForm = input.pillForm ?? input.medicationForm;
		return pillForm === "capsule" ? WHOLE_PILL_PROFILE : TABLET_PROFILE;
	}

	return PROFILES[packageType];
}

export function normalizeAsNeededQuantityMilli(quantity: number, profile: AsNeededQuantityProfile): number | null {
	if (!Number.isFinite(quantity) || quantity <= 0) return null;
	if (profile.unit === "application" && quantity !== 1) return null;
	if (profile.wholeUnitsOnly && !Number.isInteger(quantity)) return null;

	const milli = quantity * 1000;
	if (!Number.isSafeInteger(milli) || milli <= 0) return null;
	if (profile.uiStep === 0.5 && milli % 500 !== 0) return null;
	return milli;
}
