// =============================================================================
// Core Types for MedAssist
// =============================================================================

export type Blister = {
	usage: number;
	every: number;
	start: string;
};

export type Medication = {
	id: number;
	name: string;
	genericName?: string | null;
	takenBy: string[];
	packCount: number;
	blistersPerPack: number;
	pillsPerBlister: number;
	looseTablets: number;
	stockAdjustment?: number;
	lastStockCorrectionAt?: string | null;
	pillWeightMg?: number | null;
	blisters: Blister[];
	imageUrl?: string | null;
	expiryDate?: string | null;
	notes?: string | null;
	intakeRemindersEnabled?: boolean;
	dismissedUntil?: string | null; // ISO date string (YYYY-MM-DD) - all past doses until this date are dismissed
	updatedAt: string | number | null;
};

export type PlannerRow = {
	medicationId: number;
	medicationName: string;
	totalPills: number;
	plannerUsage: number;
	blisterSize: number;
	blistersNeeded: number;
	fullBlisters: number;
	loosePills: number;
	enough: boolean;
};

export type RefillEntry = {
	id: number;
	packsAdded: number;
	loosePillsAdded: number;
	refillDate: string;
};

export type FormBlister = {
	usage: string;
	every: string;
	startDate: string;
	startTime: string;
};

export type FormState = {
	name: string;
	genericName: string;
	takenBy: string[];
	packCount: string;
	blistersPerPack: string;
	pillsPerBlister: string;
	looseTablets: string;
	pillWeightMg: string;
	expiryDate: string;
	notes: string;
	intakeRemindersEnabled: boolean;
	blisters: FormBlister[];
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
	level: "out-of-stock" | "low" | "normal" | "high";
	className: string;
	label: string;
};

export type StockThresholds = {
	lowStockDays: number;
	normalStockDays: number;
	highStockDays: number;
};

export type ScheduleEvent = {
	id: string;
	medName: string;
	timeStr: string;
	dateStr: string;
	usage: number;
	when: number;
	isPast: boolean;
	takenBy: string[];
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
	imageUrl?: string | null;
	totalPills: number;
	packCount: number;
	blistersPerPack: number;
	looseTablets: number;
	pillsPerBlister: number;
	takenBy: string[];
	blisters: Blister[];
};

export type SharedScheduleData = {
	takenBy: string;
	sharedBy: string | null;
	scheduleDays: number;
	medications: SharedMedication[];
	stockThresholds?: {
		lowStockDays: number;
	};
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
	name: { min: 1, max: 100 },
	genericName: { max: 100 },
	takenBy: { max: 100 },
	notes: { max: 2000 }
} as const;

// =============================================================================
// Helper Functions for Medication Calculations
// =============================================================================

type MedLike = Pick<Medication, 'packCount' | 'blistersPerPack' | 'pillsPerBlister' | 'looseTablets'> & { stockAdjustment?: number };

/** Calculate total pills including stockAdjustment */
export function getMedTotal(med: MedLike): number {
	return med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets + (med.stockAdjustment ?? 0);
}

/** Get the base package size (without stockAdjustment) */
export function getPackageSize(med: MedLike): number {
	return med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets;
}
