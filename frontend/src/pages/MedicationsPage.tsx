import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal, MedicationAvatar, MobileEditModal } from "../components";
import { useAppContext, useUnsavedChanges } from "../context";
import { useMedicationForm, useUnsavedChangesWarning } from "../hooks";
import type { Medication } from "../types";
import { FIELD_LIMITS, getPackageSize } from "../types";
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
		refillSaving,
		submitRefill,
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
		resetForm,
		startEdit,
	} = useMedicationForm();

	// Warn user about unsaved changes when navigating away
	useUnsavedChangesWarning(formChanged);

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
		const packCount = Number(form.packCount) || 0;
		const blistersPerPack = Number(form.blistersPerPack) || 0;
		const pillsPerBlister = Number(form.pillsPerBlister) || 1;
		const looseTablets = Number(form.looseTablets) || 0;
		return packCount * blistersPerPack * pillsPerBlister + looseTablets;
	}, [form.packCount, form.blistersPerPack, form.pillsPerBlister, form.looseTablets]);

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
	}

	// Handle delete medication
	async function handleDeleteMed(id: number) {
		if (!confirm(t("medications.deleteConfirm"))) return;
		await deleteMed(id, editingId, resetForm);
	}

	// Handle submit refill
	async function handleSubmitRefill(medId: number) {
		await submitRefill(medId, editingId, setForm, loadMeds);
	}

	// Save medication
	async function saveMedication(e: React.FormEvent) {
		e.preventDefault();
		if (saving) return;
		setSaving(true);

		// Prepare medication data
		const blisters = form.blisters.map((b) => ({
			usage: Number(b.usage) || 1,
			every: Number(b.every) || 1,
			start: combineDateAndTime(b.startDate, b.startTime),
		}));

		const body = {
			name: form.name.trim(),
			genericName: form.genericName.trim() || null,
			takenBy: form.takenBy.length > 0 ? form.takenBy : [],
			packCount: Number(form.packCount) || 0,
			blistersPerPack: Number(form.blistersPerPack) || 1,
			pillsPerBlister: Number(form.pillsPerBlister) || 1,
			looseTablets: Number(form.looseTablets) || 0,
			pillWeightMg: Number(form.pillWeightMg) || null,
			expiryDate: form.expiryDate || null,
			notes: form.notes.trim() || null,
			intakeRemindersEnabled: form.intakeRemindersEnabled,
			blisters,
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
				throw new Error("Failed to save");
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
			} else {
				// Update originalForm so formChanged becomes false
				setOriginalForm(form);
			}
		} catch (err) {
			console.error("Save error:", err);
			alert(t("common.saveFailed"));
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

	// Handle edit button click - open modal on mobile
	function handleEditClick(med: Medication) {
		startEdit(med, openEditModal);
	}

	return (
		<section className="grid">
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
				<div className="med-list">
					{meds.map((med) => (
						<div key={med.id} className={`med-row${editingId === med.id ? " editing" : ""}`}>
							<div className="med-header">
								<div className="med-info">
									<div className="med-name-row">
										<MedicationAvatar name={med.name} imageUrl={med.imageUrl} size="lg" />
										<div className="med-name">{med.name}</div>
									</div>
									<div className="med-details">
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
									</div>
									<div className="med-total">
										{t("medications.details.total")}: {getPackageSize(med)} {t("common.pills")}
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
					{editingId ? (
						<div className="edit-header">
							<MedicationAvatar
								name={meds.find((m) => m.id === editingId)?.name || ""}
								imageUrl={meds.find((m) => m.id === editingId)?.imageUrl}
								size="md"
							/>
							<h2>
								{t("form.editEntry")}: {meds.find((m) => m.id === editingId)?.name}
							</h2>
						</div>
					) : (
						<h2>{t("form.newEntry")}</h2>
					)}
				</div>
				<form className="form-grid" onSubmit={saveMedication}>
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
						{t("form.packs")}
						<input
							type="number"
							min="0"
							value={form.packCount}
							onChange={(e) => handleValueChange("packCount", e.target.value)}
						/>
					</label>
					<label>
						{t("form.blistersPerPack")}
						<input
							type="number"
							min="1"
							value={form.blistersPerPack}
							onChange={(e) => handleValueChange("blistersPerPack", e.target.value)}
						/>
					</label>
					<label>
						{t("form.pillsPerBlister")}
						<input
							type="number"
							min="1"
							value={form.pillsPerBlister}
							onChange={(e) => handleValueChange("pillsPerBlister", e.target.value)}
						/>
					</label>
					<label>
						{t("form.loosePills")}
						<input
							type="number"
							min="0"
							value={form.looseTablets}
							onChange={(e) => handleValueChange("looseTablets", e.target.value)}
						/>
					</label>
					<label>
						{t("form.pillWeight")}
						<input
							type="number"
							min="1"
							value={form.pillWeightMg}
							onChange={(e) => handleValueChange("pillWeightMg", e.target.value)}
							placeholder={t("form.placeholders.weight")}
						/>
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

					{/* Refill section - only shown when editing */}
					{editingId && (
						<div className="full refill-section">
							<h4 className="refill-title">{t("refill.title")}</h4>
							<div className="refill-form-inline">
								<label>
									{t("refill.packs")}
									<input
										type="number"
										min="0"
										value={refillPacks}
										onChange={(e) => setRefillPacks(parseInt(e.target.value, 10) || 0)}
									/>
								</label>
								<label>
									{t("refill.loosePills")}
									<input
										type="number"
										min="0"
										value={refillLoose}
										onChange={(e) => setRefillLoose(parseInt(e.target.value, 10) || 0)}
									/>
								</label>
								<button
									type="button"
									className="success"
									onClick={() => handleSubmitRefill(editingId!)}
									disabled={(refillPacks < 1 && refillLoose < 1) || refillSaving}
								>
									{refillSaving ? t("refill.adding") : t("refill.button")}
								</button>
								{(refillPacks > 0 || refillLoose > 0) && (
									<span className="refill-preview">
										+{refillPacks * Number(form.blistersPerPack || 0) * Number(form.pillsPerBlister || 1) + refillLoose}{" "}
										{t("common.pills")}
									</span>
								)}
							</div>
						</div>
					)}

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

					<div className="full blisters">
						<div className="card-head">
							<h3>{t("form.blisters.title")}</h3>
							<div className="blisters-actions">
								<label className="inline-checkbox" title={t("form.blisters.remindTooltip")}>
									<input
										type="checkbox"
										checked={form.intakeRemindersEnabled}
										onChange={(e) => setForm((prev) => ({ ...prev, intakeRemindersEnabled: e.target.checked }))}
									/>
									<span>🔔 {t("form.blisters.remind")}</span>
								</label>
								<button type="button" className="primary" onClick={addBlister}>
									+ {t("form.blisters.addIntake")}
								</button>
							</div>
						</div>
						{form.blisters.map((s, idx) => (
							<div key={idx} className="blister-row">
								<div className="blister-inputs">
									<label>
										{t("form.blisters.usage")}
										<input
											type="number"
											min="0"
											step="0.1"
											value={s.usage}
											onChange={(e) => setBlisterValue(idx, "usage", e.target.value)}
										/>
									</label>
									<label>
										{t("form.blisters.everyDays")}
										<input
											type="number"
											min="1"
											value={s.every}
											onChange={(e) => setBlisterValue(idx, "every", e.target.value)}
										/>
									</label>
									<label>
										{t("form.blisters.startDate")}
										<input
											type="date"
											value={s.startDate}
											onChange={(e) => setBlisterValue(idx, "startDate", e.target.value)}
										/>
									</label>
									<label>
										{t("form.blisters.startTime")}
										<input
											type="time"
											value={s.startTime}
											onChange={(e) => setBlisterValue(idx, "startTime", e.target.value)}
										/>
									</label>
								</div>
								{form.blisters.length > 1 && (
									<button type="button" className="danger" onClick={() => removeBlister(idx)}>
										{t("common.remove")}
									</button>
								)}
							</div>
						))}
					</div>

					<div className="full image-upload-section">
						<label className="setting-label">{t("form.medicationImage")}</label>
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
						{editingId && (
							<button type="button" className="ghost" onClick={handleResetForm}>
								{t("common.cancel")}
							</button>
						)}
						<button
							type="submit"
							disabled={saving || hasValidationErrors || (!formChanged && (formSaved || !!editingId))}
						>
							{formSaved && !formChanged ? t("common.saved") : t("common.save")}
						</button>
					</div>
				</form>
			</article>

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
				onHandleValueChange={handleValueChange}
				refillPacks={refillPacks}
				onRefillPacksChange={setRefillPacks}
				refillLoose={refillLoose}
				onRefillLooseChange={setRefillLoose}
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
