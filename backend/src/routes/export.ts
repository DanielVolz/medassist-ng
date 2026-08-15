import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import {
	getAsNeededQuantityProfile,
	INTAKE_MOODS,
	normalizeAsNeededQuantityMilli,
	normalizeIntakeMood,
} from "@medassist/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, withImmediateWriteTransaction } from "../db/client.js";
import { getDataDir } from "../db/path-utils.js";
import {
	asNeededIntakeEvents,
	doseTracking,
	intakeJournal,
	medications,
	refillHistory,
	shareTokens,
	userSettings,
} from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { filterScheduledDoseRows } from "../services/as-needed-intakes-service.js";
import {
	listAsNeededIntakeJournalExportPayloadsForUser,
	listIntakeJournalExportPayloadsForUser,
	restoreIntakeJournalForImportedDose,
} from "../services/intake-journal-export.js";
import { generateShareToken } from "../services/share-token-service.js";
import type { AuthUser } from "../types/fastify.js";
import { buildDoseId, parseDoseId } from "../utils/dose-id.js";
import {
	ALLOWED_IMAGE_MIME_TYPES,
	MAX_IMAGE_UPLOAD_BYTES,
	removeImageFiles,
	writeOptimizedImageSet,
} from "../utils/image-upload.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import { normalizePackageType, PACKAGE_TYPES } from "../utils/package-profiles.js";
import { normalizeIntake, normalizeMedicationIntakes, parseTakenByJson } from "../utils/scheduler-utils.js";

const IMAGES_DIR = resolve(getDataDir(), "images");

// =============================================================================
// Export Format Version (bump this when format changes)
// =============================================================================
const EXPORT_VERSION = "1.9";

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
	return !Number.isNaN(new Date(value).getTime());
}

function toRequiredIsoString(value: Date | string | number, field: string): string {
	const parsed = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Cannot export invalid as-needed intake ${field}`);
	}
	return parsed.toISOString();
}

function stockCutoffToIsoString(value: number): string | null {
	if (value === 0) return null;
	return toRequiredIsoString(value * 1000, "stock cutoff timestamp");
}

const dateLikeStringSchema = z.string().refine(isValidDateLikeString, { message: "Invalid date" });
const nullableDateLikeStringSchema = dateLikeStringSchema.nullable().optional();
const requiredNullableDateLikeStringSchema = dateLikeStringSchema.nullable();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

// =============================================================================
// Zod Schemas for Import Validation
// =============================================================================

const scheduleSchema = z.object({
	usage: z.number().nonnegative(),
	every: z.number().int().min(1),
	start: dateLikeStringSchema, // ISO/local datetime string
	scheduleMode: z.unknown().optional(),
	weekdays: z.unknown().optional(),
	intakeUnit: z.enum(["ml", "tsp", "tbsp"]).nullable().optional(),
	remind: z.boolean().optional().default(false),
	takenBy: z.string().nullable().optional(), // Per-intake takenBy (new field)
});

const inventorySchema = z.object({
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

const medicationExportSchema = z.object({
	_exportId: z.string(),
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
	medicationStartDate: z.string().nullable().optional(),
	medicationEndDate: z.string().nullable().optional(),
	autoMarkObsoleteAfterEndDate: z.boolean().default(true),
	expiryDate: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	intakeRemindersEnabled: z.boolean().default(false),
	isObsolete: z.boolean().default(false),
	obsoleteAt: nullableDateLikeStringSchema,
	prescriptionEnabled: z.boolean().default(false),
	prescriptionAuthorizedRefills: z.number().int().min(0).nullable().optional(),
	prescriptionRemainingRefills: z.number().int().min(0).nullable().optional(),
	prescriptionLowRefillThreshold: z.number().int().min(0).default(1),
	prescriptionExpiryDate: z.string().nullable().optional(),
	dismissedUntil: z.string().nullable().optional(), // ISO date string for dismissed past doses
	image: z.string().nullable().optional(), // base64 data URL or null
	lastStockCorrectionAt: nullableDateLikeStringSchema, // ISO datetime of last stock correction
});

const doseHistorySchema = z.object({
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

const refillHistoryExportSchema = z.object({
	medicationRef: z.string(), // References _exportId
	packsAdded: z.number().int().min(0).default(0),
	loosePillsAdded: z.number().int().min(0).optional(),
	quantityAdded: z.number().int().min(0).optional(),
	usedPrescription: z.boolean().default(false),
	refillDate: dateLikeStringSchema, // ISO datetime
});

const shareLinkSchema = z.object({
	takenBy: z.string().min(1),
	scheduleDays: z.number().int().min(1).default(30),
	allowJournalNotes: z.boolean().default(false),
	allowMarkTaken: z.boolean().default(true),
	expiresAt: nullableDateLikeStringSchema, // ISO datetime
	regenerateToken: z.boolean().default(true),
});

const asNeededIntakeExportSchema = z
	.object({
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

const settingsSchemaBase = z.object({
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
	language: z.enum(["en", "de"]).default("en"),
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

const importDataSchema = z
	.object({
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

const exportQuerystringSchema = {
	type: "object",
	properties: {
		includeSensitive: { type: "string", enum: ["true", "false"] },
		includeImages: { type: "string", enum: ["true", "false"] },
	},
} as const;

const exportResponseSchema = {
	type: "object",
	properties: {
		version: { type: "string" },
		exportedAt: { type: "string", format: "date-time" },
		includeSensitiveData: { type: "boolean" },
		medications: { type: "array", items: { type: "object", additionalProperties: true } },
		doseHistory: { type: "array", items: { type: "object", additionalProperties: true } },
		asNeededIntakes: { type: "array", items: { type: "object", additionalProperties: true } },
		refillHistory: { type: "array", items: { type: "object", additionalProperties: true } },
		settings: { type: "object", additionalProperties: true },
		shareLinks: { type: "array", items: { type: "object", additionalProperties: true } },
	},
} as const;

const importBodyOpenApiSchema = {
	type: "object",
	required: ["version", "exportedAt"],
	properties: {
		version: { type: "string" },
		exportedAt: { type: "string", format: "date-time" },
		includeSensitiveData: { type: "boolean" },
		medications: { type: "array", items: { type: "object", additionalProperties: true } },
		doseHistory: { type: "array", items: { type: "object", additionalProperties: true } },
		asNeededIntakes: { type: "array", items: { type: "object", additionalProperties: true } },
		refillHistory: { type: "array", items: { type: "object", additionalProperties: true } },
		settings: { type: "object", additionalProperties: true },
		shareLinks: { type: "array", items: { type: "object", additionalProperties: true } },
	},
	example: {
		version: "1.9",
		exportedAt: "2026-03-11T10:15:00.000Z",
		includeSensitiveData: true,
		medications: [
			{
				name: "Ibuprofen 400",
				packageType: "box",
				packCount: 1,
				looseTablets: 8,
				intakes: [
					{
						usage: 1,
						every: 8,
						start: "2026-03-11T08:00:00.000Z",
						takenBy: "Daniel",
						remind: true,
					},
				],
			},
		],
		doseHistory: [
			{
				medicationRef: "med-1",
				scheduleIndex: 0,
				scheduledTime: "2026-03-11T08:00:00.000Z",
				takenAt: "2026-03-11T08:03:00.000Z",
				markedBy: "Daniel",
				takenSource: "manual",
				dismissed: false,
				takenByPerson: "Daniel",
				journalNote: "Took after breakfast.",
				journalMood: "good",
				journalUpdatedAt: "2026-03-11T08:05:00.000Z",
			},
		],
		asNeededIntakes: [],
		refillHistory: [{ packsAdded: 1, loosePillsAdded: 4, quantityAdded: 34, refillDate: "2026-03-10T12:00:00.000Z" }],
		settings: { language: "en", stockCalculationMode: "automatic" },
		shareLinks: [{ takenBy: "Daniel", scheduleDays: 14 }],
	},
} as const;

const importPreviewResponseSchema = {
	type: "object",
	properties: {
		success: { type: "boolean" },
		preview: {
			type: "object",
			properties: {
				version: { type: "string" },
				exportedAt: { type: "string", format: "date-time" },
				includeSensitiveData: { type: "boolean" },
				incoming: {
					type: "object",
					properties: {
						medications: { type: "integer" },
						doseHistory: { type: "integer" },
						asNeededIntakes: { type: "integer" },
						refillHistory: { type: "integer" },
						shareLinks: { type: "integer" },
						journalEntries: { type: "integer" },
						imageCount: { type: "integer" },
						hasSettings: { type: "boolean" },
					},
				},
				current: {
					type: "object",
					properties: {
						medications: { type: "integer" },
						doseHistory: { type: "integer" },
						asNeededIntakes: { type: "integer" },
						refillHistory: { type: "integer" },
						shareLinks: { type: "integer" },
						hasSettings: { type: "boolean" },
					},
				},
				warnings: {
					type: "object",
					properties: {
						replacesExistingData: { type: "boolean" },
						regeneratesShareLinks: { type: "boolean" },
						containsImages: { type: "boolean" },
						containsSensitiveData: { type: "boolean" },
					},
				},
			},
		},
	},
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

// Helper to get user ID from request
async function getUserId(request: FastifyRequest, reply: FastifyReply): Promise<number> {
	if (!env.AUTH_ENABLED) {
		return getAnonymousUserId();
	}

	const authUser = request.user as unknown as AuthUser | null;
	if (!authUser) {
		reply.status(401).send({ error: "Not authenticated" });
		throw new Error("AUTH_REQUIRED");
	}
	return authUser.id;
}

// Parse intakes from DB format to export format (with per-intake takenBy)
function parseIntakesForExport(row: typeof medications.$inferSelect): Array<{
	usage: number;
	every: number;
	start: string;
	scheduleMode: "interval" | "weekdays";
	weekdays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
	intakeUnit: "ml" | "tsp" | "tbsp" | null;
	remind: boolean;
	takenBy: string | null;
}> {
	const intakes = normalizeMedicationIntakes(row);

	return intakes.map((intake) => ({
		usage: intake.usage,
		every: intake.every,
		start: intake.start,
		scheduleMode: intake.scheduleMode ?? "interval",
		weekdays: intake.weekdays ?? [],
		intakeUnit: intake.intakeUnit ?? null,
		remind: intake.intakeRemindersEnabled,
		takenBy: intake.takenBy, // Per-intake takenBy
	}));
}

// Read image file and convert to base64 data URL
const imageFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

function resolveStoredImagePath(imageUrl: string): string | null {
	if (
		!imageFilenamePattern.test(imageUrl) ||
		imageUrl.includes("/") ||
		imageUrl.includes("\\") ||
		imageUrl.includes("..")
	) {
		return null;
	}

	const imagePath = resolve(IMAGES_DIR, imageUrl);
	const relativePath = relative(IMAGES_DIR, imagePath);
	if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
		return null;
	}

	return imagePath;
}

function imageToBase64(imageUrl: string | null): string | null {
	if (!imageUrl) return null;
	const imagePath = resolveStoredImagePath(imageUrl);
	if (!imagePath) return null;
	if (!existsSync(imagePath)) return null;

	try {
		const imageBuffer = readFileSync(imagePath);
		const ext = extname(imageUrl).toLowerCase();
		const mimeTypes: Record<string, string> = {
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".png": "image/png",
			".webp": "image/webp",
			".gif": "image/gif",
		};
		const mimeType = mimeTypes[ext] || "image/jpeg";
		return `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
	} catch {
		return null;
	}
}

class ImportValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ImportValidationError";
	}
}

// Save base64 image to file and return filename
async function base64ToImage(base64: string, medicationId: number): Promise<string | null> {
	if (!base64.startsWith("data:")) {
		throw new ImportValidationError("Invalid image data");
	}

	try {
		// Parse data URL: "data:image/jpeg;base64,/9j/4AAQ..."
		const matches = base64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/);
		if (!matches) throw new ImportValidationError("Invalid image data");

		const mimeType = matches[1].toLowerCase();
		if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
			throw new ImportValidationError("Invalid image type");
		}

		const data = matches[2];
		const buffer = Buffer.from(data, "base64");
		if (buffer.length === 0 || buffer.length > MAX_IMAGE_UPLOAD_BYTES) {
			throw new ImportValidationError("Invalid image size");
		}

		if (!existsSync(IMAGES_DIR)) {
			mkdirSync(IMAGES_DIR, { recursive: true });
		}

		const { filename } = await writeOptimizedImageSet(IMAGES_DIR, `med-${medicationId}`, buffer);
		return filename;
	} catch (error) {
		if (error instanceof ImportValidationError) {
			throw error;
		}
		throw new ImportValidationError("Invalid image data");
	}
}

function removeImageSetIfPresent(imageFilename: string): string | null {
	try {
		if (!resolveStoredImagePath(imageFilename)) {
			return "Unsafe image filename";
		}
		removeImageFiles(IMAGES_DIR, imageFilename);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : "Unknown file removal error";
	}
}

function buildImportPreview(
	importData: z.infer<typeof importDataSchema>,
	currentData: {
		medications: number;
		doseHistory: number;
		asNeededIntakes: number;
		refillHistory: number;
		shareLinks: number;
		hasSettings: boolean;
	}
) {
	const scheduledJournalEntries = importData.doseHistory.filter(
		(dose) =>
			(typeof dose.journalNote === "string" && dose.journalNote.trim()) ||
			normalizeIntakeMood(dose.journalMood) !== null
	).length;
	const asNeededJournalEntries = importData.asNeededIntakes.filter(
		(event) =>
			event.journalNote !== null ||
			event.journalMood !== null ||
			event.journalCreatedAt !== null ||
			event.journalUpdatedAt !== null
	).length;
	const imageCount = importData.medications.filter(
		(med) => typeof med.image === "string" && med.image.startsWith("data:")
	).length;

	return {
		version: importData.version,
		exportedAt: importData.exportedAt,
		includeSensitiveData: importData.includeSensitiveData,
		incoming: {
			medications: importData.medications.length,
			doseHistory: importData.doseHistory.length,
			asNeededIntakes: importData.asNeededIntakes.length,
			refillHistory: importData.refillHistory.length,
			shareLinks: importData.shareLinks.length,
			journalEntries: scheduledJournalEntries + asNeededJournalEntries,
			imageCount,
			hasSettings: Boolean(importData.settings),
		},
		current: currentData,
		warnings: {
			replacesExistingData:
				currentData.medications > 0 ||
				currentData.doseHistory > 0 ||
				currentData.asNeededIntakes > 0 ||
				currentData.refillHistory > 0 ||
				currentData.shareLinks > 0 ||
				currentData.hasSettings,
			regeneratesShareLinks: importData.shareLinks.length > 0,
			containsImages: imageCount > 0,
			containsSensitiveData: importData.includeSensitiveData,
		},
	};
}

const MAX_IMPORT_VALIDATION_ISSUES = 10;
type ImportData = z.infer<typeof importDataSchema>;
type ImportedAsNeededIntake = ImportData["asNeededIntakes"][number];

function formatImportSchemaIssues(error: z.ZodError): string[] {
	return error.issues
		.slice(0, MAX_IMPORT_VALIDATION_ISSUES)
		.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "root"}: ${issue.message}`);
}

function hasImportedAsNeededJournal(event: ImportedAsNeededIntake): boolean {
	return event.journalNote !== null;
}

function collectImportValidationIssues(importData: ImportData): string[] {
	const issues: string[] = [];
	const addIssue = (message: string) => {
		if (issues.length < MAX_IMPORT_VALIDATION_ISSUES) issues.push(message);
	};
	const medicationsByRef = new Map<string, z.infer<typeof medicationExportSchema>>();

	for (const med of importData.medications) {
		if (medicationsByRef.has(med._exportId)) {
			addIssue(`Duplicate medication reference: ${med._exportId}`);
			continue;
		}
		medicationsByRef.set(med._exportId, med);
	}

	const doseKeys = new Set<string>();
	for (const dose of importData.doseHistory) {
		const medication = medicationsByRef.get(dose.medicationRef);
		if (!medication) {
			addIssue(`Dose history references unknown medication: ${dose.medicationRef}`);
			continue;
		}
		if (dose.scheduleIndex >= medication.schedules.length) {
			addIssue(`Dose history references unknown schedule index ${dose.scheduleIndex} for ${dose.medicationRef}`);
		}

		const doseKey = [
			dose.medicationRef,
			dose.scheduleIndex,
			new Date(dose.scheduledTime).getTime(),
			dose.takenByPerson ?? "",
		].join(":");
		if (doseKeys.has(doseKey)) addIssue(`Duplicate dose history entry for ${dose.medicationRef}`);
		doseKeys.add(doseKey);
	}

	for (const refill of importData.refillHistory) {
		if (!medicationsByRef.has(refill.medicationRef)) {
			addIssue(`Refill history references unknown medication: ${refill.medicationRef}`);
		}
	}

	const eventsById = new Map<string, ImportedAsNeededIntake>();
	const createKeyHashes = new Set<string>();
	const reversalKeyHashes = new Set<string>();
	const replacementTargets = new Set<string>();

	for (const event of importData.asNeededIntakes) {
		if (eventsById.has(event.eventId)) addIssue("Duplicate as-needed event ID");
		else eventsById.set(event.eventId, event);
		if (
			event.eventId !== event.eventId.toLowerCase() ||
			(event.replacementForEventId !== null &&
				event.replacementForEventId !== event.replacementForEventId.toLowerCase())
		) {
			addIssue("As-needed event IDs must use canonical lowercase UUIDs");
		}

		if (createKeyHashes.has(event.idempotencyKeyHash)) addIssue("Duplicate as-needed idempotency key hash");
		createKeyHashes.add(event.idempotencyKeyHash);
		if (event.reversalIdempotencyKeyHash) {
			if (reversalKeyHashes.has(event.reversalIdempotencyKeyHash)) {
				addIssue("Duplicate as-needed reversal key hash");
			}
			reversalKeyHashes.add(event.reversalIdempotencyKeyHash);
		}

		const medication = medicationsByRef.get(event.medicationRef);
		if (!medication) {
			addIssue("As-needed intake references unknown medication");
			continue;
		}

		const profile = getAsNeededQuantityProfile({
			packageType: medication.inventory.packageType,
			medicationForm: medication.medicationForm,
			pillForm: medication.pillForm,
		});
		if (
			event.quantityUnit !== profile.unit ||
			normalizeAsNeededQuantityMilli(event.quantityMilli / 1000, profile) !== event.quantityMilli
		) {
			addIssue("As-needed intake quantity does not match the medication package profile");
		}
		if (event.person !== null && (event.person.length === 0 || event.person.trim() !== event.person)) {
			addIssue("As-needed intake person must be canonical or null");
		}

		const occurredAt = new Date(event.occurredAt).getTime();
		const recordedAt = new Date(event.recordedAt).getTime();
		if (recordedAt < occurredAt) addIssue("As-needed intake recordedAt precedes occurredAt");
		if (
			[occurredAt, recordedAt, event.reversedAt ? new Date(event.reversedAt).getTime() : 0].some(
				(timestamp) => timestamp % 1000 !== 0
			)
		) {
			addIssue("As-needed intake timestamps exceed persisted whole-second precision");
		}
		if (event.status === "active" && event.reversalIdempotencyKeyHash !== null) {
			addIssue("Active as-needed intake cannot have reversal metadata");
		}
		if (event.status === "reversed" && (event.reversalIdempotencyKeyHash === null || event.revision < 2)) {
			addIssue("Reversed as-needed intake has incomplete reversal metadata");
		}
		if (event.reversedAt && new Date(event.reversedAt).getTime() < occurredAt) {
			addIssue("As-needed intake reversedAt precedes occurredAt");
		}

		const hasJournal = hasImportedAsNeededJournal(event);
		const hasJournalCreatedAt = event.journalCreatedAt !== null;
		const hasJournalUpdatedAt = event.journalUpdatedAt !== null;
		if (
			(event.journalMood !== null && !hasJournal) ||
			hasJournalCreatedAt !== hasJournalUpdatedAt ||
			hasJournal !== hasJournalCreatedAt
		) {
			addIssue("As-needed intake journal fields are inconsistent");
		} else if (
			hasJournalCreatedAt &&
			new Date(event.journalUpdatedAt as string).getTime() < new Date(event.journalCreatedAt as string).getTime()
		) {
			addIssue("As-needed intake journal updatedAt precedes createdAt");
		} else if (
			hasJournalCreatedAt &&
			[new Date(event.journalCreatedAt as string).getTime(), new Date(event.journalUpdatedAt as string).getTime()].some(
				(timestamp) => timestamp % 1000 !== 0
			)
		) {
			addIssue("As-needed intake journal timestamps exceed persisted whole-second precision");
		}

		const cutoffAt = event.stockCutoffAt ? new Date(event.stockCutoffAt).getTime() : null;
		if (cutoffAt !== null && cutoffAt % 1000 !== 0) {
			addIssue("As-needed intake stock cutoff exceeds persisted whole-second precision");
		}
		const correctionAt = medication.lastStockCorrectionAt ? new Date(medication.lastStockCorrectionAt).getTime() : null;
		if (!profile.measurable) {
			if (event.stockEffectMilli !== 0 || event.stockEffectReason !== "non_measurable" || cutoffAt !== null) {
				addIssue("Non-measurable as-needed intake has an invalid stock effect");
			}
		} else if (event.stockEffectReason === "applied") {
			if (event.stockEffectMilli !== event.quantityMilli || cutoffAt !== null) {
				addIssue("Applied as-needed intake has an invalid stock effect");
			}
			if (event.status === "active" && correctionAt !== null && occurredAt <= correctionAt) {
				addIssue("Active as-needed intake predating the stock correction must have a neutralized effect");
			}
		} else if (
			event.stockEffectReason === "before_correction" ||
			event.stockEffectReason === "superseded_by_correction"
		) {
			if (
				event.stockEffectMilli !== 0 ||
				cutoffAt === null ||
				correctionAt === null ||
				cutoffAt < occurredAt ||
				cutoffAt > correctionAt
			) {
				addIssue("Correction-neutralized as-needed intake has an invalid stock effect or cutoff");
			}
		} else {
			addIssue("Measurable as-needed intake has an invalid stock effect reason");
		}

		if (event.replacementForEventId) {
			if (replacementTargets.has(event.replacementForEventId)) {
				addIssue("Multiple as-needed intakes replace the same event");
			}
			replacementTargets.add(event.replacementForEventId);
		}
	}

	for (const event of importData.asNeededIntakes) {
		if (!event.replacementForEventId) continue;
		const target = eventsById.get(event.replacementForEventId);
		if (!target) addIssue("As-needed replacement references unknown event");
		else if (
			target.eventId === event.eventId ||
			target.medicationRef !== event.medicationRef ||
			target.status !== "reversed"
		) {
			addIssue("As-needed replacement target must be a different reversed event for the same medication");
		} else if (target.reversedAt && new Date(event.occurredAt).getTime() < new Date(target.reversedAt).getTime()) {
			addIssue("As-needed replacement predates the target reversal");
		}
	}

	const graphState = new Map<string, "visiting" | "done">();
	for (const startId of eventsById.keys()) {
		if (graphState.get(startId) === "done") continue;
		const path: string[] = [];
		let currentId: string | null = startId;
		while (currentId && eventsById.has(currentId) && graphState.get(currentId) !== "done") {
			if (graphState.get(currentId) === "visiting") {
				addIssue("As-needed replacement graph contains a cycle");
				break;
			}
			graphState.set(currentId, "visiting");
			path.push(currentId);
			currentId = eventsById.get(currentId)?.replacementForEventId ?? null;
		}
		for (const eventId of path) graphState.set(eventId, "done");
	}

	return issues;
}

// =============================================================================
// Export Routes
// =============================================================================
export async function exportRoutes(app: FastifyInstance) {
	// All export routes require auth
	app.addHook("preHandler", requireAuth);
	applyOpenApiRouteStandards(app, { tag: "export", protectedByDefault: true });

	// ---------------------------------------------------------------------------
	// GET /export - Export all user data
	// ---------------------------------------------------------------------------
	app.get<{ Querystring: { includeSensitive?: string; includeImages?: string } }>(
		"/export",
		{
			schema: {
				querystring: exportQuerystringSchema,
				response: {
					200: exportResponseSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const includeSensitive = request.query.includeSensitive === "true";
			const includeImages = request.query.includeImages !== "false"; // Default to true

			// 1. Load all medications
			const meds = await db.select().from(medications).where(eq(medications.userId, userId)).orderBy(medications.id);
			const medicationById = new Map(meds.map((med) => [med.id, med]));

			// Build medication ID to export ID mapping
			const medIdToExportId = new Map<number, string>();
			const exportMedications = meds.map((med, index) => {
				const exportId = `med-${index + 1}`;
				medIdToExportId.set(med.id, exportId);

				// Safely convert lastStockCorrectionAt to ISO string
				let lastStockCorrectionAtIso: string | null = null;
				if (med.lastStockCorrectionAt) {
					try {
						if (med.lastStockCorrectionAt instanceof Date && !Number.isNaN(med.lastStockCorrectionAt.getTime())) {
							lastStockCorrectionAtIso = med.lastStockCorrectionAt.toISOString();
						} else if (typeof med.lastStockCorrectionAt === "number" || typeof med.lastStockCorrectionAt === "string") {
							const d = new Date(med.lastStockCorrectionAt);
							lastStockCorrectionAtIso = !Number.isNaN(d.getTime()) ? d.toISOString() : null;
						}
					} catch {
						lastStockCorrectionAtIso = null;
					}
				}

				return {
					_exportId: exportId,
					name: med.name,
					genericName: med.genericName,
					takenBy: parseTakenByJson(med.takenByJson),
					medicationForm: med.medicationForm ?? "tablet",
					pillForm: med.pillForm ?? null,
					lifecycleCategory: med.lifecycleCategory ?? "refill_when_empty",
					inventory: {
						packCount: med.packCount ?? 1,
						blistersPerPack: med.blistersPerPack ?? 1,
						pillsPerBlister: med.pillsPerBlister ?? 1,
						totalPills: med.totalPills ?? null,
						looseTablets: med.looseTablets ?? 0,
						stockAdjustment: med.stockAdjustment ?? 0,
						scheduleStockRebaseMilli: med.scheduleStockRebaseMilli ?? 0,
						packageType: normalizePackageType(med.packageType),
						packageAmountValue: med.packageAmountValue ?? 0,
						packageAmountUnit: (med.packageAmountUnit ?? "ml") as "ml" | "g",
					},
					pillWeightMg: med.pillWeightMg,
					doseUnit: med.doseUnit ?? "mg",
					schedules: parseIntakesForExport(med),
					medicationStartDate: med.medicationStartDate || null,
					medicationEndDate: med.medicationEndDate || null,
					autoMarkObsoleteAfterEndDate: med.autoMarkObsoleteAfterEndDate ?? true,
					expiryDate: med.expiryDate,
					notes: med.notes,
					intakeRemindersEnabled: med.intakeRemindersEnabled ?? false,
					isObsolete: med.isObsolete ?? false,
					obsoleteAt: med.obsoleteAt?.toISOString() ?? null,
					prescriptionEnabled: med.prescriptionEnabled ?? false,
					prescriptionAuthorizedRefills: med.prescriptionAuthorizedRefills ?? null,
					prescriptionRemainingRefills: med.prescriptionRemainingRefills ?? null,
					prescriptionLowRefillThreshold: med.prescriptionLowRefillThreshold ?? 1,
					prescriptionExpiryDate: med.prescriptionExpiryDate ?? null,
					dismissedUntil: med.dismissedUntil ?? null,
					image: includeImages ? imageToBase64(med.imageUrl) : null,
					lastStockCorrectionAt: lastStockCorrectionAtIso,
				};
			});

			// 2. Load all dose tracking entries
			const doseRows = await db.select().from(doseTracking).where(eq(doseTracking.userId, userId));
			const doses = await filterScheduledDoseRows(db, userId, doseRows);
			const journalPayloadsByDoseTrackingId = await listIntakeJournalExportPayloadsForUser(userId);

			const exportDoseHistory = doses
				.map((dose) => {
					const parsed = parseDoseId(dose.doseId);
					if (!parsed) return null;

					const exportId = medIdToExportId.get(parsed.medicationId);
					if (!exportId) return null; // Orphaned dose, skip

					// Safely convert takenAt to ISO string
					let takenAtIso: string;
					try {
						if (dose.takenAt instanceof Date && !Number.isNaN(dose.takenAt.getTime())) {
							takenAtIso = dose.takenAt.toISOString();
						} else if (typeof dose.takenAt === "number" || typeof dose.takenAt === "string") {
							const d = new Date(dose.takenAt);
							takenAtIso = !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
						} else {
							takenAtIso = new Date().toISOString();
						}
					} catch {
						takenAtIso = new Date().toISOString();
					}

					// Safely convert scheduled time
					let scheduledTimeIso: string;
					try {
						const d = new Date(parsed.timestampMs);
						scheduledTimeIso = !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
					} catch {
						scheduledTimeIso = new Date().toISOString();
					}

					return {
						medicationRef: exportId,
						scheduleIndex: parsed.intakeIndex,
						scheduledTime: scheduledTimeIso,
						takenAt: takenAtIso,
						markedBy: dose.markedBy,
						takenSource:
							dose.takenSource === "automatic" || dose.takenSource === "notification" ? dose.takenSource : "manual",
						dismissed: dose.dismissed ?? false,
						takenByPerson: parsed.personSuffix,
						...journalPayloadsByDoseTrackingId.get(dose.id),
					};
				})
				.filter((d): d is NonNullable<typeof d> => d !== null);

			const asNeededEvents = await db
				.select()
				.from(asNeededIntakeEvents)
				.where(eq(asNeededIntakeEvents.userId, userId))
				.orderBy(asNeededIntakeEvents.id);
			const eventIdByInternalId = new Map(asNeededEvents.map((event) => [event.id, event.eventId]));
			const asNeededJournalPayloads = await listAsNeededIntakeJournalExportPayloadsForUser(userId);
			const exportAsNeededIntakes = asNeededEvents.map((event) => {
				const medicationRef = medIdToExportId.get(event.medicationId);
				if (!medicationRef) {
					throw new Error("Cannot export as-needed intake with missing medication");
				}

				const replacementForEventId = event.replacesEventId ? eventIdByInternalId.get(event.replacesEventId) : null;
				if (event.replacesEventId && !replacementForEventId) {
					throw new Error("Cannot export as-needed intake with missing replacement target");
				}

				const journal = asNeededJournalPayloads.get(event.doseTrackingId);
				return asNeededIntakeExportSchema.parse({
					eventId: event.eventId,
					medicationRef,
					idempotencyKeyHash: event.idempotencyKeyHash,
					requestFingerprint: event.requestFingerprint,
					occurredAt: toRequiredIsoString(event.occurredAt, "occurred timestamp"),
					recordedAt: toRequiredIsoString(event.recordedAt, "recorded timestamp"),
					quantityMilli: event.quantityMilli,
					quantityUnit: event.quantityUnit,
					person: event.personName || null,
					source: event.source,
					status: event.status,
					stockEffectMilli: event.stockEffectMilli,
					stockEffectReason: event.stockEffectReason,
					stockCutoffAt: stockCutoffToIsoString(event.stockCutoffAt),
					replacementForEventId,
					reversedAt: event.reversedAt ? toRequiredIsoString(event.reversedAt, "reversed timestamp") : null,
					reversalIdempotencyKeyHash: event.reversalIdempotencyKeyHash,
					revision: event.revision,
					journalNote: journal?.journalNote ?? null,
					journalMood: journal?.journalMood ?? null,
					journalCreatedAt: journal?.journalCreatedAt ?? null,
					journalUpdatedAt: journal?.journalUpdatedAt ?? null,
				});
			});

			// 3. Load user settings
			const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));

			const exportSettings = settings
				? {
						timezone: settings.timezone ?? "",
						emailEnabled: settings.emailEnabled,
						notificationEmail: includeSensitive ? settings.notificationEmail : undefined,
						emailStockReminders: settings.emailStockReminders,
						emailIntakeReminders: settings.emailIntakeReminders,
						emailPrescriptionReminders: settings.emailPrescriptionReminders ?? true,
						// Only include sensitive data if requested
						shoutrrrEnabled: includeSensitive ? settings.shoutrrrEnabled : undefined,
						shoutrrrUrl: includeSensitive ? settings.shoutrrrUrl : undefined,
						shoutrrrStockReminders: settings.shoutrrrStockReminders,
						shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
						shoutrrrPrescriptionReminders: settings.shoutrrrPrescriptionReminders ?? true,
						reminderDaysBefore: settings.reminderDaysBefore,
						repeatDailyReminders: settings.repeatDailyReminders,
						skipRemindersForTakenDoses: settings.skipRemindersForTakenDoses,
						repeatRemindersEnabled: settings.repeatRemindersEnabled,
						reminderRepeatIntervalMinutes: settings.reminderRepeatIntervalMinutes,
						maxNaggingReminders: settings.maxNaggingReminders,
						lowStockDays: settings.lowStockDays,
						normalStockDays: settings.normalStockDays,
						highStockDays: settings.highStockDays,
						expiryWarningDays: settings.expiryWarningDays,
						language: settings.language,
						stockCalculationMode: settings.stockCalculationMode,
						shareMedicationOverview: settings.shareMedicationOverview ?? false,
						upcomingTodayOnly: settings.upcomingTodayOnly ?? false,
						shareScheduleTodayOnly: settings.shareScheduleTodayOnly ?? false,
						swapDashboardMainSections: settings.swapDashboardMainSections ?? false,
					}
				: undefined;

			// 4. Load share links
			const shares = await db.select().from(shareTokens).where(eq(shareTokens.userId, userId));

			const exportShareLinks = includeSensitive
				? shares.map((share) => {
						// Safely convert expiresAt to ISO string
						let expiresAtIso: string | null = null;
						if (share.expiresAt) {
							try {
								if (share.expiresAt instanceof Date && !Number.isNaN(share.expiresAt.getTime())) {
									expiresAtIso = share.expiresAt.toISOString();
								} else if (typeof share.expiresAt === "number" || typeof share.expiresAt === "string") {
									const d = new Date(share.expiresAt);
									expiresAtIso = !Number.isNaN(d.getTime()) ? d.toISOString() : null;
								}
							} catch {
								expiresAtIso = null;
							}
						}

						return {
							takenBy: share.takenBy,
							scheduleDays: share.scheduleDays,
							allowJournalNotes: share.allowJournalNotes ?? false,
							allowMarkTaken: share.allowMarkTaken ?? true,
							expiresAt: expiresAtIso,
							regenerateToken: true, // Always regenerate tokens on import for security
						};
					})
				: [];

			// 5. Load refill history
			const refills = await db.select().from(refillHistory).where(eq(refillHistory.userId, userId));

			const exportRefillHistory = refills
				.map((refill) => {
					const exportId = medIdToExportId.get(refill.medicationId);
					if (!exportId) return null; // Orphaned refill, skip
					const medication = medicationById.get(refill.medicationId);
					const packageType = normalizePackageType(medication?.packageType);
					const pillsPerPack = Math.max(1, (medication?.blistersPerPack ?? 1) * (medication?.pillsPerBlister ?? 1));
					const quantityAdded =
						packageType === "bottle" ||
						packageType === "inhaler" ||
						packageType === "injection" ||
						packageType === "tube" ||
						packageType === "liquid_container"
							? (refill.loosePillsAdded ?? 0)
							: (refill.packsAdded ?? 0) * pillsPerPack + (refill.loosePillsAdded ?? 0);

					// Safely convert refillDate to ISO string
					let refillDateIso: string;
					try {
						if (refill.refillDate instanceof Date && !Number.isNaN(refill.refillDate.getTime())) {
							refillDateIso = refill.refillDate.toISOString();
						} else if (typeof refill.refillDate === "number" || typeof refill.refillDate === "string") {
							const d = new Date(refill.refillDate);
							refillDateIso = !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
						} else {
							refillDateIso = new Date().toISOString();
						}
					} catch {
						refillDateIso = new Date().toISOString();
					}

					return {
						medicationRef: exportId,
						packsAdded: refill.packsAdded ?? 0,
						loosePillsAdded: refill.loosePillsAdded ?? 0,
						quantityAdded,
						usedPrescription: refill.usedPrescription ?? false,
						refillDate: refillDateIso,
					};
				})
				.filter((r): r is NonNullable<typeof r> => r !== null);

			// Build export object
			const exportData = {
				version: EXPORT_VERSION,
				exportedAt: new Date().toISOString(),
				includeSensitiveData: includeSensitive,
				medications: exportMedications,
				doseHistory: exportDoseHistory,
				asNeededIntakes: exportAsNeededIntakes,
				refillHistory: exportRefillHistory,
				settings: exportSettings,
				shareLinks: exportShareLinks,
			};

			// Set download headers
			const now = new Date();
			const dateStr = now.toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 13);
			const authUser = env.AUTH_ENABLED ? (request.user as unknown as AuthUser | null) : null;
			const userPart = authUser?.username ? `-${authUser.username}` : "";
			const filename = `medassist-export${userPart}-${dateStr}.json`;
			reply.header("Content-Type", "application/json");
			reply.header("Content-Disposition", `attachment; filename="${filename}"`);

			return exportData;
		}
	);

	// ---------------------------------------------------------------------------
	// POST /import/preview - Validate and summarize import data without writing
	// ---------------------------------------------------------------------------
	app.post(
		"/import/preview",
		{
			config: {
				rawBody: true,
			},
			bodyLimit: 50 * 1024 * 1024,
			schema: {
				body: importBodyOpenApiSchema,
				response: {
					200: importPreviewResponseSchema,
					400: validationErrorSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			const parsed = importDataSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: "Invalid import data format",
					code: "INVALID_IMPORT_DATA",
					details: { _errors: formatImportSchemaIssues(parsed.error) },
				});
			}

			const validationIssues = collectImportValidationIssues(parsed.data);
			if (validationIssues.length > 0) {
				return reply.status(400).send({
					error: "Invalid import data format",
					code: "INVALID_IMPORT_DATA",
					details: { _errors: validationIssues },
				});
			}

			const [
				existingMeds,
				existingDoseHistory,
				existingAsNeededIntakes,
				existingRefillHistory,
				existingShareLinks,
				existingSettings,
			] = await Promise.all([
				db.select({ id: medications.id }).from(medications).where(eq(medications.userId, userId)),
				db.select({ id: doseTracking.id }).from(doseTracking).where(eq(doseTracking.userId, userId)),
				db
					.select({ id: asNeededIntakeEvents.id })
					.from(asNeededIntakeEvents)
					.where(eq(asNeededIntakeEvents.userId, userId)),
				db.select({ id: refillHistory.id }).from(refillHistory).where(eq(refillHistory.userId, userId)),
				db.select({ id: shareTokens.id }).from(shareTokens).where(eq(shareTokens.userId, userId)),
				db.select({ id: userSettings.id }).from(userSettings).where(eq(userSettings.userId, userId)),
			]);
			const scheduledDoseHistory = await filterScheduledDoseRows(db, userId, existingDoseHistory);

			return {
				success: true,
				preview: buildImportPreview(parsed.data, {
					medications: existingMeds.length,
					doseHistory: scheduledDoseHistory.length,
					asNeededIntakes: existingAsNeededIntakes.length,
					refillHistory: existingRefillHistory.length,
					shareLinks: existingShareLinks.length,
					hasSettings: existingSettings.length > 0,
				}),
			};
		}
	);

	// ---------------------------------------------------------------------------
	// POST /import - Import user data (replaces all existing data!)
	// ---------------------------------------------------------------------------
	app.post(
		"/import",
		{
			config: {
				// Increase body limit to 50MB to handle exports with base64 images
				rawBody: true,
			},
			bodyLimit: 50 * 1024 * 1024, // 50 MB
			schema: {
				body: importBodyOpenApiSchema,
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							imported: {
								type: "object",
								properties: {
									medications: { type: "integer" },
									doseHistory: { type: "integer" },
									asNeededIntakes: { type: "integer" },
									refillHistory: { type: "integer" },
									settings: { type: "integer" },
									shareLinks: { type: "integer" },
								},
							},
						},
					},
					400: validationErrorSchema,
					401: genericErrorSchema,
					500: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			// 1. Parse and validate import data
			const parsed = importDataSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: "Invalid import data format",
					code: "INVALID_IMPORT_DATA",
					details: { _errors: formatImportSchemaIssues(parsed.error) },
				});
			}

			const importData = parsed.data;
			const validationIssues = collectImportValidationIssues(importData);
			if (validationIssues.length > 0) {
				return reply.status(400).send({
					error: "Invalid import data format",
					code: "INVALID_IMPORT_DATA",
					details: { _errors: validationIssues },
				});
			}
			// Existing image files are captured transaction-visibly and removed only after the import commits.
			let oldImageFilenames: string[] = [];
			const newImageFilenames: string[] = [];
			const imported = {
				medications: 0,
				doseHistory: 0,
				asNeededIntakes: 0,
				refillHistory: 0,
				settings: 0,
				shareLinks: 0,
			};

			try {
				await withImmediateWriteTransaction(async (tx) => {
					const existingMeds = await tx.select().from(medications).where(eq(medications.userId, userId));
					oldImageFilenames = existingMeds
						.map((med) => med.imageUrl)
						.filter((filename): filename is string => typeof filename === "string" && filename.length > 0);

					// Reserved anchors own companion events, so remove them before the remaining account graph.
					const existingAsNeededAnchors = await tx
						.select({ id: asNeededIntakeEvents.doseTrackingId })
						.from(asNeededIntakeEvents)
						.where(eq(asNeededIntakeEvents.userId, userId));
					for (let index = 0; index < existingAsNeededAnchors.length; index += 500) {
						await tx.delete(doseTracking).where(
							and(
								eq(doseTracking.userId, userId),
								inArray(
									doseTracking.id,
									existingAsNeededAnchors.slice(index, index + 500).map((anchor) => anchor.id)
								)
							)
						);
					}
					await tx.delete(asNeededIntakeEvents).where(eq(asNeededIntakeEvents.userId, userId));

					// Delete in order: remaining journals, refill history, scheduled doses, shares, medications, settings.
					await tx.delete(intakeJournal).where(eq(intakeJournal.userId, userId));
					await tx.delete(refillHistory).where(eq(refillHistory.userId, userId));
					await tx.delete(doseTracking).where(eq(doseTracking.userId, userId));
					await tx.delete(shareTokens).where(eq(shareTokens.userId, userId));
					await tx.delete(medications).where(eq(medications.userId, userId));
					await tx.delete(userSettings).where(eq(userSettings.userId, userId));

					const exportIdToNewId = new Map<string, number>();

					for (const med of importData.medications) {
						const normalizedSchedules = med.schedules.map((schedule) =>
							normalizeIntake({
								usage: schedule.usage,
								every: schedule.every,
								start: schedule.start,
								scheduleMode: schedule.scheduleMode,
								weekdays: schedule.weekdays,
								intakeUnit: schedule.intakeUnit ?? null,
								takenBy: schedule.takenBy || null,
								intakeRemindersEnabled: schedule.remind ?? false,
							})
						);
						const usageJson = JSON.stringify(normalizedSchedules.map((schedule) => schedule.usage));
						const everyJson = JSON.stringify(normalizedSchedules.map((schedule) => schedule.every));
						const startJson = JSON.stringify(normalizedSchedules.map((schedule) => schedule.start));
						const takenByJson = JSON.stringify(med.takenBy);
						const intakesJson = JSON.stringify(normalizedSchedules);
						const intakeRemindersEnabled =
							normalizedSchedules.some((schedule) => schedule.intakeRemindersEnabled) || med.intakeRemindersEnabled;

						const [inserted] = await tx
							.insert(medications)
							.values({
								userId,
								name: med.name,
								genericName: med.genericName || null,
								takenByJson,
								medicationForm: med.medicationForm ?? "tablet",
								pillForm: med.pillForm || null,
								lifecycleCategory: med.lifecycleCategory ?? "refill_when_empty",
								packageType: normalizePackageType(med.inventory.packageType),
								packageAmountValue: med.inventory.packageAmountValue ?? 0,
								packageAmountUnit: med.inventory.packageAmountUnit ?? "ml",
								packCount: med.inventory.packCount,
								blistersPerPack: med.inventory.blistersPerPack,
								pillsPerBlister: med.inventory.pillsPerBlister,
								looseTablets: med.inventory.looseTablets,
								totalPills: med.inventory.totalPills ?? null,
								stockAdjustment: med.inventory.stockAdjustment ?? 0,
								scheduleStockRebaseMilli: med.inventory.scheduleStockRebaseMilli ?? 0,
								lastStockCorrectionAt: med.lastStockCorrectionAt ? new Date(med.lastStockCorrectionAt) : null,
								pillWeightMg: med.pillWeightMg || null,
								doseUnit: med.doseUnit ?? "mg",
								medicationStartDate: med.medicationStartDate || "",
								medicationEndDate: med.medicationEndDate || null,
								autoMarkObsoleteAfterEndDate: med.autoMarkObsoleteAfterEndDate ?? true,
								intakesJson,
								usageJson,
								everyJson,
								startJson,
								expiryDate: med.expiryDate || null,
								notes: med.notes || null,
								intakeRemindersEnabled,
								isObsolete: med.isObsolete ?? false,
								obsoleteAt: med.obsoleteAt ? new Date(med.obsoleteAt) : null,
								prescriptionEnabled: med.prescriptionEnabled ?? false,
								prescriptionAuthorizedRefills: med.prescriptionEnabled
									? (med.prescriptionAuthorizedRefills ?? null)
									: null,
								prescriptionRemainingRefills: med.prescriptionEnabled
									? (med.prescriptionRemainingRefills ?? null)
									: null,
								prescriptionLowRefillThreshold: med.prescriptionLowRefillThreshold ?? 1,
								prescriptionExpiryDate: med.prescriptionExpiryDate || null,
								dismissedUntil: med.dismissedUntil || null,
								imageUrl: null,
							})
							.returning();

						exportIdToNewId.set(med._exportId, inserted.id);
						imported.medications += 1;

						if (med.image) {
							const imageUrl = await base64ToImage(med.image, inserted.id);
							if (imageUrl) {
								newImageFilenames.push(imageUrl);
								await tx.update(medications).set({ imageUrl }).where(eq(medications.id, inserted.id));
							}
						}
					}

					for (const dose of importData.doseHistory) {
						const newMedId = exportIdToNewId.get(dose.medicationRef);
						if (!newMedId) continue;

						const scheduledFor = new Date(dose.scheduledTime);
						const timestampMs = scheduledFor.getTime();
						const doseId = buildDoseId(newMedId, dose.scheduleIndex, timestampMs, dose.takenByPerson);

						const [insertedDose] = await tx
							.insert(doseTracking)
							.values({
								userId,
								doseId,
								takenAt: new Date(dose.takenAt),
								markedBy: dose.markedBy || null,
								takenSource: dose.takenSource ?? "manual",
								dismissed: dose.dismissed ?? false,
							})
							.returning({ id: doseTracking.id });
						imported.doseHistory += 1;

						await restoreIntakeJournalForImportedDose({
							userId,
							doseTrackingId: insertedDose.id,
							medicationId: newMedId,
							scheduledFor,
							journalNote: dose.journalNote,
							journalMood: normalizeIntakeMood(dose.journalMood),
							journalCreatedAt: dose.journalCreatedAt,
							journalUpdatedAt: dose.journalUpdatedAt,
							database: tx,
						});
					}

					const restoredEventIds = new Map<string, number>();
					const restoredAnchorIds = new Set<number>();
					for (const event of importData.asNeededIntakes) {
						const newMedId = exportIdToNewId.get(event.medicationRef);
						if (!newMedId) throw new Error("Validated as-needed medication mapping is missing");

						const occurredAt = new Date(event.occurredAt);
						const recordedAt = new Date(event.recordedAt);
						const reversedAt = event.reversedAt ? new Date(event.reversedAt) : null;
						const stockCutoffAt = event.stockCutoffAt ? new Date(event.stockCutoffAt) : null;
						const updatedAt = new Date(
							Math.max(recordedAt.getTime(), reversedAt?.getTime() ?? 0, stockCutoffAt?.getTime() ?? 0)
						);
						const [anchor] = await tx
							.insert(doseTracking)
							.values({
								userId,
								doseId: `as-needed:${event.eventId}`,
								takenAt: occurredAt,
								markedBy: event.person,
								takenSource: "manual",
								dismissed: false,
							})
							.returning({ id: doseTracking.id });
						const [restored] = await tx
							.insert(asNeededIntakeEvents)
							.values({
								eventId: event.eventId,
								userId,
								medicationId: newMedId,
								doseTrackingId: anchor.id,
								idempotencyKeyHash: event.idempotencyKeyHash,
								requestFingerprint: event.requestFingerprint,
								occurredAt,
								recordedAt,
								quantityMilli: event.quantityMilli,
								quantityUnit: event.quantityUnit,
								personName: event.person ?? "",
								source: event.source,
								status: event.status,
								stockEffectMilli: event.stockEffectMilli,
								stockEffectReason: event.stockEffectReason,
								stockCutoffAt: stockCutoffAt ? Math.floor(stockCutoffAt.getTime() / 1000) : 0,
								reversedAt,
								reversalIdempotencyKeyHash: event.reversalIdempotencyKeyHash,
								revision: event.revision,
								createdAt: recordedAt,
								updatedAt,
							})
							.returning({ id: asNeededIntakeEvents.id });
						restoredEventIds.set(event.eventId, restored.id);
						restoredAnchorIds.add(anchor.id);
						imported.asNeededIntakes += 1;

						if (hasImportedAsNeededJournal(event)) {
							if (!event.journalCreatedAt || !event.journalUpdatedAt) {
								throw new Error("Validated as-needed journal timestamps are missing");
							}
							await tx.insert(intakeJournal).values({
								userId,
								doseTrackingId: anchor.id,
								medicationId: newMedId,
								scheduledFor: occurredAt,
								note: event.journalNote ?? "",
								mood: event.journalMood ?? "",
								createdAt: new Date(event.journalCreatedAt),
								updatedAt: new Date(event.journalUpdatedAt),
							});
						}
					}

					for (const event of importData.asNeededIntakes) {
						if (!event.replacementForEventId) continue;
						const eventId = restoredEventIds.get(event.eventId);
						const targetId = restoredEventIds.get(event.replacementForEventId);
						if (!eventId || !targetId) throw new Error("Validated as-needed replacement mapping is missing");
						await tx
							.update(asNeededIntakeEvents)
							.set({ replacesEventId: targetId })
							.where(and(eq(asNeededIntakeEvents.id, eventId), eq(asNeededIntakeEvents.userId, userId)));
					}

					const restoredGraph = await tx
						.select({
							eventId: asNeededIntakeEvents.eventId,
							doseTrackingId: asNeededIntakeEvents.doseTrackingId,
						})
						.from(asNeededIntakeEvents)
						.innerJoin(
							doseTracking,
							and(
								eq(doseTracking.id, asNeededIntakeEvents.doseTrackingId),
								eq(doseTracking.userId, asNeededIntakeEvents.userId)
							)
						)
						.innerJoin(
							medications,
							and(
								eq(medications.id, asNeededIntakeEvents.medicationId),
								eq(medications.userId, asNeededIntakeEvents.userId)
							)
						)
						.where(eq(asNeededIntakeEvents.userId, userId));
					if (
						restoredGraph.length !== importData.asNeededIntakes.length ||
						restoredGraph.some(
							(event) => !restoredEventIds.has(event.eventId) || !restoredAnchorIds.has(event.doseTrackingId)
						)
					) {
						throw new Error("Restored as-needed intake graph contains orphan rows");
					}

					if (importData.settings) {
						await tx.insert(userSettings).values({
							userId,
							timezone: importData.settings.timezone ?? "",
							emailEnabled: importData.settings.emailEnabled ?? false,
							notificationEmail: importData.settings.notificationEmail || null,
							emailStockReminders: importData.settings.emailStockReminders ?? true,
							emailIntakeReminders: importData.settings.emailIntakeReminders ?? true,
							emailPrescriptionReminders: importData.settings.emailPrescriptionReminders ?? true,
							shoutrrrEnabled: importData.settings.shoutrrrEnabled ?? false,
							shoutrrrUrl: importData.settings.shoutrrrUrl || null,
							shoutrrrStockReminders: importData.settings.shoutrrrStockReminders ?? true,
							shoutrrrIntakeReminders: importData.settings.shoutrrrIntakeReminders ?? true,
							shoutrrrPrescriptionReminders: importData.settings.shoutrrrPrescriptionReminders ?? true,
							reminderDaysBefore: importData.settings.reminderDaysBefore ?? 7,
							repeatDailyReminders: importData.settings.repeatDailyReminders ?? false,
							skipRemindersForTakenDoses: importData.settings.skipRemindersForTakenDoses ?? false,
							repeatRemindersEnabled: importData.settings.repeatRemindersEnabled ?? false,
							reminderRepeatIntervalMinutes: importData.settings.reminderRepeatIntervalMinutes ?? 30,
							maxNaggingReminders: importData.settings.maxNaggingReminders ?? 5,
							lowStockDays: importData.settings.lowStockDays ?? 30,
							normalStockDays: importData.settings.normalStockDays ?? 90,
							highStockDays: importData.settings.highStockDays ?? 180,
							expiryWarningDays: importData.settings.expiryWarningDays ?? 90,
							language: importData.settings.language ?? "en",
							stockCalculationMode: importData.settings.stockCalculationMode ?? "automatic",
							shareMedicationOverview: importData.settings.shareMedicationOverview ?? false,
							upcomingTodayOnly: importData.settings.upcomingTodayOnly ?? false,
							shareScheduleTodayOnly: importData.settings.shareScheduleTodayOnly ?? false,
							swapDashboardMainSections: importData.settings.swapDashboardMainSections ?? false,
						});
						imported.settings = 1;
					}

					for (const share of importData.shareLinks) {
						await tx.insert(shareTokens).values({
							userId,
							token: generateShareToken(),
							takenBy: share.takenBy,
							scheduleDays: share.scheduleDays,
							allowJournalNotes: share.allowJournalNotes ?? false,
							allowMarkTaken: share.allowMarkTaken ?? true,
							expiresAt: share.expiresAt ? new Date(share.expiresAt) : null,
						});
						imported.shareLinks += 1;
					}

					for (const refill of importData.refillHistory) {
						const newMedId = exportIdToNewId.get(refill.medicationRef);
						if (!newMedId) continue;

						await tx.insert(refillHistory).values({
							medicationId: newMedId,
							userId,
							packsAdded: refill.packsAdded ?? 0,
							loosePillsAdded: refill.loosePillsAdded ?? refill.quantityAdded ?? 0,
							usedPrescription: refill.usedPrescription ?? false,
							refillDate: new Date(refill.refillDate),
						});
						imported.refillHistory += 1;
					}
				});
			} catch (error) {
				for (const imageFilename of newImageFilenames) {
					const removalError = removeImageSetIfPresent(imageFilename);
					if (removalError) {
						request.log.warn(`[Import] Failed to remove rolled-back image filename=${imageFilename}: ${removalError}`);
					}
				}

				if (error instanceof ImportValidationError) {
					return reply.status(400).send({
						error: "Invalid import data format",
						details: { _errors: [error.message] },
					});
				}

				request.log.error({ err: error }, "[Import] Failed to import data");
				return reply.status(500).send({ error: "Import failed" });
			}

			for (const imageFilename of oldImageFilenames) {
				const removalError = removeImageSetIfPresent(imageFilename);
				if (removalError) {
					request.log.warn(`[Import] Failed to remove replaced image filename=${imageFilename}: ${removalError}`);
				}
			}

			return {
				success: true,
				imported,
			};
		}
	);
}
