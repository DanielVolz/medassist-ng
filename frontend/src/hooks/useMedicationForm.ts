import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FieldErrors, FormBlister, FormIntake, FormState, Medication } from "../types";
import {
	FIELD_LIMITS,
	isAmountBasedPackageType,
	isLiquidContainerPackageType,
	isTubePackageType,
	normalizePackageType,
} from "../types";
import { toDateValue, toTimeValue } from "../utils/formatters";

export const defaultBlister = (): FormBlister => {
	const now = new Date();
	return {
		usage: "1",
		every: "1",
		startDate: toDateValue(now),
		startTime: toTimeValue(now),
	};
};

/**
 * Create a new intake with optional per-intake takenBy
 */
export const defaultIntake = (takenBy: string = ""): FormIntake => {
	const now = new Date();
	return {
		usage: "1",
		every: "1",
		startDate: toDateValue(now),
		startTime: toTimeValue(now),
		intakeUnit: "ml",
		takenBy, // Per-intake user assignment (empty string = null/everyone)
		intakeRemindersEnabled: false,
	};
};

export const defaultForm = (): FormState => ({
	name: "",
	genericName: "",
	takenBy: [],
	medicationForm: "tablet",
	pillForm: "tablet",
	lifecycleCategory: "refill_when_empty",
	packageType: "blister",
	packCount: "1",
	blistersPerPack: "1",
	pillsPerBlister: "1",
	packageAmountValue: "0",
	packageAmountUnit: "ml",
	totalPills: "",
	looseTablets: "0",
	pillWeightMg: "",
	doseUnit: "mg",
	medicationStartDate: "",
	medicationEndDate: "",
	autoMarkObsoleteAfterEndDate: true,
	expiryDate: "",
	notes: "",
	prescriptionEnabled: false,
	prescriptionAuthorizedRefills: "",
	prescriptionRemainingRefills: "",
	prescriptionLowRefillThreshold: "1",
	prescriptionExpiryDate: "",
	intakeRemindersEnabled: false,
	blisters: [defaultBlister()],
	intakes: [defaultIntake()],
});

export interface UseMedicationFormReturn {
	form: FormState;
	setForm: React.Dispatch<React.SetStateAction<FormState>>;
	originalForm: FormState;
	setOriginalForm: React.Dispatch<React.SetStateAction<FormState>>;
	editingId: number | null;
	setEditingId: React.Dispatch<React.SetStateAction<number | null>>;
	showEditModal: boolean;
	setShowEditModal: React.Dispatch<React.SetStateAction<boolean>>;
	fieldErrors: FieldErrors;
	formSaved: boolean;
	setFormSaved: React.Dispatch<React.SetStateAction<boolean>>;
	hasValidationErrors: boolean;
	formChanged: boolean;
	pendingImage: File | null;
	setPendingImage: React.Dispatch<React.SetStateAction<File | null>>;
	pendingImagePreview: string | null;
	setPendingImagePreview: React.Dispatch<React.SetStateAction<string | null>>;
	takenByInput: string;
	setTakenByInput: React.Dispatch<React.SetStateAction<string>>;
	validateField: (field: keyof FieldErrors, value: string | string[]) => string | undefined;
	setBlisterValue: (idx: number, field: keyof FormBlister, value: string) => void;
	addBlister: () => void;
	removeBlister: (idx: number) => void;
	// Intake management with per-intake takenBy
	setIntakeValue: (idx: number, field: keyof FormIntake, value: string | boolean) => void;
	addIntake: (takenBy?: string) => void;
	removeIntake: (idx: number) => void;
	startEdit: (med: Medication, openEditModal: () => void) => void;
	resetForm: () => void;
	handleValueChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
	addTakenByPerson: (name: string) => void;
	removeTakenByPerson: (name: string) => void;
	handleTakenByKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function useMedicationForm(): UseMedicationFormReturn {
	const { t } = useTranslation();
	const [form, setForm] = useState<FormState>(defaultForm());
	const [originalForm, setOriginalForm] = useState<FormState>(defaultForm());
	const [editingId, setEditingId] = useState<number | null>(null);
	const [showEditModal, setShowEditModal] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
	const [formSaved, setFormSaved] = useState(false);
	const [pendingImage, setPendingImage] = useState<File | null>(null);
	const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);
	const [takenByInput, setTakenByInput] = useState("");

	const parseNonNegativeInt = useCallback((value: string): number => {
		const parsed = Number.parseInt(value, 10);
		if (Number.isNaN(parsed) || parsed < 0) return 0;
		return parsed;
	}, []);

	// Validate form fields
	const validateField = useCallback(
		(field: keyof FieldErrors, value: string | string[]): string | undefined => {
			const limits = FIELD_LIMITS[field];
			// Skip validation for takenBy array (individual items validated on add)
			if (field === "takenBy") return undefined;
			const strValue = typeof value === "string" ? value : "";
			if ("max" in limits && strValue.length > limits.max) {
				return t("common.validation.maxLength", { max: limits.max, current: strValue.length });
			}
			return undefined;
		},
		[t]
	);

	// Check if form has any errors
	const hasValidationErrors = useMemo(() => {
		return Object.values(fieldErrors).some((error) => error !== undefined);
	}, [fieldErrors]);

	// Check if form has been modified from original state
	const formChanged = useMemo(() => {
		return JSON.stringify(form) !== JSON.stringify(originalForm);
	}, [form, originalForm]);

	// Reset formSaved when form changes
	useEffect(() => {
		if (formChanged) {
			setFormSaved(false);
		}
	}, [formChanged]);

	// Validate all fields when form changes
	useEffect(() => {
		const errors: FieldErrors = {};
		(["name", "genericName", "notes"] as const).forEach((f) => {
			const error = validateField(f, form[f]);
			if (error) errors[f] = error;
		});
		// Cross-field validation: at least one of name or genericName is required
		const hasName = form.name && form.name.trim().length > 0;
		const hasGenericName = form.genericName && form.genericName.trim().length > 0;
		if (!hasName && !hasGenericName) {
			const msg = t("common.validation.nameOrGenericRequired");
			errors.name = errors.name || msg;
			errors.genericName = errors.genericName || msg;
		}
		setFieldErrors(errors);
	}, [form.name, form.genericName, form.notes, validateField, form, t]);

	const setBlisterValue = useCallback((idx: number, field: keyof FormBlister, value: string) => {
		setForm((prev) => {
			const next = [...prev.blisters];
			next[idx] = { ...next[idx], [field]: value };
			return { ...prev, blisters: next };
		});
	}, []);

	const addBlister = useCallback(() => {
		setForm((prev) => ({ ...prev, blisters: [...prev.blisters, defaultBlister()] }));
	}, []);

	const removeBlister = useCallback((idx: number) => {
		setForm((prev) => ({ ...prev, blisters: prev.blisters.filter((_, i) => i !== idx) }));
	}, []);

	// Intake management with per-intake takenBy
	const setIntakeValue = useCallback((idx: number, field: keyof FormIntake, value: string | boolean) => {
		setForm((prev) => {
			const next = [...prev.intakes];
			next[idx] = { ...next[idx], [field]: value };
			return { ...prev, intakes: next };
		});
	}, []);

	const addIntake = useCallback((takenBy: string = "") => {
		setForm((prev) => ({ ...prev, intakes: [...prev.intakes, defaultIntake(takenBy)] }));
	}, []);

	const removeIntake = useCallback((idx: number) => {
		setForm((prev) => ({ ...prev, intakes: prev.intakes.filter((_, i) => i !== idx) }));
	}, []);

	const startEdit = useCallback((med: Medication, openEditModal: () => void) => {
		setEditingId(med.id);
		setTakenByInput(""); // Clear tag input when starting edit
		setFormSaved(true); // Existing medication is already saved
		setFieldErrors({}); // Prevent one-frame stale error highlight from previous/default form state

		// Parse intakes - prefer new format, fallback to legacy blisters
		const intakesFromApi =
			med.intakes && med.intakes.length > 0
				? med.intakes.map((i) => ({
						usage: String(i.usage),
						every: String(i.every),
						startDate: toDateValue(i.start),
						startTime: toTimeValue(i.start),
						intakeUnit: (i.intakeUnit ?? "ml") as FormIntake["intakeUnit"],
						takenBy: i.takenBy ?? "", // Convert null to empty string for form
						intakeRemindersEnabled: i.intakeRemindersEnabled,
					}))
				: med.blisters.map((s) => ({
						usage: String(s.usage),
						every: String(s.every),
						startDate: toDateValue(s.start),
						startTime: toTimeValue(s.start),
						intakeUnit: "ml" as const,
						takenBy: "", // Legacy blisters have no per-intake takenBy
						intakeRemindersEnabled: med.intakeRemindersEnabled ?? false,
					}));

		const authorizedRefills = Math.max(0, med.prescriptionAuthorizedRefills ?? 0);
		const remainingRefills = Math.min(Math.max(0, med.prescriptionRemainingRefills ?? 0), authorizedRefills);
		const lowRefillThreshold = Math.min(Math.max(0, med.prescriptionLowRefillThreshold ?? 1), authorizedRefills);
		const packageType = normalizePackageType(med.packageType);
		const isTubeOrLiquidPackage = isTubePackageType(packageType) || isLiquidContainerPackageType(packageType);
		let normalizedPackCount = String(med.packCount);
		let normalizedPackageAmountValue = String(med.packageAmountValue ?? 0);

		if (isTubeOrLiquidPackage) {
			const safePackCount = isTubePackageType(packageType) ? 1 : Math.max(1, med.packCount || 1);
			normalizedPackCount = String(safePackCount);

			const rawPackageAmount = Number(med.packageAmountValue ?? 0);
			const legacyKnownAmount = Math.max(0, Number(med.totalPills ?? 0), Number(med.looseTablets ?? 0));

			if (isTubePackageType(packageType)) {
				normalizedPackageAmountValue = String(
					legacyKnownAmount > 0 ? legacyKnownAmount : Math.max(1, rawPackageAmount)
				);
			} else if (rawPackageAmount > 0) {
				normalizedPackageAmountValue = String(rawPackageAmount);
			} else {
				normalizedPackageAmountValue = String(legacyKnownAmount);
			}
		}

		const normalizedDerivedTotal = isTubeOrLiquidPackage
			? Math.max(0, (Number(normalizedPackCount) || 0) * (Number(normalizedPackageAmountValue) || 0))
			: null;

		const bottleTotalPills = isAmountBasedPackageType(packageType) && med.looseTablets ? String(med.looseTablets) : "";
		let resolvedForm = med.medicationForm;
		if (!resolvedForm) {
			if (isTubePackageType(packageType)) {
				resolvedForm = "topical";
			} else if (isLiquidContainerPackageType(packageType)) {
				resolvedForm = "liquid";
			} else {
				resolvedForm = med.pillForm ?? "tablet";
			}
		}
		const resolvedPillForm = med.pillForm ?? (resolvedForm === "capsule" ? "capsule" : "tablet");
		let normalizedPackageAmountUnit = med.packageAmountUnit ?? "ml";
		if (isTubePackageType(packageType)) {
			normalizedPackageAmountUnit = "g";
		} else if (isLiquidContainerPackageType(packageType)) {
			normalizedPackageAmountUnit = "ml";
		}
		let resolvedTotalPills = bottleTotalPills;
		if (normalizedDerivedTotal != null) {
			resolvedTotalPills = String(normalizedDerivedTotal);
		} else if (med.totalPills) {
			resolvedTotalPills = String(med.totalPills);
		}
		const editForm: FormState = {
			name: med.name,
			genericName: med.genericName ?? "",
			takenBy: med.takenBy || [], // Already an array from API
			medicationForm: resolvedForm,
			pillForm: resolvedPillForm,
			lifecycleCategory: med.lifecycleCategory ?? "refill_when_empty",
			packageType,
			packCount: normalizedPackCount,
			blistersPerPack: String(med.blistersPerPack),
			pillsPerBlister: String(med.pillsPerBlister),
			packageAmountValue: normalizedPackageAmountValue,
			packageAmountUnit: normalizedPackageAmountUnit,
			totalPills: resolvedTotalPills,
			looseTablets: normalizedDerivedTotal != null ? String(normalizedDerivedTotal) : String(med.looseTablets),
			pillWeightMg: med.pillWeightMg ? String(med.pillWeightMg) : "",
			doseUnit: med.doseUnit ?? "mg",
			medicationStartDate: med.medicationStartDate ?? "",
			medicationEndDate: med.medicationEndDate ?? "",
			autoMarkObsoleteAfterEndDate: med.autoMarkObsoleteAfterEndDate ?? true,
			expiryDate: med.expiryDate ? med.expiryDate.slice(0, 10) : "",
			notes: med.notes ?? "",
			prescriptionEnabled: med.prescriptionEnabled ?? false,
			prescriptionAuthorizedRefills: med.prescriptionAuthorizedRefills != null ? String(authorizedRefills) : "",
			prescriptionRemainingRefills: med.prescriptionRemainingRefills != null ? String(remainingRefills) : "",
			prescriptionLowRefillThreshold: String(lowRefillThreshold),
			prescriptionExpiryDate: med.prescriptionExpiryDate ? med.prescriptionExpiryDate.slice(0, 10) : "",
			intakeRemindersEnabled: med.intakeRemindersEnabled ?? false,
			blisters: med.blisters.map((s) => ({
				usage: String(s.usage),
				every: String(s.every),
				startDate: toDateValue(s.start),
				startTime: toTimeValue(s.start),
			})),
			intakes: intakesFromApi,
		};
		setForm(editForm);
		setOriginalForm(editForm);
		// Show modal on mobile
		if (window.innerWidth <= 768) {
			openEditModal();
		}
	}, []);

	const resetForm = useCallback(() => {
		setEditingId(null);
		setShowEditModal(false);
		setPendingImage(null);
		setPendingImagePreview(null);
		setTakenByInput("");
		setFieldErrors({});
		setFormSaved(false);
		const newForm = defaultForm();
		setForm(newForm);
		setOriginalForm(newForm);
	}, []);

	const handleValueChange = useCallback(
		<K extends keyof FormState>(key: K, value: FormState[K]) => {
			setForm((prev) => {
				const next = { ...prev, [key]: value } as FormState;

				if (key === "packageType") {
					const nextPackageType = value as FormState["packageType"];
					if (isTubePackageType(nextPackageType)) {
						next.packCount = "1";
						next.packageAmountValue = String(Math.max(1, Number(next.packageAmountValue) || 0));
						next.medicationForm = "topical";
						next.lifecycleCategory = "treatment_period";
						next.doseUnit = "units";
						next.packageAmountUnit = "g";
					} else if (isLiquidContainerPackageType(nextPackageType)) {
						next.packCount = String(Math.max(1, Number(next.packCount) || 1));
						next.packageAmountValue = String(Math.max(1, Number(next.packageAmountValue) || 0));
						next.medicationForm = "liquid";
						next.lifecycleCategory = "refill_when_empty";
						next.doseUnit = "ml";
						next.packageAmountUnit = "ml";
						next.intakes = next.intakes.map((intake) => ({ ...intake, intakeUnit: intake.intakeUnit || "ml" }));
					} else {
						next.medicationForm = next.pillForm;
						next.lifecycleCategory = "refill_when_empty";
					}
				}

				if (key === "medicationForm") {
					if (isTubePackageType(next.packageType)) {
						next.medicationForm = "topical";
						next.lifecycleCategory = "treatment_period";
						next.doseUnit = "units";
						next.packageAmountUnit = "g";
					} else if (isLiquidContainerPackageType(next.packageType)) {
						next.medicationForm = "liquid";
						next.lifecycleCategory = "refill_when_empty";
						next.doseUnit = "ml";
						next.packageAmountUnit = "ml";
						next.intakes = next.intakes.map((intake) => ({ ...intake, intakeUnit: intake.intakeUnit || "ml" }));
					}
				}

				if (isTubePackageType(next.packageType)) {
					next.packCount = "1";
					next.packageAmountUnit = "g";
				} else if (isLiquidContainerPackageType(next.packageType)) {
					next.packageAmountUnit = "ml";
				}

				if (key === "pillForm" && value === "capsule") {
					next.medicationForm = "capsule";
					next.intakes = next.intakes.map((intake) => {
						const parsedUsage = Number.parseFloat(intake.usage);
						const rounded = Number.isFinite(parsedUsage) ? Math.max(0, Math.round(parsedUsage)) : 1;
						return { ...intake, usage: String(rounded || 1) };
					});
				}

				if (key === "pillForm" && value === "tablet") {
					next.medicationForm = "tablet";
				}

				if (key === "prescriptionAuthorizedRefills") {
					const raw = String(value);
					next.prescriptionAuthorizedRefills = raw === "" ? "" : String(parseNonNegativeInt(raw));
				}

				if (key === "prescriptionRemainingRefills") {
					const raw = String(value);
					next.prescriptionRemainingRefills = raw === "" ? "" : String(parseNonNegativeInt(raw));
				}

				if (key === "prescriptionLowRefillThreshold") {
					const raw = String(value);
					next.prescriptionLowRefillThreshold = raw === "" ? "" : String(parseNonNegativeInt(raw));
				}

				if (!next.prescriptionEnabled) {
					return next;
				}

				const authorizedRefills = parseNonNegativeInt(next.prescriptionAuthorizedRefills);

				if (key === "prescriptionAuthorizedRefills") {
					next.prescriptionRemainingRefills = String(
						Math.min(parseNonNegativeInt(next.prescriptionRemainingRefills), authorizedRefills)
					);
					next.prescriptionLowRefillThreshold = String(
						Math.min(parseNonNegativeInt(next.prescriptionLowRefillThreshold), authorizedRefills)
					);
				}

				if (key === "prescriptionRemainingRefills") {
					next.prescriptionRemainingRefills = String(Math.min(parseNonNegativeInt(String(value)), authorizedRefills));
				}

				if (key === "prescriptionLowRefillThreshold") {
					next.prescriptionLowRefillThreshold = String(Math.min(parseNonNegativeInt(String(value)), authorizedRefills));
				}

				return next;
			});
		},
		[parseNonNegativeInt]
	);

	// Tag input helpers for "Taken By" field
	const addTakenByPerson = useCallback(
		(name: string) => {
			const trimmed = name.trim();
			if (trimmed && trimmed.length <= FIELD_LIMITS.takenBy.max && !form.takenBy.includes(trimmed)) {
				setForm((prev) => ({ ...prev, takenBy: [...prev.takenBy, trimmed] }));
			}
			setTakenByInput("");
		},
		[form.takenBy]
	);

	const removeTakenByPerson = useCallback((name: string) => {
		setForm((prev) => ({ ...prev, takenBy: prev.takenBy.filter((p) => p !== name) }));
	}, []);

	const handleTakenByKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Enter" || e.key === ",") {
				e.preventDefault();
				addTakenByPerson(takenByInput);
			} else if (e.key === "Backspace" && !takenByInput && form.takenBy.length > 0) {
				// Remove last tag on backspace when input is empty
				removeTakenByPerson(form.takenBy[form.takenBy.length - 1]);
			}
		},
		[takenByInput, form.takenBy, addTakenByPerson, removeTakenByPerson]
	);

	return {
		form,
		setForm,
		originalForm,
		setOriginalForm,
		editingId,
		setEditingId,
		showEditModal,
		setShowEditModal,
		fieldErrors,
		formSaved,
		setFormSaved,
		hasValidationErrors,
		formChanged,
		pendingImage,
		setPendingImage,
		pendingImagePreview,
		setPendingImagePreview,
		takenByInput,
		setTakenByInput,
		validateField,
		setBlisterValue,
		addBlister,
		removeBlister,
		setIntakeValue,
		addIntake,
		removeIntake,
		startEdit,
		resetForm,
		handleValueChange,
		addTakenByPerson,
		removeTakenByPerson,
		handleTakenByKeyDown,
	};
}
