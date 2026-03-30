/* biome-ignore-all lint/a11y/noLabelWithoutControl: form uses custom inputs and display fields wrapped in label-like layout */
/* biome-ignore-all lint/correctness/useExhaustiveDependencies: modal-history callbacks are intentionally managed outside hook deps */
/* biome-ignore-all lint/suspicious/noArrayIndexKey: local draft intake rows do not have stable ids before persistence */
import { Bell, Minus, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { DateInput, FormNumberStepper, MedicationEnrichmentSection, MobileEditModal } from "../components";
import { useAuth } from "../components/Auth";
import { MedicationDialogs } from "../components/medications/MedicationDialogs";
import { MedicationEditCoordinator } from "../components/medications/MedicationEditCoordinator";
import { MedicationListSection } from "../components/medications/MedicationListSection";
import { useAppContext, useUnsavedChanges } from "../context";
import {
	MEDICATION_ENRICHMENT_INITIAL_LIMIT,
	MEDICATION_ENRICHMENT_LIMIT_STEP,
	MEDICATION_ENRICHMENT_MAX_LIMIT,
	useMedicationEnrichmentController,
	useMedicationForm,
	useModalHistory,
	useUnsavedChangesWarning,
} from "../hooks";
import type {
	DoseUnit,
	FormState,
	Medication,
	MedicationEnrichmentEnrichResponse,
	MedicationEnrichmentPackageOption,
	MedicationEnrichmentSearchResponse,
	MedicationEnrichmentSearchResult,
	MedicationEnrichmentStrengthOption,
	PackageType,
} from "../types";
import {
	allowsPillFormSelection,
	DOSE_UNITS,
	FIELD_LIMITS,
	getMedDisplayName,
	getPackageProfile,
	getPackageSize,
	isAmountBasedPackageType,
	isLiquidContainerPackageType,
	isTubePackageType,
	normalizePackageType,
	PACKAGE_PROFILES,
} from "../types";
import { combineDateAndTime, formatNumber } from "../utils/formatters";
import { MAX_IMAGE_UPLOAD_BYTES, resolveImageUploadError } from "../utils/image-upload";
import {
	getIntakeScheduleMode,
	getWeekdayLabel,
	hasSelectedWeekdays,
	toggleWeekdaySelection,
	WEEKDAY_CODES,
} from "../utils/intake-schedule";
import { log } from "../utils/logger";
import { countMedicationEnrichmentDisplayResults } from "../utils/medication-enrichment";

function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

const OBSOLETE_SECTION_STORAGE_KEY = "medicationsShowObsolete";
const OPEN_FDA_PACKAGE_CODE_PATTERN = /\s*\(([0-9A-Z]{4,}(?:-[0-9A-Z]{1,})+)\)\s*/gi;

function normalizeMedicationEnrichmentDoseUnit(unit: MedicationEnrichmentStrengthOption["doseUnit"]): DoseUnit | null {
	if (unit === "IU") return "units";
	if (unit === "mg" || unit === "g" || unit === "mcg" || unit === "ml" || unit === "units") return unit;
	return null;
}

function normalizeMedicationEnrichmentPackageText(value: string): string {
	return value.replace(OPEN_FDA_PACKAGE_CODE_PATTERN, " ").replace(/\s+/g, " ").trim();
}

function hasMatchingMedicationEnrichmentPackageStructure(
	left: MedicationEnrichmentPackageOption,
	right: MedicationEnrichmentPackageOption
): boolean {
	return (
		left.packageType === right.packageType &&
		left.packCount === right.packCount &&
		left.blistersPerPack === right.blistersPerPack &&
		left.pillsPerBlister === right.pillsPerBlister &&
		left.totalPills === right.totalPills &&
		left.looseTablets === right.looseTablets &&
		left.packageAmountValue === right.packageAmountValue &&
		left.packageAmountUnit === right.packageAmountUnit
	);
}

function matchesMedicationEnrichmentPackageOption(
	left: MedicationEnrichmentPackageOption,
	right: MedicationEnrichmentPackageOption
): boolean {
	const leftTexts = [left.label, left.description].map(normalizeMedicationEnrichmentPackageText).filter(Boolean);
	const rightTexts = [right.label, right.description].map(normalizeMedicationEnrichmentPackageText).filter(Boolean);
	const hasMatchingText = leftTexts.some((text) => rightTexts.includes(text));

	return (
		hasMatchingMedicationEnrichmentPackageStructure(left, right) ||
		(hasMatchingText && left.packageType === right.packageType)
	);
}

function applyMedicationEnrichmentSuggestions(
	form: FormState,
	suggestions: MedicationEnrichmentEnrichResponse["suggestions"]
): FormState {
	const nextForm: FormState = {
		...form,
		name: suggestions.name,
		genericName: suggestions.genericName ?? "",
	};

	if (suggestions.medicationForm === "tablet" || suggestions.medicationForm === "capsule") {
		return {
			...nextForm,
			medicationForm: suggestions.medicationForm,
			pillForm: suggestions.medicationForm,
		};
	}

	if (suggestions.medicationForm === "liquid" || suggestions.medicationForm === "topical") {
		return {
			...nextForm,
			medicationForm: suggestions.medicationForm,
		};
	}

	return nextForm;
}

function applyMedicationEnrichmentStrength(
	form: FormState,
	option: MedicationEnrichmentStrengthOption
): FormState | null {
	if (option.pillWeightMg === null) return null;
	const doseUnit = normalizeMedicationEnrichmentDoseUnit(option.doseUnit);
	if (!doseUnit) return null;

	return {
		...form,
		pillWeightMg: `${option.pillWeightMg}`,
		doseUnit,
	};
}

function applyMedicationEnrichmentPackage(form: FormState, option: MedicationEnrichmentPackageOption): FormState {
	const nextForm: FormState = {
		...form,
		packageType: option.packageType,
		packCount: `${option.packCount}`,
		blistersPerPack: option.blistersPerPack !== null ? `${option.blistersPerPack}` : "1",
		pillsPerBlister: option.pillsPerBlister !== null ? `${option.pillsPerBlister}` : "1",
		packageAmountValue: option.packageAmountValue !== null ? `${option.packageAmountValue}` : "",
		packageAmountUnit: option.packageAmountUnit ?? form.packageAmountUnit,
		totalPills: option.totalPills !== null ? `${option.totalPills}` : "",
		looseTablets: option.looseTablets !== null ? `${option.looseTablets}` : "0",
	};

	if (option.packageType === "blister") {
		return {
			...nextForm,
			totalPills: "",
			looseTablets: "0",
		};
	}

	if (option.packageType === "liquid_container") {
		return {
			...nextForm,
			medicationForm: "liquid",
		};
	}

	if (option.packageType === "tube") {
		return {
			...nextForm,
			medicationForm: "topical",
		};
	}

	return nextForm;
}

async function getMedicationEnrichmentErrorMessage(
	response: Response,
	fallback: string,
	unauthorizedFallback: string
): Promise<string> {
	if (response.status === 401) {
		return unauthorizedFallback;
	}

	try {
		const errorBody = (await response.json()) as { error?: string; message?: string };
		if (typeof errorBody?.error === "string" && errorBody.error.trim().length > 0) {
			return errorBody.error;
		}
		if (typeof errorBody?.message === "string" && errorBody.message.trim().length > 0) {
			return errorBody.message;
		}
	} catch {
		// keep translated fallback
	}

	return fallback;
}

export function MedicationsPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const { t } = useTranslation();
	const { user } = useAuth();
	const {
		meds,
		saving,
		setSaving,
		loadMeds,
		deleteMed,
		uploadMedImage,
		deleteMedImage,
		uploadingImage,
		existingPeople,
		coverageByMed,
	} = useAppContext();

	// Use the medication form hook
	const {
		form,
		setForm,
		setOriginalForm,
		editingId,
		setEditingId,
		formSaved,
		setFormSaved,
		formChanged,
		fieldErrors,
		hasValidationErrors,
		takenByInput,
		setTakenByInput,
		addTakenByPerson,
		removeTakenByPerson,
		handleTakenByKeyDown,
		handleValueChange,
		addBlister,
		removeBlister,
		setBlisterValue,
		addIntake,
		removeIntake,
		setIntakeValue,
		resetForm,
		startEdit,
	} = useMedicationForm();

	// Warn user about unsaved changes when navigating away
	useUnsavedChangesWarning(formChanged);

	// View mode: grid (default) or form (edit/new)
	// If navigating in with editMedId, suppress rendering until the edit form is ready
	const [pendingEditTransition, setPendingEditTransition] = useState(() => searchParams.has("editMedId"));
	const [viewMode, setViewMode] = useState<"grid" | "form">(pendingEditTransition ? "form" : "grid");
	const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
	const [activeTab, setActiveTab] = useState<"general" | "stock" | "prescription" | "schedule">("general");

	// Mobile modal state (declared early because it's used in useEffect below)
	const [showEditModal, setShowEditModal] = useState(pendingEditTransition && window.innerWidth <= 768);
	const showEditModalRef = useRef(false);
	useEffect(() => {
		showEditModalRef.current = showEditModal;
	}, [showEditModal]);
	const processedEditMedIdRef = useRef<string | null>(null);
	const hasDesktopFormHistoryState = useRef(false);

	// Sync formChanged state to the global context for navigation blocking
	const { setHasUnsavedChanges } = useUnsavedChanges();
	useEffect(() => {
		setHasUnsavedChanges(formChanged);
		return () => setHasUnsavedChanges(false); // Clear on unmount
	}, [formChanged, setHasUnsavedChanges]);

	// Push history state when form changes to capture browser back button
	const hasUnsavedHistoryState = useRef(false);
	useEffect(() => {
		if (formChanged && !hasUnsavedHistoryState.current && !showEditModal) {
			// Push a history state so we can intercept browser back
			window.history.pushState({ unsavedChanges: true }, "");
			hasUnsavedHistoryState.current = true;
		} else if (!formChanged && hasUnsavedHistoryState.current) {
			// Clean up history state when form is saved/reset
			hasUnsavedHistoryState.current = false;
		}
	}, [formChanged, showEditModal]);

	// Push a history state when desktop form is open so browser back returns to grid view.
	useEffect(() => {
		const isDesktop = window.innerWidth > 768;
		if (isDesktop && viewMode === "form" && !showEditModal && !hasDesktopFormHistoryState.current) {
			window.history.pushState({ desktopForm: true }, "");
			hasDesktopFormHistoryState.current = true;
		}
		if ((viewMode === "grid" || showEditModal) && hasDesktopFormHistoryState.current) {
			hasDesktopFormHistoryState.current = false;
		}
	}, [viewMode, showEditModal]);

	// Image state for new medications
	const [pendingImage, setPendingImage] = useState<File | null>(null);
	const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);
	// Track if close was confirmed programmatically (to avoid double confirmation)
	const closeConfirmedRef = useRef(false);
	// Pending action to execute after user confirms "Leave" in unsaved changes modal
	const pendingActionRef = useRef<(() => void) | null>(null);
	// Confirmation modal for unsaved changes
	const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
	const [unsavedConfirmSource, setUnsavedConfirmSource] = useState<"mobile-edit" | "desktop-form" | null>(null);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [deleteCandidate, setDeleteCandidate] = useState<Medication | null>(null);
	const [showObsoleteConfirm, setShowObsoleteConfirm] = useState(false);
	const [obsoleteCandidate, setObsoleteCandidate] = useState<Medication | null>(null);
	const [allMeds, setAllMeds] = useState<Medication[]>(meds);
	const [imageUploadError, setImageUploadError] = useState<string | null>(null);
	const {
		medicationEnrichment,
		setMedicationEnrichment,
		medicationEnrichmentQueryRef,
		resetMedicationEnrichment,
		handleMedicationEnrichmentQueryChange,
	} = useMedicationEnrichmentController();

	const performMedicationEnrichmentSearch = useCallback(
		async (
			requestedLimit: number,
			preserveExistingResults = false,
			previousVisibleResultCount = countMedicationEnrichmentDisplayResults(medicationEnrichment.results),
			queryOverride?: string
		) => {
			const trimmedQuery = (queryOverride ?? medicationEnrichmentQueryRef.current).trim();
			if (!trimmedQuery) return;
			const limit = Math.min(requestedLimit, MEDICATION_ENRICHMENT_MAX_LIMIT);
			medicationEnrichmentQueryRef.current = trimmedQuery;

			setMedicationEnrichment((previous) => ({
				...previous,
				query: trimmedQuery,
				results: preserveExistingResults ? previous.results : [],
				hasMoreResults: preserveExistingResults ? previous.hasMoreResults : false,
				resultLimit: limit,
				isSearching: true,
				hasSearched: preserveExistingResults ? previous.hasSearched : false,
				searchError: null,
				applyingCode: null,
				applyingPackageLabel: null,
				...(preserveExistingResults
					? {}
					: {
							activeResultCode: null,
							appliedSelection: null,
							enrichError: null,
							meta: null,
							strengthOptions: [],
							packageOptions: [],
							appliedStrengthLabel: null,
							appliedPackageLabel: null,
						}),
			}));

			try {
				const params = new URLSearchParams({ q: trimmedQuery, limit: String(limit) });
				const response = await fetch(`/api/medication-enrichment/search?${params.toString()}`, {
					credentials: "include",
				});

				if (!response.ok) {
					throw new Error(
						await getMedicationEnrichmentErrorMessage(
							response,
							t("form.enrichment.searchError"),
							t("form.enrichment.authRequired")
						)
					);
				}

				const data = (await response.json()) as MedicationEnrichmentSearchResponse;
				const nextResults = Array.isArray(data.results) ? data.results : [];
				const nextVisibleResultCount = countMedicationEnrichmentDisplayResults(nextResults);
				const reachedResultLimitCap = limit >= MEDICATION_ENRICHMENT_MAX_LIMIT;
				const shouldLoadUntilVisibleResultChanges =
					preserveExistingResults &&
					Boolean(data.hasMore) &&
					!reachedResultLimitCap &&
					nextVisibleResultCount <= previousVisibleResultCount;

				if (shouldLoadUntilVisibleResultChanges) {
					await performMedicationEnrichmentSearch(
						Math.min(limit + MEDICATION_ENRICHMENT_LIMIT_STEP, MEDICATION_ENRICHMENT_MAX_LIMIT),
						true,
						previousVisibleResultCount,
						trimmedQuery
					);
					return;
				}

				setMedicationEnrichment((previous) => {
					const loadedAdditionalResults = !preserveExistingResults || nextResults.length > previous.results.length;

					return {
						...previous,
						query: data.query,
						results: nextResults,
						hasMoreResults: Boolean(data.hasMore) && !reachedResultLimitCap && loadedAdditionalResults,
						resultLimit: limit,
						isSearching: false,
						hasSearched: true,
						searchError: null,
					};
				});
				medicationEnrichmentQueryRef.current = data.query;
			} catch (error) {
				const message =
					error instanceof Error && error.message.trim().length > 0 ? error.message : t("form.enrichment.searchError");

				setMedicationEnrichment((previous) => ({
					...previous,
					results: preserveExistingResults ? previous.results : [],
					hasMoreResults: false,
					resultLimit: limit,
					isSearching: false,
					hasSearched: true,
					searchError: message,
				}));
			}
		},
		[medicationEnrichment.query, medicationEnrichment.results, t]
	);

	const handlePendingMedicationImageSelection = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = "";
			if (!file) return;
			if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
				setImageUploadError(t("form.imageUploadErrors.tooLarge"));
				setPendingImage(null);
				setPendingImagePreview(null);
				return;
			}

			setImageUploadError(null);
			setPendingImage(file);
			const reader = new FileReader();
			reader.onload = (ev) => setPendingImagePreview(ev.target?.result as string);
			reader.readAsDataURL(file);
		},
		[t]
	);

	useEffect(() => {
		setImageUploadError(null);
	}, [editingId]);
	const [showObsolete, setShowObsolete] = useState(true);
	const [readOnlyView, setReadOnlyView] = useState(false);
	const [showReportModal, setShowReportModal] = useState(false);
	useModalHistory(showReportModal, "report", () => setShowReportModal(false));
	const [showNameValidation, setShowNameValidation] = useState(false);

	useEffect(() => {
		const saved = localStorage.getItem(userStorageKey(user?.id, OBSOLETE_SECTION_STORAGE_KEY));
		if (saved !== null) {
			setShowObsolete(saved === "true");
		}
	}, [user?.id]);

	const toggleObsoleteSection = useCallback(() => {
		setShowObsolete((prev) => {
			const next = !prev;
			localStorage.setItem(userStorageKey(user?.id, OBSOLETE_SECTION_STORAGE_KEY), String(next));
			return next;
		});
	}, [user?.id]);

	const handleMedicationEnrichmentSearch = useCallback(async () => {
		await performMedicationEnrichmentSearch(
			MEDICATION_ENRICHMENT_INITIAL_LIMIT,
			false,
			countMedicationEnrichmentDisplayResults(medicationEnrichment.results),
			medicationEnrichmentQueryRef.current
		);
	}, [medicationEnrichment.results, performMedicationEnrichmentSearch]);

	const loadAllMeds = useCallback(async () => {
		try {
			const res = await fetch("/api/medications?includeObsolete=true", { credentials: "include" });
			const data = (await res.json()) as unknown;
			setAllMeds(Array.isArray(data) ? (data as Medication[]) : []);
		} catch {
			setAllMeds([]);
		}
	}, []);

	useEffect(() => {
		void loadAllMeds();
	}, [loadAllMeds]);

	const tryUploadMedImage = useCallback(
		async (medId: number, file: File) => {
			setImageUploadError(null);
			if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
				setImageUploadError(t("form.imageUploadErrors.tooLarge"));
				return false;
			}
			try {
				await uploadMedImage(medId, file);
				void loadAllMeds();
				setImageUploadError(null);
				return true;
			} catch (error) {
				const code = error instanceof Error ? error.message : "UNKNOWN";
				setImageUploadError(resolveImageUploadError(code, t));
				return false;
			}
		},
		[t, uploadMedImage, loadAllMeds]
	);

	const handleUploadMedImage = useCallback(
		async (medId: number, file: File) => {
			await tryUploadMedImage(medId, file);
		},
		[tryUploadMedImage]
	);

	const handleDeleteMedImage = useCallback(
		async (medId: number) => {
			await deleteMedImage(medId);
			void loadAllMeds();
		},
		[deleteMedImage, loadAllMeds]
	);

	const applicableMedicationEnrichmentStrengthOptions = useMemo(() => {
		if (!allowsPillFormSelection(form.packageType)) return [];

		return [...medicationEnrichment.strengthOptions]
			.filter(
				(option) => option.pillWeightMg !== null && normalizeMedicationEnrichmentDoseUnit(option.doseUnit) !== null
			)
			.sort((left, right) => {
				const leftWeight = left.pillWeightMg ?? Number.POSITIVE_INFINITY;
				const rightWeight = right.pillWeightMg ?? Number.POSITIVE_INFINITY;
				if (leftWeight !== rightWeight) {
					return leftWeight - rightWeight;
				}
				return left.label.localeCompare(right.label, undefined, { numeric: true });
			});
	}, [form.packageType, medicationEnrichment.strengthOptions]);

	const handleMedicationEnrichmentLoadMore = useCallback(async () => {
		if (
			medicationEnrichment.isSearching ||
			!medicationEnrichment.hasMoreResults ||
			medicationEnrichment.resultLimit >= MEDICATION_ENRICHMENT_MAX_LIMIT
		)
			return;
		await performMedicationEnrichmentSearch(
			Math.min(medicationEnrichment.resultLimit + MEDICATION_ENRICHMENT_LIMIT_STEP, MEDICATION_ENRICHMENT_MAX_LIMIT),
			true
		);
	}, [
		medicationEnrichment.hasMoreResults,
		medicationEnrichment.isSearching,
		medicationEnrichment.resultLimit,
		performMedicationEnrichmentSearch,
	]);

	const handleMedicationEnrichmentApply = useCallback(
		async (result: MedicationEnrichmentSearchResult, preferredPackageOption?: MedicationEnrichmentPackageOption) => {
			setMedicationEnrichment((previous) => ({
				...previous,
				applyingCode: result.code,
				applyingPackageLabel: preferredPackageOption?.label ?? null,
				activeResultCode: result.code,
				enrichError: null,
				appliedSelection: null,
				meta: null,
				strengthOptions: [],
				packageOptions: [],
				appliedStrengthLabel: null,
				appliedPackageLabel: null,
			}));

			try {
				const response = await fetch("/api/medication-enrichment/enrich", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						query: medicationEnrichment.query.trim() || result.name,
						name: result.name,
						genericName: result.genericName ?? null,
						code: result.code,
						source: result.source,
					}),
					credentials: "include",
				});

				if (!response.ok) {
					throw new Error(
						await getMedicationEnrichmentErrorMessage(
							response,
							t("form.enrichment.applyError"),
							t("form.enrichment.authRequired")
						)
					);
				}

				const data = (await response.json()) as MedicationEnrichmentEnrichResponse;
				let nextForm = applyMedicationEnrichmentSuggestions(form, data.suggestions);
				let appliedPackageLabel: string | null = null;
				let appliedStrengthLabel: string | null = null;
				const matchedPreferredPackageOption = preferredPackageOption
					? (data.suggestions.packageOptions.find((option) =>
							matchesMedicationEnrichmentPackageOption(option, preferredPackageOption)
						) ?? null)
					: null;

				if (matchedPreferredPackageOption) {
					nextForm = applyMedicationEnrichmentPackage(nextForm, matchedPreferredPackageOption);
					appliedPackageLabel = matchedPreferredPackageOption.label;
				} else if (data.suggestions.packageOptions.length === 1) {
					nextForm = applyMedicationEnrichmentPackage(nextForm, data.suggestions.packageOptions[0]);
					appliedPackageLabel = data.suggestions.packageOptions[0].label;
				}

				if (allowsPillFormSelection(nextForm.packageType) && data.suggestions.strengthOptions.length === 1) {
					const autoAppliedForm = applyMedicationEnrichmentStrength(nextForm, data.suggestions.strengthOptions[0]);
					if (autoAppliedForm) {
						nextForm = autoAppliedForm;
						appliedStrengthLabel = data.suggestions.strengthOptions[0].label;
					}
				}

				setForm(nextForm);
				setMedicationEnrichment((previous) => ({
					...previous,
					applyingCode: null,
					applyingPackageLabel: null,
					activeResultCode: result.code,
					appliedSelection: data.selection,
					enrichError: null,
					meta: data.meta,
					strengthOptions: data.suggestions.strengthOptions,
					packageOptions: data.suggestions.packageOptions,
					appliedStrengthLabel,
					appliedPackageLabel,
				}));
			} catch (error) {
				const message =
					error instanceof Error && error.message.trim().length > 0 ? error.message : t("form.enrichment.applyError");

				setMedicationEnrichment((previous) => ({
					...previous,
					applyingCode: null,
					applyingPackageLabel: null,
					activeResultCode: null,
					appliedSelection: null,
					enrichError: message,
					meta: null,
					strengthOptions: [],
					packageOptions: [],
					appliedStrengthLabel: null,
					appliedPackageLabel: null,
				}));
			}
		},
		[form, medicationEnrichment.query, setForm, t]
	);

	const handleMedicationEnrichmentStrengthApply = useCallback(
		(option: MedicationEnrichmentStrengthOption) => {
			setForm((currentForm) => {
				const nextForm = applyMedicationEnrichmentStrength(currentForm, option);
				return nextForm ?? currentForm;
			});
			setMedicationEnrichment((previous) => ({
				...previous,
				appliedStrengthLabel: option.label,
			}));
		},
		[setForm]
	);

	const handleMedicationEnrichmentPackageApply = useCallback(
		(option: MedicationEnrichmentPackageOption) => {
			setForm((currentForm) => applyMedicationEnrichmentPackage(currentForm, option));
			setMedicationEnrichment((previous) => ({
				...previous,
				appliedPackageLabel: option.label,
				applyingPackageLabel: null,
				appliedStrengthLabel: null,
			}));
		},
		[setForm]
	);

	const medicationEnrichmentViewModel = useMemo(
		() => ({
			...medicationEnrichment,
			strengthOptions: applicableMedicationEnrichmentStrengthOptions,
		}),
		[applicableMedicationEnrichmentStrengthOptions, medicationEnrichment]
	);

	// Calculate total tablets
	const totalTablets = useMemo(() => {
		if (isAmountBasedPackageType(form.packageType)) {
			// For bottle type, looseTablets is the current stock
			return Number(form.looseTablets) || 0;
		}
		// For blister type
		const packCount = Number(form.packCount) || 0;
		const blistersPerPack = Number(form.blistersPerPack) || 0;
		const pillsPerBlister = Number(form.pillsPerBlister) || 1;
		return packCount * blistersPerPack * pillsPerBlister;
	}, [form.packageType, form.packCount, form.blistersPerPack, form.pillsPerBlister, form.looseTablets]);
	const decrementValueLabel = t("editStock.decreaseValue");
	const incrementValueLabel = t("editStock.increaseValue");

	const dateConsistencyError = useMemo(() => {
		const medicationStartDate = form.medicationStartDate;
		const medicationEndDate = form.medicationEndDate;
		if (medicationStartDate && medicationEndDate && medicationEndDate < medicationStartDate) {
			return t("form.validation.endDateBeforeStart", {
				medicationStartDate,
				medicationEndDate,
			});
		}

		if (!medicationStartDate) return null;

		const conflictingIntake = form.intakes.find((intake) => intake.startDate && intake.startDate < medicationStartDate);
		if (!conflictingIntake?.startDate) return null;

		return t("form.validation.startDateAfterIntake", {
			medicationStartDate,
			intakeDate: conflictingIntake.startDate,
		});
	}, [form.medicationStartDate, form.medicationEndDate, form.intakes, t]);

	const allowFractionalIntake = useMemo(() => {
		if (isLiquidContainerPackageType(form.packageType)) return true;
		if (isTubePackageType(form.packageType)) return form.medicationForm === "liquid";
		return form.pillForm === "tablet";
	}, [form.packageType, form.medicationForm, form.pillForm]);

	const getUsageLabel = useCallback(
		(intakeUnit: "ml" | "tsp" | "tbsp") => {
			if (isLiquidContainerPackageType(form.packageType)) {
				if (intakeUnit === "tsp") return t("form.blisters.usageTsp");
				if (intakeUnit === "tbsp") return t("form.blisters.usageTbsp");
				return t("form.blisters.usageMl");
			}
			if (isTubePackageType(form.packageType)) {
				return form.medicationForm === "liquid" ? t("form.blisters.usageMl") : t("form.blisters.usageApplication");
			}
			if (form.pillForm === "capsule") return t("form.blisters.usageCapsules");
			return t("form.blisters.usageTablets");
		},
		[form.packageType, form.medicationForm, form.pillForm, t]
	);

	const usesAmountLabels = isTubePackageType(form.packageType) || isLiquidContainerPackageType(form.packageType);
	const totalCapacityLabel = usesAmountLabels ? t("form.totalAmount") : t("form.totalCapacity");
	const currentStockLabel = usesAmountLabels ? t("form.currentAmount") : t("form.currentPills");
	const totalLabel = usesAmountLabels ? t("form.totalAmountLabel") : t("form.total");
	const weekdayOptions = useMemo(
		() =>
			WEEKDAY_CODES.map((day) => ({
				value: day,
				shortLabel: getWeekdayLabel(day, t, "short"),
				longLabel: getWeekdayLabel(day, t, "long"),
			})),
		[t]
	);
	const hasWeekdaySelectionError = useCallback(
		(intake: (typeof form.intakes)[number]) =>
			getIntakeScheduleMode(intake) === "weekdays" && !hasSelectedWeekdays(intake.weekdays),
		[]
	);
	const hasWeekdayScheduleError = useMemo(
		() => form.intakes.some((intake) => hasWeekdaySelectionError(intake)),
		[form.intakes, hasWeekdaySelectionError]
	);

	const getMedicationPackageTypeLabel = useCallback(
		(med: Medication) => {
			return t(getPackageProfile(med.packageType).labelKey);
		},
		[t]
	);

	const getMedicationStockSuffix = useCallback(
		(med: Medication) => {
			if (isTubePackageType(med.packageType)) return "";
			if (isLiquidContainerPackageType(med.packageType)) return " ml";
			return ` ${getPackageSize(med) === 1 ? t("common.pill") : t("common.pills")}`;
		},
		[t]
	);

	const getMedicationUsageUnitLabel = useCallback(
		(med: Medication, usage: number) => {
			if (isTubePackageType(med.packageType)) {
				return med.medicationForm === "liquid" ? "ml" : t("form.blisters.usageApplication");
			}
			if (isLiquidContainerPackageType(med.packageType)) return "ml";
			if (usage === 1) return t("common.pill");
			return t("common.pills");
		},
		[t]
	);

	const clearEditMedIdParam = useCallback(() => {
		setSearchParams(
			(prevParams) => {
				if (!prevParams.has("editMedId")) return prevParams;
				const nextParams = new URLSearchParams(prevParams);
				nextParams.delete("editMedId");
				return nextParams;
			},
			{ replace: true }
		);
	}, [setSearchParams]);

	// Open mobile edit modal
	function openEditModal() {
		if (showEditModalRef.current) return;
		showEditModalRef.current = true;
		setShowEditModal(true);
		window.history.pushState({ modal: "edit" }, "");
	}

	// Close mobile edit modal
	function closeEditModal() {
		if (showEditModal) {
			// Check for unsaved changes before closing
			if (formChanged) {
				setUnsavedConfirmSource("mobile-edit");
				setShowUnsavedConfirm(true);
				return;
			}
			clearEditMedIdParam();
			// Mark as confirmed to avoid double confirmation in popstate handler
			closeConfirmedRef.current = true;
			window.history.back();
		}
	}

	// Handle confirmed close (user clicked "Leave" in confirmation modal)
	function handleConfirmClose() {
		const source = unsavedConfirmSource;
		const pendingAction = pendingActionRef.current;
		setShowUnsavedConfirm(false);
		setUnsavedConfirmSource(null);
		pendingActionRef.current = null;
		closeConfirmedRef.current = true;
		hasUnsavedHistoryState.current = false;

		if (pendingAction) {
			// There's a pending action (e.g. switching to another medication) — reset and run it
			resetForm();
			resetMedicationEnrichment();
			setReadOnlyView(false);
			pendingAction();
		} else if (source === "mobile-edit" && showEditModal) {
			clearEditMedIdParam();
			setShowEditModal(false);
			resetForm();
			resetMedicationEnrichment();
			setReadOnlyView(false);
			window.history.back();
		} else {
			// Desktop form — reset and go back to grid
			handleResetForm();
		}
	}

	// Handle cancelled close (user clicked "Stay" in confirmation modal)
	function handleCancelClose() {
		setShowUnsavedConfirm(false);
		pendingActionRef.current = null;
		if (unsavedConfirmSource === "mobile-edit") {
			setShowEditModal(true);
		}
		setUnsavedConfirmSource(null);
	}

	// Helper to reset form and clear history state
	function handleResetForm() {
		hasDesktopFormHistoryState.current = false;
		if (hasUnsavedHistoryState.current) {
			hasUnsavedHistoryState.current = false;
			// Go back to remove the unsaved changes history entry
			window.history.back();
		}
		resetForm();
		resetMedicationEnrichment();
		setShowNameValidation(false);
		setActiveTab("general");
		setReadOnlyView(false);
		setViewMode("grid");
	}

	// Guard for desktop form Back/Cancel — shows unsaved changes modal if needed
	function handleDesktopFormLeave() {
		if (readOnlyView) {
			handleResetForm();
			return;
		}
		if (formChanged) {
			setUnsavedConfirmSource("desktop-form");
			setShowUnsavedConfirm(true);
			return;
		}
		handleResetForm();
	}

	function requestDeleteMed(med: Medication) {
		setDeleteCandidate(med);
		setShowDeleteConfirm(true);
		window.history.pushState({ modal: "delete-confirm" }, "");
	}

	async function handleConfirmDelete() {
		if (!deleteCandidate) return;
		await deleteMed(deleteCandidate.id, editingId, resetForm);
		await loadAllMeds();
		setShowDeleteConfirm(false);
		setDeleteCandidate(null);
		// Pop the delete-confirm history entry
		window.history.back();
	}

	function handleCancelDelete() {
		setShowDeleteConfirm(false);
		setDeleteCandidate(null);
		// Pop the delete-confirm history entry
		window.history.back();
	}

	function requestMarkObsolete(med: Medication) {
		setObsoleteCandidate(med);
		setShowObsoleteConfirm(true);
		window.history.pushState({ modal: "obsolete-confirm" }, "");
	}

	async function handleConfirmMarkObsolete() {
		if (!obsoleteCandidate) return;
		await markMedicationObsolete(obsoleteCandidate.id);
		setShowObsoleteConfirm(false);
		setObsoleteCandidate(null);
		window.history.back();
	}

	function handleCancelMarkObsolete() {
		setShowObsoleteConfirm(false);
		setObsoleteCandidate(null);
		window.history.back();
	}

	async function markMedicationObsolete(id: number) {
		try {
			await fetch(`/api/medications/${id}/obsolete`, { method: "POST", credentials: "include" });
			if (editingId === id) {
				handleResetForm();
			}
			loadMeds();
			await loadAllMeds();
		} catch {
			// ignore
		}
	}

	async function reactivateMedication(id: number) {
		try {
			await fetch(`/api/medications/${id}/reactivate`, { method: "POST", credentials: "include" });
			loadMeds();
			await loadAllMeds();
		} catch {
			// ignore
		}
	}

	// Save medication
	async function saveMedication(e: React.FormEvent) {
		e.preventDefault();
		if (readOnlyView) return;
		if (hasValidationErrors || dateConsistencyError || hasWeekdayScheduleError) {
			setShowNameValidation(true);
			// Scroll to first visible error so the user sees what's wrong
			const firstError = document.querySelector(".field-error");
			if (firstError) {
				firstError.scrollIntoView({ behavior: "smooth", block: "center" });
				// Brief highlight pulse
				firstError.classList.add("error-pulse");
				setTimeout(() => firstError.classList.remove("error-pulse"), 1500);
			}
			return;
		}
		if (saving) return;
		if (form.pillForm === "capsule" && form.intakes.some((i) => !Number.isInteger(Number(i.usage)))) {
			setShowNameValidation(true);
			return;
		}
		setSaving(true);

		// Prepare intakes data with per-intake takenBy
		const intakes = form.intakes.map((intake) => ({
			usage: Number(intake.usage) || 1,
			every: getIntakeScheduleMode(intake) === "weekdays" ? 1 : Number(intake.every) || 1,
			start: combineDateAndTime(intake.startDate, intake.startTime),
			scheduleMode: getIntakeScheduleMode(intake),
			weekdays: getIntakeScheduleMode(intake) === "weekdays" ? [...(intake.weekdays ?? [])] : [],
			intakeUnit: isLiquidContainerPackageType(form.packageType) ? intake.intakeUnit : null,
			takenBy: intake.takenBy.trim() || null, // Empty string becomes null
			intakeRemindersEnabled: intake.intakeRemindersEnabled,
		}));

		// Also prepare legacy blisters for backward compatibility
		const blisters = intakes.map((i) => ({
			usage: i.usage,
			every: i.every,
			start: i.start,
		}));

		const authorizedRefills = Number(form.prescriptionAuthorizedRefills || 0);
		const remainingRefills = Math.min(Number(form.prescriptionRemainingRefills || 0), authorizedRefills);
		const lowRefillThreshold = Math.min(Number(form.prescriptionLowRefillThreshold || 1), authorizedRefills);

		let derivedMedicationForm: string;
		if (isTubePackageType(form.packageType)) {
			derivedMedicationForm =
				form.medicationForm === "liquid" || form.medicationForm === "topical" ? form.medicationForm : "topical";
		} else if (isLiquidContainerPackageType(form.packageType)) {
			derivedMedicationForm = "liquid";
		} else {
			derivedMedicationForm = form.pillForm;
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

		const body = {
			name: form.name.trim(),
			genericName: form.genericName.trim() || null,
			takenBy: form.takenBy.length > 0 ? form.takenBy : [],
			medicationForm: derivedMedicationForm,
			pillForm:
				isTubePackageType(form.packageType) || isLiquidContainerPackageType(form.packageType) ? null : form.pillForm,
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
			expiryDate: form.expiryDate || null,
			notes: form.notes.trim() || null,
			intakeRemindersEnabled: form.intakeRemindersEnabled,
			prescriptionEnabled: form.prescriptionEnabled,
			prescriptionAuthorizedRefills: form.prescriptionEnabled ? authorizedRefills : null,
			prescriptionRemainingRefills: form.prescriptionEnabled ? remainingRefills : null,
			prescriptionLowRefillThreshold: form.prescriptionEnabled ? lowRefillThreshold : 1,
			prescriptionExpiryDate: form.prescriptionExpiryDate || null,
			blisters, // Legacy format for backward compatibility
			intakes, // New format with per-intake takenBy
		};

		try {
			let url = "/api/medications";
			let method = "POST";
			if (editingId) {
				url = `/api/medications/${editingId}`;
				method = "PUT";
			}

			const res = await fetch(url, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				credentials: "include",
			});

			if (!res.ok) {
				let errorMessage = t("common.saveFailed");
				try {
					const errorBody = (await res.json()) as { error?: string; message?: string };
					if (typeof errorBody?.error === "string" && errorBody.error.trim().length > 0) {
						errorMessage = errorBody.error;
					} else if (typeof errorBody?.message === "string" && errorBody.message.trim().length > 0) {
						errorMessage = errorBody.message;
					}
				} catch {
					// keep translated fallback
				}
				throw new Error(errorMessage);
			}

			const saved = await res.json();

			// Upload image if pending (for new medications)
			if (!editingId && pendingImage && saved.id) {
				const uploaded = await tryUploadMedImage(saved.id, pendingImage);
				if (!uploaded) {
					// Keep user in edit mode so upload error stays visible and retry is immediate.
					setEditingId(saved.id);
					setFormSaved(true);
					setOriginalForm(form);
					setPendingImage(null);
					setPendingImagePreview(null);
					loadMeds();
					void loadAllMeds();
					setSaving(false);
					return;
				}
				setPendingImage(null);
				setPendingImagePreview(null);
			}

			setFormSaved(true);
			loadMeds();
			void loadAllMeds();

			// Clean up history state if we had unsaved changes
			if (hasUnsavedHistoryState.current) {
				hasUnsavedHistoryState.current = false;
				// Don't go back here, just clear the flag - the state will be cleaned naturally
			}

			// Reset form after successful save
			if (!editingId) {
				const shouldCloseMobileModal = showEditModal && window.innerWidth <= 768;
				if (shouldCloseMobileModal) {
					// Treat post-save close as confirmed so popstate does not trigger unsaved guards.
					closeConfirmedRef.current = true;
					clearEditMedIdParam();
					setShowEditModal(false);
					setReadOnlyView(false);
					setActiveTab("general");
					setViewMode("grid");
					resetForm();
					resetMedicationEnrichment();
					window.history.back();
					setSaving(false);
					return;
				}
				resetForm();
				resetMedicationEnrichment();
				setViewMode("grid");
			} else {
				// Update originalForm so formChanged becomes false
				setOriginalForm(form);
			}
		} catch (err) {
			log.error("Save error:", err);
			alert(err instanceof Error && err.message ? err.message : t("common.saveFailed"));
		}

		setSaving(false);
	}

	// Handle browser back button for modals and unsaved changes
	useEffect(() => {
		const handlePopState = () => {
			const currentEditMedId = new URLSearchParams(window.location.search).get("editMedId");

			// Obsolete confirmation is open — dismiss it and stay where we are
			if (showObsoleteConfirm) {
				setShowObsoleteConfirm(false);
				setObsoleteCandidate(null);
				return;
			}

			// Delete confirmation is open — dismiss it and stay where we are
			if (showDeleteConfirm) {
				setShowDeleteConfirm(false);
				setDeleteCandidate(null);
				return;
			}

			// If close was already confirmed programmatically, allow navigation
			if (closeConfirmedRef.current) {
				closeConfirmedRef.current = false;
				if (currentEditMedId) {
					// Prevent URL popstate from immediately reopening mobile edit for the same id.
					processedEditMedIdRef.current = currentEditMedId;
					clearEditMedIdParam();
				}
				if (showEditModal) {
					setShowEditModal(false);
					resetForm();
					resetMedicationEnrichment();
				}
				return;
			}

			// Handle mobile edit modal
			if (showEditModal) {
				// Check for unsaved changes (user pressed browser back directly)
				if (formChanged) {
					// Re-push history state to stay in modal
					window.history.pushState({ modal: "edit" }, "");
					// Show confirmation modal
					setUnsavedConfirmSource("mobile-edit");
					setShowUnsavedConfirm(true);
					return;
				}
				if (currentEditMedId) {
					// Mark as handled before URL cleanup to avoid same-tick re-open races.
					processedEditMedIdRef.current = currentEditMedId;
				}
				clearEditMedIdParam();
				setShowEditModal(false);
				resetForm();
				resetMedicationEnrichment();
				return;
			}

			// Handle desktop form: browser back should return to medication overview grid.
			if (viewMode === "form" && hasDesktopFormHistoryState.current) {
				if (formChanged) {
					window.history.pushState({ desktopForm: true }, "");
					setUnsavedConfirmSource("desktop-form");
					setShowUnsavedConfirm(true);
					return;
				}
				hasDesktopFormHistoryState.current = false;
				resetForm();
				resetMedicationEnrichment();
				setShowNameValidation(false);
				setActiveTab("general");
				setReadOnlyView(false);
				setViewMode("grid");
				return;
			}

			// Handle desktop form with unsaved changes
			if (formChanged && hasUnsavedHistoryState.current) {
				// Re-push history state to stay on page
				window.history.pushState({ unsavedChanges: true }, "");
				// Show confirmation modal
				setUnsavedConfirmSource("desktop-form");
				setShowUnsavedConfirm(true);
			}
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, [showObsoleteConfirm, showDeleteConfirm, showEditModal, viewMode, formChanged, resetForm, clearEditMedIdParam]);

	// Close modal on Escape key
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape" && showEditModal) {
				closeEditModal();
			}
		};
		document.addEventListener("keydown", handleEscape);
		return () => document.removeEventListener("keydown", handleEscape);
	}, [showEditModal, closeEditModal]);

	function scrollToTopForDesktopEdit() {
		if (window.innerWidth <= 768) return;
		window.requestAnimationFrame(() => {
			window.scrollTo({ top: 0, behavior: "smooth" });
		});
	}

	const getLatestMedication = useCallback(
		(med: Medication) => meds.find((candidate) => candidate.id === med.id) ?? med,
		[meds]
	);

	function handleEditClick(med: Medication) {
		const latestMedication = getLatestMedication(med);
		if (formChanged) {
			pendingActionRef.current = () => {
				setShowNameValidation(false);
				setReadOnlyView(false);
				resetMedicationEnrichment(latestMedication.name || latestMedication.genericName || "");
				startEdit(latestMedication, openEditModal);
				setViewMode("form");
				scrollToTopForDesktopEdit();
			};
			setUnsavedConfirmSource(showEditModal ? "mobile-edit" : "desktop-form");
			setShowUnsavedConfirm(true);
			return;
		}
		setShowNameValidation(false);
		setReadOnlyView(false);
		setActiveTab("general");
		resetMedicationEnrichment(latestMedication.name || latestMedication.genericName || "");
		startEdit(latestMedication, openEditModal);
		setViewMode("form");
		scrollToTopForDesktopEdit();
	}

	function handleViewClick(med: Medication) {
		const latestMedication = getLatestMedication(med);
		if (formChanged) {
			pendingActionRef.current = () => {
				setShowNameValidation(false);
				setReadOnlyView(true);
				resetMedicationEnrichment(latestMedication.name || latestMedication.genericName || "");
				startEdit(latestMedication, openEditModal);
				setViewMode("form");
				scrollToTopForDesktopEdit();
			};
			setUnsavedConfirmSource(showEditModal ? "mobile-edit" : "desktop-form");
			setShowUnsavedConfirm(true);
			return;
		}
		setShowNameValidation(false);
		setReadOnlyView(true);
		setActiveTab("general");
		resetMedicationEnrichment(latestMedication.name || latestMedication.genericName || "");
		startEdit(latestMedication, openEditModal);
		setViewMode("form");
		scrollToTopForDesktopEdit();
	}

	function handleNewEntryClick() {
		if (formChanged) {
			pendingActionRef.current = () => {
				resetForm();
				resetMedicationEnrichment();
				setShowNameValidation(false);
				setReadOnlyView(false);
				if (window.innerWidth <= 768) {
					openEditModal();
				} else {
					setViewMode("form");
				}
			};
			setUnsavedConfirmSource(showEditModal ? "mobile-edit" : "desktop-form");
			setShowUnsavedConfirm(true);
			return;
		}
		resetForm();
		resetMedicationEnrichment();
		setShowNameValidation(false);
		setReadOnlyView(false);
		if (window.innerWidth <= 768) {
			openEditModal();
		} else {
			setViewMode("form");
		}
	}

	const activeMeds = useMemo(() => allMeds.filter((med) => !med.isObsolete), [allMeds]);
	const obsoleteMeds = useMemo(() => allMeds.filter((med) => med.isObsolete), [allMeds]);

	const orderedMeds = useMemo(() => {
		if (!editingId) {
			return activeMeds;
		}

		const selectedMedication = activeMeds.find((med) => med.id === editingId);
		if (!selectedMedication) {
			return activeMeds;
		}

		return [selectedMedication, ...activeMeds.filter((med) => med.id !== editingId)];
	}, [activeMeds, editingId]);

	useEffect(() => {
		const editMedId = searchParams.get("editMedId");
		if (!editMedId) {
			processedEditMedIdRef.current = null;
			return;
		}
		if (processedEditMedIdRef.current === editMedId) return;
		const parsedMedId = Number.parseInt(editMedId, 10);
		if (Number.isNaN(parsedMedId)) return;
		const medicationToEdit =
			meds.find((med) => med.id === parsedMedId) ?? allMeds.find((med) => med.id === parsedMedId);
		if (!medicationToEdit) return;

		processedEditMedIdRef.current = editMedId;

		setShowNameValidation(false);
		setReadOnlyView(false);
		setActiveTab("general");
		resetMedicationEnrichment(medicationToEdit.name || medicationToEdit.genericName || "");
		startEdit(medicationToEdit, openEditModal);
		setViewMode("form");
		scrollToTopForDesktopEdit();
		setPendingEditTransition(false);
		window.dispatchEvent(new Event("medassist:edit-transition-ready"));

		const nextParams = new URLSearchParams(searchParams);
		nextParams.delete("editMedId");
		setSearchParams(nextParams, { replace: true });
	}, [allMeds, meds, openEditModal, searchParams, setSearchParams, startEdit]);

	const selectedMedication = useMemo(() => {
		if (!editingId) return null;
		return allMeds.find((med) => med.id === editingId) ?? null;
	}, [allMeds, editingId]);

	// While navigating from detail modal to edit, render nothing until form is populated
	if (pendingEditTransition) {
		return null;
	}

	return (
		<section className={`med-grid-wrapper${viewMode === "form" ? " desktop-edit-open" : ""}`}>
			<MedicationListSection
				orderedMeds={orderedMeds}
				obsoleteMeds={obsoleteMeds}
				editingId={editingId}
				showObsolete={showObsolete}
				coverageByMed={coverageByMed}
				onNewEntry={handleNewEntryClick}
				onOpenReport={() => setShowReportModal(true)}
				onEdit={handleEditClick}
				onView={handleViewClick}
				onMarkObsolete={requestMarkObsolete}
				onDelete={requestDeleteMed}
				onReactivate={reactivateMedication}
				onToggleObsolete={toggleObsoleteSection}
				onImagePreview={(med) => setLightboxImage({ src: `/api/images/${med.imageUrl}`, alt: getMedDisplayName(med) })}
				getMedicationPackageTypeLabel={getMedicationPackageTypeLabel}
				getMedicationStockSuffix={getMedicationStockSuffix}
				getMedicationUsageUnitLabel={getMedicationUsageUnitLabel}
			/>

			{/* ── Desktop Edit Panel: inline below medication list ── */}
			<MedicationEditCoordinator
				viewMode={viewMode}
				editingId={editingId}
				readOnlyView={readOnlyView}
				selectedMedicationName={selectedMedication?.name}
				onBack={handleDesktopFormLeave}
				onSubmit={saveMedication}
			>
				<div className="full form-tabs" role="tablist" aria-label={t("form.sections.general")}>
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === "general"}
						className={`form-tab${activeTab === "general" ? " active" : ""}`}
						onClick={() => setActiveTab("general")}
					>
						{t("form.sections.general")}
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === "stock"}
						className={`form-tab${activeTab === "stock" ? " active" : ""}`}
						onClick={() => setActiveTab("stock")}
					>
						{t("form.sections.stock")}
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === "schedule"}
						className={`form-tab${activeTab === "schedule" ? " active" : ""}`}
						onClick={() => setActiveTab("schedule")}
					>
						{t("form.sections.schedule")}
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === "prescription"}
						className={`form-tab${activeTab === "prescription" ? " active" : ""}`}
						onClick={() => setActiveTab("prescription")}
					>
						{t("form.sections.prescription")}
					</button>
				</div>
				<fieldset className="readonly-fieldset" disabled={readOnlyView}>
					<div className={`form-tab-panel${activeTab === "general" ? " active" : ""}`}>
						<div className="full form-category">
							<h4 className="form-category-title">{t("form.sections.general")}</h4>
							<label className={!readOnlyView && showNameValidation && fieldErrors.name ? "has-error" : ""}>
								{t("form.commercialName")}
								<input
									value={form.name}
									onChange={(e) => {
										setShowNameValidation(true);
										setForm({ ...form, name: e.target.value });
									}}
									onBlur={() => setShowNameValidation(true)}
									placeholder={t("form.placeholders.commercial")}
									maxLength={FIELD_LIMITS.name.max}
								/>
								{!readOnlyView && showNameValidation && fieldErrors.name && (
									<span className="field-error">{fieldErrors.name}</span>
								)}
							</label>
							<label className={!readOnlyView && showNameValidation && fieldErrors.genericName ? "has-error" : ""}>
								{t("form.genericName")}
								<input
									value={form.genericName}
									onChange={(e) => {
										setShowNameValidation(true);
										setForm({ ...form, genericName: e.target.value });
									}}
									onBlur={() => setShowNameValidation(true)}
									placeholder={t("form.placeholders.generic")}
									maxLength={FIELD_LIMITS.genericName.max}
								/>
								{!readOnlyView && showNameValidation && fieldErrors.genericName && (
									<span className="field-error">{fieldErrors.genericName}</span>
								)}
							</label>
							<MedicationEnrichmentSection
								state={medicationEnrichmentViewModel}
								onQueryChange={handleMedicationEnrichmentQueryChange}
								onSearch={handleMedicationEnrichmentSearch}
								onLoadMoreResults={handleMedicationEnrichmentLoadMore}
								onApplyResult={handleMedicationEnrichmentApply}
								onApplyStrength={handleMedicationEnrichmentStrengthApply}
								onApplyPackage={handleMedicationEnrichmentPackageApply}
							/>
							<div className="full date-pair-group">
								<label className="date-pair-field">
									{t("form.medicationStartDate")}
									<DateInput
										value={form.medicationStartDate}
										onChange={(e) => handleValueChange("medicationStartDate", e.target.value)}
										placeholder={t("common.optional")}
									/>
									{!readOnlyView && dateConsistencyError && <span className="field-error">{dateConsistencyError}</span>}
								</label>
								<label className="date-pair-field">
									{t("form.medicationEndDate")}
									<DateInput
										value={form.medicationEndDate}
										onChange={(e) => handleValueChange("medicationEndDate", e.target.value)}
										placeholder={t("common.optional")}
									/>
								</label>
							</div>
							<label>
								{t("form.packageType")}
								<select
									className="select-field package-type-select"
									value={form.packageType}
									onChange={(e) => handleValueChange("packageType", e.target.value as PackageType)}
								>
									{PACKAGE_PROFILES.map((profile) => (
										<option key={profile.value} value={profile.value}>
											{t(profile.labelKey)}
										</option>
									))}
								</select>
							</label>
							{allowsPillFormSelection(form.packageType) && (
								<label>
									{t("form.pillForm")}
									<select
										className="select-field"
										value={form.pillForm}
										onChange={(e) => handleValueChange("pillForm", e.target.value as FormState["pillForm"])}
									>
										<option value="tablet">{t("form.medicationFormTablet")}</option>
										<option value="capsule">{t("form.medicationFormCapsule")}</option>
									</select>
								</label>
							)}
							{isTubePackageType(form.packageType) && (
								<label>
									{t("form.medicationForm")}
									<select
										className="select-field"
										value={"topical"}
										onChange={() => handleValueChange("medicationForm", "topical")}
									>
										<option value="topical">{t("form.medicationFormTopical")}</option>
									</select>
								</label>
							)}
							{isLiquidContainerPackageType(form.packageType) && (
								<label>
									{t("form.medicationForm")}
									<select
										className="select-field"
										value={"liquid"}
										onChange={() => handleValueChange("medicationForm", "liquid")}
									>
										<option value="liquid">{t("form.medicationFormLiquid")}</option>
									</select>
								</label>
							)}
							{form.medicationEndDate && (
								<label className="full">
									{t("form.autoMarkObsoleteAfterEndDate")}
									<label className="toggle-switch small">
										<input
											type="checkbox"
											checked={form.autoMarkObsoleteAfterEndDate}
											onChange={(e) => handleValueChange("autoMarkObsoleteAfterEndDate", e.target.checked)}
										/>
										<span className="toggle-slider"></span>
									</label>
								</label>
							)}
							<label className={`full ${fieldErrors.takenBy ? "has-error" : ""}`}>
								{t("form.takenBy")}
								<div className="tag-input-container">
									{form.takenBy.map((person) => (
										<span key={person} className="tag">
											{person}
											{!readOnlyView && (
												<button type="button" className="tag-remove" onClick={() => removeTakenByPerson(person)}>
													×
												</button>
											)}
										</span>
									))}
									{!readOnlyView && (
										<>
											<input
												value={takenByInput}
												onChange={(e) => setTakenByInput(e.target.value)}
												onKeyDown={handleTakenByKeyDown}
												onBlur={() => {
													if (takenByInput.trim()) addTakenByPerson(takenByInput);
												}}
												placeholder={
													form.takenBy.length === 0 ? t("form.placeholders.takenBy") : t("form.placeholders.addPerson")
												}
												maxLength={FIELD_LIMITS.takenBy.max}
												list="takenby-suggestions"
											/>
											<datalist id="takenby-suggestions">
												{existingPeople
													.filter((p) => !form.takenBy.includes(p))
													.map((person) => (
														<option key={person} value={person} />
													))}
											</datalist>
										</>
									)}
								</div>
								{fieldErrors.takenBy && <span className="field-error">{fieldErrors.takenBy}</span>}
							</label>
						</div>

						<div className="full form-category image-section">
							<h4 className="form-category-title">{t("form.medicationImage")}</h4>
							{(() => {
								if (editingId) {
									const currentMed = meds.find((m) => m.id === editingId);
									if (currentMed?.imageUrl) {
										return (
											<div className="image-preview">
												<img src={`/api/images/${currentMed.imageUrl}`} alt={currentMed.name} />
												<button
													type="button"
													className="danger icon-only tooltip-trigger"
													onClick={() => handleDeleteMedImage(editingId)}
													aria-label={t("form.removeImage")}
													data-tooltip={t("form.removeImage")}
												>
													<Trash2 size={18} aria-hidden="true" />
												</button>
											</div>
										);
									}
									return (
										<input
											type="file"
											accept="image/jpeg,image/png,image/webp,image/gif"
											onChange={(e) => {
												const file = e.target.files?.[0];
												e.target.value = "";
												if (file) void tryUploadMedImage(editingId, file);
											}}
											disabled={uploadingImage}
										/>
									);
								}
								if (pendingImagePreview) {
									return (
										<div className="image-preview">
											<img src={pendingImagePreview} alt="Preview" />
											<button
												type="button"
												className="danger icon-only tooltip-trigger"
												onClick={() => {
													setPendingImage(null);
													setPendingImagePreview(null);
												}}
												aria-label={t("form.removeImage")}
												data-tooltip={t("form.removeImage")}
											>
												<Trash2 size={18} aria-hidden="true" />
											</button>
										</div>
									);
								}
								return (
									<input
										type="file"
										accept="image/jpeg,image/png,image/webp,image/gif"
										onChange={handlePendingMedicationImageSelection}
									/>
								);
							})()}
							{imageUploadError && <span className="field-error">{imageUploadError}</span>}
						</div>
					</div>
					{/* end general tab */}

					<div className={`form-tab-panel${activeTab === "stock" ? " active" : ""}`}>
						<div className="full form-category">
							<h4 className="form-category-title">{t("form.sections.stock")}</h4>
							{(() => {
								if (!isAmountBasedPackageType(form.packageType)) {
									return (
										<>
											<label>
												{t("form.packs")}
												<FormNumberStepper
													value={form.packCount}
													onChange={(nextValue) => handleValueChange("packCount", nextValue)}
													min={0}
													decrementLabel={decrementValueLabel}
													incrementLabel={incrementValueLabel}
												/>
											</label>
											<label>
												{t("form.blistersPerPack")}
												<FormNumberStepper
													value={form.blistersPerPack}
													onChange={(nextValue) => handleValueChange("blistersPerPack", nextValue)}
													min={1}
													decrementLabel={decrementValueLabel}
													incrementLabel={incrementValueLabel}
												/>
											</label>
											<label>
												{t("form.pillsPerBlister")}
												<FormNumberStepper
													value={form.pillsPerBlister}
													onChange={(nextValue) => handleValueChange("pillsPerBlister", nextValue)}
													min={1}
													decrementLabel={decrementValueLabel}
													incrementLabel={incrementValueLabel}
												/>
											</label>
											<label>
												{t("form.total")}
												<div className="static-value">{formatNumber(totalTablets)}</div>
											</label>
										</>
									);
								}

								if (isTubePackageType(form.packageType)) {
									return (
										<>
											<label>
												{t("form.tubes")}
												<FormNumberStepper
													value={form.packCount}
													onChange={(nextValue) => handleValueChange("packCount", nextValue)}
													min={1}
													decrementLabel={decrementValueLabel}
													incrementLabel={incrementValueLabel}
												/>
											</label>
											<label className="full">
												{t("form.packageAmountPerTube")}
												<div className="dose-input-group">
													<input
														type="text"
														inputMode="decimal"
														pattern="[0-9]*\.?[0-9]*"
														value={form.packageAmountValue ?? "0"}
														onChange={(e) => handleValueChange("packageAmountValue", e.target.value)}
														placeholder="0"
													/>
													<select
														value="g"
														disabled
														className="select-field dose-unit-select"
														aria-label={t("form.packageAmountUnitG")}
													>
														<option value="g">{t("form.packageAmountUnitG")}</option>
													</select>
												</div>
											</label>
											<label>
												{t("form.totalAmount")}
												<div className="static-value">
													{formatNumber((Number(form.packCount) || 0) * (Number(form.packageAmountValue ?? 0) || 0))}
													{t("form.packageAmountUnitG")}
												</div>
											</label>
										</>
									);
								}

								return (
									<>
										<label>
											{totalCapacityLabel}
											<FormNumberStepper
												value={form.totalPills}
												onChange={(nextValue) => handleValueChange("totalPills", nextValue)}
												min={0}
												decrementLabel={decrementValueLabel}
												incrementLabel={incrementValueLabel}
											/>
										</label>
										<label>
											{currentStockLabel}
											<FormNumberStepper
												value={form.looseTablets}
												onChange={(nextValue) => handleValueChange("looseTablets", nextValue)}
												min={0}
												decrementLabel={decrementValueLabel}
												incrementLabel={incrementValueLabel}
											/>
										</label>
									</>
								);
							})()}
							{allowsPillFormSelection(form.packageType) && (
								<label className="full">
									{t("form.pillWeight")} ({form.doseUnit})
									<div className="dose-input-group">
										<input
											type="text"
											inputMode="decimal"
											pattern="[0-9]*\.?[0-9]*"
											value={form.pillWeightMg}
											onChange={(e) => handleValueChange("pillWeightMg", e.target.value)}
											placeholder={t("form.placeholders.weight")}
										/>
										<select
											value={form.doseUnit}
											onChange={(e) => handleValueChange("doseUnit", e.target.value as DoseUnit)}
											className="select-field dose-unit-select"
										>
											{DOSE_UNITS.map((unit) => (
												<option key={unit.value} value={unit.value}>
													{unit.label}
												</option>
											))}
										</select>
									</div>
								</label>
							)}
							{isAmountBasedPackageType(form.packageType) && !isTubePackageType(form.packageType) && (
								<div className="full stock-total-row">
									<label className="stock-total-field">
										{totalLabel}
										<div className="static-value">{formatNumber(totalTablets)}</div>
									</label>
								</div>
							)}
							{isLiquidContainerPackageType(form.packageType) && (
								<label className="full">
									{t("form.packageAmount")}
									<div className="dose-input-group">
										<input
											type="text"
											inputMode="decimal"
											pattern="[0-9]*\.?[0-9]*"
											value={form.packageAmountValue ?? "0"}
											onChange={(e) => handleValueChange("packageAmountValue", e.target.value)}
											placeholder="0"
										/>
										<select
											value="ml"
											disabled
											className="select-field dose-unit-select"
											aria-label={t("form.packageAmountUnitMl")}
										>
											<option value="ml">{t("form.packageAmountUnitMl")}</option>
										</select>
									</div>
								</label>
							)}
							<label>
								{t("form.expiryDate")}
								<DateInput
									value={form.expiryDate}
									onChange={(e) => handleValueChange("expiryDate", e.target.value)}
									placeholder={t("common.optional")}
								/>
							</label>
							<label className={`full ${fieldErrors.notes ? "has-error" : ""}`}>
								{t("form.notes")}
								<textarea
									value={form.notes}
									onChange={(e) => handleValueChange("notes", e.target.value)}
									placeholder={t("form.placeholders.notes")}
									rows={2}
									maxLength={FIELD_LIMITS.notes.max}
									className="auto-resize"
									onInput={(e) => {
										const t = e.target as HTMLTextAreaElement;
										t.style.height = "auto";
										t.style.height = `${t.scrollHeight}px`;
									}}
								/>
								{form.notes.length > 0 && (
									<span className={`char-count ${form.notes.length > FIELD_LIMITS.notes.max * 0.9 ? "warning" : ""}`}>
										{t("common.validation.tooLong", { current: form.notes.length, max: FIELD_LIMITS.notes.max })}
									</span>
								)}
								{fieldErrors.notes && <span className="field-error">{fieldErrors.notes}</span>}
							</label>
						</div>
					</div>
					{/* end stock tab */}

					<div className={`form-tab-panel${activeTab === "prescription" ? " active" : ""}`}>
						<div className="full form-category">
							<h4 className="form-category-title">{t("form.sections.prescription")}</h4>
							<label className="full">
								{t("prescription.enabled")}
								<label className="toggle-switch small">
									<input
										type="checkbox"
										checked={form.prescriptionEnabled}
										onChange={(e) => handleValueChange("prescriptionEnabled", e.target.checked)}
									/>
									<span className="toggle-slider"></span>
								</label>
							</label>
							{form.prescriptionEnabled && (
								<>
									<label className="prescription-field">
										{t("prescription.authorizedRefills")}
										<FormNumberStepper
											value={form.prescriptionAuthorizedRefills}
											onChange={(nextValue) => handleValueChange("prescriptionAuthorizedRefills", nextValue)}
											min={0}
											decrementLabel={decrementValueLabel}
											incrementLabel={incrementValueLabel}
										/>
									</label>
									<label className="prescription-field">
										{t("prescription.remainingRefills")}
										<FormNumberStepper
											value={form.prescriptionRemainingRefills}
											onChange={(nextValue) => handleValueChange("prescriptionRemainingRefills", nextValue)}
											min={0}
											decrementLabel={decrementValueLabel}
											incrementLabel={incrementValueLabel}
										/>
									</label>
									<label className="prescription-field">
										{t("prescription.lowThreshold")}
										<FormNumberStepper
											value={form.prescriptionLowRefillThreshold}
											onChange={(nextValue) => handleValueChange("prescriptionLowRefillThreshold", nextValue)}
											min={0}
											decrementLabel={decrementValueLabel}
											incrementLabel={incrementValueLabel}
										/>
									</label>
									<label className="prescription-field">
										{t("prescription.expiryDate")}
										<DateInput
											value={form.prescriptionExpiryDate}
											onChange={(e) => handleValueChange("prescriptionExpiryDate", e.target.value)}
										/>
									</label>
								</>
							)}
						</div>
					</div>
					{/* end prescription tab */}

					<div className={`form-tab-panel${activeTab === "schedule" ? " active" : ""}`}>
						<div className="full form-category intake-section">
							<div className="form-category-header">
								<h4 className="form-category-title">{t("form.blisters.title")}</h4>
								{!readOnlyView && (
									<button
										type="button"
										className="primary icon-only tooltip-trigger"
										onClick={() => addIntake(form.takenBy.length === 1 ? form.takenBy[0] : undefined)}
										aria-label={t("form.blisters.addIntake")}
										data-tooltip={t("form.blisters.addIntake")}
									>
										<Plus size={18} aria-hidden="true" />
									</button>
								)}
							</div>
							{form.intakes.map((intake, idx) => {
								const scheduleMode = getIntakeScheduleMode(intake);
								const selectedWeekdays = intake.weekdays ?? [];
								return (
									<div key={idx} className="blister-row">
										<div className="blister-inputs">
											<label>
												{getUsageLabel(intake.intakeUnit ?? "ml")}
												<FormNumberStepper
													value={intake.usage}
													onChange={(nextValue) => setIntakeValue(idx, "usage", nextValue)}
													min={allowFractionalIntake ? 0.5 : 1}
													step={allowFractionalIntake ? 0.5 : 1}
													allowDecimal={allowFractionalIntake}
													decrementLabel={decrementValueLabel}
													incrementLabel={incrementValueLabel}
												/>
											</label>
											<label>
												{t("form.blisters.scheduleMode")}
												<select
													className="select-field"
													value={scheduleMode}
													onChange={(e) =>
														setIntakeValue(idx, "scheduleMode", e.target.value as "interval" | "weekdays")
													}
												>
													<option value="interval">{t("form.blisters.scheduleModeInterval")}</option>
													<option value="weekdays">{t("form.blisters.scheduleModeWeekdays")}</option>
												</select>
											</label>
											{scheduleMode === "interval" ? (
												<label>
													{t("form.blisters.everyDays")}
													<FormNumberStepper
														value={intake.every}
														onChange={(nextValue) => setIntakeValue(idx, "every", nextValue)}
														min={1}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
											) : (
												<label className="taken-by-field">
													{t("form.blisters.weekdays")}
													<div className="badges">
														{weekdayOptions.map((weekday) => {
															const isSelected = selectedWeekdays.includes(weekday.value);
															return (
																<button
																	key={weekday.value}
																	type="button"
																	className={isSelected ? "pill clickable" : "pill clickable neutral"}
																	aria-pressed={isSelected}
																	title={weekday.longLabel}
																	onClick={() =>
																		setIntakeValue(
																			idx,
																			"weekdays",
																			toggleWeekdaySelection(selectedWeekdays, weekday.value)
																		)
																	}
																>
																	{weekday.shortLabel}
																</button>
															);
														})}
													</div>
													{!readOnlyView && hasWeekdaySelectionError(intake) && (
														<span className="field-error">{t("form.blisters.weekdaysRequired")}</span>
													)}
												</label>
											)}
											<label>
												{t("form.blisters.startDate")}
												<DateInput
													value={intake.startDate}
													onChange={(e) => setIntakeValue(idx, "startDate", e.target.value)}
												/>
											</label>
											<label>
												{t("form.blisters.startTime")}
												<input
													type="time"
													value={intake.startTime}
													onChange={(e) => setIntakeValue(idx, "startTime", e.target.value)}
												/>
											</label>
											{isLiquidContainerPackageType(form.packageType) && (
												<label>
													{t("form.blisters.intakeUnit")}
													<select
														className="select-field"
														value={intake.intakeUnit}
														onChange={(e) => setIntakeValue(idx, "intakeUnit", e.target.value as "ml" | "tsp" | "tbsp")}
													>
														<option value="ml">{t("form.blisters.intakeUnitMl")}</option>
														<option value="tsp">{t("form.blisters.intakeUnitTsp")}</option>
														<option value="tbsp">{t("form.blisters.intakeUnitTbsp")}</option>
													</select>
												</label>
											)}
											{form.takenBy.length === 0 ? null : (
												<label className="taken-by-field" title={t("form.blisters.takenByTooltip")}>
													{t("form.blisters.takenByIntake")}
													<select
														className="select-field"
														value={intake.takenBy}
														onChange={(e) => setIntakeValue(idx, "takenBy", e.target.value)}
													>
														{form.takenBy.map((person) => (
															<option key={person} value={person}>
																{person}
															</option>
														))}
													</select>
												</label>
											)}
											<div className="remind-toggle-row" title={t("form.blisters.remindTooltip")}>
												<span className="blister-reminder-icon">
													<Bell size={14} aria-hidden="true" />
												</span>
												<label className="toggle-switch small">
													<input
														type="checkbox"
														checked={intake.intakeRemindersEnabled}
														onChange={(e) => setIntakeValue(idx, "intakeRemindersEnabled", e.target.checked)}
													/>
													<span className="toggle-slider"></span>
												</label>
											</div>
										</div>
										{!readOnlyView && form.intakes.length > 1 && (
											<button
												type="button"
												className="danger icon-only tooltip-trigger"
												onClick={() => removeIntake(idx)}
												aria-label={t("common.remove")}
												data-tooltip={t("common.remove")}
											>
												<Minus size={18} aria-hidden="true" />
											</button>
										)}
									</div>
								);
							})}
						</div>
					</div>
					{/* end schedule tab */}
				</fieldset>
				<div className="full align-end gap">
					<button type="button" className="ghost" onClick={handleDesktopFormLeave}>
						{readOnlyView || (formSaved && !formChanged) ? t("common.close") : t("common.cancel")}
					</button>
					{!readOnlyView && (
						<button
							type="submit"
							disabled={saving || (!formChanged && (formSaved || !!editingId))}
							className={
								hasValidationErrors || dateConsistencyError || hasWeekdayScheduleError ? "has-validation-error" : ""
							}
						>
							{formSaved && !formChanged ? t("common.saved") : t("common.save")}
						</button>
					)}
				</div>
			</MedicationEditCoordinator>

			<MedicationDialogs
				mobileEditModal={
					<MobileEditModal
						show={showEditModal}
						editingId={editingId}
						form={form}
						onFormChange={setForm}
						medicationEnrichment={medicationEnrichmentViewModel}
						onMedicationEnrichmentQueryChange={handleMedicationEnrichmentQueryChange}
						onMedicationEnrichmentSearch={handleMedicationEnrichmentSearch}
						onMedicationEnrichmentLoadMore={handleMedicationEnrichmentLoadMore}
						onMedicationEnrichmentApply={handleMedicationEnrichmentApply}
						onMedicationEnrichmentStrengthApply={handleMedicationEnrichmentStrengthApply}
						onMedicationEnrichmentPackageApply={handleMedicationEnrichmentPackageApply}
						fieldErrors={fieldErrors}
						saving={saving}
						formSaved={formSaved}
						formChanged={formChanged}
						hasValidationErrors={hasValidationErrors}
						dateConsistencyError={dateConsistencyError}
						readOnlyMode={readOnlyView}
						takenByInput={takenByInput}
						onTakenByInputChange={setTakenByInput}
						existingPeople={existingPeople}
						onAddTakenByPerson={addTakenByPerson}
						onRemoveTakenByPerson={removeTakenByPerson}
						onTakenByKeyDown={handleTakenByKeyDown}
						onSetBlisterValue={setBlisterValue}
						onAddBlister={addBlister}
						onRemoveBlister={removeBlister}
						onSetIntakeValue={setIntakeValue}
						onAddIntake={addIntake}
						onRemoveIntake={removeIntake}
						onHandleValueChange={handleValueChange}
						meds={allMeds}
						onUploadMedImage={handleUploadMedImage}
						onDeleteMedImage={handleDeleteMedImage}
						imageUploadError={imageUploadError}
						onClose={closeEditModal}
						onResetForm={handleResetForm}
						onSaveMedication={saveMedication}
					/>
				}
				showUnsavedConfirm={showUnsavedConfirm}
				unsavedTitle={t("common.unsavedChanges.title", "Unsaved Changes")}
				unsavedMessage={t("common.unsavedChanges.message")}
				unsavedConfirmLabel={t("common.unsavedChanges.leave", "Leave")}
				unsavedCancelLabel={
					unsavedConfirmSource === "mobile-edit" ? t("common.back") : t("common.unsavedChanges.stay", "Stay")
				}
				onConfirmClose={handleConfirmClose}
				onCancelClose={handleCancelClose}
				showObsoleteConfirm={showObsoleteConfirm}
				obsoleteCandidate={obsoleteCandidate}
				obsoleteTitle={t("medications.obsoleteModal.title")}
				obsoleteMessage={t("medications.obsoleteModal.message", { name: obsoleteCandidate?.name ?? "" })}
				obsoleteConfirmLabel={t("medications.list.markObsolete")}
				obsoleteCancelLabel={t("common.cancel")}
				onConfirmMarkObsolete={handleConfirmMarkObsolete}
				onCancelMarkObsolete={handleCancelMarkObsolete}
				showDeleteConfirm={showDeleteConfirm}
				deleteCandidate={deleteCandidate}
				deleteTitle={t("medications.deleteModal.title")}
				deleteMessage={t("medications.deleteModal.message", { name: deleteCandidate?.name ?? "" })}
				deleteConfirmLabel={t("common.delete")}
				deleteCancelLabel={t("common.cancel")}
				onConfirmDelete={handleConfirmDelete}
				onCancelDelete={handleCancelDelete}
				showEditModal={showEditModal}
				lightboxImage={lightboxImage}
				onCloseLightbox={() => setLightboxImage(null)}
				showReportModal={showReportModal}
				onCloseReportModal={() => setShowReportModal(false)}
				medications={allMeds}
			/>
		</section>
	);
}
