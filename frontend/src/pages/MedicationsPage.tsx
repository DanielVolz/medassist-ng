import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal, MedicationAvatar, MobileEditModal } from "../components";
import { useAppContext, useUnsavedChanges } from "../context";
import { useMedicationForm, useUnsavedChangesWarning } from "../hooks";
import type { DoseUnit, Medication } from "../types";
import { DOSE_UNITS, FIELD_LIMITS, getPackageSize } from "../types";
import { combineDateAndTime, formatDateTime, formatNumber } from "../utils/formatters";

export function MedicationsPage() {
	const { t } = useTranslation();
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
	// Confirmation modal for unsaved changes
	const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

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
		setShowUnsavedConfirm(false);
		closeConfirmedRef.current = true;
		hasUnsavedHistoryState.current = false;
		if (showEditModal) {
			setShowEditModal(false);
		}
		resetForm();
		window.history.back();
	}

	// Handle cancelled close (user clicked "Stay" in confirmation modal)
	function handleCancelClose() {
		setShowUnsavedConfirm(false);
	}

	// Helper to reset form and clear history state
	function handleResetForm() {
		if (hasUnsavedHistoryState.current) {
			hasUnsavedHistoryState.current = false;
			// Go back to remove the unsaved changes history entry
			window.history.back();
		}
		resetForm();
		setViewMode("grid");
	}

	// Handle delete medication
	async function handleDeleteMed(id: number) {
		if (!confirm(t("medications.deleteConfirm"))) return;
		await deleteMed(id, editingId, resetForm);
	}

	// Handle submit refill
	async function handleSubmitRefill(medId: number) {
		await submitRefill(medId, editingId, setForm, loadMeds, usePrescriptionRefill);
	}

	// Save medication
	async function saveMedication(e: React.FormEvent) {
		e.preventDefault();
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
			console.error("Save error:", err);
			alert(err instanceof Error && err.message ? err.message : t("common.saveFailed"));
		}

		setSaving(false);
	}

	// Handle browser back button for modals and unsaved changes
	useEffect(() => {
		const handlePopState = () => {
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
				setShowUnsavedConfirm(true);
			}
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, [showEditModal, formChanged, resetForm]);

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
		startEdit(med, openEditModal);
		setViewMode("form");
	}

	const orderedMeds = useMemo(() => {
		if (!editingId) {
			return meds;
		}

		const selectedMedication = meds.find((med) => med.id === editingId);
		if (!selectedMedication) {
			return meds;
		}

		return [selectedMedication, ...meds.filter((med) => med.id !== editingId)];
	}, [meds, editingId]);

	const medListRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (viewMode !== "form" || !editingId) {
			return;
		}

		if (medListRef.current) {
			medListRef.current.scrollTop = 0;
		}
	}, [viewMode, editingId]);

	return (
		<section className={viewMode === "grid" ? "med-grid-wrapper" : "grid"}>
			{viewMode === "grid" ? (
				/* ── Grid View: compact medication cards ── */
				<article className="card">
					<div className="card-head">
						<h2>{t("medications.list.title")}</h2>
						<button
							type="button"
							className="btn primary small"
							onClick={() => {
								resetForm();
								if (window.innerWidth <= 768) {
									openEditModal();
								} else {
									setViewMode("form");
								}
							}}
						>
							+ {t("form.newEntry")}
						</button>
					</div>
					<div className="med-grid">
						{orderedMeds.map((med) => (
							<div key={med.id} className="med-row">
								<div className="med-header">
									<div className="med-info">
										<div className="med-name-row">
											<MedicationAvatar name={med.name} imageUrl={med.imageUrl} size="lg" />
											<div className="med-name">{med.name}</div>
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
										<div className="med-total">
											{t("medications.details.stock")}:{" "}
											{coverageByMed[med.name] ? Math.round(coverageByMed[med.name].medsLeft) : getPackageSize(med)} /{" "}
											{getPackageSize(med)} {getPackageSize(med) === 1 ? t("common.pill") : t("common.pills")}
											{(coverageByMed[med.name] ? Math.round(coverageByMed[med.name].medsLeft) : getPackageSize(med)) >
												getPackageSize(med) && (
												<span
													className="info-tooltip tooltip-align-left warning-text"
													data-tooltip={t("tooltips.stockExceedsCapacity")}
												>
													{" "}
													⚠️
												</span>
											)}
											{med.prescriptionEnabled && (
												<div className="med-total">
													{t("prescription.remainingRefills")}: <strong>{med.prescriptionRemainingRefills ?? 0}</strong>
												</div>
											)}
										</div>
									</div>
									<div className="med-actions">
										<button className="info" onClick={() => handleEditClick(med)}>
											{t("common.edit")}
										</button>
										<button className="danger" onClick={() => handleDeleteMed(med.id)}>
											{t("common.delete")}
										</button>
									</div>
								</div>
								<div className="blister-list">
									{med.blisters.map((s, idx) => (
										<div key={`${med.id}-${idx}`} className="blister-row-simple">
											{s.usage} {s.usage === 1 ? t("common.pill") : t("common.pills")} · {t("form.blisters.every")}{" "}
											{s.every} {s.every === 1 ? t("common.day") : t("common.days")} · {t("form.blisters.from")}{" "}
											{formatDateTime(s.start)}
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				</article>
			) : (
				/* ── Form View: list panel + form panel (existing layout) ── */
				<>
					<article className="card meds">
						<div className="card-head">
							<h2>{t("medications.list.title")}</h2>
							<button
								type="button"
								className="btn primary small"
								onClick={() => {
									resetForm();
									// On mobile, open the edit modal
									if (window.innerWidth <= 768) {
										openEditModal();
									}
								}}
							>
								+ {t("form.newEntry")}
							</button>
						</div>
						<div className="med-list" ref={medListRef}>
							{orderedMeds.map((med) => (
								<div key={med.id} className={`med-row${editingId === med.id ? " editing" : ""}`}>
									<div className="med-header">
										<div className="med-info">
											<div className="med-name-row">
												<MedicationAvatar name={med.name} imageUrl={med.imageUrl} size="lg" />
												<div className="med-name">{med.name}</div>
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
												{med.prescriptionEnabled && (
													<div className="med-total">
														{t("prescription.remainingRefills")}:{" "}
														<strong>{med.prescriptionRemainingRefills ?? 0}</strong>
													</div>
												)}
											</div>
										</div>
										<div className="med-actions">
											<button className="info" onClick={() => handleEditClick(med)}>
												{t("common.edit")}
											</button>
											<button className="danger" onClick={() => handleDeleteMed(med.id)}>
												{t("common.delete")}
											</button>
										</div>
									</div>
									<div className="blister-list">
										{med.blisters.map((s, idx) => (
											<div key={`${med.id}-${idx}`} className="blister-row-simple">
												{s.usage} {s.usage === 1 ? t("common.pill") : t("common.pills")} · {t("form.blisters.every")}{" "}
												{s.every} {s.every === 1 ? t("common.day") : t("common.days")} · {t("form.blisters.from")}{" "}
												{formatDateTime(s.start)}
											</div>
										))}
									</div>
								</div>
							))}
						</div>
					</article>

					<article className="card form desktop-only">
						<div className="card-head">
							<div className="edit-header">
								<button type="button" className="ghost small" onClick={handleResetForm}>
									← {t("common.back")}
								</button>
								{editingId ? (
									<>
										<MedicationAvatar
											name={meds.find((m) => m.id === editingId)?.name || ""}
											imageUrl={meds.find((m) => m.id === editingId)?.imageUrl}
											size="md"
										/>
										<h2>
											{t("form.editEntry")}: {meds.find((m) => m.id === editingId)?.name}
										</h2>
									</>
								) : (
									<h2>{t("form.newEntry")}</h2>
								)}
							</div>
						</div>
						<form className="form-grid" onSubmit={saveMedication}>
							<div className="full form-category">
								<h4 className="form-category-title">{t("form.sections.general")}</h4>
								<label className={fieldErrors.name ? "has-error" : ""}>
									{t("form.commercialName")}
									<input
										value={form.name}
										onChange={(e) => setForm({ ...form, name: e.target.value })}
										placeholder={t("form.placeholders.commercial")}
										maxLength={FIELD_LIMITS.name.max}
										required
									/>
									{fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
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
								<label className={fieldErrors.takenBy ? "has-error" : ""}>
									{t("form.takenBy")}
									<div className="tag-input-container">
										{form.takenBy.map((person) => (
											<span key={person} className="tag">
												{person}
												<button type="button" className="tag-remove" onClick={() => removeTakenByPerson(person)}>
													×
												</button>
											</span>
										))}
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
									<input
										type="date"
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
											<input
												type="date"
												value={form.prescriptionExpiryDate}
												onChange={(e) => handleValueChange("prescriptionExpiryDate", e.target.value)}
											/>
										</label>
									</>
								)}
							</div>

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

							<div className="full form-category intake-section">
								<div className="form-category-header">
									<h4 className="form-category-title">{t("form.blisters.title")}</h4>
									<button
										type="button"
										className="primary"
										onClick={() => addIntake(form.takenBy.length === 1 ? form.takenBy[0] : undefined)}
									>
										+ {t("form.blisters.addIntake")}
									</button>
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
												<input
													type="date"
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
										{form.intakes.length > 1 && (
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

							<div className="full align-end gap">
								<button type="button" className="ghost" onClick={handleResetForm}>
									{t("common.cancel")}
								</button>
								<button
									type="submit"
									disabled={saving || hasValidationErrors || (!formChanged && (formSaved || !!editingId))}
								>
									{formSaved && !formChanged ? t("common.saved") : t("common.save")}
								</button>
							</div>
						</form>
					</article>
				</>
			)}

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
				meds={meds}
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
					cancelLabel={t("common.unsavedChanges.stay", "Stay")}
					onConfirm={handleConfirmClose}
					onCancel={handleCancelClose}
					confirmVariant="danger"
				/>
			)}
		</section>
	);
}
