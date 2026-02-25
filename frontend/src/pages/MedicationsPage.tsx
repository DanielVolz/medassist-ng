/* biome-ignore-all lint/a11y/noLabelWithoutControl: form uses custom inputs and display fields wrapped in label-like layout */
/* biome-ignore-all lint/correctness/useExhaustiveDependencies: modal-history callbacks are intentionally managed outside hook deps */
/* biome-ignore-all lint/suspicious/noArrayIndexKey: local draft intake rows do not have stable ids before persistence */
import { Bell, Eye, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
	ConfirmModal,
	DateInput,
	FormNumberStepper,
	Lightbox,
	MedicationAvatar,
	MobileEditModal,
	ReportModal,
} from "../components";
import { useAuth } from "../components/Auth";
import { useAppContext, useUnsavedChanges } from "../context";
import { useMedicationForm, useModalHistory, useUnsavedChangesWarning } from "../hooks";
import type { DoseUnit, Medication } from "../types";
import { DOSE_UNITS, FIELD_LIMITS, getPackageSize, getMedDisplayName } from "../types";
import { combineDateAndTime, formatDate, formatDateTime, formatNumber } from "../utils/formatters";
import { MAX_IMAGE_UPLOAD_BYTES, resolveImageUploadError } from "../utils/image-upload";
import { log } from "../utils/logger";

function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

const OBSOLETE_SECTION_STORAGE_KEY = "medicationsShowObsolete";

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

	// Calculate total tablets
	const totalTablets = useMemo(() => {
		if (form.packageType === "bottle") {
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
		if (!medicationStartDate) return null;

		const conflictingIntake = form.intakes.find((intake) => intake.startDate && intake.startDate < medicationStartDate);
		if (!conflictingIntake?.startDate) return null;

		return t("form.validation.startDateAfterIntake", {
			medicationStartDate,
			intakeDate: conflictingIntake.startDate,
		});
	}, [form.medicationStartDate, form.intakes, t]);

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
			setReadOnlyView(false);
			pendingAction();
		} else if (source === "mobile-edit" && showEditModal) {
			clearEditMedIdParam();
			setShowEditModal(false);
			resetForm();
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
		if (hasValidationErrors || dateConsistencyError) {
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
		setSaving(true);

		// Prepare intakes data with per-intake takenBy
		const intakes = form.intakes.map((intake) => ({
			usage: Number(intake.usage) || 1,
			every: Number(intake.every) || 1,
			start: combineDateAndTime(intake.startDate, intake.startTime),
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

		const body = {
			name: form.name.trim(),
			genericName: form.genericName.trim() || null,
			takenBy: form.takenBy.length > 0 ? form.takenBy : [],
			packageType: form.packageType,
			packCount: Number(form.packCount) || 0,
			blistersPerPack: Number(form.blistersPerPack) || 1,
			pillsPerBlister: Number(form.pillsPerBlister) || 1,
			totalPills: Number(form.totalPills) || null,
			looseTablets: Number(form.looseTablets) || 0,
			pillWeightMg: Number(form.pillWeightMg) || null,
			doseUnit: form.doseUnit,
			medicationStartDate: form.medicationStartDate || null,
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
					window.history.back();
					setSaving(false);
					return;
				}
				resetForm();
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

	function handleEditClick(med: Medication) {
		if (formChanged) {
			pendingActionRef.current = () => {
				setShowNameValidation(false);
				setReadOnlyView(false);
				startEdit(med, openEditModal);
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
		startEdit(med, openEditModal);
		setViewMode("form");
		scrollToTopForDesktopEdit();
	}

	function handleViewClick(med: Medication) {
		if (formChanged) {
			pendingActionRef.current = () => {
				setShowNameValidation(false);
				setReadOnlyView(true);
				startEdit(med, openEditModal);
				setViewMode("form");
			};
			setUnsavedConfirmSource(showEditModal ? "mobile-edit" : "desktop-form");
			setShowUnsavedConfirm(true);
			return;
		}
		setShowNameValidation(false);
		setReadOnlyView(true);
		setActiveTab("general");
		startEdit(med, openEditModal);
		setViewMode("form");
	}

	function handleNewEntryClick() {
		if (formChanged) {
			pendingActionRef.current = () => {
				resetForm();
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
		const medicationToEdit = allMeds.find((med) => med.id === parsedMedId);
		if (!medicationToEdit) return;

		processedEditMedIdRef.current = editMedId;

		setShowNameValidation(false);
		setReadOnlyView(false);
		setActiveTab("general");
		startEdit(medicationToEdit, openEditModal);
		setViewMode("form");
		setPendingEditTransition(false);
		window.dispatchEvent(new Event("medassist:edit-transition-ready"));

		const nextParams = new URLSearchParams(searchParams);
		nextParams.delete("editMedId");
		setSearchParams(nextParams, { replace: true });
	}, [allMeds, openEditModal, searchParams, setSearchParams, startEdit]);

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
			{/* ── Grid View: always visible medication cards ── */}
			<article className="card">
				<div className="card-head">
					<h2>{t("medications.list.title")}</h2>
					<div className="card-head-actions">
						<button type="button" className="btn primary small" onClick={handleNewEntryClick}>
							+ {t("form.newEntry")}
						</button>
						<button type="button" className="btn ghost small" onClick={() => setShowReportModal(true)}>
							{t("report.button")}
						</button>
					</div>
				</div>
				<div className="med-groups">
					<div className="med-group med-group-active">
						<div className="med-grid">
							{orderedMeds.map((med) => (
								<div key={med.id} className={`med-row${editingId === med.id ? " editing" : ""}`}>
									<div className="med-header">
										<div className="med-info">
											<div className="med-name-row">
												<span
													className={med.imageUrl ? "med-avatar-clickable" : undefined}
													onClick={() =>
														med.imageUrl && setLightboxImage({ src: `/api/images/${med.imageUrl}`, alt: getMedDisplayName(med) })
													}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															if (med.imageUrl) setLightboxImage({ src: `/api/images/${med.imageUrl}`, alt: getMedDisplayName(med) });
														}
													}}
												>
													<MedicationAvatar name={getMedDisplayName(med)} imageUrl={med.imageUrl} size="lg" />
												</span>
												<div className="med-name-block">
													<div className="med-name">{getMedDisplayName(med)}</div>
													{med.name && med.genericName && <div className="med-generic-name">{med.genericName}</div>}
												</div>
											</div>
											<div className="med-actions">
												{editingId !== med.id && (
													<button
														className="info icon-only tooltip-trigger"
														onClick={() => handleEditClick(med)}
														aria-label={t("common.edit")}
														data-tooltip={t("common.edit")}
													>
														<Pencil size={18} aria-hidden="true" />
													</button>
												)}
												<button
													className="danger icon-only tooltip-trigger"
													onClick={() => requestDeleteMed(med)}
													aria-label={t("common.delete")}
													data-tooltip={t("common.delete")}
												>
													<Trash2 size={18} aria-hidden="true" />
												</button>
												<button className="btn-obsolete" onClick={() => requestMarkObsolete(med)}>
													{t("medications.list.markObsolete")}
												</button>
											</div>
											<div className="med-details">
												<span>
													{t("medications.details.type")}:{" "}
													<strong>
														{med.packageType === "bottle" ? t("form.packageTypeBottle") : t("form.packageTypeBlister")}
													</strong>
												</span>
												{med.packageType === "blister" ? (
													<>
														<span>
															{t("medications.details.packs")}: <strong>{med.packCount}</strong>
														</span>
														<span>
															{t("medications.details.blisters")}: <strong>{med.blistersPerPack}</strong>
														</span>
														<span>
															{t("medications.details.pillsPerBlister")}: <strong>{med.pillsPerBlister}</strong>
														</span>
														<span>
															{t("medications.details.loose")}: <strong>{med.looseTablets}</strong>
														</span>
													</>
												) : (
													<span>
														{t("medications.details.totalCapacity")}:{" "}
														<strong>{med.totalPills ?? med.looseTablets}</strong>
													</span>
												)}
											</div>
											{med.prescriptionEnabled && (
												<div className="med-total">
													{t("prescription.remainingRefills")}: <strong>{med.prescriptionRemainingRefills ?? 0}</strong>
												</div>
											)}
											<div className="med-total">
												{t("medications.details.stock")}:{" "}
												{coverageByMed[getMedDisplayName(med)] ? Math.round(coverageByMed[getMedDisplayName(med)].medsLeft) : getPackageSize(med)} /{" "}
												{getPackageSize(med)} {getPackageSize(med) === 1 ? t("common.pill") : t("common.pills")}
												{(coverageByMed[getMedDisplayName(med)]
													? Math.round(coverageByMed[getMedDisplayName(med)].medsLeft)
													: getPackageSize(med)) > getPackageSize(med) && (
													<span
														className="info-tooltip tooltip-align-left warning-text"
														data-tooltip={t("tooltips.stockExceedsCapacity")}
													>
														{" "}
														⚠️
													</span>
												)}
											</div>
										</div>
									</div>
									<div className="blister-list">
										{(med.intakes ?? med.blisters).map((s, idx) => (
											<div key={`${med.id}-${idx}`} className="blister-row-simple">
												{s.usage} {s.usage === 1 ? t("common.pill") : t("common.pills")} ·{" "}
												{s.every === 1 ? t("common.daily") : t("common.everyNDays", { count: s.every })} ·{" "}
												{t("form.blisters.from")} {formatDateTime(s.start)}
												{"takenBy" in s && (s as import("../types").Intake).takenBy && (
													<span className="blister-taken-by"> · {(s as import("../types").Intake).takenBy}</span>
												)}
												{"intakeRemindersEnabled" in s && (s as import("../types").Intake).intakeRemindersEnabled && (
													<span className="blister-reminder-icon" title={t("form.blisters.remindTooltip")}>
														{" "}
														<Bell size={12} aria-hidden="true" />
													</span>
												)}
											</div>
										))}
									</div>
								</div>
							))}
						</div>
					</div>
					{obsoleteMeds.length > 0 && (
						<div className="med-group med-group-obsolete">
							<button
								type="button"
								className="med-group-head med-group-head-toggle"
								onClick={toggleObsoleteSection}
								aria-expanded={showObsolete}
							>
								<h3 className="med-group-title">
									{showObsolete ? "▼" : "▶"} {t("medications.list.obsoleteTitle", { count: obsoleteMeds.length })}
								</h3>
							</button>
							{showObsolete && (
								<div className="med-grid med-grid-obsolete">
									{obsoleteMeds.map((med) => (
										<div key={med.id} className="med-row obsolete-row">
											<div className="med-header">
												<div className="med-info">
													<div className="med-name-row">
														<span
															className={med.imageUrl ? "med-avatar-clickable" : undefined}
															onClick={() =>
																med.imageUrl && setLightboxImage({ src: `/api/images/${med.imageUrl}`, alt: getMedDisplayName(med) })
															}
															onKeyDown={(e) => {
																if (e.key === "Enter" || e.key === " ") {
																	if (med.imageUrl)
																		setLightboxImage({ src: `/api/images/${med.imageUrl}`, alt: getMedDisplayName(med) });
																}
															}}
														>
															<MedicationAvatar name={getMedDisplayName(med)} imageUrl={med.imageUrl} size="lg" />
														</span>
														<div className="med-name-block">
															<div className="med-name">{getMedDisplayName(med)}</div>
															{med.name && med.genericName && <div className="med-generic-name">{med.genericName}</div>}
														</div>
													</div>
													<div className="med-actions">
														<button
															className="info icon-only tooltip-trigger"
															onClick={() => handleViewClick(med)}
															aria-label={t("common.view")}
															data-tooltip={t("common.view")}
														>
															<Eye size={18} aria-hidden="true" />
														</button>
														<button
															className="danger icon-only tooltip-trigger"
															onClick={() => requestDeleteMed(med)}
															aria-label={t("common.delete")}
															data-tooltip={t("common.delete")}
														>
															<Trash2 size={18} aria-hidden="true" />
														</button>
														<button className="success" onClick={() => reactivateMedication(med.id)}>
															{t("medications.list.reactivate")}
														</button>
													</div>
													<div className="med-details">
														{med.medicationStartDate && (
															<span style={{ gridColumn: "1 / -1" }}>
																{t("medications.list.started")}: <strong>{formatDate(med.medicationStartDate)}</strong>
															</span>
														)}
														<span style={{ gridColumn: "1 / -1" }}>
															{t("medications.list.obsoleteSince")}: <strong>{formatDate(med.obsoleteAt)}</strong>
														</span>
													</div>
												</div>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			</article>

			{/* ── Desktop Edit Panel: inline below medication list ── */}
			<aside className={`edit-sidebar desktop-only${viewMode === "form" ? " open" : ""}`}>
				<article className="card form">
					<div className="card-head">
						<div className="edit-header">
							<button type="button" className="ghost small btn-nav" onClick={handleDesktopFormLeave}>
								← {t("common.back")}
							</button>
							{editingId ? (
								<h2>
									{readOnlyView ? t("form.viewEntry") : t("form.editEntry")}: {selectedMedication?.name}
								</h2>
							) : (
								<h2>{t("form.newEntry")}</h2>
							)}
						</div>
					</div>
					<form
						className="form-grid"
						onSubmit={saveMedication}
						autoComplete="off"
						spellCheck={false}
						autoCorrect="off"
						autoCapitalize="off"
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
									<label>
										{t("form.medicationStartDate")}
										<DateInput
											value={form.medicationStartDate}
											onChange={(e) => handleValueChange("medicationStartDate", e.target.value)}
										/>
										{!readOnlyView && dateConsistencyError && (
											<span className="field-error">{dateConsistencyError}</span>
										)}
									</label>
									<label>
										{t("form.packageType")}
										<select
											className="package-type-select"
											value={form.packageType}
											onChange={(e) =>
												handleValueChange("packageType", e.target.value as import("../types").PackageType)
											}
										>
											<option value="blister">{t("form.packageTypeBlister")}</option>
											<option value="bottle">{t("form.packageTypeBottle")}</option>
										</select>
									</label>
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
															form.takenBy.length === 0
																? t("form.placeholders.takenBy")
																: t("form.placeholders.addPerson")
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
									{form.packageType === "blister" ? (
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
									) : (
										<>
											<label>
												{t("form.totalCapacity")}
												<FormNumberStepper
													value={form.totalPills}
													onChange={(nextValue) => handleValueChange("totalPills", nextValue)}
													min={0}
													decrementLabel={decrementValueLabel}
													incrementLabel={incrementValueLabel}
												/>
											</label>
											<label>
												{t("form.currentPills")}
												<FormNumberStepper
													value={form.looseTablets}
													onChange={(nextValue) => handleValueChange("looseTablets", nextValue)}
													min={0}
													decrementLabel={decrementValueLabel}
													incrementLabel={incrementValueLabel}
												/>
											</label>
										</>
									)}
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
												className="dose-unit-select"
											>
												{DOSE_UNITS.map((unit) => (
													<option key={unit.value} value={unit.value}>
														{unit.label}
													</option>
												))}
											</select>
										</div>
									</label>
									{form.packageType === "bottle" && (
										<div className="full stock-total-row">
											<label className="stock-total-field">
												{t("form.total")}
												<div className="static-value">{formatNumber(totalTablets)}</div>
											</label>
										</div>
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
											<span
												className={`char-count ${form.notes.length > FIELD_LIMITS.notes.max * 0.9 ? "warning" : ""}`}
											>
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
									{form.intakes.map((intake, idx) => (
										<div key={idx} className="blister-row">
											<div className="blister-inputs">
												<label>
													{t("form.blisters.usage")}
													<FormNumberStepper
														value={intake.usage}
														onChange={(nextValue) => setIntakeValue(idx, "usage", nextValue)}
														min={0.5}
														step={0.5}
														allowDecimal={true}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
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
												{form.takenBy.length === 0 ? null : (
													<label className="taken-by-field" title={t("form.blisters.takenByTooltip")}>
														{t("form.blisters.takenByIntake")}
														<select
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
									))}
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
									className={hasValidationErrors || dateConsistencyError ? "has-validation-error" : ""}
								>
									{formSaved && !formChanged ? t("common.saved") : t("common.save")}
								</button>
							)}
						</div>
					</form>
				</article>
			</aside>

			{/* Mobile Edit Modal */}
			<MobileEditModal
				show={showEditModal}
				editingId={editingId}
				form={form}
				onFormChange={setForm}
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
				onClose={() => {
					closeEditModal();
				}}
				onResetForm={handleResetForm}
				onSaveMedication={saveMedication}
			/>

			{/* Unsaved Changes Confirmation Modal */}
			{showUnsavedConfirm && (
				<ConfirmModal
					title={t("common.unsavedChanges.title", "Unsaved Changes")}
					message={t("common.unsavedChanges.message")}
					confirmLabel={t("common.unsavedChanges.leave", "Leave")}
					cancelLabel={
						unsavedConfirmSource === "mobile-edit" ? t("common.back") : t("common.unsavedChanges.stay", "Stay")
					}
					onConfirm={handleConfirmClose}
					onCancel={handleCancelClose}
					confirmVariant="danger"
					overlayClassName={showEditModal ? "nested-confirm" : undefined}
				/>
			)}

			{/* Delete Medication Confirmation Modal */}
			{showObsoleteConfirm && obsoleteCandidate && (
				<ConfirmModal
					title={t("medications.obsoleteModal.title")}
					message={t("medications.obsoleteModal.message", { name: obsoleteCandidate.name })}
					confirmLabel={t("medications.list.markObsolete")}
					cancelLabel={t("common.cancel")}
					onConfirm={handleConfirmMarkObsolete}
					onCancel={handleCancelMarkObsolete}
					confirmVariant="warning"
					overlayClassName={showEditModal ? "nested-confirm" : undefined}
				/>
			)}

			{/* Delete Medication Confirmation Modal */}
			{showDeleteConfirm && deleteCandidate && (
				<ConfirmModal
					title={t("medications.deleteModal.title")}
					message={t("medications.deleteModal.message", { name: deleteCandidate.name })}
					confirmLabel={t("common.delete")}
					cancelLabel={t("common.cancel")}
					onConfirm={handleConfirmDelete}
					onCancel={handleCancelDelete}
					confirmVariant="danger"
					overlayClassName={showEditModal ? "nested-confirm" : undefined}
				/>
			)}

			{/* Image Lightbox */}
			{lightboxImage && (
				<Lightbox src={lightboxImage.src} alt={lightboxImage.alt} onClose={() => setLightboxImage(null)} />
			)}

			{/* Report Modal */}
			<ReportModal isOpen={showReportModal} onClose={() => setShowReportModal(false)} medications={allMeds} />
		</section>
	);
}
