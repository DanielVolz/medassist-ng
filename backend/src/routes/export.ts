import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { getDataDir } from "../db/db-utils.js";
import { doseTracking, medications, shareTokens, userSettings } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";
import { parseIntakesJson, parseTakenByJson } from "../utils/scheduler-utils.js";

const IMAGES_DIR = resolve(getDataDir(), "images");

// =============================================================================
// Export Format Version (bump this when format changes)
// =============================================================================
const EXPORT_VERSION = "1.0";

// =============================================================================
// Zod Schemas for Import Validation
// =============================================================================

const scheduleSchema = z.object({
	usage: z.number().nonnegative(),
	every: z.number().int().min(1),
	start: z.string(), // ISO datetime string
	remind: z.boolean().optional().default(false),
	takenBy: z.string().nullable().optional(), // Per-intake takenBy (new field)
});

const inventorySchema = z.object({
	packCount: z.number().int().min(0).default(1),
	blistersPerPack: z.number().int().min(1).default(1),
	pillsPerBlister: z.number().int().min(1).default(1),
	looseTablets: z.number().int().min(0).default(0),
	stockAdjustment: z.number().int().default(0), // Manual stock correction
	packageType: z.enum(["blister", "bottle"]).default("blister"),
});

const medicationExportSchema = z.object({
	_exportId: z.string(),
	name: z.string().min(1),
	genericName: z.string().nullable().optional(),
	takenBy: z.array(z.string()).default([]),
	inventory: inventorySchema,
	pillWeightMg: z.number().int().nullable().optional(),
	doseUnit: z.enum(["mg", "g", "mcg", "ml", "IU", "units", "drops", "puffs"]).default("mg"),
	schedules: z.array(scheduleSchema).default([]),
	expiryDate: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	intakeRemindersEnabled: z.boolean().default(false),
	image: z.string().nullable().optional(), // base64 data URL or null
	lastStockCorrectionAt: z.string().nullable().optional(), // ISO datetime of last stock correction
});

const doseHistorySchema = z.object({
	medicationRef: z.string(), // References _exportId
	scheduleIndex: z.number().int().min(0),
	scheduledTime: z.string(), // ISO datetime
	takenAt: z.string(), // ISO datetime
	markedBy: z.string().nullable().optional(),
	dismissed: z.boolean().default(false),
	takenByPerson: z.string().nullable().optional(), // Person suffix from dose ID (e.g., "Daniel")
});

const shareLinkSchema = z.object({
	takenBy: z.string().min(1),
	scheduleDays: z.number().int().min(1).default(30),
	expiresAt: z.string().nullable().optional(), // ISO datetime
	regenerateToken: z.boolean().default(true),
});

const settingsExportSchema = z
	.object({
		// Email notifications
		emailEnabled: z.boolean().default(false),
		notificationEmail: z.string().nullable().optional(),
		emailStockReminders: z.boolean().default(true),
		emailIntakeReminders: z.boolean().default(true),
		// Push notifications
		shoutrrrEnabled: z.boolean().optional(),
		shoutrrrUrl: z.string().nullable().optional(),
		shoutrrrStockReminders: z.boolean().default(true),
		shoutrrrIntakeReminders: z.boolean().default(true),
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
		// UI preferences
		language: z.string().default("en"),
		stockCalculationMode: z.enum(["automatic", "manual"]).default("automatic"),
	})
	.optional();

const importDataSchema = z.object({
	version: z.string(),
	exportedAt: z.string(),
	includeSensitiveData: z.boolean().default(false),
	medications: z.array(medicationExportSchema).default([]),
	doseHistory: z.array(doseHistorySchema).default([]),
	settings: settingsExportSchema,
	shareLinks: z.array(shareLinkSchema).default([]),
});

// =============================================================================
// Helper Functions
// =============================================================================

// Helper to get user ID from request
async function getUserId(request: any, reply: any): Promise<number> {
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
function parseIntakesForExport(
	row: typeof medications.$inferSelect
): Array<{ usage: number; every: number; start: string; remind: boolean; takenBy: string | null }> {
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
	if (!base64 || !base64.startsWith("data:")) return null;

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

	// ---------------------------------------------------------------------------
	// GET /export - Export all user data
	// ---------------------------------------------------------------------------
	app.get<{ Querystring: { includeSensitive?: string; includeImages?: string } }>("/export", async (request, reply) => {
		const userId = await getUserId(request, reply);
		const includeSensitive = request.query.includeSensitive === "true";
		const includeImages = request.query.includeImages !== "false"; // Default to true

		// 1. Load all medications
		const meds = await db.select().from(medications).where(eq(medications.userId, userId)).orderBy(medications.id);

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
				inventory: {
					packCount: med.packCount ?? 1,
					blistersPerPack: med.blistersPerPack ?? 1,
					pillsPerBlister: med.pillsPerBlister ?? 1,
					looseTablets: med.looseTablets ?? 0,
					stockAdjustment: med.stockAdjustment ?? 0,
					packageType: med.packageType ?? "blister",
				},
				pillWeightMg: med.pillWeightMg,
				doseUnit: med.doseUnit ?? "mg",
				schedules: parseIntakesForExport(med),
				expiryDate: med.expiryDate,
				notes: med.notes,
				intakeRemindersEnabled: med.intakeRemindersEnabled ?? false,
				image: includeImages ? imageToBase64(med.imageUrl) : null,
				lastStockCorrectionAt: lastStockCorrectionAtIso,
			};
		});

		// 2. Load all dose tracking entries
		const doses = await db.select().from(doseTracking).where(eq(doseTracking.userId, userId));

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
					dismissed: dose.dismissed ?? false,
					takenByPerson: parsed.person,
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
					// Only include sensitive data if requested
					shoutrrrEnabled: includeSensitive ? settings.shoutrrrEnabled : undefined,
					shoutrrrUrl: includeSensitive ? settings.shoutrrrUrl : undefined,
					shoutrrrStockReminders: settings.shoutrrrStockReminders,
					shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
					reminderDaysBefore: settings.reminderDaysBefore,
					repeatDailyReminders: settings.repeatDailyReminders,
					skipRemindersForTakenDoses: settings.skipRemindersForTakenDoses,
					repeatRemindersEnabled: settings.repeatRemindersEnabled,
					reminderRepeatIntervalMinutes: settings.reminderRepeatIntervalMinutes,
					maxNaggingReminders: settings.maxNaggingReminders,
					lowStockDays: settings.lowStockDays,
					normalStockDays: settings.normalStockDays,
					highStockDays: settings.highStockDays,
					language: settings.language,
					stockCalculationMode: settings.stockCalculationMode,
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
				expiresAt: expiresAtIso,
				regenerateToken: true, // Always regenerate tokens on import for security
			};
		});

		// Build export object
		const exportData = {
			version: EXPORT_VERSION,
			exportedAt: new Date().toISOString(),
			includeSensitiveData: includeSensitive,
			medications: exportMedications,
			doseHistory: exportDoseHistory,
			settings: exportSettings,
			shareLinks: exportShareLinks,
		};

		// Set download headers
		const filename = `medassist-export-${new Date().toISOString().split("T")[0]}.json`;
		reply.header("Content-Type", "application/json");
		reply.header("Content-Disposition", `attachment; filename="${filename}"`);

		return exportData;
	});

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

			// 2. Delete all existing user data (in correct order to respect foreign keys)
			// Note: CASCADE delete should handle this, but let's be explicit

			// First, delete images for existing medications
			const existingMeds = await db.select().from(medications).where(eq(medications.userId, userId));
			for (const med of existingMeds) {
				if (med.imageUrl) {
					const imagePath = resolve(IMAGES_DIR, med.imageUrl);
					if (existsSync(imagePath)) {
						try {
							unlinkSync(imagePath);
						} catch {
							/* ignore */
						}
					}
				}
			}

			// Delete in order: doses, share tokens, medications, settings
			await db.delete(doseTracking).where(eq(doseTracking.userId, userId));
			await db.delete(shareTokens).where(eq(shareTokens.userId, userId));
			await db.delete(medications).where(eq(medications.userId, userId));
			await db.delete(userSettings).where(eq(userSettings.userId, userId));

			// 3. Import medications and build ID mapping
			const exportIdToNewId = new Map<string, number>();

			for (const med of importData.medications) {
				// Convert schedules to both legacy and new formats
				const usageJson = JSON.stringify(med.schedules.map((s) => s.usage));
				const everyJson = JSON.stringify(med.schedules.map((s) => s.every));
				const startJson = JSON.stringify(med.schedules.map((s) => s.start));
				const takenByJson = JSON.stringify(med.takenBy);

				// Build intakesJson array (new unified format with per-intake takenBy)
				const intakesJson = JSON.stringify(
					med.schedules.map((s) => ({
						usage: s.usage,
						every: s.every,
						start: s.start,
						takenBy: s.takenBy || null,
						intakeRemindersEnabled: s.remind ?? false,
					}))
				);

				// Check if any schedule has remind enabled
				const intakeRemindersEnabled = med.schedules.some((s) => s.remind) || med.intakeRemindersEnabled;

				const [inserted] = await db
					.insert(medications)
					.values({
						userId,
						name: med.name,
						genericName: med.genericName || null,
						takenByJson,
						packageType: med.inventory.packageType ?? "blister",
						packCount: med.inventory.packCount,
						blistersPerPack: med.inventory.blistersPerPack,
						pillsPerBlister: med.inventory.pillsPerBlister,
						looseTablets: med.inventory.looseTablets,
						stockAdjustment: med.inventory.stockAdjustment ?? 0,
						lastStockCorrectionAt: med.lastStockCorrectionAt ? new Date(med.lastStockCorrectionAt) : null,
						pillWeightMg: med.pillWeightMg || null,
						doseUnit: med.doseUnit ?? "mg",
						intakesJson,
						usageJson,
						everyJson,
						startJson,
						expiryDate: med.expiryDate || null,
						notes: med.notes || null,
						intakeRemindersEnabled,
						imageUrl: null, // Will be set after image is saved
					})
					.returning();

				// Save mapping
				exportIdToNewId.set(med._exportId, inserted.id);

				// Save image if present
				if (med.image) {
					const imageUrl = base64ToImage(med.image, inserted.id);
					if (imageUrl) {
						await db.update(medications).set({ imageUrl }).where(eq(medications.id, inserted.id));
					}
				}
			}

			// 4. Import dose history with remapped medication IDs
			for (const dose of importData.doseHistory) {
				const newMedId = exportIdToNewId.get(dose.medicationRef);
				if (!newMedId) continue; // Skip orphaned doses

				// Convert ISO timestamp back to milliseconds for dose ID
				const timestampMs = new Date(dose.scheduledTime).getTime();
				// Rebuild dose ID with optional person suffix
				const doseId = buildDoseId(newMedId, dose.scheduleIndex, timestampMs, dose.takenByPerson);

				await db.insert(doseTracking).values({
					userId,
					doseId,
					takenAt: new Date(dose.takenAt),
					markedBy: dose.markedBy || null,
					dismissed: dose.dismissed ?? false,
				});
			}

			// 5. Import settings
			if (importData.settings) {
				await db.insert(userSettings).values({
					userId,
					emailEnabled: importData.settings.emailEnabled ?? false,
					notificationEmail: importData.settings.notificationEmail || null,
					emailStockReminders: importData.settings.emailStockReminders ?? true,
					emailIntakeReminders: importData.settings.emailIntakeReminders ?? true,
					shoutrrrEnabled: importData.settings.shoutrrrEnabled ?? false,
					shoutrrrUrl: importData.settings.shoutrrrUrl || null,
					shoutrrrStockReminders: importData.settings.shoutrrrStockReminders ?? true,
					shoutrrrIntakeReminders: importData.settings.shoutrrrIntakeReminders ?? true,
					reminderDaysBefore: importData.settings.reminderDaysBefore ?? 7,
					repeatDailyReminders: importData.settings.repeatDailyReminders ?? false,
					skipRemindersForTakenDoses: importData.settings.skipRemindersForTakenDoses ?? false,
					repeatRemindersEnabled: importData.settings.repeatRemindersEnabled ?? false,
					reminderRepeatIntervalMinutes: importData.settings.reminderRepeatIntervalMinutes ?? 30,
					maxNaggingReminders: importData.settings.maxNaggingReminders ?? 5,
					lowStockDays: importData.settings.lowStockDays ?? 30,
					normalStockDays: importData.settings.normalStockDays ?? 90,
					highStockDays: importData.settings.highStockDays ?? 180,
					language: importData.settings.language ?? "en",
					stockCalculationMode: importData.settings.stockCalculationMode ?? "automatic",
				});
			}

			// 6. Import share links (with new tokens)
			for (const share of importData.shareLinks) {
				// Always generate new token for security
				const token = randomBytes(8).toString("hex");

				await db.insert(shareTokens).values({
					userId,
					token,
					takenBy: share.takenBy,
					scheduleDays: share.scheduleDays,
					expiresAt: share.expiresAt ? new Date(share.expiresAt) : null,
				});
			}

			return {
				success: true,
				imported: {
					medications: importData.medications.length,
					doseHistory: importData.doseHistory.length,
					settings: importData.settings ? 1 : 0,
					shareLinks: importData.shareLinks.length,
				},
			};
		}
	);
}
