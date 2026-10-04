import { APP_LANGUAGE_INPUTS, INTAKE_MOODS, normalizeAppLanguage } from "@medassist/shared";
import { z } from "zod";
import { PACKAGE_TYPES } from "../utils/package-profiles.js";

// =============================================================================
// Export Format Version (bump this when format changes)
// =============================================================================
export const EXPORT_VERSION = "1.9";

const currentExportVersion = parseExportVersion(EXPORT_VERSION);

function parseExportVersion(version: string): { major: number; minor: number } | null {
	const match = version.trim().match(/^(\d+)(?:\.(\d+))?$/);
	if (!match) return null;
	return {
		major: Number.parseInt(match[1], 10),
		minor: match[2] ? Number.parseInt(match[2], 10) : 0,
	};
}

function isSupportedExportVersion(version: string): boolean {
	const parsed = parseExportVersion(version);
	if (!parsed || !currentExportVersion) return false;
	if (parsed.major !== currentExportVersion.major) return false;
	return parsed.minor <= currentExportVersion.minor;
}

function isValidDateLikeString(value: string): boolean {
	const calendarDate = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
	if (calendarDate) {
		const [, year, month, day] = calendarDate;
		const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
		if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return false;
	}
	return !Number.isNaN(new Date(value).getTime());
}

const dateLikeStringSchema = z.string().refine(isValidDateLikeString, { message: "Invalid date" });
const nullableDateLikeStringSchema = dateLikeStringSchema.nullable().optional();
const requiredNullableDateLikeStringSchema = dateLikeStringSchema.nullable();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const optionalMedicationDateSchema = z
	.union([dateLikeStringSchema, z.literal("")])
	.nullable()
	.optional();

// =============================================================================
// Zod Schemas for Import Validation
// =============================================================================

const scheduleSchema = z
	.strictObject({
		usage: z.number().nonnegative(),
		every: z.number().int().min(1),
		start: dateLikeStringSchema, // ISO/local datetime string
		scheduleMode: z.enum(["interval", "weekdays"]).optional(),
		weekdays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).optional(),
		intakeUnit: z.enum(["ml", "tsp", "tbsp"]).nullable().optional(),
		remind: z.boolean().optional().default(false),
		takenBy: z.string().nullable().optional(), // Per-intake takenBy (new field)
	})
	.refine((schedule) => schedule.scheduleMode !== "weekdays" || (schedule.weekdays?.length ?? 0) > 0, {
		message: "Weekday schedules require weekdays",
		path: ["weekdays"],
	});

const inventorySchema = z.strictObject({
	packCount: z.number().int().min(0).default(1),
	blistersPerPack: z.number().int().min(1).default(1),
	pillsPerBlister: z.number().int().min(1).default(1),
	totalPills: z.number().int().nullable().optional(), // For bottle type: total capacity
	looseTablets: z.number().int().min(0).default(0),
	stockAdjustment: z.number().int().default(0), // Manual stock correction
	scheduleStockRebaseMilli: z.number().int().default(0),
	packageType: z.enum(PACKAGE_TYPES).default("blister"),
	packageAmountValue: z.number().int().min(0).default(0),
	packageAmountUnit: z.enum(["ml", "g"]).default("ml"),
});

const medicationExportSchema = z.strictObject({
	_exportId: z.string().min(1),
	name: z.string().min(1),
	genericName: z.string().nullable().optional(),
	takenBy: z.array(z.string()).default([]),
	medicationForm: z.enum(["capsule", "tablet", "liquid", "topical"]).default("tablet"),
	pillForm: z.enum(["capsule", "tablet"]).nullable().optional(),
	lifecycleCategory: z.enum(["refill_when_empty", "treatment_period"]).default("refill_when_empty"),
	inventory: inventorySchema,
	pillWeightMg: z.number().int().nullable().optional(),
	doseUnit: z.enum(["mg", "g", "mcg", "ml", "IU", "units", "drops", "puffs", "injections"]).default("mg"),
	schedules: z.array(scheduleSchema).default([]),
	medicationStartDate: optionalMedicationDateSchema,
	medicationEndDate: optionalMedicationDateSchema,
	autoMarkObsoleteAfterEndDate: z.boolean().default(true),
	expiryDate: optionalMedicationDateSchema,
	notes: z.string().nullable().optional(),
	intakeRemindersEnabled: z.boolean().default(false),
	isObsolete: z.boolean().default(false),
	obsoleteAt: nullableDateLikeStringSchema,
	prescriptionEnabled: z.boolean().default(false),
	prescriptionAuthorizedRefills: z.number().int().min(0).nullable().optional(),
	prescriptionRemainingRefills: z.number().int().min(0).nullable().optional(),
	prescriptionLowRefillThreshold: z.number().int().min(0).default(1),
	prescriptionExpiryDate: optionalMedicationDateSchema,
	dismissedUntil: optionalMedicationDateSchema, // ISO date string for dismissed past doses
	image: z.string().nullable().optional(), // base64 data URL or null
	lastStockCorrectionAt: nullableDateLikeStringSchema, // ISO datetime of last stock correction
});

const doseHistorySchema = z.strictObject({
	medicationRef: z.string(), // References _exportId
	scheduleIndex: z.number().int().min(0),
	scheduledTime: dateLikeStringSchema, // ISO datetime
	takenAt: dateLikeStringSchema, // ISO datetime
	markedBy: z.string().nullable().optional(),
	takenSource: z.enum(["manual", "automatic", "notification"]).default("manual"),
	dismissed: z.boolean().default(false),
	takenByPerson: z.string().nullable().optional(), // Person suffix from dose ID (e.g., "Daniel")
	journalNote: z.string().nullable().optional(),
	journalMood: z.enum(INTAKE_MOODS).nullable().optional(),
	journalCreatedAt: nullableDateLikeStringSchema,
	journalUpdatedAt: nullableDateLikeStringSchema,
});

const refillHistoryExportSchema = z.strictObject({
	medicationRef: z.string(), // References _exportId
	packsAdded: z.number().int().min(0).default(0),
	loosePillsAdded: z.number().int().min(0).optional(),
	quantityAdded: z.number().int().min(0).optional(),
	usedPrescription: z.boolean().default(false),
	refillDate: dateLikeStringSchema, // ISO datetime
});

const shareLinkSchema = z.strictObject({
	takenBy: z.string().min(1),
	scheduleDays: z.number().int().min(1).default(30),
	allowJournalNotes: z.boolean().default(false),
	allowMarkTaken: z.boolean().default(true),
	expiresAt: nullableDateLikeStringSchema, // ISO datetime
	regenerateToken: z.boolean().default(true),
});

export const asNeededIntakeExportSchema = z
	.strictObject({
		eventId: z.string().uuid(),
		medicationRef: z.string().min(1),
		idempotencyKeyHash: sha256Schema,
		requestFingerprint: sha256Schema,
		occurredAt: dateLikeStringSchema,
		recordedAt: dateLikeStringSchema,
		quantityMilli: z.number().int().positive(),
		quantityUnit: z.enum(["pills", "ml", "puffs", "injections", "application"]),
		person: z.string().max(100).nullable(),
		source: z.literal("owner_as_needed"),
		status: z.enum(["active", "reversed"]),
		stockEffectMilli: z.number().int().nonnegative(),
		stockEffectReason: z.enum(["applied", "non_measurable", "before_correction", "superseded_by_correction"]),
		stockCutoffAt: requiredNullableDateLikeStringSchema,
		replacementForEventId: z.string().uuid().nullable(),
		reversedAt: requiredNullableDateLikeStringSchema,
		reversalIdempotencyKeyHash: sha256Schema.nullable(),
		revision: z.number().int().min(1),
		journalNote: z.string().max(4000).nullable(),
		journalMood: z.enum(INTAKE_MOODS).nullable(),
		journalCreatedAt: requiredNullableDateLikeStringSchema,
		journalUpdatedAt: requiredNullableDateLikeStringSchema,
	})
	.superRefine((event, context) => {
		if (event.status === "active" && event.reversedAt !== null) {
			context.addIssue({ code: "custom", path: ["reversedAt"], message: "Active event cannot have reversedAt" });
		}
		if (event.status === "reversed" && event.reversedAt === null) {
			context.addIssue({ code: "custom", path: ["reversedAt"], message: "Reversed event requires reversedAt" });
		}
		if (
			event.quantityUnit === "application" &&
			(event.quantityMilli !== 1000 || event.stockEffectMilli !== 0 || event.stockEffectReason !== "non_measurable")
		) {
			context.addIssue({
				code: "custom",
				path: ["quantityUnit"],
				message: "Application events require quantity 1 and zero non-measurable stock effect",
			});
		}
	});

const settingsSchemaBase = z.strictObject({
	timezone: z.string().default(""),
	// Email notifications
	emailEnabled: z.boolean().default(false),
	notificationEmail: z.string().nullable().optional(),
	emailStockReminders: z.boolean().default(true),
	emailIntakeReminders: z.boolean().default(true),
	emailPrescriptionReminders: z.boolean().default(true),
	// Push notifications
	shoutrrrEnabled: z.boolean().optional(),
	shoutrrrUrl: z.string().nullable().optional(),
	shoutrrrStockReminders: z.boolean().default(true),
	shoutrrrIntakeReminders: z.boolean().default(true),
	shoutrrrPrescriptionReminders: z.boolean().default(true),
	// Reminder settings
	reminderDaysBefore: z.number().int().default(7),
	repeatDailyReminders: z.boolean().default(false),
	skipRemindersForTakenDoses: z.boolean().default(false),
	repeatRemindersEnabled: z.boolean().default(false),
	reminderRepeatIntervalMinutes: z.number().int().default(30),
	maxNaggingReminders: z.number().int().default(5),
	// Stock thresholds
	lowStockDays: z.number().int().default(30),
	normalStockDays: z.number().int().default(90),
	highStockDays: z.number().int().default(180),
	expiryWarningDays: z.number().int().default(90),
	// UI preferences
	language: z.enum(APP_LANGUAGE_INPUTS).default("en-US").transform(normalizeAppLanguage),
	stockCalculationMode: z.enum(["automatic", "manual"]).default("automatic"),
	shareMedicationOverview: z.boolean().default(false),
	upcomingTodayOnly: z.boolean().default(false),
	shareScheduleTodayOnly: z.boolean().default(false),
	swapDashboardMainSections: z.boolean().default(false),
});

const importSettingsSchema = settingsSchemaBase
	.extend({
		// Accept the removed field from legacy exports so old backups still import,
		// but do not map it back into current runtime settings.
		shareStockStatus: z.boolean().optional(),
	})
	.optional();

export const importDataSchema = z
	.strictObject({
		version: z.string().refine(isSupportedExportVersion, {
			message: `Unsupported export format version. Supported up to ${EXPORT_VERSION}.`,
		}),
		exportedAt: dateLikeStringSchema,
		includeSensitiveData: z.boolean().default(false),
		medications: z.array(medicationExportSchema).default([]),
		doseHistory: z.array(doseHistorySchema).default([]),
		asNeededIntakes: z.array(asNeededIntakeExportSchema).optional(),
		refillHistory: z.array(refillHistoryExportSchema).default([]),
		settings: importSettingsSchema,
		shareLinks: z.array(shareLinkSchema).default([]),
	})
	.superRefine((data, context) => {
		if (parseExportVersion(data.version)?.minor === 9 && data.asNeededIntakes === undefined) {
			context.addIssue({
				code: "custom",
				path: ["asNeededIntakes"],
				message: "Export format 1.9 requires asNeededIntakes",
			});
		}
	})
	.transform((data) => ({ ...data, asNeededIntakes: data.asNeededIntakes ?? [] }));

export type ImportData = z.infer<typeof importDataSchema>;
