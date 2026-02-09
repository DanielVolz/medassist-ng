/**
 * MobileEditModal - Full-screen edit form for medications (mobile-optimized)
 * Handles new medication creation and editing existing medications
 */
import { useTranslation } from "react-i18next";
import type { DoseUnit, FieldErrors, FormBlister, FormIntake, FormState, Medication } from "../types";
import { DOSE_UNITS } from "../types";
import { deriveTotal } from "../utils";

// Field limits for validation
const FIELD_LIMITS = {
	name: { max: 100 },
	genericName: { max: 100 },
	takenBy: { max: 50 },
	notes: { max: 1000 },
};

export interface MobileEditModalProps {
	show: boolean;
	editingId: number | null;
	form: FormState;
	onFormChange: (form: FormState) => void;
	fieldErrors: FieldErrors;
	saving: boolean;
	formSaved: boolean;
	formChanged: boolean;
	hasValidationErrors: boolean;
	// TakenBy tag input
	takenByInput: string;
	onTakenByInputChange: (value: string) => void;
	existingPeople: string[];
	onAddTakenByPerson: (person: string) => void;
	onRemoveTakenByPerson: (person: string) => void;
	onTakenByKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
	// Blister helpers (legacy)
	onSetBlisterValue: (idx: number, field: keyof FormBlister, value: string) => void;
	onAddBlister: () => void;
	onRemoveBlister: (idx: number) => void;
	// Intake helpers (new - with per-intake takenBy)
	onSetIntakeValue: (idx: number, field: keyof FormIntake, value: string | boolean) => void;
	onAddIntake: (takenBy?: string) => void;
	onRemoveIntake: (idx: number) => void;
	// Value change handler for numeric fields
	onHandleValueChange: <K extends keyof FormState>(field: K, value: string) => void;
	// Refill state (for edit mode)
	refillPacks: number;
	onRefillPacksChange: (value: number) => void;
	refillLoose: number;
	onRefillLooseChange: (value: number) => void;
	refillSaving: boolean;
	onSubmitRefill: (medId: number) => Promise<void>;
	// Image handling
	meds: Medication[];
	onUploadMedImage: (medId: number, file: File) => Promise<void>;
	onDeleteMedImage: (medId: number) => Promise<void>;
	// Actions
	onClose: () => void;
	onResetForm: () => void;
	onSaveMedication: (e: React.FormEvent) => void;
}

/** Calculate total pills from form state */
function deriveTotalFromForm(form: FormState) {
	if (form.packageType === "bottle") {
		// For bottle type, looseTablets is the current stock
		return Number(form.looseTablets) || 0;
	}
	const packCount = Number(form.packCount) || 0;
	const blistersPerPack = Number(form.blistersPerPack) || 0;
	const pillsPerBlister = Number(form.pillsPerBlister) || 1;
	const looseTablets = Number(form.looseTablets) || 0;
	return deriveTotal(packCount, blistersPerPack, pillsPerBlister, looseTablets);
}

export function MobileEditModal({
	show,
	editingId,
	form,
	onFormChange,
	fieldErrors,
	saving,
	formSaved,
	formChanged,
	hasValidationErrors,
	takenByInput,
	onTakenByInputChange,
	existingPeople,
	onAddTakenByPerson,
	onRemoveTakenByPerson,
	onTakenByKeyDown,
	onSetBlisterValue,
	onAddBlister,
	onRemoveBlister,
	onSetIntakeValue,
	onAddIntake,
	onRemoveIntake,
	onHandleValueChange,
	refillPacks,
	onRefillPacksChange,
	refillLoose,
	onRefillLooseChange,
	refillSaving,
	onSubmitRefill,
	meds,
	onUploadMedImage,
	onDeleteMedImage,
	onClose,
	_onResetForm,
	onSaveMedication,
}: MobileEditModalProps) {
	const { t } = useTranslation();

	if (!show) return null;

	const currentMed = editingId ? meds.find((m) => m.id === editingId) : null;

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className="modal-content edit-modal" onClick={(e) => e.stopPropagation()}>
				<button className="modal-close" onClick={onClose}>
					×
				</button>
				<div className="edit-modal-header">
					<h2>{editingId ? t("form.editEntry") : t("form.newEntry")}</h2>
				</div>
				<form
					className="form-grid mobile-edit-form"
					onSubmit={(e) => {
						// Check native HTML5 validation first
						const formElement = e.currentTarget;
						if (!formElement.checkValidity()) {
							// Let browser show native validation messages
							formElement.reportValidity();
							e.preventDefault();
							return;
						}
						onSaveMedication(e);
					}}
				>
					<label className={`full ${fieldErrors.name ? "has-error" : ""}`}>
						{t("form.commercialName")}
						<input
							value={form.name}
							onChange={(e) => onFormChange({ ...form, name: e.target.value })}
							placeholder={t("form.placeholders.commercial")}
							maxLength={FIELD_LIMITS.name.max}
							required
						/>
						{fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
					</label>
					<label className={`full ${fieldErrors.genericName ? "has-error" : ""}`}>
						{t("form.genericName")}
						<input
							value={form.genericName}
							onChange={(e) => onFormChange({ ...form, genericName: e.target.value })}
							placeholder={t("form.placeholders.generic")}
							maxLength={FIELD_LIMITS.genericName.max}
						/>
						{fieldErrors.genericName && <span className="field-error">{fieldErrors.genericName}</span>}
					</label>
					<label className={`full ${fieldErrors.takenBy ? "has-error" : ""}`}>
						{t("form.takenBy")}
						<div className="tag-input-container">
							{form.takenBy.map((person) => (
								<span key={person} className="tag">
									{person}
									<button type="button" className="tag-remove" onClick={() => onRemoveTakenByPerson(person)}>
										×
									</button>
								</span>
							))}
							<input
								value={takenByInput}
								onChange={(e) => onTakenByInputChange(e.target.value)}
								onKeyDown={onTakenByKeyDown}
								onBlur={() => {
									if (takenByInput.trim()) onAddTakenByPerson(takenByInput);
								}}
								placeholder={
									form.takenBy.length === 0 ? t("form.placeholders.takenBy") : t("form.placeholders.addPerson")
								}
								maxLength={FIELD_LIMITS.takenBy.max}
								list="takenby-suggestions-modal"
							/>
							<datalist id="takenby-suggestions-modal">
								{existingPeople
									.filter((p) => !form.takenBy.includes(p))
									.map((person) => (
										<option key={person} value={person} />
									))}
							</datalist>
						</div>
						{fieldErrors.takenBy && <span className="field-error">{fieldErrors.takenBy}</span>}
					</label>
					<label className="full">
						{t("form.packageType")}
						<select
							className="package-type-select"
							value={form.packageType}
							onChange={(e) => onHandleValueChange("packageType", e.target.value)}
						>
							<option value="blister">{t("form.packageTypeBlister")}</option>
							<option value="bottle">{t("form.packageTypeBottle")}</option>
						</select>
					</label>
					{form.packageType === "blister" ? (
						<>
							<label>
								{t("form.packs")}
								<input
									type="number"
									min="0"
									value={form.packCount}
									onChange={(e) => onHandleValueChange("packCount", e.target.value)}
								/>
							</label>
							<label>
								{t("form.blistersPerPack")}
								<input
									type="number"
									min="0"
									value={form.blistersPerPack}
									onChange={(e) => onHandleValueChange("blistersPerPack", e.target.value)}
								/>
							</label>
							<label>
								{t("form.pillsPerBlister")}
								<input
									type="number"
									min="1"
									value={form.pillsPerBlister}
									onChange={(e) => onHandleValueChange("pillsPerBlister", e.target.value)}
								/>
							</label>
							<label>
								{t("form.loosePills")}
								<input
									type="number"
									min="0"
									value={form.looseTablets}
									onChange={(e) => onHandleValueChange("looseTablets", e.target.value)}
								/>
							</label>
						</>
					) : (
						<>
							<label>
								{t("form.totalCapacity")}
								<input
									type="number"
									min="1"
									value={form.totalPills}
									onChange={(e) => onHandleValueChange("totalPills", e.target.value)}
								/>
							</label>
							<label>
								{t("form.currentPills")}
								<input
									type="number"
									min="0"
									value={form.looseTablets}
									onChange={(e) => onHandleValueChange("looseTablets", e.target.value)}
								/>
							</label>
						</>
					)}
					<div className="full">
						<p className="sub">
							<strong>{t("form.total")}:</strong> {deriveTotalFromForm(form)}{" "}
							{deriveTotalFromForm(form) === 1 ? t("common.pill") : t("common.pills")}
						</p>
					</div>
					<label className="full">
						{t("form.pillWeight")} ({form.doseUnit})
						<div className="dose-input-group">
							<input
								type="number"
								min="0"
								step="0.1"
								value={form.pillWeightMg}
								onChange={(e) => onFormChange({ ...form, pillWeightMg: e.target.value })}
								placeholder={t("form.placeholders.weight")}
							/>
							<select
								value={form.doseUnit}
								onChange={(e) => onFormChange({ ...form, doseUnit: e.target.value as DoseUnit })}
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
					<label className="full">
						{t("form.expiryDate")}
						<input
							type="date"
							value={form.expiryDate}
							onChange={(e) => onFormChange({ ...form, expiryDate: e.target.value })}
						/>
					</label>

					{/* Refill section - only shown when editing (mobile) */}
					{editingId && (
						<div className="full refill-section">
							<h4 className="refill-title">{t("refill.title")}</h4>
							<div className="refill-form-inline">
								{form.packageType === "blister" ? (
									<>
										<label>
											{t("refill.packs")}
											<input
												type="number"
												min="0"
												value={refillPacks}
												onChange={(e) => onRefillPacksChange(parseInt(e.target.value, 10) || 0)}
											/>
										</label>
										<label>
											{t("refill.loosePills")}
											<input
												type="number"
												min="0"
												value={refillLoose}
												onChange={(e) => onRefillLooseChange(parseInt(e.target.value, 10) || 0)}
											/>
										</label>
									</>
								) : (
									<label>
										{t("refill.pillsToAdd")}
										<input
											type="number"
											min="0"
											value={refillLoose}
											onChange={(e) => onRefillLooseChange(parseInt(e.target.value, 10) || 0)}
										/>
									</label>
								)}
								<button
									type="button"
									className="success"
									onClick={() => onSubmitRefill(editingId)}
									disabled={(refillPacks < 1 && refillLoose < 1) || refillSaving}
								>
									{refillSaving ? t("common.saving") : t("refill.button")}
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
						</div>
					)}

					<label className={`full ${fieldErrors.notes ? "has-error" : ""}`}>
						{t("form.notes")}
						<textarea
							value={form.notes}
							onChange={(e) => onFormChange({ ...form, notes: e.target.value })}
							placeholder={t("form.placeholders.notes")}
							rows={2}
							maxLength={FIELD_LIMITS.notes.max}
							className="auto-resize"
							onInput={(e) => {
								const target = e.target as HTMLTextAreaElement;
								target.style.height = "auto";
								target.style.height = `${target.scrollHeight}px`;
							}}
						/>
						{form.notes.length > 0 && (
							<span className={`char-count ${form.notes.length > FIELD_LIMITS.notes.max * 0.9 ? "warning" : ""}`}>
								{t("common.validation.tooLong", { current: form.notes.length, max: FIELD_LIMITS.notes.max })}
							</span>
						)}
						{fieldErrors.notes && <span className="field-error">{fieldErrors.notes}</span>}
					</label>

					{editingId && currentMed?.imageUrl ? (
						<div className="full image-field">
							<span className="field-label">{t("form.medicationImage")}</span>
							<div className="image-preview">
								<img src={`/api/images/${currentMed.imageUrl}`} alt={currentMed.name} />
								<button type="button" className="danger" onClick={() => onDeleteMedImage(editingId)}>
									{t("form.removeImage")}
								</button>
							</div>
						</div>
					) : editingId ? (
						<label className="full">
							{t("form.medicationImage")}
							<input
								type="file"
								accept="image/*"
								onChange={(e) => e.target.files?.[0] && onUploadMedImage(editingId, e.target.files[0])}
							/>
						</label>
					) : null}

					<fieldset className="full blister-section">
						<legend>{t("form.blisters.title")}</legend>
						{form.intakes.map((intake, idx) => (
							<div key={idx} className="blister-row">
								<label className="compact">
									<span>{t("form.blisters.usage")}</span>
									<input
										type="number"
										min="0"
										step="0.1"
										value={intake.usage}
										onChange={(e) => onSetIntakeValue(idx, "usage", e.target.value)}
									/>
								</label>
								<label className="compact">
									<span>{t("form.blisters.everyDays")}</span>
									<input
										type="number"
										min="1"
										value={intake.every}
										onChange={(e) => onSetIntakeValue(idx, "every", e.target.value)}
									/>
								</label>
								<label className="compact full-row">
									<span>{t("form.blisters.startDate")}</span>
									<input
										type="date"
										value={intake.startDate}
										onChange={(e) => onSetIntakeValue(idx, "startDate", e.target.value)}
									/>
								</label>
								<label className="compact time-label">
									<span>{t("form.blisters.startTime")}</span>
									<input
										type="time"
										value={intake.startTime}
										onChange={(e) => onSetIntakeValue(idx, "startTime", e.target.value)}
									/>
								</label>
								{form.takenBy.length === 0 ? null : (
									<label className="compact full-row">
										<span>{t("form.blisters.takenByIntake")}</span>
										<select value={intake.takenBy} onChange={(e) => onSetIntakeValue(idx, "takenBy", e.target.value)}>
											{form.takenBy.map((person) => (
												<option key={person} value={person}>
													{person}
												</option>
											))}
										</select>
									</label>
								)}
								<div className="remind-toggle-row" title={t("form.blisters.remindTooltip")}>
									<span className="legend-hint">🔔</span>
									<label className="toggle-switch small">
										<input
											type="checkbox"
											checked={intake.intakeRemindersEnabled}
											onChange={(e) => onSetIntakeValue(idx, "intakeRemindersEnabled", e.target.checked)}
										/>
										<span className="toggle-slider"></span>
									</label>
								</div>
								{form.intakes.length > 1 && (
									<button type="button" className="danger remove-blister-btn" onClick={() => onRemoveIntake(idx)}>
										{t("common.remove")}
									</button>
								)}
							</div>
						))}
						<button
							type="button"
							className="ghost add-blister"
							onClick={() => onAddIntake(form.takenBy.length === 1 ? form.takenBy[0] : undefined)}
						>
							+ {t("form.blisters.addIntake")}
						</button>
					</fieldset>

					<div className="modal-footer">
						<button type="button" className="ghost" onClick={onClose}>
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
			</div>
		</div>
	);
}
