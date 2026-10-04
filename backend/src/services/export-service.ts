import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { normalizeAppLanguage } from "@medassist/shared";
import { eq } from "drizzle-orm";
import { getDataDir } from "../db/path-utils.js";
import {
	asNeededIntakeEvents,
	doseTracking,
	medications,
	refillHistory,
	shareTokens,
	userSettings,
} from "../db/schema.js";
import { asNeededIntakeExportSchema, EXPORT_VERSION } from "../routes/export-import-schemas.js";
import { parseDoseId } from "../utils/dose-id.js";
import { normalizePackageType } from "../utils/package-profiles.js";
import { normalizeMedicationIntakes, parseTakenByJson } from "../utils/scheduler-utils.js";

/** Assemble settings independently of HTTP; sensitive fields require explicit opt-in. */
export function buildExportSettings(settings: typeof userSettings.$inferSelect | undefined, includeSensitive = false) {
	return settings
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
				language: normalizeAppLanguage(settings.language),
				stockCalculationMode: settings.stockCalculationMode,
				shareMedicationOverview: settings.shareMedicationOverview ?? false,
				upcomingTodayOnly: settings.upcomingTodayOnly ?? false,
				shareScheduleTodayOnly: settings.shareScheduleTodayOnly ?? false,
				swapDashboardMainSections: settings.swapDashboardMainSections ?? false,
			}
		: undefined;
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

export function resolveStoredImagePath(imageUrl: string, imagesDir: string): string | null {
	if (
		!imageFilenamePattern.test(imageUrl) ||
		imageUrl.includes("/") ||
		imageUrl.includes("\\") ||
		imageUrl.includes("..")
	) {
		return null;
	}

	const imagePath = resolve(imagesDir, imageUrl);
	const relativePath = relative(imagesDir, imagePath);
	if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
		return null;
	}

	return imagePath;
}

function imageToBase64(imageUrl: string | null, imagesDir: string): string | null {
	if (!imageUrl) return null;
	const imagePath = resolveStoredImagePath(imageUrl, imagesDir);
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

/** Assemble the complete user backup independently of HTTP. */
export async function exportUserData(
	userId: number,
	{ includeSensitive = false, includeImages = true }: { includeSensitive?: boolean; includeImages?: boolean } = {},
	imagesDir = resolve(getDataDir(), "images")
) {
	const { db } = await import("../db/client.js");
	const { filterScheduledDoseRows } = await import("./as-needed-intakes-service.js");
	const { listAsNeededIntakeJournalExportPayloadsForUser, listIntakeJournalExportPayloadsForUser } = await import(
		"./intake-journal-export.js"
	);
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
			image: includeImages ? imageToBase64(med.imageUrl, imagesDir) : null,
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

	const exportSettings = buildExportSettings(settings, includeSensitive);

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
	return exportData;
}
