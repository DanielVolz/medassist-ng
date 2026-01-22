import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Medication, FormState, FormBlister, FieldErrors } from "../types";
import { FIELD_LIMITS } from "../types";
import { toDateValue, toTimeValue } from "../utils/formatters";

export const defaultBlister = (): FormBlister => {
	const now = new Date();
	return {
		usage: "1",
		every: "1",
		startDate: toDateValue(now),
		startTime: toTimeValue(now)
	};
};

export const defaultForm = (): FormState => ({
	name: "",
	genericName: "",
	takenBy: [],
	packCount: "1",
	blistersPerPack: "1",
	pillsPerBlister: "1",
	looseTablets: "0",
	pillWeightMg: "",
	expiryDate: "",
	notes: "",
	intakeRemindersEnabled: false,
	blisters: [defaultBlister()]
});

export interface UseMedicationFormReturn {
	form: FormState;
	setForm: React.Dispatch<React.SetStateAction<FormState>>;
	originalForm: FormState;
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
	startEdit: (med: Medication, openEditModal: () => void) => void;
	resetForm: () => void;
	handleValueChange: <K extends keyof FormState>(key: K, value: string) => void;
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

	// Validate form fields
	const validateField = useCallback((field: keyof FieldErrors, value: string | string[]): string | undefined => {
		const limits = FIELD_LIMITS[field];
		// Skip validation for takenBy array (individual items validated on add)
		if (field === 'takenBy') return undefined;
		const strValue = typeof value === 'string' ? value : '';
		if (field === 'name' && (!strValue || strValue.trim().length === 0)) {
			return t('common.validation.required');
		}
		if ('max' in limits && strValue.length > limits.max) {
			return t('common.validation.maxLength', { max: limits.max, current: strValue.length });
		}
		return undefined;
	}, [t]);

	// Check if form has any errors
	const hasValidationErrors = useMemo(() => {
		return Object.values(fieldErrors).some(error => error !== undefined);
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
		(['name', 'genericName', 'notes'] as const).forEach(field => {
			const error = validateField(field, form[field]);
			if (error) errors[field] = error;
		});
		setFieldErrors(errors);
	}, [form.name, form.genericName, form.notes, validateField]);

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

	const startEdit = useCallback((med: Medication, openEditModal: () => void) => {
		setEditingId(med.id);
		setTakenByInput(""); // Clear tag input when starting edit
		setFormSaved(false);
		const editForm: FormState = {
			name: med.name,
			genericName: med.genericName ?? "",
			takenBy: med.takenBy || [], // Already an array from API
			packCount: String(med.packCount),
			blistersPerPack: String(med.blistersPerPack),
			pillsPerBlister: String(med.pillsPerBlister),
			looseTablets: String(med.looseTablets),
			pillWeightMg: med.pillWeightMg ? String(med.pillWeightMg) : "",
			expiryDate: med.expiryDate ? med.expiryDate.slice(0, 10) : "",
			notes: med.notes ?? "",
			intakeRemindersEnabled: med.intakeRemindersEnabled ?? false,
			blisters: med.blisters.map((s) => ({ 
				usage: String(s.usage), 
				every: String(s.every), 
				startDate: toDateValue(s.start),
				startTime: toTimeValue(s.start)
			})),
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
		setFormSaved(false);
		const newForm = defaultForm();
		setForm(newForm);
		setOriginalForm(newForm);
	}, []);

	const handleValueChange = useCallback(<K extends keyof FormState>(key: K, value: string) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	}, []);

	// Tag input helpers for "Taken By" field
	const addTakenByPerson = useCallback((name: string) => {
		const trimmed = name.trim();
		if (trimmed && trimmed.length <= FIELD_LIMITS.takenBy.max && !form.takenBy.includes(trimmed)) {
			setForm(prev => ({ ...prev, takenBy: [...prev.takenBy, trimmed] }));
		}
		setTakenByInput("");
	}, [form.takenBy]);

	const removeTakenByPerson = useCallback((name: string) => {
		setForm(prev => ({ ...prev, takenBy: prev.takenBy.filter(p => p !== name) }));
	}, []);

	const handleTakenByKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addTakenByPerson(takenByInput);
		} else if (e.key === 'Backspace' && !takenByInput && form.takenBy.length > 0) {
			// Remove last tag on backspace when input is empty
			removeTakenByPerson(form.takenBy[form.takenBy.length - 1]);
		}
	}, [takenByInput, form.takenBy, addTakenByPerson, removeTakenByPerson]);

	return {
		form,
		setForm,
		originalForm,
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
		startEdit,
		resetForm,
		handleValueChange,
		addTakenByPerson,
		removeTakenByPerson,
		handleTakenByKeyDown,
	};
}
