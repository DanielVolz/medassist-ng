/**
 * MobileEditModal - Full-screen edit form for medications (mobile-optimized)
 * Handles new medication creation and editing existing medications
 */

/* biome-ignore-all lint/a11y/noLabelWithoutControl: modal uses custom DateInput and static value fields */
import { Bell, Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DoseUnit, FieldErrors, FormBlister, FormIntake, FormState, Medication } from "../types";
import { DOSE_UNITS } from "../types";
import { deriveTotal } from "../utils";
import { DateInput } from "./DateInput";
import { FormNumberStepper } from "./FormNumberStepper";

// Field limits for validation
const FIELD_LIMITS = {
	name: { max: 100 },
	genericName: { max: 100 },
	takenBy: { max: 50 },
	notes: { max: 1000 },
};

const MOBILE_TAB_ORDER = ["general", "stock", "schedule", "prescription"] as const;
type MobileTab = (typeof MOBILE_TAB_ORDER)[number];

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
	dateConsistencyError: string | null;
	readOnlyMode: boolean;
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
	onHandleValueChange: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
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
	return deriveTotal(packCount, blistersPerPack, pillsPerBlister, 0);
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
	dateConsistencyError,
	readOnlyMode,
	takenByInput,
	onTakenByInputChange,
	existingPeople,
	onAddTakenByPerson,
	onRemoveTakenByPerson,
	onTakenByKeyDown,
	_onSetBlisterValue,
	_onAddBlister,
	_onRemoveBlister,
	onSetIntakeValue,
	onAddIntake,
	onRemoveIntake,
	onHandleValueChange,
	meds,
	onUploadMedImage,
	onDeleteMedImage,
	onClose,
	_onResetForm,
	onSaveMedication,
}: MobileEditModalProps) {
	const { t } = useTranslation();
	const decrementValueLabel = t("editStock.decreaseValue");
	const incrementValueLabel = t("editStock.increaseValue");
	const [activeTab, setActiveTab] = useState<MobileTab>("general");
	const fieldsetRef = useRef<HTMLFieldSetElement | null>(null);
	const tabStripRef = useRef<HTMLDivElement | null>(null);
	const tabViewportRef = useRef<HTMLDivElement | null>(null);
	const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
	const swipeAxisRef = useRef<"x" | "y" | null>(null);
	const [swipeDeltaX, setSwipeDeltaX] = useState(0);
	const [isHorizontalSwiping, setIsHorizontalSwiping] = useState(false);
	const activeTabIndexRef = useRef(0);

	// Reset tab when modal opens
	useEffect(() => {
		if (show) setActiveTab("general");
	}, [show]);

	// Close on Escape key
	useEffect(() => {
		if (!show) return;
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose();
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [show, onClose]);

	// Lock background scroll while modal is open.
	useEffect(() => {
		if (!show) return;
		const html = document.documentElement;
		const body = document.body;
		const scrollY = window.scrollY;

		const hadHtmlModalClass = html.classList.contains("modal-open");
		const hadBodyModalClass = body.classList.contains("modal-open");

		const previousHtmlOverflow = html.style.overflow;
		const previousHtmlOverscrollBehavior = html.style.overscrollBehavior;
		const previousBodyOverflow = body.style.overflow;
		const previousBodyPosition = body.style.position;
		const previousBodyTop = body.style.top;
		const previousBodyLeft = body.style.left;
		const previousBodyRight = body.style.right;
		const previousBodyWidth = body.style.width;
		const previousBodyOverscrollBehavior = body.style.overscrollBehavior;

		html.classList.add("modal-open");
		body.classList.add("modal-open");
		html.style.overflow = "hidden";
		html.style.overscrollBehavior = "none";
		body.style.overflow = "hidden";
		body.style.position = "fixed";
		body.style.top = `-${scrollY}px`;
		body.style.left = "0";
		body.style.right = "0";
		body.style.width = "100%";
		body.style.overscrollBehavior = "none";

		return () => {
			if (!hadHtmlModalClass) html.classList.remove("modal-open");
			if (!hadBodyModalClass) body.classList.remove("modal-open");

			html.style.overflow = previousHtmlOverflow;
			html.style.overscrollBehavior = previousHtmlOverscrollBehavior;
			body.style.overflow = previousBodyOverflow;
			body.style.position = previousBodyPosition;
			body.style.top = previousBodyTop;
			body.style.left = previousBodyLeft;
			body.style.right = previousBodyRight;
			body.style.width = previousBodyWidth;
			body.style.overscrollBehavior = previousBodyOverscrollBehavior;

			window.scrollTo(0, scrollY);
		};
	}, [show]);

	// Keep activeTabIndex ref in sync for native listeners
	const activeTabIndex = MOBILE_TAB_ORDER.indexOf(activeTab);
	activeTabIndexRef.current = activeTabIndex;

	// Auto-scroll tab strip to keep active tab visible
	useEffect(() => {
		const strip = tabStripRef.current;
		if (!strip) return;
		const btn = strip.children[activeTabIndex] as HTMLElement | undefined;
		if (btn) btn.scrollIntoView?.({ behavior: "smooth", inline: "nearest", block: "nearest" });
	}, [activeTabIndex]);

	// Non-passive touch listeners for reliable horizontal swipe detection.
	// React's onTouchMove is passive, so e.preventDefault() is a no-op there.
	// With native { passive: false } we can block the browser's vertical scroll
	// when a horizontal swipe is detected, making tab swiping reliable.
	useEffect(() => {
		const fieldset = fieldsetRef.current;
		if (!show || !fieldset) return;

		const AXIS_LOCK_THRESHOLD = 6;

		function resetSwipe() {
			swipeStartRef.current = null;
			swipeAxisRef.current = null;
			setIsHorizontalSwiping(false);
			setSwipeDeltaX(0);
		}

		function onTouchStart(e: TouchEvent) {
			if (e.touches.length !== 1) {
				resetSwipe();
				return;
			}
			const touch = e.touches[0];
			swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
			swipeAxisRef.current = null;
			setIsHorizontalSwiping(false);
			setSwipeDeltaX(0);
		}

		function onTouchMove(e: TouchEvent) {
			if (!swipeStartRef.current || e.touches.length !== 1) return;

			const touch = e.touches[0];
			const dx = touch.clientX - swipeStartRef.current.x;
			const dy = touch.clientY - swipeStartRef.current.y;
			const ax = Math.abs(dx);
			const ay = Math.abs(dy);

			if (!swipeAxisRef.current) {
				if (ax < AXIS_LOCK_THRESHOLD && ay < AXIS_LOCK_THRESHOLD) return;
				swipeAxisRef.current = ax >= ay ? "x" : "y";
			}

			if (swipeAxisRef.current === "y") return;

			// Horizontal swipe — block native vertical scroll
			e.preventDefault();
			setIsHorizontalSwiping(true);

			let nextDelta = dx;
			const idx = activeTabIndexRef.current;
			if ((idx === 0 && nextDelta > 0) || (idx === MOBILE_TAB_ORDER.length - 1 && nextDelta < 0)) {
				nextDelta *= 0.35;
			}
			setSwipeDeltaX(nextDelta);
		}

		function onTouchEnd(e: TouchEvent) {
			if (!swipeStartRef.current || e.changedTouches.length !== 1) {
				resetSwipe();
				return;
			}

			if (swipeAxisRef.current === "x") {
				const touch = e.changedTouches[0];
				const dx = touch.clientX - swipeStartRef.current.x;
				const minSwipe = Math.max(36, (tabViewportRef.current?.clientWidth ?? 360) * 0.1);
				if (Math.abs(dx) >= minSwipe) {
					const direction = dx < 0 ? 1 : -1;
					const idx = activeTabIndexRef.current;
					const next = Math.min(Math.max(idx + direction, 0), MOBILE_TAB_ORDER.length - 1);
					if (next !== idx) {
						setActiveTab(MOBILE_TAB_ORDER[next]);
					}
				}
			}
			resetSwipe();
		}

		fieldset.addEventListener("touchstart", onTouchStart, { passive: true });
		fieldset.addEventListener("touchmove", onTouchMove, { passive: false });
		fieldset.addEventListener("touchend", onTouchEnd, { passive: true });
		fieldset.addEventListener("touchcancel", resetSwipe, { passive: true });
		return () => {
			fieldset.removeEventListener("touchstart", onTouchStart);
			fieldset.removeEventListener("touchmove", onTouchMove);
			fieldset.removeEventListener("touchend", onTouchEnd);
			fieldset.removeEventListener("touchcancel", resetSwipe);
		};
	}, [show]);

	if (!show) return null;

	const currentMed = editingId ? meds.find((m) => m.id === editingId) : null;
	const mobileTitle = (() => {
		if (!editingId) return t("form.newEntry");
		if (readOnlyMode) return t("form.viewEntry");
		const medicationName = currentMed?.name?.trim() || form.name.trim();
		if (!medicationName) return t("form.editEntry");
		return t("form.editEntryWithName", { name: medicationName });
	})();

	return (
		<div
			className="modal-overlay mobile-edit-overlay"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div
				className="modal-content edit-modal"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<div className="edit-modal-header">
					<button type="button" className="ghost small btn-nav" onClick={onClose}>
						← {t("common.back")}
					</button>
					<h2>{mobileTitle}</h2>
				</div>
				<form
					className="form-grid mobile-edit-form"
					autoComplete="off"
					spellCheck={false}
					autoCorrect="off"
					autoCapitalize="off"
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
					<div className="full form-tabs" role="tablist" aria-label={t("form.sections.general")} ref={tabStripRef}>
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
					<fieldset
						ref={fieldsetRef}
						className={`readonly-fieldset${isHorizontalSwiping ? " swiping-horizontal" : ""}`}
						disabled={readOnlyMode}
					>
						<div className="mobile-tab-viewport" ref={tabViewportRef}>
							<div
								className={`mobile-tab-track${isHorizontalSwiping ? " is-swiping" : ""}`}
								style={{ transform: `translateX(calc(${-activeTabIndex * 100}% + ${swipeDeltaX}px))` }}
							>
								<div className={`form-tab-panel${activeTab === "general" ? " active" : ""}`}>
									<div className="full form-category">
										<h4 className="form-category-title">{t("form.sections.general")}</h4>
										<label className={`full ${!readOnlyMode && fieldErrors.name ? "has-error" : ""}`}>
											{t("form.commercialName")}
											<input
												value={form.name}
												onChange={(e) => onFormChange({ ...form, name: e.target.value })}
												placeholder={t("form.placeholders.commercial")}
												maxLength={FIELD_LIMITS.name.max}
												required={!readOnlyMode}
											/>
											{!readOnlyMode && fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
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
										<label className="full">
											{t("form.medicationStartDate")}
											<DateInput
												value={form.medicationStartDate}
												onChange={(e) => onHandleValueChange("medicationStartDate", e.target.value)}
											/>
											{!readOnlyMode && dateConsistencyError && (
												<span className="field-error">{dateConsistencyError}</span>
											)}
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
														form.takenBy.length === 0
															? t("form.placeholders.takenBy")
															: t("form.placeholders.addPerson")
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
									</div>

									{editingId && (
										<div className="full form-category image-section">
											<h4 className="form-category-title">{t("form.medicationImage")}</h4>
											{currentMed?.imageUrl ? (
												<div className="image-preview">
													<img src={`/api/images/${currentMed.imageUrl}`} alt={currentMed.name} />
													<button
														type="button"
														className="danger icon-only tooltip-trigger"
														onClick={() => onDeleteMedImage(editingId)}
														aria-label={t("form.removeImage")}
														data-tooltip={t("form.removeImage")}
													>
														<Trash2 size={18} aria-hidden="true" />
													</button>
												</div>
											) : (
												<input
													type="file"
													accept="image/*"
													onChange={(e) => e.target.files?.[0] && onUploadMedImage(editingId, e.target.files[0])}
												/>
											)}
										</div>
									)}
								</div>
								<div className={`form-tab-panel${activeTab === "stock" ? " active" : ""}`}>
									<div className="full form-category">
										<h4 className="form-category-title">{t("form.sections.stock")}</h4>
										{form.packageType === "blister" ? (
											<>
												<label>
													{t("form.packs")}
													<FormNumberStepper
														value={form.packCount}
														onChange={(nextValue) => onHandleValueChange("packCount", nextValue)}
														min={0}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
												<label>
													{t("form.blistersPerPack")}
													<FormNumberStepper
														value={form.blistersPerPack}
														onChange={(nextValue) => onHandleValueChange("blistersPerPack", nextValue)}
														min={1}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
												<label>
													{t("form.pillsPerBlister")}
													<FormNumberStepper
														value={form.pillsPerBlister}
														onChange={(nextValue) => onHandleValueChange("pillsPerBlister", nextValue)}
														min={1}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
												<label>
													{t("form.total")}
													<div className="static-value">{deriveTotalFromForm(form)}</div>
												</label>
											</>
										) : (
											<>
												<label>
													{t("form.totalCapacity")}
													<FormNumberStepper
														value={form.totalPills}
														onChange={(nextValue) => onHandleValueChange("totalPills", nextValue)}
														min={0}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
												<label>
													{t("form.currentPills")}
													<FormNumberStepper
														value={form.looseTablets}
														onChange={(nextValue) => onHandleValueChange("looseTablets", nextValue)}
														min={0}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
											</>
										)}
										{form.packageType === "bottle" && (
											<div className="full stock-total-row">
												<div className="stock-total-field">
													<p className="sub">
														<strong>{t("form.total")}:</strong> {deriveTotalFromForm(form)}{" "}
														{deriveTotalFromForm(form) === 1 ? t("common.pill") : t("common.pills")}
													</p>
												</div>
											</div>
										)}
										<label className="full">
											{t("form.pillWeight")} ({form.doseUnit})
											<div className="dose-input-group">
												<input
													type="text"
													inputMode="decimal"
													pattern="[0-9]*\.?[0-9]*"
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
											<DateInput
												value={form.expiryDate}
												onChange={(e) => onFormChange({ ...form, expiryDate: e.target.value })}
											/>
										</label>
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
								<div className={`form-tab-panel${activeTab === "schedule" ? " active" : ""}`}>
									<div className="full form-category intake-section">
										<div className="form-category-header">
											<h4 className="form-category-title">{t("form.blisters.title")}</h4>
											{!readOnlyMode && (
												<button
													type="button"
													className="ghost add-blister icon-only tooltip-trigger"
													onClick={() => onAddIntake(form.takenBy.length === 1 ? form.takenBy[0] : undefined)}
													aria-label={t("form.blisters.addIntake")}
													data-tooltip={t("form.blisters.addIntake")}
												>
													<Plus size={18} aria-hidden="true" />
												</button>
											)}
										</div>
										{form.intakes.map((intake, idx) => (
											<div
												key={`${intake.startDate}-${intake.startTime}-${intake.usage}-${intake.every}-${intake.takenBy ?? ""}`}
												className="blister-row"
											>
												<label className="compact">
													<span>{t("form.blisters.usage")}</span>
													<FormNumberStepper
														value={intake.usage}
														onChange={(nextValue) => onSetIntakeValue(idx, "usage", nextValue)}
														min={0.5}
														step={0.5}
														allowDecimal={true}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
												<label className="compact">
													<span>{t("form.blisters.everyDays")}</span>
													<FormNumberStepper
														value={intake.every}
														onChange={(nextValue) => onSetIntakeValue(idx, "every", nextValue)}
														min={1}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
												<label className="compact full-row">
													<span>{t("form.blisters.startDate")}</span>
													<DateInput
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
													<label className="compact full-row taken-by-field">
														<span>{t("form.blisters.takenByIntake")}</span>
														<select
															value={intake.takenBy}
															onChange={(e) => onSetIntakeValue(idx, "takenBy", e.target.value)}
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
													<span className="legend-hint">
														<Bell size={14} aria-hidden="true" />
													</span>
													<label className="toggle-switch small">
														<input
															type="checkbox"
															checked={intake.intakeRemindersEnabled}
															onChange={(e) => onSetIntakeValue(idx, "intakeRemindersEnabled", e.target.checked)}
														/>
														<span className="toggle-slider"></span>
													</label>
												</div>
												{!readOnlyMode && form.intakes.length > 1 && (
													<button
														type="button"
														className="danger remove-blister-btn icon-only tooltip-trigger"
														onClick={() => onRemoveIntake(idx)}
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
								<div className={`form-tab-panel${activeTab === "prescription" ? " active" : ""}`}>
									<div className="full form-category">
										<h4 className="form-category-title">{t("form.sections.prescription")}</h4>
										<label className="full">
											{t("prescription.enabled")}
											<span className="toggle-switch small">
												<input
													type="checkbox"
													checked={form.prescriptionEnabled}
													onChange={(e) => onHandleValueChange("prescriptionEnabled", e.target.checked)}
												/>
												<span className="toggle-slider"></span>
											</span>
										</label>
										{form.prescriptionEnabled && (
											<>
												<label className="prescription-field">
													{t("prescription.authorizedRefills")}
													<FormNumberStepper
														value={form.prescriptionAuthorizedRefills}
														onChange={(nextValue) => onHandleValueChange("prescriptionAuthorizedRefills", nextValue)}
														min={0}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
												<label className="prescription-field">
													{t("prescription.remainingRefills")}
													<FormNumberStepper
														value={form.prescriptionRemainingRefills}
														onChange={(nextValue) => onHandleValueChange("prescriptionRemainingRefills", nextValue)}
														min={0}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
												<label className="prescription-field">
													{t("prescription.lowThreshold")}
													<FormNumberStepper
														value={form.prescriptionLowRefillThreshold}
														onChange={(nextValue) => onHandleValueChange("prescriptionLowRefillThreshold", nextValue)}
														min={0}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
												<label className="prescription-field">
													{t("prescription.expiryDate")}
													<DateInput
														value={form.prescriptionExpiryDate}
														onChange={(e) => onHandleValueChange("prescriptionExpiryDate", e.target.value)}
													/>
												</label>
											</>
										)}
									</div>
								</div>
							</div>
						</div>
					</fieldset>
					<div className="modal-footer">
						<button type="button" className="ghost" onClick={onClose}>
							{readOnlyMode || (formSaved && !formChanged) ? t("common.close") : t("common.cancel")}
						</button>
						{!readOnlyMode && (
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
			</div>
		</div>
	);
}
