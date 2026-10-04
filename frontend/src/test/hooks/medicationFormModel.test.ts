import { describe, expect, it } from "vitest";
import {
	buildMedicationSubmitPayload,
	getMedicationFormIssues,
	hasMedicationFormValidationErrors,
	MEDICATION_FORM_FIELD_LIMITS,
	validateMedicationForm,
	validateMedicationFormField,
} from "../../hooks/medicationFormModel";
import { defaultForm } from "../../hooks/useMedicationForm";
import { FIELD_LIMITS } from "../../types";

const t = (key: string) => key;

describe("medicationFormModel", () => {
	it("exposes the shared medication field limits", () => {
		expect(MEDICATION_FORM_FIELD_LIMITS).toBe(FIELD_LIMITS);
		expect(MEDICATION_FORM_FIELD_LIMITS.takenBy.max).toBe(100);
		expect(MEDICATION_FORM_FIELD_LIMITS.notes.max).toBe(2000);
	});

	it("requires either commercial or generic name", () => {
		const errors = validateMedicationForm({ name: " ", genericName: "", notes: "" }, t);

		expect(errors.name).toBe("common.validation.nameOrGenericRequired");
		expect(errors.genericName).toBe("common.validation.nameOrGenericRequired");
		expect(hasMedicationFormValidationErrors(errors)).toBe(true);
	});

	it("accepts a generic-only medication name", () => {
		const errors = validateMedicationForm({ name: "", genericName: "Ibuprofen", notes: "" }, t);

		expect(errors.name).toBeUndefined();
		expect(errors.genericName).toBeUndefined();
		expect(hasMedicationFormValidationErrors(errors)).toBe(false);
	});

	it("applies shared max-length validation to edge-case fields", () => {
		expect(validateMedicationFormField("name", "a".repeat(MEDICATION_FORM_FIELD_LIMITS.name.max + 1), t)).toBe(
			"common.validation.maxLength"
		);
		expect(validateMedicationFormField("notes", "a".repeat(MEDICATION_FORM_FIELD_LIMITS.notes.max + 1), t)).toBe(
			"common.validation.maxLength"
		);
		expect(validateMedicationFormField("takenBy", ["Alice"], t)).toBeUndefined();
	});

	it("checks required names synchronously and permits an explicit empty schedule", () => {
		const form = { ...defaultForm(), name: " ", intakes: [] };
		expect(getMedicationFormIssues(form, t).hasErrors).toBe(true);
		form.genericName = " Generic ";
		expect(getMedicationFormIssues(form, t).hasErrors).toBe(false);
		const payload = buildMedicationSubmitPayload(form);
		expect(payload).toMatchObject({ name: "", genericName: "Generic", intakes: [] });
		expect(payload.blisters).toBeUndefined();
		expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty("blisters");
	});

	it("prioritizes end-before-start, then intake-before-start date errors", () => {
		const form = { ...defaultForm(), name: "Synthetic", medicationStartDate: "2026-10-04" };
		form.medicationEndDate = "2026-10-03";
		form.intakes[0].startDate = "2026-10-02";
		expect(getMedicationFormIssues(form, t).dateConsistencyError).toBe("form.validation.endDateBeforeStart");
		form.medicationEndDate = "2026-10-05";
		expect(getMedicationFormIssues(form, t).dateConsistencyError).toBe("form.validation.startDateAfterIntake");
		form.intakes[0].startDate = "2026-10-04";
		expect(getMedicationFormIssues(form, t).hasErrors).toBe(false);
	});

	it("rejects missing weekdays and fractional capsules without blocking liquid after a package switch", () => {
		const form = { ...defaultForm(), name: "Synthetic", pillForm: "capsule" as const };
		form.intakes[0] = { ...form.intakes[0], usage: "0.5", scheduleMode: "weekdays", weekdays: [] };
		expect(getMedicationFormIssues(form, t)).toMatchObject({
			hasWeekdayScheduleError: true,
			hasFractionalCapsuleError: true,
			hasErrors: true,
		});
		form.intakes[0].weekdays = ["mon", "wed"];
		const liquid = { ...form, packageType: "liquid_container" as const };
		expect(getMedicationFormIssues(liquid, t).hasErrors).toBe(false);
		expect(buildMedicationSubmitPayload(liquid).intakes[0]).toMatchObject({
			usage: 0.5,
			every: 1,
			scheduleMode: "weekdays",
			weekdays: ["mon", "wed"],
			intakeUnit: "ml",
		});
	});

	it("preserves trimming, schedule compatibility, month-end and prescription clamping", () => {
		const form = {
			...defaultForm(),
			name: " Synthetic ",
			notes: " note ",
			expiryDate: "2028-02",
			prescriptionEnabled: true,
			prescriptionAuthorizedRefills: "2",
			prescriptionRemainingRefills: "7",
			prescriptionLowRefillThreshold: "4",
		};
		form.intakes[0] = { ...form.intakes[0], takenBy: " Person ", every: "3", weekdays: ["mon"] };
		const payload = buildMedicationSubmitPayload(form);
		expect(payload).toMatchObject({
			name: "Synthetic",
			genericName: null,
			notes: "note",
			expiryDate: "2028-02-29",
			prescriptionAuthorizedRefills: 2,
			prescriptionRemainingRefills: 2,
			prescriptionLowRefillThreshold: 2,
		});
		expect(payload.intakes[0]).toMatchObject({ takenBy: "Person", every: 3, weekdays: [], intakeUnit: null });
		expect(payload.blisters).toEqual(payload.intakes.map(({ usage, every, start }) => ({ usage, every, start })));
		expect(form.intakes[0].weekdays).toEqual(["mon"]);
	});

	it.each([
		["tube", "topical", "g", 30],
		["liquid_container", "liquid", "ml", null],
		["inhaler", "tablet", "ml", null],
	] as const)("normalizes %s package fields without stale pill form", (packageType, medicationForm, unit, total) => {
		const payload = buildMedicationSubmitPayload({
			...defaultForm(),
			packageType,
			packCount: "2",
			packageAmountValue: "15",
		});
		expect(payload).toMatchObject({ medicationForm, pillForm: null, packageAmountUnit: unit, totalPills: total });
		if (packageType === "tube") expect(payload.looseTablets).toBe(30);
	});
});
