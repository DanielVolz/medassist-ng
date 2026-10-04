import { existsSync, mkdirSync } from "node:fs";
import {
	getAsNeededQuantityProfile,
	normalizeAppLanguage,
	normalizeAsNeededQuantityMilli,
	normalizeIntakeMood,
} from "@medassist/shared";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import {
	asNeededIntakeEvents,
	doseTracking,
	intakeJournal,
	medications,
	refillHistory,
	shareTokens,
	userSettings,
} from "../db/schema.js";
import { type ImportData, importDataSchema } from "../routes/export-import-schemas.js";
import { buildDoseId } from "../utils/dose-id.js";
import {
	ALLOWED_IMAGE_MIME_TYPES,
	MAX_IMAGE_UPLOAD_BYTES,
	removeImageFiles,
	writeOptimizedImageSet,
} from "../utils/image-upload.js";
import { normalizePackageType } from "../utils/package-profiles.js";
import { normalizeIntake } from "../utils/scheduler-utils.js";
import { resolveStoredImagePath } from "./export-service.js";

const MAX_IMPORT_VALIDATION_ISSUES = 10;

/** Parse the backup contract without HTTP concerns or persistence side effects. */
export function parseImportData(
	input: unknown
): { success: true; data: ImportData } | { success: false; issues: string[] } {
	const parsed = importDataSchema.safeParse(input);
	if (!parsed.success) {
		return {
			success: false,
			issues: parsed.error.issues
				.slice(0, MAX_IMPORT_VALIDATION_ISSUES)
				.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "root"}: ${issue.message}`),
		};
	}
	return { success: true, data: parsed.data };
}

export class ImportValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ImportValidationError";
	}
}

const MAX_IMPORT_IMAGE_PIXELS = 40_000_000;
function parseImportedImage(base64: string): Buffer {
	// Bound the encoded content before allocating the decoded buffer.
	if (base64.length > Math.ceil(MAX_IMAGE_UPLOAD_BYTES / 3) * 4 + 64) {
		throw new ImportValidationError("Image exceeds 10 MiB limit");
	}
	const matches = base64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/);
	if (!matches || !ALLOWED_IMAGE_MIME_TYPES.includes(matches[1].toLowerCase())) {
		throw new ImportValidationError("Invalid image data or type");
	}
	const buffer = Buffer.from(matches[2], "base64");
	if (buffer.length === 0 || buffer.length > MAX_IMAGE_UPLOAD_BYTES || buffer.toString("base64") !== matches[2]) {
		throw new ImportValidationError("Invalid image size or encoding");
	}
	return buffer;
}

function buildImportPreview(
	importData: ImportData,
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

/** Read and summarize a validated backup without changing the account or its image files. */
export async function previewImportData(userId: number, importData: ImportData) {
	const { db } = await import("../db/client.js");
	const { filterScheduledDoseRows } = await import("./as-needed-intakes-service.js");
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

	return buildImportPreview(importData, {
		medications: existingMeds.length,
		doseHistory: scheduledDoseHistory.length,
		asNeededIntakes: existingAsNeededIntakes.length,
		refillHistory: existingRefillHistory.length,
		shareLinks: existingShareLinks.length,
		hasSettings: existingSettings.length > 0,
	});
}

type ImportedAsNeededIntake = ImportData["asNeededIntakes"][number];

function hasImportedAsNeededJournal(event: ImportedAsNeededIntake): boolean {
	return event.journalNote !== null;
}

export async function collectImportValidationIssues(importData: ImportData): Promise<string[]> {
	const issues: string[] = [];
	const addIssue = (message: string) => {
		if (issues.length < MAX_IMPORT_VALIDATION_ISSUES) issues.push(message);
	};
	const medicationsByRef = new Map<string, ImportData["medications"][number]>();

	for (const med of importData.medications) {
		if (medicationsByRef.has(med._exportId)) {
			addIssue(`Duplicate medication reference: ${med._exportId}`);
			continue;
		}
		medicationsByRef.set(med._exportId, med);
		if (med.image !== null && med.image !== undefined) {
			try {
				const decoder = sharp(parseImportedImage(med.image), {
					failOn: "error",
					limitInputPixels: MAX_IMPORT_IMAGE_PIXELS,
				});
				const metadata = await decoder.metadata();
				if (!["jpeg", "png", "webp", "gif"].includes(metadata.format ?? "")) {
					throw new ImportValidationError("Unsupported decoded image format");
				}
				await decoder.resize(1, 1).toBuffer();
			} catch {
				addIssue(`Invalid image for ${med._exportId}: require a decodable image up to 10 MiB and 40 million pixels`);
			}
		}
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

interface ImportImageFiles {
	write(base64: string, medicationId: number): Promise<string | null>;
	remove(filename: string): string | null;
}

/** Bind production image I/O to the account backup's configured image directory. */
export function createImportImageFiles(imagesDir: string): ImportImageFiles {
	// Save a validated image to a uniquely owned file set.
	async function base64ToImage(base64: string, medicationId: number): Promise<string | null> {
		try {
			const buffer = parseImportedImage(base64);

			if (!existsSync(imagesDir)) {
				mkdirSync(imagesDir, { recursive: true });
			}

			const { filename } = await writeOptimizedImageSet(imagesDir, `med-${medicationId}`, buffer, { exclusive: true });
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
			if (!resolveStoredImagePath(imageFilename, imagesDir)) {
				return "Unsafe image filename";
			}
			removeImageFiles(imagesDir, imageFilename);
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : "Unknown file removal error";
		}
	}

	return { write: base64ToImage, remove: removeImageSetIfPresent };
}

/** Replace a validated account graph. Schema, semantic and media validation must precede this call. */
export async function importValidatedData(
	userId: number,
	importData: ImportData,
	imageFiles: ImportImageFiles,
	logger: { warn(message: string): void }
) {
	const { withImmediateWriteTransaction } = await import("../db/client.js");
	const { restoreIntakeJournalForImportedDose } = await import("./intake-journal-export.js");
	const { generateShareToken } = await import("./share-token-service.js");
	// Existing image files are captured transaction-visibly and removed only after the import commits.
	let oldImageFilenames: string[] = [];
	const newImageFilenames: string[] = [];
	const imported = { medications: 0, doseHistory: 0, asNeededIntakes: 0, refillHistory: 0, settings: 0, shareLinks: 0 };

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
						prescriptionAuthorizedRefills: med.prescriptionEnabled ? (med.prescriptionAuthorizedRefills ?? null) : null,
						prescriptionRemainingRefills: med.prescriptionEnabled ? (med.prescriptionRemainingRefills ?? null) : null,
						prescriptionLowRefillThreshold: med.prescriptionLowRefillThreshold ?? 1,
						prescriptionExpiryDate: med.prescriptionExpiryDate || null,
						dismissedUntil: med.dismissedUntil || null,
						imageUrl: null,
					})
					.returning();

				exportIdToNewId.set(med._exportId, inserted.id);
				imported.medications += 1;

				if (med.image) {
					const imageUrl = await imageFiles.write(med.image, inserted.id);
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

				if (event.journalNote !== null) {
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
					language: normalizeAppLanguage(importData.settings.language),
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
			const removalError = imageFiles.remove(imageFilename);
			if (removalError) {
				logger.warn(`[Import] Failed to remove rolled-back image filename=${imageFilename}: ${removalError}`);
			}
		}
		throw error;
	}

	for (const imageFilename of oldImageFilenames) {
		const removalError = imageFiles.remove(imageFilename);
		if (removalError) {
			logger.warn(`[Import] Failed to remove replaced image filename=${imageFilename}: ${removalError}`);
		}
	}
	return imported;
}
