import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { getDataDir } from "../db/path-utils.js";
import { doseTracking, intakeJournal, medications, refillHistory, shareTokens, userSettings } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import {
	listIntakeJournalExportPayloadsForUser,
	restoreIntakeJournalForImportedDose,
} from "../services/intake-journal-export.js";
import type { AuthUser } from "../types/fastify.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import { normalizePackageType, PACKAGE_TYPES } from "../utils/package-profiles.js";
import { normalizeIntake, parseIntakesJson, parseTakenByJson } from "../utils/scheduler-utils.js";

const IMAGES_DIR = resolve(getDataDir(), "images");

// =============================================================================
// Export Format Version (bump this when format changes)
// =============================================================================
const EXPORT_VERSION = "1.6";

// =============================================================================
// Zod Schemas for Import Validation
// =============================================================================

const scheduleSchema = z.object({
	usage: z.number().nonnegative(),
	every: z.number().int().min(1),
	start: z.string(), // ISO datetime string
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
	obsoleteAt: z.string().nullable().optional(),
	prescriptionEnabled: z.boolean().default(false),
	prescriptionAuthorizedRefills: z.number().int().min(0).nullable().optional(),
	prescriptionRemainingRefills: z.number().int().min(0).nullable().optional(),
	prescriptionLowRefillThreshold: z.number().int().min(0).default(1),
	prescriptionExpiryDate: z.string().nullable().optional(),
	dismissedUntil: z.string().nullable().optional(), // ISO date string for dismissed past doses
	image: z.string().nullable().optional(), // base64 data URL or null
	lastStockCorrectionAt: z.string().nullable().optional(), // ISO datetime of last stock correction
});

const doseHistorySchema = z.object({
	medicationRef: z.string(), // References _exportId
	scheduleIndex: z.number().int().min(0),
	scheduledTime: z.string(), // ISO datetime
	takenAt: z.string(), // ISO datetime
	markedBy: z.string().nullable().optional(),
	takenSource: z.enum(["manual", "automatic"]).default("manual"),
	dismissed: z.boolean().default(false),
	takenByPerson: z.string().nullable().optional(), // Person suffix from dose ID (e.g., "Daniel")
	journalNote: z.string().nullable().optional(),
	journalCreatedAt: z.string().nullable().optional(),
	journalUpdatedAt: z.string().nullable().optional(),
});

const refillHistoryExportSchema = z.object({
	medicationRef: z.string(), // References _exportId
	packsAdded: z.number().int().min(0).default(0),
	loosePillsAdded: z.number().int().min(0).optional(),
	quantityAdded: z.number().int().min(0).optional(),
	usedPrescription: z.boolean().default(false),
	refillDate: z.string(), // ISO datetime
});

const shareLinkSchema = z.object({
	takenBy: z.string().min(1),
	scheduleDays: z.number().int().min(1).default(30),
	allowJournalNotes: z.boolean().default(false),
	expiresAt: z.string().nullable().optional(), // ISO datetime
	regenerateToken: z.boolean().default(true),
});

const settingsSchemaBase = z.object({
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
	language: z.string().default("en"),
	stockCalculationMode: z.enum(["automatic", "manual"]).default("automatic"),
	shareMedicationOverview: z.boolean().default(false),
});

const importSettingsSchema = settingsSchemaBase
	.extend({
		// Accept the removed field from legacy exports so old backups still import,
		// but do not map it back into current runtime settings.
		shareStockStatus: z.boolean().optional(),
	})
	.optional();

const importDataSchema = z.object({
	version: z.string(),
	exportedAt: z.string(),
	includeSensitiveData: z.boolean().default(false),
	medications: z.array(medicationExportSchema).default([]),
	doseHistory: z.array(doseHistorySchema).default([]),
	refillHistory: z.array(refillHistoryExportSchema).default([]),
	settings: importSettingsSchema,
	shareLinks: z.array(shareLinkSchema).default([]),
});

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
		refillHistory: { type: "array", items: { type: "object", additionalProperties: true } },
		settings: { type: "object", additionalProperties: true },
		shareLinks: { type: "array", items: { type: "object", additionalProperties: true } },
	},
	example: {
		version: "1.6",
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
				journalUpdatedAt: "2026-03-11T08:05:00.000Z",
			},
		],
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
	// Use the new parseIntakesJson which falls back to legacy format
	const intakes = parseIntakesJson(
		row.intakesJson,
		{ usageJson: row.usageJson, everyJson: row.everyJson, startJson: row.startJson },
		row.intakeRemindersEnabled ?? false
	);

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
function imageToBase64(imageUrl: string | null): string | null {
	if (!imageUrl) return null;
	const imagePath = resolve(IMAGES_DIR, imageUrl);
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

// Save base64 image to file and return filename
function base64ToImage(base64: string, medicationId: number): string | null {
	if (!base64.startsWith("data:")) return null;

	try {
		// Parse data URL: "data:image/jpeg;base64,/9j/4AAQ..."
		const matches = base64.match(/^data:image\/(\w+);base64,(.+)$/);
		if (!matches) return null;

		const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
		const data = matches[2];
		const buffer = Buffer.from(data, "base64");

		const filename = `med-${medicationId}-${Date.now()}.${ext}`;
		const filepath = resolve(IMAGES_DIR, filename);

		// Ensure images directory exists
		if (!existsSync(IMAGES_DIR)) {
			mkdirSync(IMAGES_DIR, { recursive: true });
		}

		writeFileSync(filepath, buffer);
		return filename;
	} catch {
		return null;
	}
}

function removeFileIfPresent(filePath: string): string | null {
	if (!existsSync(filePath)) {
		return null;
	}

	try {
		unlinkSync(filePath);
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
		refillHistory: number;
		shareLinks: number;
		hasSettings: boolean;
	}
) {
	const journalEntries = importData.doseHistory.filter(
		(dose) => typeof dose.journalNote === "string" && dose.journalNote.trim()
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
			refillHistory: importData.refillHistory.length,
			shareLinks: importData.shareLinks.length,
			journalEntries,
			imageCount,
			hasSettings: Boolean(importData.settings),
		},
		current: currentData,
		warnings: {
			replacesExistingData:
				currentData.medications > 0 ||
				currentData.doseHistory > 0 ||
				currentData.refillHistory > 0 ||
				currentData.shareLinks > 0 ||
				currentData.hasSettings,
			regeneratesShareLinks: importData.shareLinks.length > 0,
			containsImages: imageCount > 0,
			containsSensitiveData: importData.includeSensitiveData,
		},
	};
}

// Parse dose ID to extract medication ID and timestamp
// Format: "{medicationId}-{blisterIndex}-{timestampMs}" or "{medicationId}-{blisterIndex}-{timestampMs}-{person}"
function parseDoseId(
	doseId: string
): { medicationId: number; blisterIndex: number; timestampMs: number; person: string | null } | null {
	const parts = doseId.split("-");
	if (parts.length < 3) return null;

	const medicationId = parseInt(parts[0], 10);
	const blisterIndex = parseInt(parts[1], 10);
	const timestampMs = parseInt(parts[2], 10);

	if (Number.isNaN(medicationId) || Number.isNaN(blisterIndex) || Number.isNaN(timestampMs)) return null;

	// Check if there's a person suffix (4th part onwards, could be multi-part name)
	const person = parts.length > 3 ? parts.slice(3).join("-") : null;

	return { medicationId, blisterIndex, timestampMs, person };
}

// Build dose ID from parts (with optional person suffix)
function buildDoseId(medicationId: number, blisterIndex: number, timestampMs: number, person?: string | null): string {
	const base = `${medicationId}-${blisterIndex}-${timestampMs}`;
	return person ? `${base}-${person}` : base;
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
			const doses = await db.select().from(doseTracking).where(eq(doseTracking.userId, userId));
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
						scheduleIndex: parsed.blisterIndex,
						scheduledTime: scheduledTimeIso,
						takenAt: takenAtIso,
						markedBy: dose.markedBy,
						takenSource: dose.takenSource === "automatic" ? "automatic" : "manual",
						dismissed: dose.dismissed ?? false,
						takenByPerson: parsed.person,
						...journalPayloadsByDoseTrackingId.get(dose.id),
					};
				})
				.filter((d): d is NonNullable<typeof d> => d !== null);

			// 3. Load user settings
			const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));

			const exportSettings = settings
				? {
						emailEnabled: settings.emailEnabled,
						notificationEmail: settings.notificationEmail,
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
					}
				: undefined;

			// 4. Load share links
			const shares = await db.select().from(shareTokens).where(eq(shareTokens.userId, userId));

			const exportShareLinks = shares.map((share) => {
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
					expiresAt: expiresAtIso,
					regenerateToken: true, // Always regenerate tokens on import for security
				};
			});

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
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
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
					details: parsed.error.format(),
				});
			}

			const [existingMeds, existingDoseHistory, existingRefillHistory, existingShareLinks, existingSettings] =
				await Promise.all([
					db.select({ id: medications.id }).from(medications).where(eq(medications.userId, userId)),
					db.select({ id: doseTracking.id }).from(doseTracking).where(eq(doseTracking.userId, userId)),
					db.select({ id: refillHistory.id }).from(refillHistory).where(eq(refillHistory.userId, userId)),
					db.select({ id: shareTokens.id }).from(shareTokens).where(eq(shareTokens.userId, userId)),
					db.select({ id: userSettings.id }).from(userSettings).where(eq(userSettings.userId, userId)),
				]);

			return {
				success: true,
				preview: buildImportPreview(parsed.data, {
					medications: existingMeds.length,
					doseHistory: existingDoseHistory.length,
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
									refillHistory: { type: "integer" },
									settings: { type: "integer" },
									shareLinks: { type: "integer" },
								},
							},
						},
					},
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
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
					details: parsed.error.format(),
				});
			}

			const importData = parsed.data;

			// Existing image files are removed only after the DB import commits.
			const existingMeds = await db.select().from(medications).where(eq(medications.userId, userId));
			const oldImagePaths = existingMeds
				.map((med) => (med.imageUrl ? resolve(IMAGES_DIR, med.imageUrl) : null))
				.filter((path): path is string => path !== null);
			const newImagePaths: string[] = [];

			try {
				await db.transaction(async (tx) => {
					// Delete in order: journal entries, refill history, doses, share tokens, medications, settings.
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

						if (med.image) {
							const imageUrl = base64ToImage(med.image, inserted.id);
							if (imageUrl) {
								newImagePaths.push(resolve(IMAGES_DIR, imageUrl));
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

						await restoreIntakeJournalForImportedDose({
							userId,
							doseTrackingId: insertedDose.id,
							medicationId: newMedId,
							scheduledFor,
							journalNote: dose.journalNote,
							journalCreatedAt: dose.journalCreatedAt,
							journalUpdatedAt: dose.journalUpdatedAt,
							database: tx,
						});
					}

					if (importData.settings) {
						await tx.insert(userSettings).values({
							userId,
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
						});
					}

					for (const share of importData.shareLinks) {
						await tx.insert(shareTokens).values({
							userId,
							token: randomBytes(8).toString("hex"),
							takenBy: share.takenBy,
							scheduleDays: share.scheduleDays,
							allowJournalNotes: share.allowJournalNotes ?? false,
							expiresAt: share.expiresAt ? new Date(share.expiresAt) : null,
						});
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
					}
				});
			} catch (error) {
				for (const imagePath of newImagePaths) {
					const removalError = removeFileIfPresent(imagePath);
					if (removalError) {
						request.log.warn(`[Import] Failed to remove rolled-back image path=${imagePath}: ${removalError}`);
					}
				}

				request.log.error({ err: error }, "[Import] Failed to import data");
				return reply.status(500).send({ error: "Import failed" });
			}

			for (const imagePath of oldImagePaths) {
				const removalError = removeFileIfPresent(imagePath);
				if (removalError) {
					request.log.warn(`[Import] Failed to remove replaced image path=${imagePath}: ${removalError}`);
				}
			}

			return {
				success: true,
				imported: {
					medications: importData.medications.length,
					doseHistory: importData.doseHistory.length,
					refillHistory: importData.refillHistory.length,
					settings: importData.settings ? 1 : 0,
					shareLinks: importData.shareLinks.length,
				},
			};
		}
	);
}
