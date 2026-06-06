import type { FieldErrors, FormState } from "../types";
import { FIELD_LIMITS } from "../types";

export const MEDICATION_FORM_FIELD_LIMITS = FIELD_LIMITS;

type TranslationFunction = (key: string, options?: Record<string, unknown>) => string;

export function validateMedicationFormField(
	field: keyof FieldErrors,
	value: string | string[],
	t: TranslationFunction
): string | undefined {
	if (field === "takenBy") return undefined;

	const limits = MEDICATION_FORM_FIELD_LIMITS[field];
	const strValue = typeof value === "string" ? value : "";
	if ("max" in limits && strValue.length > limits.max) {
		return t("common.validation.maxLength", { max: limits.max, current: strValue.length });
	}

	return undefined;
}

export function validateMedicationForm(
	form: Pick<FormState, "name" | "genericName" | "notes">,
	t: TranslationFunction
): FieldErrors {
	const errors: FieldErrors = {};

	for (const field of ["name", "genericName", "notes"] as const) {
		const error = validateMedicationFormField(field, form[field], t);
		if (error) errors[field] = error;
	}

	const hasName = form.name.trim().length > 0;
	const hasGenericName = form.genericName.trim().length > 0;
	if (!hasName && !hasGenericName) {
		const message = t("common.validation.nameOrGenericRequired");
		errors.name = errors.name || message;
		errors.genericName = errors.genericName || message;
	}

	return errors;
}

export function hasMedicationFormValidationErrors(errors: FieldErrors): boolean {
	return Object.values(errors).some((error) => error !== undefined);
}
