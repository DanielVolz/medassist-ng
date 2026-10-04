import type { FieldErrors, FormIntake, FormState } from "../types";
import {
	allowsPillFormSelection,
	FIELD_LIMITS,
	isDiscreteCountPackageType,
	isLiquidContainerPackageType,
	isTubePackageType,
	normalizePackageType,
} from "../types";
import { combineDateAndTime, toMonthEndDateValue } from "../utils/formatters";
import { getIntakeScheduleMode, hasSelectedWeekdays } from "../utils/intake-schedule";

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

export function hasMedicationWeekdaySelectionError(intake: FormIntake): boolean {
	return getIntakeScheduleMode(intake) === "weekdays" && !hasSelectedWeekdays(intake.weekdays);
}

/** One submit-time decision for desktop and mobile; do not rely on effect timing. */
export function getMedicationFormIssues(form: FormState, t: TranslationFunction) {
	const fieldErrors = validateMedicationForm(form, t);
	let dateConsistencyError: string | null = null;
	const { medicationStartDate, medicationEndDate } = form;
	if (medicationStartDate && medicationEndDate && medicationEndDate < medicationStartDate) {
		dateConsistencyError = t("form.validation.endDateBeforeStart", { medicationStartDate, medicationEndDate });
	} else if (medicationStartDate) {
		const conflictingIntake = form.intakes.find((intake) => intake.startDate && intake.startDate < medicationStartDate);
		if (conflictingIntake) {
			dateConsistencyError = t("form.validation.startDateAfterIntake", {
				medicationStartDate,
				intakeDate: conflictingIntake.startDate,
			});
		}
	}
	const hasWeekdayScheduleError = form.intakes.some(hasMedicationWeekdaySelectionError);
	const hasFractionalCapsuleError =
		allowsPillFormSelection(form.packageType) &&
		form.pillForm === "capsule" &&
		form.intakes.some((intake) => !Number.isInteger(Number(intake.usage)));
	return {
		fieldErrors,
		dateConsistencyError,
		hasWeekdayScheduleError,
		hasFractionalCapsuleError,
		hasErrors:
			hasMedicationFormValidationErrors(fieldErrors) ||
			!!dateConsistencyError ||
			hasWeekdayScheduleError ||
			hasFractionalCapsuleError,
	};
}

/** Preserve the API's legacy schedule and package normalization contracts. */
export function buildMedicationSubmitPayload(form: FormState) {
	const intakes = form.intakes.map((intake) => ({
		usage: Number(intake.usage) || 1,
		every: getIntakeScheduleMode(intake) === "weekdays" ? 1 : Number(intake.every) || 1,
		start: combineDateAndTime(intake.startDate, intake.startTime),
		scheduleMode: getIntakeScheduleMode(intake),
		weekdays: getIntakeScheduleMode(intake) === "weekdays" ? [...(intake.weekdays ?? [])] : [],
		intakeUnit: isLiquidContainerPackageType(form.packageType) ? intake.intakeUnit : null,
		takenBy: intake.takenBy.trim() || null,
		intakeRemindersEnabled: intake.intakeRemindersEnabled,
	}));
	const blisters = intakes.map(({ usage, every, start }) => ({ usage, every, start }));
	const authorizedRefills = Number(form.prescriptionAuthorizedRefills || 0);
	const remainingRefills = Math.min(Number(form.prescriptionRemainingRefills || 0), authorizedRefills);
	const lowRefillThreshold = Math.min(Number(form.prescriptionLowRefillThreshold || 1), authorizedRefills);

	let medicationForm: string;
	if (isTubePackageType(form.packageType)) {
		medicationForm =
			form.medicationForm === "liquid" || form.medicationForm === "topical" ? form.medicationForm : "topical";
	} else if (isLiquidContainerPackageType(form.packageType)) {
		medicationForm = "liquid";
	} else if (isDiscreteCountPackageType(form.packageType)) {
		medicationForm = "tablet";
	} else {
		medicationForm = form.pillForm;
	}
	const tubeTotalAmount = isTubePackageType(form.packageType)
		? (Number(form.packCount) || 0) * (Number(form.packageAmountValue ?? 0) || 0)
		: null;
	let packageAmountUnit = form.packageAmountUnit ?? "ml";
	if (isTubePackageType(form.packageType)) {
		packageAmountUnit = "g";
	} else if (isLiquidContainerPackageType(form.packageType)) {
		packageAmountUnit = "ml";
	}
	return {
		name: form.name.trim(),
		genericName: form.genericName.trim() || null,
		takenBy: form.takenBy.length > 0 ? form.takenBy : [],
		medicationForm,
		pillForm: allowsPillFormSelection(form.packageType) ? form.pillForm : null,
		lifecycleCategory: form.lifecycleCategory,
		packageType: normalizePackageType(form.packageType),
		packCount: isTubePackageType(form.packageType)
			? Math.max(1, Number(form.packCount) || 1)
			: Number(form.packCount) || 0,
		blistersPerPack: isTubePackageType(form.packageType) ? 1 : Number(form.blistersPerPack) || 1,
		pillsPerBlister: isTubePackageType(form.packageType) ? 1 : Number(form.pillsPerBlister) || 1,
		packageAmountValue: Number(form.packageAmountValue ?? 0) || 0,
		packageAmountUnit,
		totalPills: isTubePackageType(form.packageType) ? tubeTotalAmount : Number(form.totalPills) || null,
		looseTablets: isTubePackageType(form.packageType) ? tubeTotalAmount || 0 : Number(form.looseTablets) || 0,
		pillWeightMg: Number(form.pillWeightMg) || null,
		doseUnit: form.doseUnit,
		medicationStartDate: form.medicationStartDate || null,
		medicationEndDate: form.medicationEndDate || null,
		autoMarkObsoleteAfterEndDate: form.autoMarkObsoleteAfterEndDate,
		expiryDate: toMonthEndDateValue(form.expiryDate) || null,
		notes: form.notes.trim() || null,
		intakeRemindersEnabled: form.intakeRemindersEnabled,
		prescriptionEnabled: form.prescriptionEnabled,
		prescriptionAuthorizedRefills: form.prescriptionEnabled ? authorizedRefills : null,
		prescriptionRemainingRefills: form.prescriptionEnabled ? remainingRefills : null,
		prescriptionLowRefillThreshold: form.prescriptionEnabled ? lowRefillThreshold : 1,
		prescriptionExpiryDate: form.prescriptionExpiryDate || null,
		blisters: intakes.length > 0 ? blisters : undefined,
		intakes,
	};
}
