/**
 * MobileEditModal - Full-screen edit form for medications (mobile-optimized)
 * Handles new medication creation and editing existing medications
 */

/* biome-ignore-all lint/a11y/noLabelWithoutControl: modal uses custom DateInput and static value fields */
import { ActionIcon } from "@mantine/core";
import { ArrowLeft, Bell, Minus, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MEDICATION_FORM_FIELD_LIMITS } from "../hooks/medicationFormModel";
import type {
	DoseUnit,
	FieldErrors,
	FormBlister,
	FormIntake,
	FormState,
	Medication,
	MedicationEnrichmentPackageOption,
	MedicationEnrichmentSearchResult,
	MedicationEnrichmentStrengthOption,
} from "../types";
import {
	allowsPillFormSelection,
	DOSE_UNITS,
	isAmountBasedPackageType,
	isDiscreteCountPackageType,
	isLiquidContainerPackageType,
	isPackageAmountPackageType,
	isTubePackageType,
	PACKAGE_PROFILES,
} from "../types";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import { AppCheckbox } from "../ui/primitives/AppCheckbox";
import { AppTooltip } from "../ui/primitives/AppTooltip";
import { deriveTotal } from "../utils";
import {
	getIntakeScheduleMode,
	getWeekdayLabel,
	hasSelectedWeekdays,
	toggleWeekdaySelection,
	WEEKDAY_CODES,
} from "../utils/intake-schedule";
import { DateInput, MonthInput } from "./DateInput";
import { FormNumberStepper } from "./FormNumberStepper";
import type { MedicationEnrichmentViewModel } from "./MedicationEnrichmentSection";
import { MedicationEnrichmentSection } from "./MedicationEnrichmentSection";
import classes from "./MobileEditModal.module.css";
import formClasses from "./medications/MedicationForm.module.css";

const MOBILE_TAB_ORDER = ["general", "stock", "schedule", "prescription"] as const;
type MobileTab = (typeof MOBILE_TAB_ORDER)[number];
const MOBILE_SWIPE_HINT_STORAGE_KEY = "medassist.mobileEditSwipeHintDismissed";

const EMPTY_MEDICATION_ENRICHMENT: MedicationEnrichmentViewModel = {
	query: "",
	results: [],
	hasMoreResults: false,
	isSearching: false,
	hasSearched: false,
	searchError: null,
	applyingCode: null,
	applyingPackageLabel: null,
	activeResultCode: null,
	appliedSelection: null,
	enrichError: null,
	meta: null,
	strengthOptions: [],
	packageOptions: [],
	appliedStrengthLabel: null,
	appliedPackageLabel: null,
};

function shouldShowInitialSwipeHint() {
	if (typeof window === "undefined") return true;
	try {
		return window.localStorage.getItem(MOBILE_SWIPE_HINT_STORAGE_KEY) !== "true";
	} catch {
		return true;
	}
}

function persistSwipeHintDismissed() {
	try {
		window.localStorage.setItem(MOBILE_SWIPE_HINT_STORAGE_KEY, "true");
	} catch {
		// Non-critical: the hint can still be dismissed for the current render.
	}
}

export interface MobileEditModalProps {
	show: boolean;
	editingId: number | null;
	form: FormState;
	onFormChange: (form: FormState) => void;
	medicationEnrichment?: MedicationEnrichmentViewModel;
	onMedicationEnrichmentQueryChange?: (value: string) => void;
	onMedicationEnrichmentSearch?: () => void;
	onMedicationEnrichmentLoadMore?: () => void;
	onMedicationEnrichmentApply?: (
		result: MedicationEnrichmentSearchResult,
		preferredPackageOption?: MedicationEnrichmentPackageOption
	) => void;
	onMedicationEnrichmentStrengthApply?: (option: MedicationEnrichmentStrengthOption) => void;
	onMedicationEnrichmentPackageApply?: (option: MedicationEnrichmentPackageOption) => void;
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
	onSetIntakeValue: <K extends keyof FormIntake>(idx: number, field: K, value: FormIntake[K]) => void;
	onAddIntake: (takenBy?: string) => void;
	onRemoveIntake: (idx: number) => void;
	onNoRegularScheduleChange: (checked: boolean) => void;
	// Value change handler for numeric fields
	onHandleValueChange: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
	// Image handling
	meds: Medication[];
	onUploadMedImage: (medId: number, file: File) => Promise<void>;
	onDeleteMedImage: (medId: number) => Promise<void>;
	imageUploadError: string | null;
	// Actions
	onClose: () => void;
	onResetForm: () => void;
	onSaveMedication: (e: React.FormEvent) => void;
}

/** Calculate total pills from form state */
function deriveTotalFromForm(form: FormState) {
	if (isAmountBasedPackageType(form.packageType)) {
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
	medicationEnrichment = EMPTY_MEDICATION_ENRICHMENT,
	onMedicationEnrichmentQueryChange = () => {},
	onMedicationEnrichmentSearch = () => {},
	onMedicationEnrichmentLoadMore = () => {},
	onMedicationEnrichmentApply = () => {},
	onMedicationEnrichmentStrengthApply = () => {},
	onMedicationEnrichmentPackageApply = () => {},
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
	onSetBlisterValue: _onSetBlisterValue,
	onAddBlister: _onAddBlister,
	onRemoveBlister: _onRemoveBlister,
	onSetIntakeValue,
	onAddIntake,
	onRemoveIntake,
	onNoRegularScheduleChange,
	onHandleValueChange,
	meds,
	onUploadMedImage,
	onDeleteMedImage,
	imageUploadError,
	onClose,
	onResetForm: _onResetForm,
	onSaveMedication,
}: MobileEditModalProps) {
	const { t } = useTranslation();
	const decrementValueLabel = t("editStock.decreaseValue");
	const incrementValueLabel = t("editStock.increaseValue");
	const [activeTab, setActiveTab] = useState<MobileTab>("general");
	const fieldsetRef = useRef<HTMLFieldSetElement | null>(null);
	const tabStripRef = useRef<HTMLDivElement | null>(null);
	const tabViewportRef = useRef<HTMLDivElement | null>(null);
	const [tabViewportElement, setTabViewportElement] = useState<HTMLDivElement | null>(null);
	const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
	const swipeAxisRef = useRef<"x" | "y" | null>(null);
	const [swipeDeltaX, setSwipeDeltaX] = useState(0);
	const [isHorizontalSwiping, setIsHorizontalSwiping] = useState(false);
	const [showSwipeHint, setShowSwipeHint] = useState(shouldShowInitialSwipeHint);
	const [showNameValidation, setShowNameValidation] = useState(false);
	const activeTabIndexRef = useRef(0);
	const setTabViewportRef = useCallback((node: HTMLDivElement | null) => {
		tabViewportRef.current = node;
		setTabViewportElement(node);
	}, []);
	const dismissSwipeHint = useCallback(() => {
		setShowSwipeHint(false);
		persistSwipeHintDismissed();
	}, []);

	const allowFractionalIntake = useMemo(() => {
		if (isLiquidContainerPackageType(form.packageType)) return true;
		if (isTubePackageType(form.packageType)) return form.medicationForm === "liquid";
		return form.pillForm === "tablet";
	}, [form.packageType, form.medicationForm, form.pillForm]);

	const getDiscreteUnitLabel = useCallback(
		(count: number) => {
			if (form.packageType === "inhaler") return count === 1 ? t("common.puff") : t("common.puffs");
			if (form.packageType === "injection") return count === 1 ? t("common.injection") : t("common.injections");
			return count === 1 ? t("common.pill") : t("common.pills");
		},
		[form.packageType, t]
	);

	const getUsageLabel = useCallback(
		(intake: (typeof form.intakes)[number]) => {
			if (isLiquidContainerPackageType(form.packageType)) {
				if (intake.intakeUnit === "tsp") return t("form.blisters.usageTsp");
				if (intake.intakeUnit === "tbsp") return t("form.blisters.usageTbsp");
				return t("form.blisters.usageMl");
			}
			if (isTubePackageType(form.packageType)) {
				return form.medicationForm === "liquid" ? t("form.blisters.usageMl") : t("form.blisters.usageApplication");
			}
			if (form.packageType === "inhaler") return t("common.puffs");
			if (form.packageType === "injection") return t("common.injections");
			if (form.pillForm === "capsule") return t("form.blisters.usageCapsules");
			return t("form.blisters.usageTablets");
		},
		[form.packageType, form.medicationForm, form.pillForm, t]
	);

	const usesAmountLabels = isPackageAmountPackageType(form.packageType);
	const usesCountLabels = isDiscreteCountPackageType(form.packageType) && form.packageType !== "bottle";
	const totalCapacityLabel = usesAmountLabels ? t("form.totalAmount") : t("form.totalCapacity");
	let currentStockLabel = t("form.currentPills");
	if (usesAmountLabels) {
		currentStockLabel = t("form.currentAmount");
	} else if (usesCountLabels) {
		currentStockLabel = t("form.currentStockCount");
	}
	let totalLabel = t("form.total");
	if (usesAmountLabels) {
		totalLabel = t("form.totalAmountLabel");
	} else if (usesCountLabels) {
		totalLabel = t("form.totalCount");
	}
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

	// Reset tab when modal opens
	useEffect(() => {
		if (show) {
			setActiveTab("general");
			setShowNameValidation(false);
		}
	}, [show]);

	useEffect(() => {
		if (show && (hasValidationErrors || !!fieldErrors.name)) {
			setShowNameValidation(true);
		}
	}, [show, hasValidationErrors, fieldErrors.name]);

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
		const swipeSurface = tabViewportElement;
		if (!show || !swipeSurface) return;

		const AXIS_LOCK_THRESHOLD = 6;
		const touchListenerOptions = { capture: true };

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

		swipeSurface.addEventListener("touchstart", onTouchStart, { ...touchListenerOptions, passive: true });
		swipeSurface.addEventListener("touchmove", onTouchMove, { ...touchListenerOptions, passive: false });
		swipeSurface.addEventListener("touchend", onTouchEnd, { ...touchListenerOptions, passive: true });
		swipeSurface.addEventListener("touchcancel", resetSwipe, { ...touchListenerOptions, passive: true });
		return () => {
			swipeSurface.removeEventListener("touchstart", onTouchStart, touchListenerOptions);
			swipeSurface.removeEventListener("touchmove", onTouchMove, touchListenerOptions);
			swipeSurface.removeEventListener("touchend", onTouchEnd, touchListenerOptions);
			swipeSurface.removeEventListener("touchcancel", resetSwipe, touchListenerOptions);
		};
	}, [show, tabViewportElement]);

	if (!show) return null;

	const currentMed = editingId ? meds.find((m) => m.id === editingId) : null;
	const mobileTitle = (() => {
		if (!editingId) return t("form.newEntry");
		if (readOnlyMode) return t("form.viewEntry");
		const medicationName =
			(currentMed ? currentMed.name?.trim() || currentMed.genericName?.trim() : null) ||
			form.name.trim() ||
			form.genericName.trim();
		if (!medicationName) return t("form.editEntry");
		return t("form.editEntryWithName", { name: medicationName });
	})();
	const closeLabel = readOnlyMode || (formSaved && !formChanged) ? t("common.close") : t("common.cancel");
	const tabPanelTransform = `translateX(calc(${-activeTabIndex * 100}% + ${swipeDeltaX}px))`;
	const modalHeader = (
		<div className={classes.headerTitle}>
			<AppButton
				type="button"
				className={classes.backButton}
				tone="secondary"
				leftSection={<ArrowLeft size={16} aria-hidden="true" />}
				onClick={onClose}
			>
				{t("common.back")}
			</AppButton>
			<h2>{mobileTitle}</h2>
		</div>
	);

	return (
		<AppModal
			centered={false}
			classNames={{
				body: classes.body,
				header: classes.header,
				inner: classes.inner,
				title: classes.title,
			}}
			closeButtonProps={{ "aria-label": t("common.close") }}
			contentClassName={classes.content}
			onClose={onClose}
			opened={show}
			size="95vw"
			title={modalHeader}
			withCloseButton
		>
			<form
				className={[classes.form, "form-grid"].join(" ")}
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
				<div className={classes.tabList} role="tablist" aria-label={t("form.sections.general")} ref={tabStripRef}>
					{MOBILE_TAB_ORDER.map((tab) => (
						<button
							key={tab}
							type="button"
							role="tab"
							aria-selected={activeTab === tab}
							className={[classes.tab, activeTab === tab ? classes.tabActive : ""].filter(Boolean).join(" ")}
							onClick={() => setActiveTab(tab)}
						>
							{t(`form.sections.${tab}`)}
						</button>
					))}
				</div>
				{showSwipeHint && (
					<div className={classes.swipeHint} role="note">
						<span>{t("form.mobileSwipeHint")}</span>
						<ActionIcon
							type="button"
							aria-label={t("form.dismissSwipeHint")}
							className={classes.swipeHintClose}
							color="gray"
							onClick={dismissSwipeHint}
							size="sm"
							variant="subtle"
						>
							<X size={14} aria-hidden="true" />
						</ActionIcon>
					</div>
				)}
				<fieldset
					ref={fieldsetRef}
					className={[classes.fieldset, isHorizontalSwiping ? classes.fieldsetSwiping : ""].filter(Boolean).join(" ")}
					disabled={readOnlyMode}
				>
					<div className={classes.tabViewport} ref={setTabViewportRef} data-testid="mobile-edit-tab-viewport">
						<div
							className={[classes.tabTrack, isHorizontalSwiping ? classes.tabTrackSwiping : ""]
								.filter(Boolean)
								.join(" ")}
							style={{ transform: tabPanelTransform }}
						>
							<div className={[classes.tabPanel, activeTab === "general" ? classes.tabPanelActive : ""].join(" ")}>
								<div className={["full", formClasses.category, classes.category].join(" ")}>
									<h4 className={formClasses.categoryTitle}>{t("form.sections.general")}</h4>
									<div className={classes.sectionCard}>
										<label
											className={`full ${!readOnlyMode && showNameValidation && fieldErrors.name ? "has-error" : ""}`}
										>
											{t("form.commercialName")}
											<input
												value={form.name}
												onChange={(e) => {
													setShowNameValidation(true);
													onFormChange({ ...form, name: e.target.value });
												}}
												onBlur={() => setShowNameValidation(true)}
												placeholder={t("form.placeholders.commercial")}
												maxLength={MEDICATION_FORM_FIELD_LIMITS.name.max}
											/>
											{!readOnlyMode && showNameValidation && fieldErrors.name && (
												<span className="field-error">{fieldErrors.name}</span>
											)}
										</label>
										<label
											className={`full ${!readOnlyMode && showNameValidation && fieldErrors.genericName ? "has-error" : ""}`}
										>
											{t("form.genericName")}
											<input
												value={form.genericName}
												onChange={(e) => {
													setShowNameValidation(true);
													onFormChange({ ...form, genericName: e.target.value });
												}}
												onBlur={() => setShowNameValidation(true)}
												placeholder={t("form.placeholders.generic")}
												maxLength={MEDICATION_FORM_FIELD_LIMITS.genericName.max}
											/>
											{!readOnlyMode && showNameValidation && fieldErrors.genericName && (
												<span className="field-error">{fieldErrors.genericName}</span>
											)}
										</label>
										<MedicationEnrichmentSection
											state={medicationEnrichment}
											onQueryChange={onMedicationEnrichmentQueryChange}
											onSearch={onMedicationEnrichmentSearch}
											onLoadMoreResults={onMedicationEnrichmentLoadMore}
											onApplyResult={onMedicationEnrichmentApply}
											onApplyStrength={onMedicationEnrichmentStrengthApply}
											onApplyPackage={onMedicationEnrichmentPackageApply}
										/>
										<div className="full date-pair-group">
											<label className="date-pair-field">
												{t("form.medicationStartDate")}
												<DateInput
													value={form.medicationStartDate}
													onChange={(e) => onHandleValueChange("medicationStartDate", e.target.value)}
													placeholder={t("common.optional")}
												/>
												{!readOnlyMode && dateConsistencyError && (
													<span className="field-error">{dateConsistencyError}</span>
												)}
											</label>
											<label className="date-pair-field">
												{t("form.medicationEndDate")}
												<DateInput
													value={form.medicationEndDate}
													onChange={(e) => onHandleValueChange("medicationEndDate", e.target.value)}
													placeholder={t("common.optional")}
												/>
											</label>
										</div>
										<label className="full">
											{t("form.packageType")}
											<select
												className={[formClasses.selectField, formClasses.packageTypeSelect].join(" ")}
												value={form.packageType}
												onChange={(e) => onHandleValueChange("packageType", e.target.value as FormState["packageType"])}
											>
												{PACKAGE_PROFILES.map((profile) => (
													<option key={profile.value} value={profile.value}>
														{t(profile.labelKey)}
													</option>
												))}
											</select>
										</label>
										{allowsPillFormSelection(form.packageType) && (
											<label className="full">
												{t("form.pillForm")}
												<select
													className={formClasses.selectField}
													value={form.pillForm}
													onChange={(e) => onHandleValueChange("pillForm", e.target.value as FormState["pillForm"])}
												>
													<option value="tablet">{t("form.medicationFormTablet")}</option>
													<option value="capsule">{t("form.medicationFormCapsule")}</option>
												</select>
											</label>
										)}
										{isTubePackageType(form.packageType) && (
											<label className="full">
												{t("form.medicationForm")}
												<select
													className={formClasses.selectField}
													value={"topical"}
													onChange={() => onHandleValueChange("medicationForm", "topical")}
												>
													<option value="topical">{t("form.medicationFormTopical")}</option>
												</select>
											</label>
										)}
										{isLiquidContainerPackageType(form.packageType) && (
											<label className="full">
												{t("form.medicationForm")}
												<select
													className={formClasses.selectField}
													value={"liquid"}
													onChange={() => onHandleValueChange("medicationForm", "liquid")}
												>
													<option value="liquid">{t("form.medicationFormLiquid")}</option>
												</select>
											</label>
										)}
										{form.medicationEndDate && (
											<label className={`full ${formClasses.inlineToggleField}`}>
												<span className={formClasses.inlineToggleText}>{t("form.autoMarkObsoleteAfterEndDate")}</span>
												<span className="toggle-switch small">
													<input
														type="checkbox"
														checked={form.autoMarkObsoleteAfterEndDate}
														onChange={(e) => onHandleValueChange("autoMarkObsoleteAfterEndDate", e.target.checked)}
													/>
													<span className="toggle-slider"></span>
												</span>
											</label>
										)}
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
													maxLength={MEDICATION_FORM_FIELD_LIMITS.takenBy.max}
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
								</div>

								{editingId && (
									<div className={["full", formClasses.category, formClasses.imageSection].join(" ")}>
										<h4 className={formClasses.categoryTitle}>{t("form.medicationImage")}</h4>
										{currentMed?.imageUrl ? (
											<div className={formClasses.imagePreview}>
												<img
													className={formClasses.imagePreviewImage}
													src={`/api/images/${currentMed.imageUrl}`}
													alt={currentMed.name}
												/>
												<AppTooltip label={t("form.removeImage")}>
													<ActionIcon
														type="button"
														color="red"
														variant="filled"
														onClick={() => onDeleteMedImage(editingId)}
														aria-label={t("form.removeImage")}
													>
														<Trash2 size={18} aria-hidden="true" />
													</ActionIcon>
												</AppTooltip>
											</div>
										) : (
											<input
												type="file"
												accept="image/*"
												onChange={(e) => {
													const file = e.target.files?.[0];
													e.target.value = "";
													if (file) void onUploadMedImage(editingId, file);
												}}
											/>
										)}
										{imageUploadError && <span className="field-error">{imageUploadError}</span>}
									</div>
								)}
							</div>
							<div className={[classes.tabPanel, activeTab === "stock" ? classes.tabPanelActive : ""].join(" ")}>
								<div className={["full", formClasses.category, classes.category].join(" ")}>
									<h4 className={formClasses.categoryTitle}>{t("form.sections.stock")}</h4>
									<div className={classes.sectionCard}>
										{(() => {
											if (!isAmountBasedPackageType(form.packageType)) {
												return (
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
												);
											}

											if (isTubePackageType(form.packageType)) {
												return (
													<>
														<label>
															{t("form.tubes")}
															<div className="static-value">1</div>
														</label>
														<label className="full">
															{t("form.packageAmountPerTube")}
															<div className="dose-input-group">
																<input
																	type="text"
																	inputMode="decimal"
																	pattern="[0-9]*\.?[0-9]*"
																	value={form.packageAmountValue ?? "0"}
																	onChange={(e) => onHandleValueChange("packageAmountValue", e.target.value)}
																	placeholder="0"
																/>
																<select
																	value="g"
																	disabled
																	className={[formClasses.selectField, formClasses.doseUnitSelect].join(" ")}
																	aria-label={t("form.packageAmountUnitG")}
																>
																	<option value="g">{t("form.packageAmountUnitG")}</option>
																</select>
															</div>
														</label>
														<label>
															{t("form.totalAmount")}
															<div className="static-value">
																{(Number(form.packCount) || 0) * (Number(form.packageAmountValue ?? 0) || 0)}{" "}
																{t("form.packageAmountUnitG")}
															</div>
														</label>
													</>
												);
											}

											if (isLiquidContainerPackageType(form.packageType)) {
												return (
													<>
														<label>
															{t("form.bottles")}
															<FormNumberStepper
																value={form.packCount}
																onChange={(nextValue) => onHandleValueChange("packCount", nextValue)}
																min={1}
																decrementLabel={decrementValueLabel}
																incrementLabel={incrementValueLabel}
															/>
														</label>
														<label className="full">
															{t("form.packageAmountPerBottle")}
															<div className="dose-input-group">
																<input
																	type="text"
																	inputMode="decimal"
																	pattern="[0-9]*\.?[0-9]*"
																	value={form.packageAmountValue ?? "0"}
																	onChange={(e) => onHandleValueChange("packageAmountValue", e.target.value)}
																	placeholder="0"
																/>
																<select
																	value="ml"
																	disabled
																	className={[formClasses.selectField, formClasses.doseUnitSelect].join(" ")}
																	aria-label={t("form.packageAmountUnitMl")}
																>
																	<option value="ml">{t("form.packageAmountUnitMl")}</option>
																</select>
															</div>
														</label>
														<label>
															{t("form.totalAmount")}
															<div className="static-value">
																{(Number(form.packCount) || 0) * (Number(form.packageAmountValue ?? 0) || 0)}{" "}
																{t("form.packageAmountUnitMl")}
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
															onChange={(nextValue) => onHandleValueChange("totalPills", nextValue)}
															min={0}
															decrementLabel={decrementValueLabel}
															incrementLabel={incrementValueLabel}
														/>
													</label>
													<label>
														{currentStockLabel}
														<FormNumberStepper
															value={form.looseTablets}
															onChange={(nextValue) => onHandleValueChange("looseTablets", nextValue)}
															min={0}
															decrementLabel={decrementValueLabel}
															incrementLabel={incrementValueLabel}
														/>
													</label>
												</>
											);
										})()}
										{isAmountBasedPackageType(form.packageType) && !isTubePackageType(form.packageType) && (
											<div className="full stock-total-row">
												<div className="stock-total-field">
													<p className="sub">
														<strong>{totalLabel}:</strong> {deriveTotalFromForm(form)}
														{` ${getDiscreteUnitLabel(deriveTotalFromForm(form))}`}
													</p>
												</div>
											</div>
										)}
										{allowsPillFormSelection(form.packageType) && (
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
														className={[formClasses.selectField, formClasses.doseUnitSelect].join(" ")}
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
										<label className="full">
											{t("form.expiryDate")}
											<MonthInput
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
												maxLength={MEDICATION_FORM_FIELD_LIMITS.notes.max}
												className="auto-resize"
												onInput={(e) => {
													const target = e.target as HTMLTextAreaElement;
													target.style.height = "auto";
													target.style.height = `${target.scrollHeight}px`;
												}}
											/>
											{form.notes.length > 0 && (
												<span
													className={`char-count ${form.notes.length > MEDICATION_FORM_FIELD_LIMITS.notes.max * 0.9 ? "warning" : ""}`}
												>
													{t("common.validation.tooLong", {
														current: form.notes.length,
														max: MEDICATION_FORM_FIELD_LIMITS.notes.max,
													})}
												</span>
											)}
											{fieldErrors.notes && <span className="field-error">{fieldErrors.notes}</span>}
										</label>
									</div>
								</div>
							</div>
							<div className={[classes.tabPanel, activeTab === "schedule" ? classes.tabPanelActive : ""].join(" ")}>
								<div className={["full", formClasses.category, formClasses.intakeSection, classes.category].join(" ")}>
									<div className={formClasses.categoryHeader}>
										<h4 className={formClasses.categoryTitle}>{t("form.blisters.title")}</h4>
										{!readOnlyMode && form.intakes.length > 0 && (
											<AppTooltip label={t("form.blisters.addIntake")}>
												<ActionIcon
													data-testid="add-intake-button"
													type="button"
													color="brand"
													variant="subtle"
													onClick={() => onAddIntake(form.takenBy.length === 1 ? form.takenBy[0] : undefined)}
													aria-label={t("form.blisters.addIntake")}
												>
													<Plus size={18} aria-hidden="true" />
												</ActionIcon>
											</AppTooltip>
										)}
									</div>
									<AppCheckbox
										data-testid="no-regular-schedule"
										checked={form.intakes.length === 0}
										disabled={readOnlyMode}
										label={t("form.blisters.noRegularSchedule")}
										onChange={onNoRegularScheduleChange}
									/>
									{form.intakes.length === 0 && (
										<div className={formClasses.noScheduleEmpty}>{t("form.blisters.noRegularScheduleHint")}</div>
									)}
									{form.intakes.map((intake, idx) => {
										const scheduleMode = getIntakeScheduleMode(intake);
										const selectedWeekdays = intake.weekdays ?? [];
										const intakeKey = `${intake.startDate}-${intake.startTime}-${intake.usage}-${intake.every}-${scheduleMode}-${selectedWeekdays.join("")}-${intake.takenBy ?? ""}-${intake.intakeUnit ?? "unit"}-${intake.intakeRemindersEnabled ? "reminder" : "silent"}`;
										return (
											<div key={intakeKey} className={`blister-row ${classes.intakeRow}`}>
												<label className="compact">
													<span>{getUsageLabel(intake)}</span>
													<FormNumberStepper
														value={intake.usage}
														onChange={(nextValue) => onSetIntakeValue(idx, "usage", nextValue)}
														min={allowFractionalIntake ? 0.5 : 1}
														step={allowFractionalIntake ? 0.5 : 1}
														allowDecimal={allowFractionalIntake}
														decrementLabel={decrementValueLabel}
														incrementLabel={incrementValueLabel}
													/>
												</label>
												<label className="compact">
													<span>{t("form.blisters.scheduleMode")}</span>
													<select
														className={formClasses.selectField}
														value={scheduleMode}
														onChange={(e) =>
															onSetIntakeValue(idx, "scheduleMode", e.target.value as "interval" | "weekdays")
														}
													>
														<option value="interval">{t("form.blisters.scheduleModeInterval")}</option>
														<option value="weekdays">{t("form.blisters.scheduleModeWeekdays")}</option>
													</select>
												</label>
												{scheduleMode === "interval" ? (
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
												) : (
													<label className="compact full-row">
														<span>{t("form.blisters.weekdays")}</span>
														<div className="badges">
															{weekdayOptions.map((weekday) => {
																const isSelected = selectedWeekdays.includes(weekday.value);
																return (
																	<AppTooltip key={weekday.value} label={weekday.longLabel}>
																		<button
																			type="button"
																			className={isSelected ? "pill clickable" : "pill clickable neutral"}
																			aria-label={weekday.longLabel}
																			aria-pressed={isSelected}
																			onClick={() =>
																				onSetIntakeValue(
																					idx,
																					"weekdays",
																					toggleWeekdaySelection(selectedWeekdays, weekday.value)
																				)
																			}
																		>
																			{weekday.shortLabel}
																		</button>
																	</AppTooltip>
																);
															})}
														</div>
														{!readOnlyMode && hasWeekdaySelectionError(intake) && (
															<span className="field-error">{t("form.blisters.weekdaysRequired")}</span>
														)}
													</label>
												)}
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
												{isLiquidContainerPackageType(form.packageType) && (
													<label className="compact full-row">
														<span>{t("form.blisters.intakeUnit")}</span>
														<select
															className={formClasses.selectField}
															value={intake.intakeUnit}
															onChange={(e) =>
																onSetIntakeValue(idx, "intakeUnit", e.target.value as "ml" | "tsp" | "tbsp")
															}
														>
															<option value="ml">{t("form.blisters.intakeUnitMl")}</option>
															<option value="tsp">{t("form.blisters.intakeUnitTsp")}</option>
															<option value="tbsp">{t("form.blisters.intakeUnitTbsp")}</option>
														</select>
													</label>
												)}
												{form.takenBy.length === 0 ? null : (
													<label className="compact full-row taken-by-field">
														<span>{t("form.blisters.takenByIntake")}</span>
														<select
															className={formClasses.selectField}
															value={intake.takenBy}
															onChange={(e) => onSetIntakeValue(idx, "takenBy", e.target.value)}
														>
															<option value="">{t("common.none")}</option>
															{form.takenBy.map((person) => (
																<option key={person} value={person}>
																	{person}
																</option>
															))}
														</select>
													</label>
												)}
												<div className="remind-toggle-row">
													<span className="legend-hint">
														<Bell size={14} aria-hidden="true" />
													</span>
													<AppCheckbox
														checked={intake.intakeRemindersEnabled}
														label={t("form.blisters.remind")}
														onChange={(checked) => onSetIntakeValue(idx, "intakeRemindersEnabled", checked)}
														tooltip={t("form.blisters.remindTooltip")}
													/>
												</div>
												{!readOnlyMode && (
													<AppButton
														type="button"
														tone="secondary"
														className={classes.removeIntakeButton}
														leftSection={<Minus size={16} aria-hidden="true" />}
														onClick={() => onRemoveIntake(idx)}
													>
														{t("common.remove")}
													</AppButton>
												)}
											</div>
										);
									})}
								</div>
							</div>
							<div className={[classes.tabPanel, activeTab === "prescription" ? classes.tabPanelActive : ""].join(" ")}>
								<div className={["full", formClasses.category, classes.category].join(" ")}>
									<h4 className={formClasses.categoryTitle}>{t("form.sections.prescription")}</h4>
									<div className={classes.sectionCard}>
										<div className="full">
											<AppCheckbox
												checked={form.prescriptionEnabled}
												label={t("prescription.enabled")}
												onChange={(checked) => onHandleValueChange("prescriptionEnabled", checked)}
											/>
										</div>
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
					</div>
				</fieldset>
				<AppModalFooter>
					<AppButton type="button" tone="secondary" onClick={onClose}>
						{closeLabel}
					</AppButton>
					{!readOnlyMode && (
						<AppButton
							type="submit"
							disabled={saving || (!formChanged && (formSaved || !!editingId))}
							tone={hasValidationErrors || dateConsistencyError || hasWeekdayScheduleError ? "warning" : "primary"}
						>
							{formSaved && !formChanged ? t("common.saved") : t("common.save")}
						</AppButton>
					)}
				</AppModalFooter>
			</form>
		</AppModal>
	);
}
