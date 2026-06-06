import { describe, expect, it } from "vitest";
import {
	hasMedicationFormValidationErrors,
	MEDICATION_FORM_FIELD_LIMITS,
	validateMedicationForm,
	validateMedicationFormField,
} from "../../hooks/medicationFormModel";
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
});
