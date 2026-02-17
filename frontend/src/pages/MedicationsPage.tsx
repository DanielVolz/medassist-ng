import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal, DateInput, Lightbox, MedicationAvatar, MobileEditModal } from "../components";
import { useAuth } from "../components/Auth";
import { useAppContext, useUnsavedChanges } from "../context";
import { useMedicationForm, useUnsavedChangesWarning } from "../hooks";
import type { DoseUnit, Medication } from "../types";
import { DOSE_UNITS, FIELD_LIMITS, getPackageSize } from "../types";
import { combineDateAndTime, formatDate, formatDateTime, formatNumber } from "../utils/formatters";
import { log } from "../utils/logger";

function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

const OBSOLETE_SECTION_STORAGE_KEY = "medicationsShowObsolete";

export function MedicationsPage() {
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
		refillPacks,
		setRefillPacks,
		refillLoose,
		setRefillLoose,
		usePrescriptionRefill,
		setUsePrescriptionRefill,
		refillSaving,
		submitRefill,
		coverageByMed,
	} = useAppContext();

	// Use the medication form hook
	const {
		form,
		setForm,
		setOriginalForm,
		editingId,
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
	const [viewMode, setViewMode] = useState<"grid" | "form">("grid");
	const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

	// Mobile modal state (declared early because it's used in useEffect below)
	const [showEditModal, setShowEditModal] = useState(false);

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
	const [showObsolete, setShowObsolete] = useState(true);
	const [readOnlyView, setReadOnlyView] = useState(false);

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
		const looseTablets = Number(form.looseTablets) || 0;
		return packCount * blistersPerPack * pillsPerBlister + looseTablets;
	}, [form.packageType, form.packCount, form.blistersPerPack, form.pillsPerBlister, form.looseTablets]);

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

	// Open mobile edit modal
	function openEditModal() {
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
		if (hasUnsavedHistoryState.current) {
			hasUnsavedHistoryState.current = false;
			// Go back to remove the unsaved changes history entry
			window.history.back();
		}
		resetForm();
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

	// Handle submit refill
	async function handleSubmitRefill(medId: number) {
		await submitRefill(medId, editingId, setForm, loadMeds, usePrescriptionRefill);
		await loadAllMeds();
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
				await uploadMedImage(saved.id, pendingImage);
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
				setShowEditModal(false);
				resetForm();
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
	}, [showObsoleteConfirm, showDeleteConfirm, showEditModal, formChanged, resetForm]);

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

	// Handle edit button click - open modal on mobile, switch to form on desktop
	function handleEditClick(med: Medication) {
		if (formChanged) {
			pendingActionRef.current = () => {
				setReadOnlyView(false);
				startEdit(med, openEditModal);
				setViewMode("form");
			};
			setUnsavedConfirmSource(showEditModal ? "mobile-edit" : "desktop-form");
			setShowUnsavedConfirm(true);
			return;
		}
		setReadOnlyView(false);
		startEdit(med, openEditModal);
		setViewMode("form");
	}

	function handleViewClick(med: Medication) {
		if (formChanged) {
			pendingActionRef.current = () => {
				setReadOnlyView(true);
				startEdit(med, openEditModal);
				setViewMode("form");
			};
			setUnsavedConfirmSource(showEditModal ? "mobile-edit" : "desktop-form");
			setShowUnsavedConfirm(true);
			return;
		}
		setReadOnlyView(true);
		startEdit(med, openEditModal);
		setViewMode("form");
	}

	function handleNewEntryClick() {
		if (formChanged) {
			pendingActionRef.current = () => {
				resetForm();
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

	const selectedMedication = useMemo(() => {
		if (!editingId) return null;
		return allMeds.find((med) => med.id === editingId) ?? null;
	}, [allMeds, editingId]);

	return (
		<section className={`med-grid-wrapper${viewMode === "form" ? " desktop-edit-open" : ""}`}>
			{/* ── Grid View: always visible medication cards ── */}
			<article className="card">
				<div className="card-head">
					<h2>{t("medications.list.title")}</h2>
					<button type="button" className="btn primary small" onClick={handleNewEntryClick}>
						+ {t("form.newEntry")}
					</button>
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
														med.imageUrl && setLightboxImage({ src: `/api/images/${med.imageUrl}`, alt: med.name })
													}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															if (med.imageUrl) setLightboxImage({ src: `/api/images/${med.imageUrl}`, alt: med.name });
														}
													}}
												>
													<MedicationAvatar name={med.name} imageUrl={med.imageUrl} size="lg" />
												</span>
												<div className="med-name-block">
													<div className="med-name">{med.name}</div>
													{med.genericName && <div className="med-generic-name">{med.genericName}</div>}
												</div>
											</div>
											<div className="med-actions">
												<button className="danger" onClick={() => requestDeleteMed(med)}>
													{t("common.delete")}
												</button>
												<button className="btn-obsolete" onClick={() => requestMarkObsolete(med)}>
													{t("medications.list.markObsolete")}
												</button>
												{editingId !== med.id && (
													<button className="info" onClick={() => handleEditClick(med)}>
														{t("common.edit")}
													</button>
												)}
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
												{coverageByMed[med.name] ? Math.round(coverageByMed[med.name].medsLeft) : getPackageSize(med)} /{" "}
												{getPackageSize(med)} {getPackageSize(med) === 1 ? t("common.pill") : t("common.pills")}
												{(coverageByMed[med.name]
													? Math.round(coverageByMed[med.name].medsLeft)
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
												{"takenBy" in s && s.takenBy && <span className="blister-taken-by"> · {s.takenBy}</span>}
												{"intakeRemindersEnabled" in s && s.intakeRemindersEnabled && (
													<span className="blister-reminder-icon" title={t("form.blisters.remindTooltip")}>
														{" "}
														🔔
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
																med.imageUrl && setLightboxImage({ src: `/api/images/${med.imageUrl}`, alt: med.name })
															}
															onKeyDown={(e) => {
																if (e.key === "Enter" || e.key === " ") {
																	if (med.imageUrl)
																		setLightboxImage({ src: `/api/images/${med.imageUrl}`, alt: med.name });
																}
															}}
														>
															<MedicationAvatar name={med.name} imageUrl={med.imageUrl} size="lg" />
														</span>
														<div className="med-name-block">
															<div className="med-name">{med.name}</div>
															{med.genericName && <div className="med-generic-name">{med.genericName}</div>}
														</div>
													</div>
													<div className="med-actions">
														<button className="danger" onClick={() => requestDeleteMed(med)}>
															{t("common.delete")}
														</button>
														<button className="success" onClick={() => reactivateMedication(med.id)}>
															{t("medications.list.reactivate")}
														</button>
														<button className="info" onClick={() => handleViewClick(med)}>
															{t("common.view")}
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
								<>
									<MedicationAvatar
										name={selectedMedication?.name || ""}
										imageUrl={selectedMedication?.imageUrl}
										size="md"
									/>
									<h2>
										{readOnlyView ? t("form.viewEntry") : t("form.editEntry")}: {selectedMedication?.name}
									</h2>
								</>
							) : (
								<h2>{t("form.newEntry")}</h2>
							)}
						</div>
					</div>
					<form className="form-grid" onSubmit={saveMedication}>
						<fieldset className="readonly-fieldset" disabled={readOnlyView}>
							<div className="full form-category">
								<h4 className="form-category-title">{t("form.sections.general")}</h4>
								<label className={!readOnlyView && fieldErrors.name ? "has-error" : ""}>
									{t("form.commercialName")}
									<input
										value={form.name}
										onChange={(e) => setForm({ ...form, name: e.target.value })}
										placeholder={t("form.placeholders.commercial")}
										maxLength={FIELD_LIMITS.name.max}
										required={!readOnlyView}
									/>
									{!readOnlyView && fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
								</label>
								<label className={fieldErrors.genericName ? "has-error" : ""}>
									{t("form.genericName")}
									<input
										value={form.genericName}
										onChange={(e) => setForm({ ...form, genericName: e.target.value })}
										placeholder={t("form.placeholders.generic")}
										maxLength={FIELD_LIMITS.genericName.max}
									/>
									{fieldErrors.genericName && <span className="field-error">{fieldErrors.genericName}</span>}
								</label>
								<label>
									{t("form.medicationStartDate")}
									<DateInput
										value={form.medicationStartDate}
										onChange={(e) => handleValueChange("medicationStartDate", e.target.value)}
									/>
									{!readOnlyView && dateConsistencyError && <span className="field-error">{dateConsistencyError}</span>}
								</label>
								<label className={fieldErrors.takenBy ? "has-error" : ""}>
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
								<label>
									{t("form.packageType")}
									<select
										className="package-type-select"
										value={form.packageType}
										onChange={(e) => handleValueChange("packageType", e.target.value)}
									>
										<option value="blister">{t("form.packageTypeBlister")}</option>
										<option value="bottle">{t("form.packageTypeBottle")}</option>
									</select>
								</label>
							</div>

							<div className="full form-category">
								<h4 className="form-category-title">{t("form.sections.stock")}</h4>
								{form.packageType === "blister" ? (
									<>
										<label>
											{t("form.packs")}
											<input
												type="text"
												inputMode="numeric"
												pattern="[0-9]*"
												value={form.packCount}
												onChange={(e) => handleValueChange("packCount", e.target.value)}
											/>
										</label>
										<label>
											{t("form.blistersPerPack")}
											<input
												type="text"
												inputMode="numeric"
												pattern="[0-9]*"
												value={form.blistersPerPack}
												onChange={(e) => handleValueChange("blistersPerPack", e.target.value)}
											/>
										</label>
										<label>
											{t("form.pillsPerBlister")}
											<input
												type="text"
												inputMode="numeric"
												pattern="[0-9]*"
												value={form.pillsPerBlister}
												onChange={(e) => handleValueChange("pillsPerBlister", e.target.value)}
											/>
										</label>
										<label>
											{t("form.loosePills")}
											<input
												type="text"
												inputMode="numeric"
												pattern="[0-9]*"
												value={form.looseTablets}
												onChange={(e) => handleValueChange("looseTablets", e.target.value)}
											/>
										</label>
									</>
								) : (
									<>
										<label>
											{t("form.totalCapacity")}
											<input
												type="text"
												inputMode="numeric"
												pattern="[0-9]*"
												value={form.totalPills}
												onChange={(e) => handleValueChange("totalPills", e.target.value)}
											/>
										</label>
										<label>
											{t("form.currentPills")}
											<input
												type="text"
												inputMode="numeric"
												pattern="[0-9]*"
												value={form.looseTablets}
												onChange={(e) => handleValueChange("looseTablets", e.target.value)}
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
								<label>
									{t("form.total")}
									<div className="static-value">{formatNumber(totalTablets)}</div>
								</label>
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
											<input
												type="text"
												inputMode="numeric"
												pattern="[0-9]*"
												value={form.prescriptionAuthorizedRefills}
												onChange={(e) => handleValueChange("prescriptionAuthorizedRefills", e.target.value)}
											/>
										</label>
										<label className="prescription-field">
											{t("prescription.remainingRefills")}
											<input
												type="text"
												inputMode="numeric"
												pattern="[0-9]*"
												value={form.prescriptionRemainingRefills}
												onChange={(e) => handleValueChange("prescriptionRemainingRefills", e.target.value)}
											/>
										</label>
										<label className="prescription-field">
											{t("prescription.lowThreshold")}
											<input
												type="text"
												inputMode="numeric"
												pattern="[0-9]*"
												value={form.prescriptionLowRefillThreshold}
												onChange={(e) => handleValueChange("prescriptionLowRefillThreshold", e.target.value)}
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

							{!readOnlyView && (
								<div className="full form-category refill-section">
									<h4 className="form-category-title">{t("refill.title")}</h4>
									{editingId ? (
										<>
											{form.packageType === "blister" ? (
												<>
													<label>
														{t("refill.packs")}
														<input
															type="text"
															inputMode="numeric"
															pattern="[0-9]*"
															value={refillPacks}
															onChange={(e) => setRefillPacks(parseInt(e.target.value, 10) || 0)}
														/>
													</label>
													<label>
														{t("refill.loosePills")}
														<input
															type="text"
															inputMode="numeric"
															pattern="[0-9]*"
															value={refillLoose}
															onChange={(e) => setRefillLoose(parseInt(e.target.value, 10) || 0)}
														/>
													</label>
												</>
											) : (
												<label className="full">
													{t("refill.pillsToAdd")}
													<input
														type="text"
														inputMode="numeric"
														pattern="[0-9]*"
														value={refillLoose}
														onChange={(e) => setRefillLoose(parseInt(e.target.value, 10) || 0)}
													/>
												</label>
											)}
											<div className="refill-submit-row full">
												<button
													type="button"
													className="success"
													onClick={() => handleSubmitRefill(editingId)}
													disabled={(refillPacks < 1 && refillLoose < 1) || refillSaving}
												>
													{refillSaving ? t("refill.adding") : t("refill.button")}
												</button>
												{(() => {
													const totalRefill =
														form.packageType === "blister"
															? refillPacks * Number(form.blistersPerPack || 0) * Number(form.pillsPerBlister || 1) +
																refillLoose
															: refillLoose;
													return totalRefill > 0 ? (
														<span className="refill-preview">
															+{totalRefill} {totalRefill === 1 ? t("common.pill") : t("common.pills")}
														</span>
													) : null;
												})()}
											</div>
											{form.prescriptionEnabled && (
												<div className="refill-prescription-row full">
													<label className="refill-prescription-toggle">
														<input
															type="checkbox"
															checked={usePrescriptionRefill}
															onChange={(e) => setUsePrescriptionRefill(e.target.checked)}
															disabled={(Number(form.prescriptionRemainingRefills) || 0) <= 0}
														/>
														<span className="refill-prescription-label-text">{t("prescription.useForRefill")}</span>
													</label>
													<span className="refill-remaining-badge">
														{t("prescription.remainingRefills")}: {Number(form.prescriptionRemainingRefills) || 0}
													</span>
												</div>
											)}
										</>
									) : (
										<p className="refill-unavailable">
											{t("refill.saveFirst", "Save medication first to enable refill")}
										</p>
									)}
								</div>
							)}

							<div className="full form-category intake-section">
								<div className="form-category-header">
									<h4 className="form-category-title">{t("form.blisters.title")}</h4>
									{!readOnlyView && (
										<button
											type="button"
											className="primary"
											onClick={() => addIntake(form.takenBy.length === 1 ? form.takenBy[0] : undefined)}
										>
											+ {t("form.blisters.addIntake")}
										</button>
									)}
								</div>
								{form.intakes.map((intake, idx) => (
									<div key={idx} className="blister-row">
										<div className="blister-inputs">
											<label>
												{t("form.blisters.usage")}
												<input
													type="text"
													inputMode="decimal"
													pattern="[0-9]*\.?[0-9]*"
													value={intake.usage}
													onChange={(e) => setIntakeValue(idx, "usage", e.target.value)}
												/>
											</label>
											<label>
												{t("form.blisters.everyDays")}
												<input
													type="text"
													inputMode="numeric"
													pattern="[0-9]*"
													value={intake.every}
													onChange={(e) => setIntakeValue(idx, "every", e.target.value)}
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
												<label title={t("form.blisters.takenByTooltip")}>
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
												<span>🔔</span>
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
											<button type="button" className="danger" onClick={() => removeIntake(idx)}>
												{t("common.remove")}
											</button>
										)}
									</div>
								))}
							</div>

							<div className="full form-category image-section">
								<h4 className="form-category-title">{t("form.medicationImage")}</h4>
								{(() => {
									// When editing an existing medication
									if (editingId) {
										const currentMed = meds.find((m) => m.id === editingId);
										if (currentMed?.imageUrl) {
											return (
												<div className="image-preview">
													<img src={`/api/images/${currentMed.imageUrl}`} alt={currentMed.name} />
													<button type="button" className="danger" onClick={() => deleteMedImage(editingId)}>
														{t("form.removeImage")}
													</button>
												</div>
											);
										}
										return (
											<input
												type="file"
												accept="image/jpeg,image/png,image/webp,image/gif"
												onChange={(e) => e.target.files?.[0] && uploadMedImage(editingId, e.target.files[0])}
												disabled={uploadingImage}
											/>
										);
									}
									// When creating a new medication
									if (pendingImagePreview) {
										return (
											<div className="image-preview">
												<img src={pendingImagePreview} alt="Preview" />
												<button
													type="button"
													className="danger"
													onClick={() => {
														setPendingImage(null);
														setPendingImagePreview(null);
													}}
												>
													{t("form.removeImage")}
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
												if (file) {
													setPendingImage(file);
													const reader = new FileReader();
													reader.onload = (ev) => setPendingImagePreview(ev.target?.result as string);
													reader.readAsDataURL(file);
												}
											}}
										/>
									);
								})()}
							</div>
						</fieldset>
						<div className="full align-end gap">
							<button type="button" className="ghost" onClick={handleDesktopFormLeave}>
								{readOnlyView ? t("common.close") : t("common.cancel")}
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
				refillPacks={refillPacks}
				onRefillPacksChange={setRefillPacks}
				refillLoose={refillLoose}
				onRefillLooseChange={setRefillLoose}
				usePrescriptionRefill={usePrescriptionRefill}
				onUsePrescriptionRefillChange={setUsePrescriptionRefill}
				refillSaving={refillSaving}
				onSubmitRefill={handleSubmitRefill}
				meds={allMeds}
				onUploadMedImage={uploadMedImage}
				onDeleteMedImage={deleteMedImage}
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
					confirmVariant="danger"
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
		</section>
	);
}
