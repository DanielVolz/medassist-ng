/**
 * MedDetailModal - Medication detail view with nested modals
 * Displays medication information, stock, schedules, and provides refill/edit functionality
 *
 * Can work in two modes:
 * 1. Context mode: Uses useAppContext() for all state (when no props provided)
 * 2. Props mode: Accepts all required data as props (for gradual adoption)
 */
/* biome-ignore-all lint/a11y/noLabelWithoutControl: modal uses label-styled wrappers with custom interactive rows */
/* biome-ignore-all lint/style/noNestedTernary: stock/preview rendering keeps explicit branch mapping */

import { ActionIcon } from "@mantine/core";
import {
	AlertTriangle,
	Bell,
	Calendar,
	ClipboardList,
	FilePenLine,
	Info,
	Minus,
	NotebookPen,
	Pencil,
	Plus,
} from "lucide-react";
import { Fragment, type MouseEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type {
	AsNeededIntakeEvent,
	AsNeededIntakeMutationResponse,
	Coverage,
	Medication,
	RefillEntry,
	StockThresholds,
} from "../types";
import {
	allowsPillFormSelection,
	getMedDisplayName,
	getMedTotal,
	getPackageSize,
	getStockDisplayCapacity,
	type IntakeUnit,
	isAmountBasedPackageType,
	isLiquidContainerPackageType,
	isTubePackageType,
} from "../types";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import { AppTextAction } from "../ui/primitives/AppTextAction";
import { AppTooltip, AppTooltipTrigger } from "../ui/primitives/AppTooltip";
import { StatusBadge, type StatusTone } from "../ui/primitives/StatusBadge";
import {
	formatDisplayDate,
	formatDisplayDateTime,
	formatExpiryDate,
	formatNumber,
	generateICS,
	getExpiryClass,
	getSystemLocale,
} from "../utils";
import { getIntakeFrequencyText, getMedicationIntakes } from "../utils/intake-schedule";
import { getLiquidCountUnitLabel } from "../utils/intake-units";
import { getStockStatus } from "../utils/schedule";
import { splitCurrentBlisterStock } from "../utils/stock";
import { AsNeededIntakeHistory } from "./AsNeededIntakeHistory";
import stepperClasses from "./FormNumberStepper.module.css";
import { Lightbox } from "./Lightbox";
import classes from "./MedDetailModal.module.css";
import { MedicationAvatar } from "./MedicationAvatar";

// =============================================================================
// Local Helper Functions
// =============================================================================

/**
 * Format full blisters column
 */
function formatFullBlisters(fullBlisters: number, t: (key: string) => string): string {
	if (fullBlisters === 0) return "—";
	return `${fullBlisters} ${fullBlisters === 1 ? t("common.blister") : t("common.blisters")}`;
}

/**
 * Format open blister column
 */
function formatOpenBlisterAndLoose(
	openBlisterPills: number,
	loosePills: number,
	pillsPerBlister: number,
	t: (key: string) => string
): string {
	if (openBlisterPills > 0 && loosePills > 0) {
		return `${openBlisterPills} ${t("common.of")} ${pillsPerBlister} ${t("common.pills")} + ${loosePills} ${t("modal.loosePills")}`;
	}
	if (openBlisterPills > 0) {
		return `${openBlisterPills} ${t("common.of")} ${pillsPerBlister} ${t("common.pills")}`;
	}
	if (loosePills > 0) {
		return `${loosePills} ${t("modal.loosePills")}`;
	}
	return "—";
}

function cx(...classNames: Array<string | false | null | undefined>) {
	return classNames.filter(Boolean).join(" ");
}

function getStatusTone(className?: string): StatusTone {
	if (className === "danger" || className === "warning" || className === "high" || className === "success") {
		return className;
	}
	return "info";
}

function getValueToneClass(className?: string) {
	if (className === "danger" || className === "danger-text") return classes["danger-text"];
	if (className === "warning" || className === "warning-text") return classes["warning-text"];
	return classes["success-text"];
}

// =============================================================================
// Props Interface
// =============================================================================

export interface MedDetailModalProps {
	// Required
	selectedMed: Medication | null;
	coverage: { all: Coverage[] };
	settings: StockThresholds;
	// Modal state
	showImageLightbox: boolean;
	showRefillModal: boolean;
	showEditStockModal: boolean;
	editStockOnly?: boolean;
	// Modal actions
	onClose: () => void;
	onOpenImageLightbox: () => void;
	onCloseImageLightbox: () => void;
	onOpenRefillModal: () => void;
	onCloseRefillModal: () => void;
	onOpenMedicationEdit?: () => void;
	onOpenEditStockModal?: () => void;
	onOpenRecordNow?: () => void;
	onReplaceAsNeeded?: (event: AsNeededIntakeEvent) => void;
	onReverseAsNeeded?: (input: {
		eventId: string;
		expectedRevision: number;
		idempotencyKey: string;
	}) => Promise<AsNeededIntakeMutationResponse>;
	onCloseEditStockModal: () => void;
	onOpenUserFilter?: (person: string) => void;
	showAsNeededHistory?: boolean;
	canRecordAsNeeded?: boolean;
	asNeededHistoryRefreshVersion?: number;
	// Refill state
	refillPacks: number;
	onRefillPacksChange: (value: number) => void;
	refillLoose: number;
	onRefillLooseChange: (value: number) => void;
	usePrescriptionRefill: boolean;
	onUsePrescriptionRefillChange: (value: boolean) => void;
	refillSaving: boolean;
	refillHistory: RefillEntry[];
	refillHistoryExpanded: boolean;
	onRefillHistoryExpandedChange: (value: boolean) => void;
	onSubmitRefill: (medId: number, usePrescription?: boolean) => Promise<void>;
	// Edit stock state
	editStockFullBlisters: number;
	onEditStockFullBlistersChange: (value: number) => void;
	editStockPartialBlisterPills: number;
	onEditStockPartialBlisterPillsChange: (value: number) => void;
	editStockLoosePills: number;
	onEditStockLoosePillsChange: (value: number) => void;
	editStockSaving: boolean;
	onSubmitStockCorrection: (medId: number) => Promise<void>;
}

export function MedDetailModal({
	selectedMed,
	coverage,
	settings,
	showImageLightbox,
	showRefillModal,
	showEditStockModal,
	editStockOnly = false,
	onClose,
	onOpenImageLightbox,
	onCloseImageLightbox,
	onOpenRefillModal,
	onCloseRefillModal,
	onOpenMedicationEdit,
	onOpenEditStockModal,
	onOpenRecordNow,
	onReplaceAsNeeded,
	onReverseAsNeeded,
	onCloseEditStockModal,
	onOpenUserFilter,
	showAsNeededHistory = false,
	canRecordAsNeeded = false,
	asNeededHistoryRefreshVersion = 0,
	refillPacks,
	onRefillPacksChange,
	refillLoose,
	onRefillLooseChange,
	usePrescriptionRefill,
	onUsePrescriptionRefillChange,
	refillSaving,
	refillHistory,
	refillHistoryExpanded,
	onRefillHistoryExpandedChange,
	onSubmitRefill,
	editStockFullBlisters,
	onEditStockFullBlistersChange,
	editStockPartialBlisterPills,
	onEditStockPartialBlisterPillsChange,
	editStockLoosePills,
	onEditStockLoosePillsChange,
	editStockSaving,
	onSubmitStockCorrection,
}: MedDetailModalProps) {
	const { t, i18n } = useTranslation();
	const [editStockFullInput, setEditStockFullInput] = useState("0");
	const [editStockPartialInput, setEditStockPartialInput] = useState("0");
	const [editStockLooseInput, setEditStockLooseInput] = useState("0");
	const [showStockCapNotice, setShowStockCapNotice] = useState(false);
	const detailModalRef = useRef<HTMLDivElement | null>(null);

	const parseStockInput = (value: string): number => {
		const parsed = Number.parseInt(value, 10);
		return Number.isNaN(parsed) ? 0 : parsed;
	};

	useEffect(() => {
		if (showEditStockModal) {
			setEditStockFullInput(String(editStockFullBlisters));
			setEditStockPartialInput(String(editStockPartialBlisterPills));
			setEditStockLooseInput(String(editStockLoosePills));
			setShowStockCapNotice(false);
		}
	}, [showEditStockModal, editStockFullBlisters, editStockPartialBlisterPills, editStockLoosePills]);

	// Escape key: only one handler is active at a time (sub-modal states are mutually exclusive).
	// Lightbox has its own useEscapeKey internally.
	useEscapeKey(!showEditStockModal && !showImageLightbox && !showRefillModal, onClose);
	useEscapeKey(showEditStockModal, onCloseEditStockModal, { capture: true });
	useEscapeKey(showRefillModal, onCloseRefillModal, { capture: true });

	const openPersonFilter = (person: string) => {
		onOpenUserFilter?.(person);
	};

	const handlePersonClick = (person: string, event: MouseEvent<HTMLElement>) => {
		event.stopPropagation();
		openPersonFilter(person);
	};

	const renderPersonName = (person: string, className: string, color?: string) => {
		if (!onOpenUserFilter) {
			return <span className={className}>{person}</span>;
		}

		return (
			<AppTextAction className={className} color={color} onClick={(event) => handlePersonClick(person, event)}>
				{person}
			</AppTextAction>
		);
	};

	useEffect(() => {
		if (showEditStockModal) return;
		window.requestAnimationFrame(() => {
			detailModalRef.current?.focus();
		});
	}, [showEditStockModal]);

	const remainingPrescriptionRefills = Math.max(0, Number(selectedMed?.prescriptionRemainingRefills) || 0);
	const prescriptionPackCapEnabled = !isAmountBasedPackageType(selectedMed?.packageType) && usePrescriptionRefill;
	const cappedRefillPacks = prescriptionPackCapEnabled
		? Math.min(refillPacks, remainingPrescriptionRefills)
		: refillPacks;
	const exceedsPrescriptionPackLimit = prescriptionPackCapEnabled && refillPacks > remainingPrescriptionRefills;

	useEffect(() => {
		if (!selectedMed) return;
		if (!showRefillModal) return;
		if (isAmountBasedPackageType(selectedMed.packageType) || !usePrescriptionRefill) return;
		if (refillPacks <= remainingPrescriptionRefills) return;
		onRefillPacksChange(remainingPrescriptionRefills);
	}, [
		selectedMed,
		showRefillModal,
		usePrescriptionRefill,
		refillPacks,
		remainingPrescriptionRefills,
		onRefillPacksChange,
	]);

	if (!selectedMed) return null;
	const displayLocale = getSystemLocale(i18n.language);
	const isAmountPackage =
		isTubePackageType(selectedMed.packageType) || isLiquidContainerPackageType(selectedMed.packageType);
	const getDiscreteUnitLabel = (value: number) => {
		if (selectedMed.packageType === "inhaler") return value === 1 ? t("common.puff") : t("common.puffs");
		if (selectedMed.packageType === "injection") return value === 1 ? t("common.injection") : t("common.injections");
		return value === 1 ? t("common.pill") : t("common.pills");
	};
	const amountUnitLabel =
		isLiquidContainerPackageType(selectedMed.packageType) || selectedMed.medicationForm === "liquid"
			? t("form.packageAmountUnitMl")
			: t("form.packageAmountUnitG");
	const stockUnitLabel = isAmountPackage ? amountUnitLabel : null;
	const scheduleIntakes = getMedicationIntakes(selectedMed);
	const hasRegularSchedule = scheduleIntakes.length > 0;
	const hasAnyIntakeReminder = scheduleIntakes.some((intake) => intake.intakeRemindersEnabled === true);

	const medCoverage = coverage.all.find((c) => c.name === getMedDisplayName(selectedMed));
	const runsOutLabel = medCoverage
		? formatDisplayDate(medCoverage.depletionTime ?? medCoverage.depletionDate, displayLocale, {
				weekday: true,
				fallback: medCoverage.depletionDate ?? "—",
			})
		: "—";
	const packageSize = getPackageSize(selectedMed);
	const stockDisplayCapacity = getStockDisplayCapacity(selectedMed);
	// Structural max = sealed package capacity only (excludes pre-existing looseTablets).
	const structuralMax = isAmountBasedPackageType(selectedMed.packageType)
		? stockDisplayCapacity
		: selectedMed.packCount * selectedMed.blistersPerPack * selectedMed.pillsPerBlister;
	const currentStock = medCoverage ? medCoverage.medsLeft : getMedTotal(selectedMed);
	const status =
		medCoverage && hasRegularSchedule ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
	const textClass = getValueToneClass(status?.className);
	const stock = splitCurrentBlisterStock(currentStock, selectedMed.pillsPerBlister, selectedMed.looseTablets);
	const currentFullBlisters = Math.max(0, stock.fullBlisters);
	const currentPartialPills = Math.max(0, stock.openBlisterPills);
	const currentLoosePills = Math.max(0, stock.loosePills);
	const stockDisplayTotal = isAmountBasedPackageType(selectedMed.packageType)
		? stockDisplayCapacity
		: Math.max(0, structuralMax);
	const packageCount = Math.max(1, Number(selectedMed.packCount) || 1);
	const amountPerPackage = (() => {
		const configured = Number(selectedMed.packageAmountValue ?? 0);
		if (Number.isFinite(configured) && configured > 0) return configured;

		const totalAmount = Number(stockDisplayTotal ?? 0);
		if (Number.isFinite(totalAmount) && totalAmount > 0) {
			return Math.max(0, totalAmount / packageCount);
		}

		return 0;
	})();
	const maxPartialPills = Math.min(
		Math.max(0, selectedMed.pillsPerBlister),
		Math.max(0, structuralMax - Math.max(0, editStockFullBlisters) * selectedMed.pillsPerBlister)
	);
	const partialForDisplay = Math.min(Math.max(0, editStockPartialBlisterPills), maxPartialPills);
	const maxFullBlisters = Math.floor(structuralMax / selectedMed.pillsPerBlister);
	const closeLabel = t("common.close");
	const decrementLabel = t("editStock.decreaseValue");
	const incrementLabel = t("editStock.increaseValue");
	const showPillWeightDetails = allowsPillFormSelection(selectedMed.packageType) && !!selectedMed.pillWeightMg;
	const pillWeightMg = showPillWeightDetails ? (selectedMed.pillWeightMg ?? 0) : 0;
	const isTubeRefillPackage = isTubePackageType(selectedMed.packageType);
	const isLiquidRefillPackage =
		isLiquidContainerPackageType(selectedMed.packageType) || selectedMed.medicationForm === "liquid";
	const isCountBasedAmountRefillPackage = isLiquidRefillPackage || isTubeRefillPackage;
	const liquidRefillAmountPerBottle = Math.max(1, Math.round(Number.isFinite(amountPerPackage) ? amountPerPackage : 1));
	const amountRefillPackageCount = Math.max(0, Math.round(refillLoose / liquidRefillAmountPerBottle));
	const getScheduleUsageLabel = (usage: number, intakeUnit?: IntakeUnit | null) => {
		if (isLiquidContainerPackageType(selectedMed.packageType)) {
			return `${usage} ${getLiquidCountUnitLabel(intakeUnit, usage, t)}`;
		}
		if (isTubePackageType(selectedMed.packageType)) {
			return `${usage} ${t("form.blisters.applications", { count: Math.abs(usage) })}`;
		}
		return `${usage} ${getDiscreteUnitLabel(usage)}`;
	};
	const normalizeBlisterStock = (nextFull: number, nextPartial: number, nextLoose: number) => {
		let normalizedFull = Math.max(0, nextFull);
		let normalizedPartial = Math.max(0, nextPartial);
		const normalizedLoose = Math.max(0, nextLoose);

		if (selectedMed.pillsPerBlister > 0) {
			normalizedFull += Math.floor(normalizedPartial / selectedMed.pillsPerBlister);
			normalizedPartial %= selectedMed.pillsPerBlister;
		}

		// Enforce cap only for sealed package pills (full + partial).
		const sealedTotal = normalizedFull * selectedMed.pillsPerBlister + normalizedPartial;
		if (sealedTotal > structuralMax) {
			const excess = sealedTotal - structuralMax;
			const partialReduction = Math.min(normalizedPartial, excess);
			normalizedPartial -= partialReduction;
			const remainingExcess = excess - partialReduction;
			if (remainingExcess > 0) {
				normalizedFull = Math.max(0, normalizedFull - Math.ceil(remainingExcess / selectedMed.pillsPerBlister));
			}
		}

		return { full: normalizedFull, partial: normalizedPartial, loose: normalizedLoose };
	};

	const renderStepperInput = ({
		value,
		min,
		max,
		onChange,
		onBlur,
		onStep,
	}: {
		value: string;
		min: number;
		max: number;
		onChange: (raw: string) => void;
		onBlur: () => void;
		onStep: (delta: number) => void;
	}) => {
		const parsed = Number.parseInt(value, 10);
		const current = Number.isNaN(parsed) ? min : parsed;
		const canDecrement = current > min;
		const canIncrement = current < max;

		return (
			<div className={stepperClasses.numberStepper}>
				<input
					type="number"
					min={min}
					max={max}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onBlur={onBlur}
				/>
				<button
					type="button"
					className={cx(stepperClasses.stepperButton, stepperClasses.decrement)}
					onClick={() => onStep(-1)}
					disabled={!canDecrement}
					aria-label={decrementLabel}
				>
					<Minus size={16} aria-hidden="true" />
				</button>
				<button
					type="button"
					className={cx(stepperClasses.stepperButton, stepperClasses.increment)}
					onClick={() => onStep(1)}
					disabled={!canIncrement}
					aria-label={incrementLabel}
				>
					<Plus size={16} aria-hidden="true" />
				</button>
			</div>
		);
	};

	const renderRefillStepperInput = ({
		value,
		min,
		max,
		onChange,
	}: {
		value: number;
		min: number;
		max: number;
		onChange: (next: number) => void;
	}) => {
		const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
		const canDecrement = clamped > min;
		const canIncrement = clamped < max;

		return (
			<div className={stepperClasses.numberStepper}>
				<input
					type="number"
					min={min}
					max={max}
					value={clamped}
					onChange={(e) => {
						const parsed = Number.parseInt(e.target.value, 10);
						onChange(Number.isNaN(parsed) ? min : Math.min(max, Math.max(min, parsed)));
					}}
				/>
				<button
					type="button"
					className={cx(stepperClasses.stepperButton, stepperClasses.decrement)}
					onClick={() => onChange(Math.max(min, clamped - 1))}
					disabled={!canDecrement}
					aria-label={decrementLabel}
				>
					<Minus size={16} aria-hidden="true" />
				</button>
				<button
					type="button"
					className={cx(stepperClasses.stepperButton, stepperClasses.increment)}
					onClick={() => onChange(Math.min(max, clamped + 1))}
					disabled={!canIncrement}
					aria-label={incrementLabel}
				>
					<Plus size={16} aria-hidden="true" />
				</button>
			</div>
		);
	};

	const renderEditStockModal = () => {
		if (!showEditStockModal) return null;
		const isLiquidPackage = isLiquidContainerPackageType(selectedMed.packageType);
		const liquidBottleCount = Math.max(1, editStockFullBlisters);
		const liquidAmountPerBottle = Math.max(1, Number.isFinite(amountPerPackage) ? amountPerPackage : 1);
		const liquidCapacity = Math.max(1, Math.round(liquidBottleCount * liquidAmountPerBottle));
		const fullInputMax = Math.min(
			maxFullBlisters,
			Math.floor(Math.max(0, structuralMax - Math.max(0, editStockPartialBlisterPills)) / selectedMed.pillsPerBlister)
		);

		return (
			<AppModal
				closeButtonProps={{ "aria-label": closeLabel }}
				closeOnEscape={false}
				contentClassName={classes["edit-stock-modal"]}
				manageEscape={false}
				onClose={onCloseEditStockModal}
				opened={showEditStockModal}
				size="sm"
				title={t("editStock.title")}
				withCloseButton
			>
				<p className={classes["edit-stock-med-name"]}>{getMedDisplayName(selectedMed)}</p>
				<p className={classes["edit-stock-hint"]}>{t("editStock.hint")}</p>
				{!isAmountBasedPackageType(selectedMed.packageType) && (
					<p className={cx(classes["edit-stock-cap-info"], classes["edit-stock-live-breakdown"])}>
						{t("editStock.currentComposition", {
							fullBlisters: currentFullBlisters,
							partialPills: currentPartialPills,
							loosePills: currentLoosePills,
							total: Math.max(0, currentStock),
						})}
					</p>
				)}
				{isAmountBasedPackageType(selectedMed.packageType) && !isTubePackageType(selectedMed.packageType) && (
					<p className={classes["edit-stock-cap-info"]}>{t("editStock.packageSize", { count: structuralMax })}</p>
				)}
				{(isTubePackageType(selectedMed.packageType) || isLiquidContainerPackageType(selectedMed.packageType)) && (
					<p className={classes["edit-stock-cap-info"]}>
						{t("form.totalAmount")}: {formatNumber(isLiquidPackage ? liquidCapacity : structuralMax)} {amountUnitLabel}
					</p>
				)}
				{showStockCapNotice && (
					<p className={classes["edit-stock-cap-warning"]}>{t("editStock.maxExceeded", { count: structuralMax })}</p>
				)}

				{(() => {
					const dbTotal = getMedTotal(selectedMed);
					const currentTotal = medCoverage ? Math.round(medCoverage.medsLeft) : dbTotal;
					const isBottle = isAmountBasedPackageType(selectedMed.packageType);
					const enteredTotal = isLiquidPackage
						? Math.min(liquidCapacity, editStockPartialBlisterPills)
						: isBottle
							? editStockPartialBlisterPills
							: editStockFullBlisters * selectedMed.pillsPerBlister +
								editStockPartialBlisterPills +
								editStockLoosePills;
					const newTotal = Math.max(0, enteredTotal);
					const difference = newTotal - currentTotal;
					const differenceClass = difference > 0 ? "positive" : difference < 0 ? "negative" : "";

					return (
						<>
							<div className={classes["edit-stock-form"]}>
								{isBottle ? (
									<label>
										{isAmountPackage ? t("form.currentAmount") : t("editStock.totalPills")}
										{renderStepperInput({
											value: editStockPartialInput,
											min: 0,
											max: isLiquidPackage ? liquidCapacity : structuralMax,
											onChange: (raw) => {
												const parsed = raw === "" ? 0 : Math.max(0, parseStockInput(raw));
												setEditStockPartialInput(raw);
												const maxTotal = isLiquidPackage ? liquidCapacity : structuralMax;
												onEditStockPartialBlisterPillsChange(raw === "" ? 0 : Math.min(maxTotal, parsed));
												setShowStockCapNotice(parsed > maxTotal);
											},
											onBlur: () => {
												const maxTotal = isLiquidPackage ? liquidCapacity : structuralMax;
												const normalized = Math.min(maxTotal, Math.max(0, parseStockInput(editStockPartialInput)));
												onEditStockPartialBlisterPillsChange(normalized);
												setEditStockPartialInput(String(normalized));
												setShowStockCapNotice(false);
											},
											onStep: (delta) => {
												const maxTotal = isLiquidPackage ? liquidCapacity : structuralMax;
												const next = Math.min(maxTotal, Math.max(0, parseStockInput(editStockPartialInput) + delta));
												onEditStockPartialBlisterPillsChange(next);
												setEditStockPartialInput(String(next));
												setShowStockCapNotice(false);
											},
										})}
										{isLiquidPackage && (
											<p className={cx(classes["edit-stock-cap-info"], classes["edit-stock-cap-info-spaced"])}>
												{t("form.currentAmount")}: {Math.max(0, editStockPartialBlisterPills)} {amountUnitLabel} /{" "}
												{liquidCapacity} {amountUnitLabel}
											</p>
										)}
									</label>
								) : (
									<>
										<label>
											{t("editStock.fullBlisters")}{" "}
											{t("editStock.pillsPerBlister", { count: selectedMed.pillsPerBlister })}
											{renderStepperInput({
												value: editStockFullInput,
												min: 0,
												max: fullInputMax,
												onChange: (raw) => {
													const rawFull = raw === "" ? 0 : Math.max(0, parseStockInput(raw));
													const rawPartial = Math.max(0, parseStockInput(editStockPartialInput));
													const rawLoose = Math.max(0, parseStockInput(editStockLooseInput));
													setEditStockFullInput(raw);
													const normalized = normalizeBlisterStock(rawFull, rawPartial, rawLoose);
													onEditStockFullBlistersChange(normalized.full);
													onEditStockPartialBlisterPillsChange(normalized.partial);
													onEditStockLoosePillsChange(normalized.loose);
													setEditStockFullInput(String(normalized.full));
													setEditStockPartialInput(String(normalized.partial));
													setEditStockLooseInput(String(normalized.loose));
													setShowStockCapNotice(rawFull * selectedMed.pillsPerBlister + rawPartial > structuralMax);
												},
												onBlur: () => {
													const normalized = normalizeBlisterStock(
														Math.max(0, parseStockInput(editStockFullInput)),
														Math.max(0, parseStockInput(editStockPartialInput)),
														Math.max(0, parseStockInput(editStockLooseInput))
													);
													onEditStockFullBlistersChange(normalized.full);
													onEditStockPartialBlisterPillsChange(normalized.partial);
													onEditStockLoosePillsChange(normalized.loose);
													setEditStockFullInput(String(normalized.full));
													setEditStockPartialInput(String(normalized.partial));
													setEditStockLooseInput(String(normalized.loose));
													setShowStockCapNotice(false);
												},
												onStep: (delta) => {
													const rawFull = Math.max(0, parseStockInput(editStockFullInput) + delta);
													const rawPartial = Math.max(0, parseStockInput(editStockPartialInput));
													const rawLoose = Math.max(0, parseStockInput(editStockLooseInput));
													const normalized = normalizeBlisterStock(rawFull, rawPartial, rawLoose);
													onEditStockFullBlistersChange(normalized.full);
													onEditStockPartialBlisterPillsChange(normalized.partial);
													onEditStockLoosePillsChange(normalized.loose);
													setEditStockFullInput(String(normalized.full));
													setEditStockPartialInput(String(normalized.partial));
													setEditStockLooseInput(String(normalized.loose));
													setShowStockCapNotice(rawFull * selectedMed.pillsPerBlister + rawPartial > structuralMax);
												},
											})}
										</label>
										<label>
											{t("editStock.partialBlisterPills")} {partialForDisplay} {t("common.of")}{" "}
											{selectedMed.pillsPerBlister} ({t("common.max")} {maxPartialPills})
											{renderStepperInput({
												value: editStockPartialInput,
												min: 0,
												max: maxPartialPills,
												onChange: (raw) => {
													if (raw === "") {
														setEditStockPartialInput("0");
														onEditStockPartialBlisterPillsChange(0);
														setShowStockCapNotice(false);
														return;
													}
													const nextPartial = Math.max(0, parseStockInput(raw));
													const nextFull = Math.max(0, parseStockInput(editStockFullInput));
													const nextLoose = Math.max(0, parseStockInput(editStockLooseInput));
													const rawTotal = nextFull * selectedMed.pillsPerBlister + nextPartial + nextLoose;
													const normalized = normalizeBlisterStock(nextFull, nextPartial, nextLoose);
													onEditStockFullBlistersChange(normalized.full);
													onEditStockPartialBlisterPillsChange(normalized.partial);
													onEditStockLoosePillsChange(normalized.loose);
													setEditStockFullInput(String(normalized.full));
													setEditStockPartialInput(String(normalized.partial));
													setEditStockLooseInput(String(normalized.loose));
													setShowStockCapNotice(rawTotal > structuralMax);
												},
												onBlur: () => {
													const normalized = normalizeBlisterStock(
														Math.max(0, parseStockInput(editStockFullInput)),
														Math.max(0, parseStockInput(editStockPartialInput)),
														Math.max(0, parseStockInput(editStockLooseInput))
													);
													onEditStockFullBlistersChange(normalized.full);
													onEditStockPartialBlisterPillsChange(normalized.partial);
													onEditStockLoosePillsChange(normalized.loose);
													setEditStockFullInput(String(normalized.full));
													setEditStockPartialInput(String(normalized.partial));
													setEditStockLooseInput(String(normalized.loose));
													setShowStockCapNotice(false);
												},
												onStep: (delta) => {
													const nextPartial = Math.max(0, parseStockInput(editStockPartialInput) + delta);
													const nextFull = Math.max(0, parseStockInput(editStockFullInput));
													const nextLoose = Math.max(0, parseStockInput(editStockLooseInput));
													const normalized = normalizeBlisterStock(nextFull, nextPartial, nextLoose);
													onEditStockFullBlistersChange(normalized.full);
													onEditStockPartialBlisterPillsChange(normalized.partial);
													onEditStockLoosePillsChange(normalized.loose);
													setEditStockFullInput(String(normalized.full));
													setEditStockPartialInput(String(normalized.partial));
													setEditStockLooseInput(String(normalized.loose));
													setShowStockCapNotice(nextFull * selectedMed.pillsPerBlister + nextPartial > structuralMax);
												},
											})}
										</label>
										<label>
											{t("editStock.loosePills")}
											{renderStepperInput({
												value: editStockLooseInput,
												min: 0,
												max: Number.MAX_SAFE_INTEGER,
												onChange: (raw) => {
													const nextLoose = raw === "" ? 0 : Math.max(0, parseStockInput(raw));
													setEditStockLooseInput(raw);
													onEditStockLoosePillsChange(nextLoose);
												},
												onBlur: () => {
													const normalized = Math.max(0, parseStockInput(editStockLooseInput));
													onEditStockLoosePillsChange(normalized);
													setEditStockLooseInput(String(normalized));
												},
												onStep: (delta) => {
													const next = Math.max(0, parseStockInput(editStockLooseInput) + delta);
													onEditStockLoosePillsChange(next);
													setEditStockLooseInput(String(next));
												},
											})}
										</label>
									</>
								)}
								{isLiquidPackage && (
									<label>
										{t("form.bottles")}
										{renderStepperInput({
											value: editStockFullInput,
											min: 1,
											max: Number.MAX_SAFE_INTEGER,
											onChange: (raw) => {
												const nextBottleCount = raw === "" ? 1 : Math.max(1, parseStockInput(raw));
												setEditStockFullInput(raw === "" ? "1" : raw);
												onEditStockFullBlistersChange(nextBottleCount);
												const syncedTotal = Math.round(nextBottleCount * liquidAmountPerBottle);
												onEditStockPartialBlisterPillsChange(syncedTotal);
												setEditStockPartialInput(String(syncedTotal));
												setShowStockCapNotice(false);
											},
											onBlur: () => {
												const normalized = Math.max(1, parseStockInput(editStockFullInput));
												onEditStockFullBlistersChange(normalized);
												setEditStockFullInput(String(normalized));
												const syncedTotal = Math.round(normalized * liquidAmountPerBottle);
												onEditStockPartialBlisterPillsChange(syncedTotal);
												setEditStockPartialInput(String(syncedTotal));
												setShowStockCapNotice(false);
											},
											onStep: (delta) => {
												const next = Math.max(1, parseStockInput(editStockFullInput) + delta);
												onEditStockFullBlistersChange(next);
												setEditStockFullInput(String(next));
												const syncedTotal = Math.round(next * liquidAmountPerBottle);
												onEditStockPartialBlisterPillsChange(syncedTotal);
												setEditStockPartialInput(String(syncedTotal));
												setShowStockCapNotice(false);
											},
										})}
									</label>
								)}
							</div>

							<div className={classes["edit-stock-summary"]}>
								<div className={classes["summary-row"]}>
									<span>{t("editStock.currentTotal")}:</span>
									<span>
										{currentTotal}
										{isAmountPackage ? ` ${stockUnitLabel}` : ` ${getDiscreteUnitLabel(currentTotal)}`}
									</span>
								</div>
								<div className={classes["summary-row"]}>
									<span>{t("editStock.newTotal")}:</span>
									<span>
										{newTotal}
										{isAmountPackage ? ` ${stockUnitLabel}` : ` ${getDiscreteUnitLabel(newTotal)}`}
									</span>
								</div>
								<div
									className={cx(
										classes["summary-row"],
										classes.difference,
										differenceClass && classes[differenceClass]
									)}
								>
									<span>{t("editStock.difference")}:</span>
									<span>
										{difference > 0 ? "+" : ""}
										{difference}
										{isAmountPackage ? ` ${stockUnitLabel}` : ` ${getDiscreteUnitLabel(Math.abs(difference))}`}
									</span>
								</div>
							</div>
						</>
					);
				})()}

				<AppModalFooter>
					<AppButton type="button" tone="secondary" onClick={onCloseEditStockModal}>
						{t("common.close")}
					</AppButton>
					<AppButton
						type="button"
						tone="primary"
						onClick={() => onSubmitStockCorrection(selectedMed.id)}
						disabled={editStockSaving}
					>
						{editStockSaving ? t("editStock.saving") : t("editStock.save")}
					</AppButton>
				</AppModalFooter>
			</AppModal>
		);
	};

	if (editStockOnly) {
		return renderEditStockModal();
	}

	return (
		<AppModal
			classNames={{
				body: classes["med-detail-modal-shell-body"],
				header: classes["med-detail-modal-shell-header"],
			}}
			closeButtonProps={{ "aria-label": closeLabel }}
			closeOnEscape={false}
			contentClassName={classes["med-detail-modal"]}
			manageEscape={false}
			onClose={onClose}
			opened={Boolean(selectedMed)}
			rootClassName={classes["med-detail-overlay"]}
			size={711}
			withCloseButton
		>
			<div ref={detailModalRef} tabIndex={-1} className={classes["med-detail-focus-scope"]}>
				<div className={classes["med-detail-body"]}>
					{/* Header */}
					<div className={classes["med-detail-header"]}>
						<div
							className={cx(classes["med-detail-avatar-wrapper"], selectedMed.imageUrl && classes.clickable)}
							onClick={() => selectedMed.imageUrl && onOpenImageLightbox()}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									if (selectedMed.imageUrl) onOpenImageLightbox();
								}
							}}
						>
							<MedicationAvatar name={getMedDisplayName(selectedMed)} imageUrl={selectedMed.imageUrl} size="lg" />
							{selectedMed.imageUrl && <span className={classes["expand-icon"]}>🔍</span>}
						</div>
						<div className={classes["med-detail-titles"]}>
							<h2>{getMedDisplayName(selectedMed)}</h2>
							{selectedMed.name && selectedMed.genericName && (
								<span className={classes["med-generic-name"]}>{selectedMed.genericName}</span>
							)}
							{selectedMed.takenBy && (selectedMed.takenBy || []).length > 0 && (
								<span className={classes["med-taken-by"]}>
									{t("modal.for")}{" "}
									{selectedMed.takenBy.map((person, index) => (
										<span key={person} className={classes["taken-by-person-wrapper"]}>
											{index > 0 && (
												<span className={classes["taken-by-separator"]}>
													{index === selectedMed.takenBy.length - 1 ? t("common.and") : ","}
												</span>
											)}
											<span className={classes["taken-by-person"]}>
												{renderPersonName(person, classes["taken-by-name"], "white")}
												{selectedMed.intakes?.some(
													(intake) => intake.takenBy === person && intake.intakeRemindersEnabled
												) && <span className={classes["taken-by-badge"]}>🔔</span>}
											</span>
										</span>
									))}
								</span>
							)}
						</div>
					</div>

					{/* Stock Info Section */}
					<div className={classes["med-detail-section"]}>
						<h3>{t("modal.stockInfo")}</h3>
						<div className={classes["med-detail-grid"]}>
							{!isAmountBasedPackageType(selectedMed.packageType) && (
								<Fragment key="discrete-stock-details">
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("table.fullBlisters")}</span>
										<span className={cx(classes["med-detail-value"], textClass)}>
											{formatFullBlisters(stock.fullBlisters, t)}
										</span>
									</div>
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("table.openBlister")}</span>
										<span className={cx(classes["med-detail-value"], textClass)}>
											{formatOpenBlisterAndLoose(
												stock.openBlisterPills,
												stock.loosePills,
												selectedMed.pillsPerBlister ?? 1,
												t
											)}
										</span>
									</div>
								</Fragment>
							)}
							<div className={cx(classes["med-detail-item"], classes["full-width"])}>
								<span className={classes["med-detail-label"]}>
									{isAmountPackage ? t("form.currentAmount") : t("modal.currentStock")}
								</span>
								<span className={cx(classes["med-detail-value"], textClass)}>
									{isAmountPackage
										? `${formatNumber(currentStock)} / ${formatNumber(stockDisplayTotal)} ${amountUnitLabel}`
										: `${currentStock} / ${stockDisplayTotal}`}
									{currentStock > stockDisplayTotal && (
										<AppTooltip label={t("tooltips.stockExceedsCapacity")}>
											<button
												type="button"
												aria-label={t("tooltips.stockExceedsCapacity")}
												className={cx(classes["inline-icon"], classes["warning-icon"])}
											>
												<AlertTriangle size={14} aria-hidden="true" />
											</button>
										</AppTooltip>
									)}
								</span>
							</div>
						</div>
					</div>

					{showAsNeededHistory ? (
						<AsNeededIntakeHistory
							key={`${selectedMed.id}:${asNeededHistoryRefreshVersion}`}
							medicationId={selectedMed.id}
							canRecordNow={canRecordAsNeeded}
							onRecordNow={() => onOpenRecordNow?.()}
							onReplace={onReplaceAsNeeded}
							onReverse={onReverseAsNeeded}
						/>
					) : null}

					{/* Package Details Section */}
					<div className={classes["med-detail-section"]}>
						<h3>
							{t("modal.packageDetails")} (
							{isTubePackageType(selectedMed.packageType)
								? t("form.packageTypeTube")
								: isLiquidContainerPackageType(selectedMed.packageType)
									? t("form.packageTypeLiquidContainer")
									: isAmountBasedPackageType(selectedMed.packageType)
										? t("form.packageTypeBottle")
										: t("form.packageTypeBlister")}
							)
							{isTubePackageType(selectedMed.packageType) && (
								<AppTooltip label={t("modal.packageTypeTubeHint")}>
									<button
										type="button"
										aria-label={t("modal.packageTypeTubeHint")}
										className={cx(classes["inline-icon"], classes["info-icon"])}
									>
										<Info size={14} aria-hidden="true" />
									</button>
								</AppTooltip>
							)}
							{isLiquidContainerPackageType(selectedMed.packageType) && (
								<AppTooltip label={t("modal.packageTypeLiquidHint")}>
									<button
										type="button"
										aria-label={t("modal.packageTypeLiquidHint")}
										className={cx(classes["inline-icon"], classes["info-icon"])}
									>
										<Info size={14} aria-hidden="true" />
									</button>
								</AppTooltip>
							)}
						</h3>
						<div className={classes["med-detail-grid"]}>
							{!isAmountBasedPackageType(selectedMed.packageType) ? (
								<Fragment key="blister-package-details">
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("modal.packs")}</span>
										<span className={classes["med-detail-value"]}>{selectedMed.packCount}</span>
									</div>
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("modal.blistersPerPack")}</span>
										<span className={classes["med-detail-value"]}>{selectedMed.blistersPerPack}</span>
									</div>
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("modal.pillsPerBlister")}</span>
										<span className={classes["med-detail-value"]}>{selectedMed.pillsPerBlister}</span>
									</div>
								</Fragment>
							) : isLiquidContainerPackageType(selectedMed.packageType) ? (
								<Fragment key="liquid-package-details">
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("form.bottles")}</span>
										<span className={classes["med-detail-value"]}>{packageCount}</span>
									</div>
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("form.packageAmountPerBottle")}</span>
										<span className={classes["med-detail-value"]}>
											{formatNumber(amountPerPackage)} {amountUnitLabel}
										</span>
									</div>
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("form.totalAmount")}</span>
										<span className={classes["med-detail-value"]}>
											{formatNumber(stockDisplayTotal)} {amountUnitLabel}
										</span>
									</div>
								</Fragment>
							) : isTubePackageType(selectedMed.packageType) ? (
								<Fragment key="tube-package-details">
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("form.tubes")}</span>
										<span className={classes["med-detail-value"]}>{packageCount}</span>
									</div>
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("form.packageAmountPerTube")}</span>
										<span className={classes["med-detail-value"]}>
											{formatNumber(amountPerPackage)} {amountUnitLabel}
										</span>
									</div>
									<div className={classes["med-detail-item"]}>
										<span className={classes["med-detail-label"]}>{t("form.totalAmount")}</span>
										<span className={classes["med-detail-value"]}>
											{formatNumber(stockDisplayTotal)} {amountUnitLabel}
										</span>
									</div>
								</Fragment>
							) : (
								<div className={classes["med-detail-item"]}>
									<span className={classes["med-detail-label"]}>{t("form.totalCapacity")}</span>
									<span className={classes["med-detail-value"]}>{(selectedMed.totalPills ?? packageSize) || "—"}</span>
								</div>
							)}
							{showPillWeightDetails && (
								<div className={classes["med-detail-item"]}>
									<span className={classes["med-detail-label"]}>{t("modal.pillWeight")}</span>
									<span className={classes["med-detail-value"]}>
										{selectedMed.pillWeightMg} {selectedMed.doseUnit ?? "mg"}
									</span>
								</div>
							)}
							{selectedMed.expiryDate && (
								<div className={classes["med-detail-item"]}>
									<span className={classes["med-detail-label"]}>{t("modal.expiryDate")}</span>
									<span
										className={cx(
											classes["med-detail-value"],
											getValueToneClass(getExpiryClass(selectedMed.expiryDate, settings.expiryWarningDays))
										)}
									>
										{formatExpiryDate(selectedMed.expiryDate, displayLocale)}
									</span>
								</div>
							)}
						</div>
					</div>

					{/* Intake Schedule Section */}
					<div className={classes["med-detail-section"]}>
						<h3>
							{t("modal.intakeSchedule")}{" "}
							{hasAnyIntakeReminder && (
								<AppTooltip label={t("tooltips.intakeReminders")}>
									<button type="button" aria-label={t("tooltips.intakeReminders")} className={classes["reminder-icon"]}>
										<Bell size={14} aria-hidden="true" />
									</button>
								</AppTooltip>
							)}
						</h3>
						{hasRegularSchedule ? (
							<div className={classes["med-detail-schedules"]}>
								{scheduleIntakes.map((intake) => {
									const intakePerson = intake.takenBy?.trim();
									const hasPerIntakeTakenBy = !!intakePerson;
									const personCount = Math.max(1, selectedMed.takenBy?.length ?? 0);
									const totalUsage = hasPerIntakeTakenBy ? intake.usage : intake.usage * personCount;
									const showIntakeBell = intake.intakeRemindersEnabled === true;
									const intakeKey = `${intake.start}-${intake.usage}-${intake.every}-${intake.scheduleMode ?? "interval"}-${(intake.weekdays ?? []).join("")}-${intake.takenBy ?? ""}-${intake.intakeRemindersEnabled ? "reminder" : "silent"}`;

									return (
										<div key={intakeKey} className={cx(classes["med-schedule-row"], classes["blister-row-simple"])}>
											<span className={classes["med-schedule-usage"]}>
												{getScheduleUsageLabel(totalUsage, intake.intakeUnit)}
												{showPillWeightDetails && ` (${totalUsage * pillWeightMg} ${selectedMed.doseUnit ?? "mg"})`}
											</span>
											<span className={classes["med-schedule-freq"]}>{getIntakeFrequencyText(intake, t)}</span>
											{hasPerIntakeTakenBy && renderPersonName(intakePerson, classes["med-schedule-person"])}
											<span className={classes["med-schedule-time"]}>
												{t("modal.at")}{" "}
												{new Date(intake.start).toLocaleTimeString(getSystemLocale(i18n.language), {
													hour: "2-digit",
													minute: "2-digit",
												})}
											</span>
											{showIntakeBell && (
												<AppTooltipTrigger
													label={t("form.blisters.remindTooltip")}
													className={classes["med-schedule-bell"]}
												>
													<Bell size={12} aria-hidden="true" />
												</AppTooltipTrigger>
											)}
										</div>
									);
								})}
							</div>
						) : (
							<div className={classes["no-regular-schedule"]}>{t("form.blisters.noRegularSchedule")}</div>
						)}
					</div>

					{/* Prescription Details Section */}
					{selectedMed.prescriptionEnabled && (
						<div className={classes["med-detail-section"]}>
							<h3>{t("form.sections.prescription")}</h3>
							<div className={cx(classes["med-detail-grid"], classes["prescription-detail-grid"])}>
								<div className={classes["med-detail-item"]}>
									<span className={classes["med-detail-label"]}>{t("prescription.authorizedRefills")}</span>
									<span className={classes["med-detail-value"]}>
										{selectedMed.prescriptionAuthorizedRefills ?? "—"}
									</span>
								</div>
								<div className={classes["med-detail-item"]}>
									<span className={classes["med-detail-label"]}>{t("prescription.remainingRefills")}</span>
									<span className={classes["med-detail-value"]}>{selectedMed.prescriptionRemainingRefills ?? "—"}</span>
								</div>
								<div className={classes["med-detail-item"]}>
									<span className={classes["med-detail-label"]}>{t("prescription.lowThreshold")}</span>
									<span className={classes["med-detail-value"]}>
										{selectedMed.prescriptionLowRefillThreshold ?? "—"}
									</span>
								</div>
								<div className={classes["med-detail-item"]}>
									<span className={classes["med-detail-label"]}>{t("prescription.expiryDate")}</span>
									<span className={classes["med-detail-value"]}>
										{selectedMed.prescriptionExpiryDate
											? formatExpiryDate(selectedMed.prescriptionExpiryDate, displayLocale)
											: "—"}
									</span>
								</div>
							</div>
						</div>
					)}

					{/* Coverage Status Section */}
					{medCoverage && (status || !hasRegularSchedule) && (
						<div className={classes["med-detail-section"]}>
							<h3 className={classes["section-header-with-badge"]}>
								{t("modal.coverageStatus")}
								{status && (
									<StatusBadge size="xs" tone={getStatusTone(status.className)}>
										{t(status.label)}
									</StatusBadge>
								)}
							</h3>
							<div className={classes["med-detail-grid"]}>
								<div className={classes["med-detail-item"]}>
									<span className={classes["med-detail-label"]}>{t("modal.daysLeft")}</span>
									<span className={classes["med-detail-value"]}>
										{hasRegularSchedule && medCoverage.daysLeft !== null
											? formatNumber(medCoverage.daysLeft)
											: t("common.notAvailable")}
									</span>
								</div>
								<div className={classes["med-detail-item"]}>
									<span className={classes["med-detail-label"]}>{t("modal.runsOut")}</span>
									<span className={classes["med-detail-value"]}>
										{hasRegularSchedule ? runsOutLabel : t("common.notAvailable")}
									</span>
								</div>
							</div>
						</div>
					)}

					{/* Notes Section */}
					{selectedMed.notes && (
						<div className={classes["med-detail-section"]}>
							<h3>
								{t("modal.notes")}{" "}
								<span className={cx(classes["notes-icon"], classes["notes-icon-static"])} aria-hidden="true">
									<NotebookPen size={14} />
								</span>
							</h3>
							<div className={classes["med-notes-content"]}>{selectedMed.notes}</div>
						</div>
					)}

					{/* Refill History Section */}
					{refillHistory.length > 0 && (
						<div className={classes["med-detail-section"]}>
							<h3
								className={classes["section-header-clickable"]}
								onClick={() => onRefillHistoryExpandedChange(!refillHistoryExpanded)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") onRefillHistoryExpandedChange(!refillHistoryExpanded);
								}}
							>
								{t("refill.history")} ({refillHistory.length})
								<span className={classes["expand-arrow"]}>{refillHistoryExpanded ? "▼" : "▶"}</span>
							</h3>
							{refillHistoryExpanded && (
								<div className={classes["refill-history-list"]}>
									{refillHistory.map((entry) => (
										<div key={entry.id} className={classes["refill-history-item"]}>
											<span className={classes["refill-date"]}>
												{formatDisplayDateTime(entry.refillDate, displayLocale)}
											</span>
											<span className={classes["refill-amount"]}>
												{(() => {
													const total = entry.quantityAdded;
													return `+${total}${isAmountPackage ? ` ${stockUnitLabel}` : ` ${getDiscreteUnitLabel(total)}`}`;
												})()}
												{entry.usedPrescription && (
													<AppTooltipTrigger
														label={t("refill.viaPrescription")}
														className={classes["refill-prescription-badge"]}
													>
														{" "}
														<ClipboardList size={14} aria-hidden="true" />
													</AppTooltipTrigger>
												)}
											</span>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</div>

				{/* Footer */}
				<AppModalFooter stackOnMobile={false}>
					<AppButton type="button" tone="secondary" onClick={onClose}>
						{t("common.close")}
					</AppButton>
					<AppButton type="button" tone="success" onClick={onOpenRefillModal}>
						{t("refill.button")}
					</AppButton>
					{onOpenMedicationEdit && (
						<AppTooltip label={t("common.edit")}>
							<ActionIcon
								color="blue"
								size="input-sm"
								variant="filled"
								onClick={onOpenMedicationEdit}
								aria-label={t("common.edit")}
							>
								<Pencil size={18} aria-hidden="true" />
							</ActionIcon>
						</AppTooltip>
					)}
					{onOpenEditStockModal && (
						<AppTooltip label={t("editStock.buttonLabel")}>
							<ActionIcon
								className={classes["icon-stock-correction"]}
								size="input-sm"
								variant="filled"
								onClick={onOpenEditStockModal}
								aria-label={t("editStock.buttonLabel")}
							>
								<FilePenLine size={18} aria-hidden="true" />
							</ActionIcon>
						</AppTooltip>
					)}
					{scheduleIntakes.length > 0 && (
						<AppTooltip label={t("modal.exportTooltip")}>
							<ActionIcon
								color="brand"
								size="input-sm"
								variant="default"
								onClick={() => generateICS(selectedMed)}
								aria-label={t("modal.exportTooltip")}
							>
								<Calendar size={18} aria-hidden="true" />
							</ActionIcon>
						</AppTooltip>
					)}
				</AppModalFooter>
			</div>

			{/* Image Lightbox */}
			{showImageLightbox && selectedMed.imageUrl && (
				<Lightbox
					src={`/api/images/${selectedMed.imageUrl}`}
					alt={getMedDisplayName(selectedMed)}
					onClose={onCloseImageLightbox}
				/>
			)}

			{/* Refill Modal */}
			{showRefillModal && (
				<AppModal
					closeButtonProps={{ "aria-label": closeLabel }}
					closeOnEscape={false}
					contentClassName={classes["refill-modal"]}
					manageEscape={false}
					onClose={onCloseRefillModal}
					opened={showRefillModal}
					size="sm"
					title={t("refill.title")}
					withCloseButton
				>
					<p className={classes["refill-med-name"]}>{getMedDisplayName(selectedMed)}</p>

					<div className={classes["refill-form"]}>
						{!isAmountBasedPackageType(selectedMed.packageType) ? (
							<>
								<label>
									{t("refill.packs")}
									{renderRefillStepperInput({
										value: refillPacks,
										min: 0,
										max: prescriptionPackCapEnabled ? remainingPrescriptionRefills : Number.MAX_SAFE_INTEGER,
										onChange: onRefillPacksChange,
									})}
								</label>
								<label>
									{t("refill.loosePills")}
									{renderRefillStepperInput({
										value: refillLoose,
										min: 0,
										max: Number.MAX_SAFE_INTEGER,
										onChange: onRefillLooseChange,
									})}
								</label>
							</>
						) : isCountBasedAmountRefillPackage ? (
							<label>
								{isTubeRefillPackage ? t("form.tubes") : t("form.bottles")}
								{renderRefillStepperInput({
									value: amountRefillPackageCount,
									min: 0,
									max: Number.MAX_SAFE_INTEGER,
									onChange: (nextPackages) => {
										onRefillPacksChange(nextPackages);
										onRefillLooseChange(nextPackages * liquidRefillAmountPerBottle);
									},
								})}
								<p className={cx(classes["edit-stock-cap-info"], classes["edit-stock-cap-info-spaced"])}>
									{isTubeRefillPackage ? t("form.packageAmountPerTube") : t("form.packageAmountPerBottle")}:{" "}
									{formatNumber(liquidRefillAmountPerBottle)} {amountUnitLabel}
								</p>
							</label>
						) : (
							<label>
								{t("refill.pillsToAdd")}
								{renderRefillStepperInput({
									value: refillLoose,
									min: 0,
									max: Number.MAX_SAFE_INTEGER,
									onChange: onRefillLooseChange,
								})}
							</label>
						)}

						{selectedMed.prescriptionEnabled && (
							<div className={classes["refill-prescription-row"]}>
								<label className={classes["refill-prescription-toggle"]}>
									<input
										type="checkbox"
										checked={usePrescriptionRefill}
										onChange={(e) => {
											const checked = e.target.checked;
											onUsePrescriptionRefillChange(checked);
											if (
												checked &&
												!isAmountBasedPackageType(selectedMed.packageType) &&
												refillPacks > remainingPrescriptionRefills
											) {
												onRefillPacksChange(remainingPrescriptionRefills);
											}
										}}
										disabled={(Number(selectedMed.prescriptionRemainingRefills) || 0) <= 0}
									/>
									<span className={classes["refill-prescription-label-text"]}>{t("prescription.useForRefill")}</span>
								</label>
								<span className={classes["refill-remaining-badge"]}>
									<span className={classes["refill-remaining-label"]}>{t("prescription.remainingRefills")}</span>{" "}
									<strong className={classes["refill-remaining-value"]}>
										{Number(selectedMed.prescriptionRemainingRefills) || 0}
									</strong>
								</span>
							</div>
						)}
					</div>

					<AppModalFooter>
						<AppButton type="button" tone="secondary" onClick={onCloseRefillModal}>
							{t("common.close")}
						</AppButton>
						<AppButton
							type="button"
							tone="success"
							onClick={() => onSubmitRefill(selectedMed.id, usePrescriptionRefill)}
							disabled={
								(isAmountBasedPackageType(selectedMed.packageType)
									? isCountBasedAmountRefillPackage
										? amountRefillPackageCount < 1
										: refillLoose < 1
									: cappedRefillPacks < 1 && refillLoose < 1) ||
								exceedsPrescriptionPackLimit ||
								refillSaving
							}
						>
							{refillSaving ? t("common.saving") : t("refill.button")}
						</AppButton>
						{(() => {
							const totalRefill = !isAmountBasedPackageType(selectedMed.packageType)
								? cappedRefillPacks * selectedMed.blistersPerPack * selectedMed.pillsPerBlister + refillLoose
								: isCountBasedAmountRefillPackage
									? amountRefillPackageCount * liquidRefillAmountPerBottle
									: refillLoose;
							return totalRefill > 0 ? (
								<span className={classes["refill-preview"]}>
									+{totalRefill}
									{isAmountPackage ? ` ${stockUnitLabel}` : ` ${getDiscreteUnitLabel(totalRefill)}`}
								</span>
							) : null;
						})()}
					</AppModalFooter>
				</AppModal>
			)}

			{/* Edit Stock Modal */}
			{renderEditStockModal()}
		</AppModal>
	);
}
