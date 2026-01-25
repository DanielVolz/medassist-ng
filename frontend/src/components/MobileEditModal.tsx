/**
 * MobileEditModal - Full-screen edit form for medications (mobile-optimized)
 * Handles new medication creation and editing existing medications
 */
import { useTranslation } from "react-i18next";
import type { FieldErrors, FormBlister, FormState, Medication } from "../types";

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
	// Blister helpers
	onSetBlisterValue: (idx: number, field: keyof FormBlister, value: string) => void;
	onAddBlister: () => void;
	onRemoveBlister: (idx: number) => void;
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

function deriveTotal(form: FormState) {
	const packCount = Number(form.packCount) || 0;
	const blistersPerPack = Number(form.blistersPerPack) || 0;
	const pillsPerBlister = Number(form.pillsPerBlister) || 1;
	const looseTablets = Number(form.looseTablets) || 0;
	return packCount * blistersPerPack * pillsPerBlister + looseTablets;
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
					<div className="full">
						<p className="sub">
							<strong>{t("form.total")}:</strong> {deriveTotal(form)} {t("common.pills")}
						</p>
					</div>
					<label className="full">
						{t("form.pillWeight")}
						<input
							type="number"
							min="0"
							step="0.1"
							value={form.pillWeightMg}
							onChange={(e) => onFormChange({ ...form, pillWeightMg: e.target.value })}
							placeholder={t("form.placeholders.weight")}
						/>
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
								<button
									type="button"
									className="success"
									onClick={() => onSubmitRefill(editingId)}
									disabled={(refillPacks < 1 && refillLoose < 1) || refillSaving}
								>
									{refillSaving ? t("common.saving") : t("refill.button")}
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
						<legend>
							{t("form.blisters.title")}
							<label className="toggle-switch small" title={t("form.blisters.remindTooltip")}>
								<input
									type="checkbox"
									checked={form.intakeRemindersEnabled}
									onChange={(e) => onFormChange({ ...form, intakeRemindersEnabled: e.target.checked })}
								/>
								<span className="toggle-slider"></span>
							</label>
							<span className="legend-hint">{t("form.blisters.remind")}</span>
						</legend>
						{form.blisters.map((b, idx) => (
							<div key={idx} className="blister-row">
								<label className="compact">
									<span>{t("form.blisters.usage")}</span>
									<input
										type="number"
										min="0"
										step="0.1"
										value={b.usage}
										onChange={(e) => onSetBlisterValue(idx, "usage", e.target.value)}
									/>
								</label>
								<label className="compact">
									<span>{t("form.blisters.everyDays")}</span>
									<input
										type="number"
										min="1"
										value={b.every}
										onChange={(e) => onSetBlisterValue(idx, "every", e.target.value)}
									/>
								</label>
								<label className="compact full-row">
									<span>{t("form.blisters.startDate")}</span>
									<input
										type="date"
										value={b.startDate}
										onChange={(e) => onSetBlisterValue(idx, "startDate", e.target.value)}
									/>
								</label>
								<label className="compact time-label">
									<span>{t("form.blisters.startTime")}</span>
									<input
										type="time"
										value={b.startTime}
										onChange={(e) => onSetBlisterValue(idx, "startTime", e.target.value)}
									/>
								</label>
								{form.blisters.length > 1 && (
									<button type="button" className="danger remove-blister-btn" onClick={() => onRemoveBlister(idx)}>
										{t("common.remove")}
									</button>
								)}
							</div>
						))}
						<button type="button" className="ghost add-blister" onClick={onAddBlister}>
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
