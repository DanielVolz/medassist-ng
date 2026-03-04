// =============================================================================
// Core Types for MedAssist
// =============================================================================

export type { PackageProfile, PackageType } from "./package-profiles";
export {
	allowsPillFormSelection,
	getPackageProfile,
	isAmountBasedPackageType,
	isLiquidContainerPackageType,
	isTubePackageType,
	normalizePackageType,
	PACKAGE_PROFILES,
	PACKAGE_TYPES,
} from "./package-profiles";

import type { PackageType } from "./package-profiles";
import { isAmountBasedPackageType } from "./package-profiles";

// Common medication dose units
export type DoseUnit = "mg" | "g" | "mcg" | "ml" | "units";

export type MedicationForm = "tablet" | "capsule" | "topical" | "liquid";
export type PillForm = "tablet" | "capsule";
export type LifecycleCategory = "refill_when_empty" | "treatment_period";
export type PackageAmountUnit = "ml" | "g";

export const DOSE_UNITS: { value: DoseUnit; label: string }[] = [
	{ value: "mg", label: "mg" },
	{ value: "g", label: "g" },
	{ value: "mcg", label: "mcg (µg)" },
	{ value: "ml", label: "ml" },
	{ value: "units", label: "units" },
];

export type Blister = {
	usage: number;
	every: number;
	start: string;
};

export type IntakeUnit = "ml" | "tsp" | "tbsp";

/**
 * Intake with per-intake takenBy support.
 * Extends Blister with per-intake user assignment.
 */
export type Intake = {
	usage: number;
	every: number;
	start: string;
	intakeUnit?: IntakeUnit | null;
	takenBy: string | null; // Per-intake user assignment (single person or null)
	intakeRemindersEnabled: boolean;
};

export type Medication = {
	id: number;
	name: string;
	genericName?: string | null;
	takenBy: string[]; // Medication-level takenBy (legacy, still used for filtering)
	packageType: PackageType;
	packCount: number;
	blistersPerPack: number;
	pillsPerBlister: number;
	totalPills?: number | null; // For bottle type: total capacity of the container
	looseTablets: number; // For blister: extra loose pills; for bottle: current stock
	stockAdjustment?: number;
	lastStockCorrectionAt?: string | null;
	pillWeightMg?: number | null;
	doseUnit?: DoseUnit | null; // Unit for the dose (mg, g, mcg, ml, IU, etc.)
	medicationForm?: MedicationForm | null;
	pillForm?: PillForm | null;
	lifecycleCategory?: LifecycleCategory | null;
	packageAmountValue?: number | null;
	packageAmountUnit?: PackageAmountUnit | null;
	medicationStartDate?: string | null;
	medicationEndDate?: string | null;
	autoMarkObsoleteAfterEndDate?: boolean;
	blisters: Blister[]; // Legacy array format
	intakes?: Intake[]; // New intake format with per-intake takenBy
	imageUrl?: string | null;
	expiryDate?: string | null;
	notes?: string | null;
	prescriptionEnabled?: boolean;
	prescriptionAuthorizedRefills?: number | null;
	prescriptionRemainingRefills?: number | null;
	prescriptionLowRefillThreshold?: number;
	prescriptionExpiryDate?: string | null;
	intakeRemindersEnabled?: boolean; // Medication-level setting (deprecated, use per-intake)
	isObsolete?: boolean;
	obsoleteAt?: string | null;
	dismissedUntil?: string | null; // ISO date string (YYYY-MM-DD) - all past doses until this date are dismissed
	updatedAt: string | number | null;
};

export type PlannerRow = {
	medicationId: number;
	medicationName: string;
	totalPills: number;
	currentPills?: number;
	plannerUsage: number;
	blisterSize: number;
	blistersNeeded: number;
	fullBlisters: number;
	loosePills: number;
	enough: boolean;
	packageType?: PackageType;
};

export type RefillEntry = {
	id: number;
	packsAdded: number;
	loosePillsAdded: number;
	usedPrescription?: boolean;
	refillDate: string;
};

export type FormBlister = {
	usage: string;
	every: string;
	startDate: string;
	startTime: string;
};

/**
 * Form state for intake entry with per-intake takenBy support.
 */
export type FormIntake = {
	usage: string;
	every: string;
	startDate: string;
	startTime: string;
	intakeUnit?: IntakeUnit;
	takenBy: string; // Single person or empty string (empty = null for everyone)
	intakeRemindersEnabled: boolean;
};

export type FormState = {
	name: string;
	genericName: string;
	takenBy: string[]; // Medication-level takenBy (legacy/compatibility)
	medicationForm: MedicationForm;
	pillForm: PillForm;
	lifecycleCategory: LifecycleCategory;
	packageType: PackageType;
	packCount: string;
	blistersPerPack: string;
	pillsPerBlister: string;
	packageAmountValue: string;
	packageAmountUnit: PackageAmountUnit;
	totalPills: string; // For bottle type: total capacity
	looseTablets: string; // For blister: extra loose pills; for bottle: current stock
	pillWeightMg: string;
	doseUnit: DoseUnit; // Unit for the dose (mg, g, mcg, ml, IU, etc.)
	medicationStartDate: string;
	medicationEndDate: string;
	autoMarkObsoleteAfterEndDate: boolean;
	expiryDate: string;
	notes: string;
	prescriptionEnabled: boolean;
	prescriptionAuthorizedRefills: string;
	prescriptionRemainingRefills: string;
	prescriptionLowRefillThreshold: string;
	prescriptionExpiryDate: string;
	intakeRemindersEnabled: boolean; // Deprecated, kept for backward compat
	blisters: FormBlister[]; // Legacy form format
	intakes: FormIntake[]; // New form format with per-intake takenBy
};

export type FieldErrors = {
	name?: string;
	genericName?: string;
	takenBy?: string;
	notes?: string;
};

export type Coverage = {
	name: string;
	medsLeft: number;
	daysLeft: number | null;
	depletionDate: string | null;
	depletionTime: number | null;
	nextDose: string | null;
};

export type StockStatus = {
	level: "out-of-stock" | "critical" | "low" | "normal" | "high";
	className: string;
	label: string;
};

export type StockThresholds = {
	lowStockDays: number;
	normalStockDays: number;
	highStockDays: number;
	criticalStockDays: number; // Threshold for critical/danger status (typically reminderDaysBefore)
	expiryWarningDays: number; // Days before expiry to show warning
};

export type ScheduleEvent = {
	id: string;
	medName: string;
	timeStr: string;
	dateStr: string;
	usage: number;
	intakeUnit?: IntakeUnit | null;
	when: number;
	isPast: boolean;
	takenBy: string | null; // Per-intake takenBy (single person or null)
	intakeRemindersEnabled: boolean; // Per-intake reminder flag
};

export type BlisterStock = {
	fullBlisters: number;
	openBlisterPills: number;
	loosePills: number;
};

// Shared schedule types
export type SharedMedication = {
	id: number;
	name: string;
	genericName?: string | null;
	pillWeightMg?: number | null;
	doseUnit?: DoseUnit | null;
	imageUrl?: string | null;
	totalPills: number;
	packageType?: PackageType;
	packCount: number;
	blistersPerPack: number;
	looseTablets: number;
	pillsPerBlister: number;
	takenBy: string[]; // Medication-level takenBy (legacy)
	blisters: Blister[]; // Legacy array format
	intakes?: Intake[]; // New intake format with per-intake takenBy
	dismissedUntil?: string | null;
	updatedAt?: string | number | null; // For filtering out doses from previous schedule configurations
	lastStockCorrectionAt?: number | null; // Timestamp in ms for stock correction cutoff
	stockAdjustment?: number; // Manual stock adjustment
};

export type SharedScheduleData = {
	takenBy: string;
	sharedBy: string | null;
	scheduleDays: number;
	medications: SharedMedication[];
	stockThresholds?: {
		lowStockDays: number;
		normalStockDays?: number;
		highStockDays?: number;
		reminderDaysBefore?: number;
		expiryWarningDays?: number;
	};
	stockCalculationMode?: "automatic" | "manual";
	shareStockStatus?: boolean;
	upcomingTodayOnly?: boolean;
	shareScheduleTodayOnly?: boolean;
};

export type ExpiredLinkData = {
	ownerUsername: string;
	takenBy: string;
	expiredAt: string;
};

// =============================================================================
// Field Validation Limits (must match backend)
// =============================================================================
export const FIELD_LIMITS = {
	name: { min: 0, max: 100 },
	genericName: { max: 100 },
	takenBy: { max: 100 },
	notes: { max: 2000 },
} as const;

/** Returns the best display name for a medication: commercial name, or generic name as fallback */
export function getMedDisplayName(med: { name: string; genericName?: string | null }): string {
	return med.name || med.genericName || "";
}

// =============================================================================
// Helper Functions for Medication Calculations
// =============================================================================

type MedLike = Pick<Medication, "packCount" | "blistersPerPack" | "pillsPerBlister" | "looseTablets"> & {
	stockAdjustment?: number;
	packageType?: PackageType;
	totalPills?: number | null;
};

/** Calculate total pills including stockAdjustment */
export function getMedTotal(med: MedLike): number {
	// Amount-based package types store their current base stock directly
	// in totalPills (fallback looseTablets for legacy rows).
	if (isAmountBasedPackageType(med.packageType)) {
		const baseStock = med.totalPills ?? med.looseTablets;
		return baseStock + (med.stockAdjustment ?? 0);
	}
	// For blister type, calculate from packs + loose
	return med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets + (med.stockAdjustment ?? 0);
}

/** Get the base package size (without stockAdjustment) */
export function getPackageSize(med: MedLike): number {
	// Amount-based package types use totalPills as base capacity
	if (isAmountBasedPackageType(med.packageType)) {
		return med.totalPills ?? med.looseTablets;
	}
	// For blister type, calculate from packs + loose
	return med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets;
}
