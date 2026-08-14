import { describe, expect, it } from "vitest";
import { getAsNeededQuantityProfile, normalizeAsNeededQuantityMilli } from "./as-needed-intakes.js";

describe("as-needed quantity profiles", () => {
	it.each([
		[{ packageType: "blister", medicationForm: "tablet", pillForm: "tablet" }, "pills", 0.5, 0.5, false, true],
		[{ packageType: "blister", medicationForm: "capsule", pillForm: "capsule" }, "pills", 1, 1, true, true],
		[{ packageType: "liquid_container", medicationForm: "liquid" }, "ml", 1, 0.1, false, true],
		[{ packageType: "inhaler", medicationForm: "tablet" }, "puffs", 1, 1, true, true],
		[{ packageType: "tube", medicationForm: "topical" }, "application", 1, 1, true, false],
	] as const)("maps %o", (input, unit, defaultQuantity, uiStep, wholeUnitsOnly, measurable) => {
		expect(getAsNeededQuantityProfile(input)).toMatchObject({
			unit,
			defaultQuantity,
			uiStep,
			wholeUnitsOnly,
			measurable,
		});
	});

	it("enforces precision, whole-unit caps, and topical single application", () => {
		const tablet = getAsNeededQuantityProfile({ packageType: "blister", medicationForm: "tablet" });
		const capsule = getAsNeededQuantityProfile({ packageType: "blister", medicationForm: "capsule" });
		const topical = getAsNeededQuantityProfile({ medicationForm: "topical" });
		expect(normalizeAsNeededQuantityMilli(0.5, tablet)).toBe(500);
		expect(normalizeAsNeededQuantityMilli(0.1, tablet)).toBeNull();
		expect(normalizeAsNeededQuantityMilli(1.5, capsule)).toBeNull();
		expect(normalizeAsNeededQuantityMilli(1, topical)).toBe(1000);
		expect(normalizeAsNeededQuantityMilli(2, topical)).toBeNull();
	});
});
