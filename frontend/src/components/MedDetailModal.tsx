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

import { Bell, Calendar, ClipboardList, FilePenLine, Minus, NotebookPen, Pencil, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lightbox, MedicationAvatar } from "../components";
import { useEscapeKey } from "../hooks";
import type { Coverage, Medication, RefillEntry, StockThresholds } from "../types";
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
import { formatNumber, generateICS, getExpiryClass, getSystemLocale } from "../utils";
import { getIntakeFrequencyText, getMedicationIntakes } from "../utils/intake-schedule";
import { getLiquidCountUnitLabel } from "../utils/intake-units";
import { getStockStatus } from "../utils/schedule";
import { splitCurrentBlisterStock } from "../utils/stock";

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
	onCloseEditStockModal: () => void;
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
	onCloseEditStockModal,
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
	const isAmountPackage =
		isTubePackageType(selectedMed.packageType) || isLiquidContainerPackageType(selectedMed.packageType);
	const amountUnitLabel =
		isLiquidContainerPackageType(selectedMed.packageType) || selectedMed.medicationForm === "liquid"
			? t("form.packageAmountUnitMl")
			: t("form.packageAmountUnitG");
	const stockUnitLabel = isAmountPackage ? amountUnitLabel : null;

	const medCoverage = coverage.all.find((c) => c.name === getMedDisplayName(selectedMed));
	const packageSize = getPackageSize(selectedMed);
	const stockDisplayCapacity = getStockDisplayCapacity(selectedMed);
	// Structural max = sealed package capacity only (excludes pre-existing looseTablets).
	const structuralMax = isAmountBasedPackageType(selectedMed.packageType)
		? stockDisplayCapacity
		: selectedMed.packCount * selectedMed.blistersPerPack * selectedMed.pillsPerBlister;
	const currentStock = medCoverage ? Math.round(medCoverage.medsLeft) : getMedTotal(selectedMed);
	const status = medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
	const fallbackTextClass = status?.className === "warning" ? "warning-text" : "success-text";
	const textClass = status?.className === "danger" ? "danger-text" : fallbackTextClass;
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
		return `${usage} ${usage !== 1 ? t("common.pills") : t("common.pill")}`;
	};
	const scheduleIntakes = getMedicationIntakes(selectedMed);
	const hasAnyIntakeReminder = scheduleIntakes.some((intake) => intake.intakeRemindersEnabled === true);
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
			<div className="number-stepper refill-number-stepper">
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
					className="stepper-btn decrement"
					onClick={() => onStep(-1)}
					disabled={!canDecrement}
					aria-label={decrementLabel}
				>
					<Minus size={16} aria-hidden="true" />
				</button>
				<button
					type="button"
					className="stepper-btn increment"
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
			<div className="number-stepper refill-number-stepper">
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
					className="stepper-btn decrement"
					onClick={() => onChange(Math.max(min, clamped - 1))}
					disabled={!canDecrement}
					aria-label={decrementLabel}
				>
					<Minus size={16} aria-hidden="true" />
				</button>
				<button
					type="button"
					className="stepper-btn increment"
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
			<div
				className="modal-overlay"
				onClick={(e) => {
					e.stopPropagation();
					onCloseEditStockModal();
				}}
				onKeyDown={(e) => {
					e.stopPropagation();
				}}
			>
				<div
					className="modal-content edit-stock-modal"
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => {
						e.stopPropagation();
					}}
				>
					<button
						type="button"
						className="modal-close tooltip-trigger"
						onClick={onCloseEditStockModal}
						aria-label={closeLabel}
						data-tooltip={closeLabel}
					>
						<X size={18} aria-hidden="true" />
					</button>
					<h2>{t("editStock.title")}</h2>
					<p className="edit-stock-med-name">{getMedDisplayName(selectedMed)}</p>
					<p className="edit-stock-hint">{t("editStock.hint")}</p>
					{!isAmountBasedPackageType(selectedMed.packageType) && (
						<p className="edit-stock-cap-info edit-stock-live-breakdown">
							{t("editStock.currentComposition", {
								fullBlisters: currentFullBlisters,
								partialPills: currentPartialPills,
								loosePills: currentLoosePills,
								total: Math.max(0, currentStock),
							})}
						</p>
					)}
					{isAmountBasedPackageType(selectedMed.packageType) && !isTubePackageType(selectedMed.packageType) && (
						<p className="edit-stock-cap-info">{t("editStock.packageSize", { count: structuralMax })}</p>
					)}
					{(isTubePackageType(selectedMed.packageType) || isLiquidContainerPackageType(selectedMed.packageType)) && (
						<p className="edit-stock-cap-info">
							{t("form.totalAmount")}: {formatNumber(isLiquidPackage ? liquidCapacity : structuralMax)}{" "}
							{amountUnitLabel}
						</p>
					)}
					{showStockCapNotice && (
						<p className="edit-stock-cap-warning">{t("editStock.maxExceeded", { count: structuralMax })}</p>
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
								<div className="edit-stock-form">
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
												<p className="edit-stock-cap-info" style={{ marginTop: "0.35rem" }}>
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
														const _rawTotal = rawFull * selectedMed.pillsPerBlister + rawPartial + rawLoose;
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
														const _rawTotal = rawFull * selectedMed.pillsPerBlister + rawPartial + rawLoose;
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
														const _rawTotal = nextFull * selectedMed.pillsPerBlister + nextPartial + nextLoose;
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

								<div className="edit-stock-summary">
									<div className="summary-row">
										<span>{t("editStock.currentTotal")}:</span>
										<span>
											{currentTotal}
											{isAmountPackage
												? ` ${stockUnitLabel}`
												: ` ${currentTotal === 1 ? t("common.pill") : t("common.pills")}`}
										</span>
									</div>
									<div className="summary-row">
										<span>{t("editStock.newTotal")}:</span>
										<span>
											{newTotal}
											{isAmountPackage
												? ` ${stockUnitLabel}`
												: ` ${newTotal === 1 ? t("common.pill") : t("common.pills")}`}
										</span>
									</div>
									<div className={`summary-row difference ${differenceClass}`}>
										<span>{t("editStock.difference")}:</span>
										<span>
											{difference > 0 ? "+" : ""}
											{difference}
											{isAmountPackage
												? ` ${stockUnitLabel}`
												: ` ${Math.abs(difference) === 1 ? t("common.pill") : t("common.pills")}`}
										</span>
									</div>
								</div>
							</>
						);
					})()}

					<div className="modal-footer">
						<button className="ghost" onClick={onCloseEditStockModal}>
							{t("common.close")}
						</button>
						<button className="info" onClick={() => onSubmitStockCorrection(selectedMed.id)} disabled={editStockSaving}>
							{editStockSaving ? t("editStock.saving") : t("editStock.save")}
						</button>
					</div>
				</div>
			</div>
		);
	};

	if (editStockOnly) {
		return renderEditStockModal();
	}

	return (
		<div
			className="modal-overlay med-detail-overlay"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key !== "Escape") e.stopPropagation();
			}}
		>
			<div
				className="modal-content med-detail-modal"
				ref={detailModalRef}
				tabIndex={-1}
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key !== "Escape") e.stopPropagation();
				}}
			>
				<button
					type="button"
					className="modal-close tooltip-trigger"
					onClick={onClose}
					aria-label={closeLabel}
					data-tooltip={closeLabel}
				>
					<X size={18} aria-hidden="true" />
				</button>

				<div className="med-detail-body">
					{/* Header */}
					<div className="med-detail-header">
						<div
							className={`med-detail-avatar-wrapper ${selectedMed.imageUrl ? "clickable" : ""}`}
							onClick={() => selectedMed.imageUrl && onOpenImageLightbox()}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									if (selectedMed.imageUrl) onOpenImageLightbox();
								}
							}}
						>
							<MedicationAvatar name={getMedDisplayName(selectedMed)} imageUrl={selectedMed.imageUrl} size="lg" />
							{selectedMed.imageUrl && <span className="expand-icon">🔍</span>}
						</div>
						<div className="med-detail-titles">
							<h2>{getMedDisplayName(selectedMed)}</h2>
							{selectedMed.name && selectedMed.genericName && (
								<span className="med-generic-name">{selectedMed.genericName}</span>
							)}
							{selectedMed.takenBy && (selectedMed.takenBy || []).length > 0 && (
								<span className="med-taken-by">
									{t("modal.for")}{" "}
									{selectedMed.takenBy.map((person, index) => (
										<span key={person} style={{ whiteSpace: "nowrap" }}>
											{index > 0 && (index === selectedMed.takenBy.length - 1 ? ` ${t("common.and")} ` : ", ")}
											{person}
											{selectedMed.intakes?.some(
												(intake) => intake.takenBy === person && intake.intakeRemindersEnabled
											) && <span className="taken-by-badge">🔔</span>}
										</span>
									))}
								</span>
							)}
						</div>
					</div>

					{/* Stock Info Section */}
					<div className="med-detail-section">
						<h3>{t("modal.stockInfo")}</h3>
						<div className="med-detail-grid">
							{!isAmountBasedPackageType(selectedMed.packageType) && (
								<>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("table.fullBlisters")}</span>
										<span className={`med-detail-value ${textClass}`}>{formatFullBlisters(stock.fullBlisters, t)}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("table.openBlister")}</span>
										<span className={`med-detail-value ${textClass}`}>
											{formatOpenBlisterAndLoose(
												stock.openBlisterPills,
												stock.loosePills,
												selectedMed.pillsPerBlister ?? 1,
												t
											)}
										</span>
									</div>
								</>
							)}
							<div className="med-detail-item full-width">
								<span className="med-detail-label">
									{isAmountPackage ? t("form.currentAmount") : t("modal.currentStock")}
								</span>
								<span className={`med-detail-value ${textClass}`}>
									{isAmountPackage
										? `${formatNumber(currentStock)} / ${formatNumber(stockDisplayTotal)} ${amountUnitLabel}`
										: `${currentStock} / ${stockDisplayTotal}`}
									{currentStock > stockDisplayTotal && (
										<span
											className="info-tooltip tooltip-align-left warning-text"
											data-tooltip={t("tooltips.stockExceedsCapacity")}
										>
											{" "}
											⚠️
										</span>
									)}
								</span>
							</div>
						</div>
					</div>

					{/* Package Details Section */}
					<div className="med-detail-section">
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
								<span className="info-tooltip small" data-tooltip={t("modal.packageTypeTubeHint")}>
									ℹ️
								</span>
							)}
							{isLiquidContainerPackageType(selectedMed.packageType) && (
								<span className="info-tooltip small" data-tooltip={t("modal.packageTypeLiquidHint")}>
									ℹ️
								</span>
							)}
						</h3>
						<div className="med-detail-grid">
							{!isAmountBasedPackageType(selectedMed.packageType) ? (
								<>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("modal.packs")}</span>
										<span className="med-detail-value">{selectedMed.packCount}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("modal.blistersPerPack")}</span>
										<span className="med-detail-value">{selectedMed.blistersPerPack}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("modal.pillsPerBlister")}</span>
										<span className="med-detail-value">{selectedMed.pillsPerBlister}</span>
									</div>
								</>
							) : isLiquidContainerPackageType(selectedMed.packageType) ? (
								<>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("form.bottles")}</span>
										<span className="med-detail-value">{packageCount}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("form.packageAmountPerBottle")}</span>
										<span className="med-detail-value">
											{formatNumber(amountPerPackage)} {amountUnitLabel}
										</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("form.totalAmount")}</span>
										<span className="med-detail-value">
											{formatNumber(stockDisplayTotal)} {amountUnitLabel}
										</span>
									</div>
								</>
							) : isTubePackageType(selectedMed.packageType) ? (
								<>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("form.tubes")}</span>
										<span className="med-detail-value">{packageCount}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("form.packageAmountPerTube")}</span>
										<span className="med-detail-value">
											{formatNumber(amountPerPackage)} {amountUnitLabel}
										</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t("form.totalAmount")}</span>
										<span className="med-detail-value">
											{formatNumber(stockDisplayTotal)} {amountUnitLabel}
										</span>
									</div>
								</>
							) : (
								<div className="med-detail-item">
									<span className="med-detail-label">{t("form.totalCapacity")}</span>
									<span className="med-detail-value">{(selectedMed.totalPills ?? packageSize) || "—"}</span>
								</div>
							)}
							{showPillWeightDetails && (
								<div className="med-detail-item">
									<span className="med-detail-label">{t("modal.pillWeight")}</span>
									<span className="med-detail-value">
										{selectedMed.pillWeightMg} {selectedMed.doseUnit ?? "mg"}
									</span>
								</div>
							)}
							{selectedMed.expiryDate && (
								<div className="med-detail-item">
									<span className="med-detail-label">{t("modal.expiryDate")}</span>
									<span
										className={`med-detail-value ${getExpiryClass(selectedMed.expiryDate, settings.expiryWarningDays)}`}
									>
										{new Date(selectedMed.expiryDate).toLocaleDateString(getSystemLocale(i18n.language), {
											day: "2-digit",
											month: "short",
											year: "numeric",
										})}
									</span>
								</div>
							)}
						</div>
					</div>

					{/* Intake Schedule Section */}
					{scheduleIntakes.length > 0 && (
						<div className="med-detail-section">
							<h3>
								{t("modal.intakeSchedule")}{" "}
								{hasAnyIntakeReminder && (
									<span className="reminder-icon info-tooltip" data-tooltip={t("tooltips.intakeReminders")}>
										<Bell size={14} aria-hidden="true" />
									</span>
								)}
							</h3>
							<div className="med-detail-schedules">
								{scheduleIntakes.map((intake) => {
									const hasPerIntakeTakenBy = !!intake.takenBy;
									const personCount = Math.max(1, selectedMed.takenBy?.length ?? 0);
									const totalUsage = hasPerIntakeTakenBy ? intake.usage : intake.usage * personCount;
									const showIntakeBell = intake.intakeRemindersEnabled === true;
									const intakeKey = `${intake.start}-${intake.usage}-${intake.every}-${intake.scheduleMode ?? "interval"}-${(intake.weekdays ?? []).join("")}-${intake.takenBy ?? ""}-${intake.intakeRemindersEnabled ? "reminder" : "silent"}`;

									return (
										<div key={intakeKey} className="med-schedule-row blister-row-simple">
											<span className="med-schedule-usage">
												{getScheduleUsageLabel(totalUsage, intake.intakeUnit)}
												{showPillWeightDetails && ` (${totalUsage * pillWeightMg} ${selectedMed.doseUnit ?? "mg"})`}
											</span>
											<span className="med-schedule-freq">{getIntakeFrequencyText(intake, t)}</span>
											{hasPerIntakeTakenBy && <span className="med-schedule-person">{intake.takenBy}</span>}
											<span className="med-schedule-time">
												{t("modal.at")}{" "}
												{new Date(intake.start).toLocaleTimeString(getSystemLocale(i18n.language), {
													hour: "2-digit",
													minute: "2-digit",
												})}
											</span>
											{showIntakeBell && (
												<span className="med-schedule-bell" title={t("form.blisters.remindTooltip")}>
													<Bell size={12} aria-hidden="true" />
												</span>
											)}
										</div>
									);
								})}
							</div>
						</div>
					)}

					{/* Prescription Details Section */}
					{selectedMed.prescriptionEnabled && (
						<div className="med-detail-section">
							<h3>{t("form.sections.prescription")}</h3>
							<div className="med-detail-grid prescription-detail-grid">
								<div className="med-detail-item">
									<span className="med-detail-label">{t("prescription.authorizedRefills")}</span>
									<span className="med-detail-value">{selectedMed.prescriptionAuthorizedRefills ?? "—"}</span>
								</div>
								<div className="med-detail-item">
									<span className="med-detail-label">{t("prescription.remainingRefills")}</span>
									<span className="med-detail-value">{selectedMed.prescriptionRemainingRefills ?? "—"}</span>
								</div>
								<div className="med-detail-item">
									<span className="med-detail-label">{t("prescription.lowThreshold")}</span>
									<span className="med-detail-value">{selectedMed.prescriptionLowRefillThreshold ?? "—"}</span>
								</div>
								<div className="med-detail-item">
									<span className="med-detail-label">{t("prescription.expiryDate")}</span>
									<span className="med-detail-value">
										{selectedMed.prescriptionExpiryDate
											? new Date(selectedMed.prescriptionExpiryDate).toLocaleDateString(
													getSystemLocale(i18n.language),
													{
														day: "2-digit",
														month: "short",
														year: "numeric",
													}
												)
											: "—"}
									</span>
								</div>
							</div>
						</div>
					)}

					{/* Coverage Status Section */}
					{medCoverage && status && (
						<div className="med-detail-section">
							<h3 className="section-header-with-badge">
								{t("modal.coverageStatus")}
								<span className={`status-chip small ${status.className}`}>{t(status.label)}</span>
							</h3>
							<div className="med-detail-grid">
								<div className="med-detail-item">
									<span className="med-detail-label">{t("modal.daysLeft")}</span>
									<span className="med-detail-value">
										{medCoverage.daysLeft !== null ? formatNumber(medCoverage.daysLeft) : "—"}
									</span>
								</div>
								<div className="med-detail-item">
									<span className="med-detail-label">{t("modal.runsOut")}</span>
									<span className="med-detail-value">{medCoverage.depletionDate ?? "—"}</span>
								</div>
							</div>
						</div>
					)}

					{/* Notes Section */}
					{selectedMed.notes && (
						<div className="med-detail-section">
							<h3>
								{t("modal.notes")}{" "}
								<span className="notes-icon notes-icon-static" aria-hidden="true">
									<NotebookPen size={14} />
								</span>
							</h3>
							<div className="med-notes-content">{selectedMed.notes}</div>
						</div>
					)}

					{/* Refill History Section */}
					{refillHistory.length > 0 && (
						<div className="med-detail-section">
							<h3
								className="section-header-clickable"
								onClick={() => onRefillHistoryExpandedChange(!refillHistoryExpanded)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") onRefillHistoryExpandedChange(!refillHistoryExpanded);
								}}
							>
								{t("refill.history")} ({refillHistory.length})
								<span className="expand-arrow">{refillHistoryExpanded ? "▼" : "▶"}</span>
							</h3>
							{refillHistoryExpanded && (
								<div className="refill-history-list">
									{refillHistory.map((entry) => (
										<div key={entry.id} className="refill-history-item">
											<span className="refill-date">
												{new Date(entry.refillDate).toLocaleDateString(getSystemLocale(i18n.language), {
													day: "2-digit",
													month: "short",
													year: "numeric",
												})}
												,{" "}
												{new Date(entry.refillDate).toLocaleTimeString(getSystemLocale(i18n.language), {
													hour: "2-digit",
													minute: "2-digit",
												})}
											</span>
											<span className="refill-amount">
												{(() => {
													const total = entry.quantityAdded;
													return `+${total}${isAmountPackage ? ` ${stockUnitLabel}` : ` ${total === 1 ? t("common.pill") : t("common.pills")}`}`;
												})()}
												{entry.usedPrescription && (
													<span className="refill-prescription-badge" title={t("refill.viaPrescription")}>
														{" "}
														<ClipboardList size={14} aria-hidden="true" />
													</span>
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
				<div className="med-detail-footer">
					<button onClick={onClose}>{t("common.close")}</button>
					<div className="footer-actions">
						<button className="success" onClick={onOpenRefillModal}>
							{t("refill.button")}
						</button>
						{onOpenMedicationEdit && (
							<button
								className="info icon-only tooltip-trigger"
								onClick={onOpenMedicationEdit}
								aria-label={t("common.edit")}
								data-tooltip={t("common.edit")}
							>
								<Pencil size={18} aria-hidden="true" />
							</button>
						)}
						{onOpenEditStockModal && (
							<button
								className="icon-stock-correction icon-only tooltip-trigger"
								onClick={onOpenEditStockModal}
								aria-label={t("editStock.buttonLabel")}
								data-tooltip={t("editStock.buttonLabel")}
							>
								<FilePenLine size={18} aria-hidden="true" />
							</button>
						)}
						{scheduleIntakes.length > 0 && (
							<button
								className="secondary icon-only tooltip-trigger"
								onClick={() => generateICS(selectedMed)}
								aria-label={t("modal.exportTooltip")}
								data-tooltip={t("modal.exportTooltip")}
							>
								<Calendar size={18} aria-hidden="true" />
							</button>
						)}
					</div>
				</div>
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
				<div
					className="modal-overlay"
					onClick={(e) => {
						e.stopPropagation();
						onCloseRefillModal();
					}}
					onKeyDown={(e) => {
						if (e.key !== "Escape") e.stopPropagation();
					}}
				>
					<div
						className="modal-content refill-modal"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.key !== "Escape") e.stopPropagation();
						}}
					>
						<button
							type="button"
							className="modal-close tooltip-trigger"
							onClick={onCloseRefillModal}
							aria-label={closeLabel}
							data-tooltip={closeLabel}
						>
							<X size={18} aria-hidden="true" />
						</button>
						<h2>{t("refill.title")}</h2>
						<p className="refill-med-name">{getMedDisplayName(selectedMed)}</p>

						<div className="refill-form">
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
									<p className="edit-stock-cap-info" style={{ marginTop: "0.35rem" }}>
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
								<div className="refill-prescription-row full">
									<label className="refill-prescription-toggle">
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
										<span className="refill-prescription-label-text">{t("prescription.useForRefill")}</span>
									</label>
									<span className="refill-remaining-badge">
										{t("prescription.remainingRefills")}: {Number(selectedMed.prescriptionRemainingRefills) || 0}
									</span>
								</div>
							)}
						</div>

						<div className="modal-footer">
							<button className="ghost" onClick={onCloseRefillModal}>
								{t("common.close")}
							</button>
							<div className="refill-footer-right">
								<button
									className="success"
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
								</button>
								{(() => {
									const totalRefill = !isAmountBasedPackageType(selectedMed.packageType)
										? cappedRefillPacks * selectedMed.blistersPerPack * selectedMed.pillsPerBlister + refillLoose
										: isCountBasedAmountRefillPackage
											? amountRefillPackageCount * liquidRefillAmountPerBottle
											: refillLoose;
									return totalRefill > 0 ? (
										<span className="refill-preview">
											+{totalRefill}
											{isAmountPackage
												? ` ${stockUnitLabel}`
												: ` ${totalRefill === 1 ? t("common.pill") : t("common.pills")}`}
										</span>
									) : null;
								})()}
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Edit Stock Modal */}
			{renderEditStockModal()}
		</div>
	);
}
