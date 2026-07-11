import { describe, expect, it } from "vitest";
import {
	allowsPillFormSelection,
	getPackageProfile,
	getPlannerUnitKind,
	getRegionForTimezone,
	isAmountBasedPackageType,
	isDiscreteCountPackageType,
	isIntakeMood,
	isLiquidContainerPackageType,
	isPackageAmountPackageType,
	isTubePackageType,
	normalizeIntakeMood,
	normalizePackageType,
	PACKAGE_PROFILES,
	PACKAGE_TYPES,
	parseLocalDateTime,
} from "./index.js";

describe("shared contracts", () => {
	it("parses local date-times without applying a UTC offset", () => {
		const value = parseLocalDateTime("2026-07-10T08:30:45");

		expect(value.getFullYear()).toBe(2026);
		expect(value.getMonth()).toBe(6);
		expect(value.getDate()).toBe(10);
		expect(value.getHours()).toBe(8);
		expect(value.getMinutes()).toBe(30);
		expect(value.getSeconds()).toBe(45);
	});

	it("falls back to the platform parser for non-local date-time values", () => {
		expect(parseLocalDateTime("2026-07-10").getTime()).toBe(new Date("2026-07-10").getTime());
	});

	it("keeps package profiles complete and normalizes unknown package types", () => {
		expect(PACKAGE_PROFILES.map((profile) => profile.value)).toEqual(PACKAGE_TYPES);
		expect(normalizePackageType("unknown")).toBe("blister");
		expect(normalizePackageType("liquid_container")).toBe("liquid_container");
		expect(getPackageProfile("inhaler").plannerUnitKind).toBe("puffs");
	});

	it("applies package behavior consistently", () => {
		expect(isTubePackageType("tube")).toBe(true);
		expect(isLiquidContainerPackageType("liquid_container")).toBe(true);
		expect(isPackageAmountPackageType("tube")).toBe(true);
		expect(isPackageAmountPackageType("liquid_container")).toBe(true);
		expect(isDiscreteCountPackageType("bottle")).toBe(true);
		expect(isAmountBasedPackageType("bottle")).toBe(true);
		expect(allowsPillFormSelection("tube")).toBe(false);
		expect(getPlannerUnitKind("injection")).toBe("injections");
	});

	it("normalizes intake moods and rejects invalid values", () => {
		expect(isIntakeMood("good")).toBe(true);
		expect(normalizeIntakeMood("very_bad")).toBe("very_bad");
		expect(normalizeIntakeMood("excellent")).toBeNull();
		expect(normalizeIntakeMood(null)).toBeNull();
	});

	it("maps known timezones to their regional defaults", () => {
		expect(getRegionForTimezone("Europe/Berlin")).toBe("DE");
		expect(getRegionForTimezone("America/New_York")).toBe("US");
		expect(getRegionForTimezone("Unknown/Timezone")).toBeUndefined();
		expect(getRegionForTimezone()).toBeUndefined();
	});
});
