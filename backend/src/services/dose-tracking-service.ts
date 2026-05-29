import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { doseTracking, medications, userSettings } from "../db/schema.js";
import { parseDoseId } from "../utils/dose-id.js";
import { parseIntakesJson, parseLocalDateTime } from "../utils/scheduler-utils.js";
import { computeMedicationCurrentStock } from "./current-stock.js";

export type DoseTrackingSource = "manual" | "automatic" | "notification";

export type MarkDoseTakenResult =
	| {
			success: true;
			status: "marked" | "already_taken";
	  }
	| {
			success: false;
			code: "OUT_OF_STOCK" | "INVALID_DOSE" | "ALREADY_SKIPPED";
			message: string;
	  };

export type DismissDosesResult = {
	success: true;
	dismissedCount: number;
	alreadyTakenCount: number;
};

export type SkipDosesResult = {
	success: true;
	skippedCount: number;
	alreadySkippedCount: number;
	switchedFromTakenCount: number;
};

function hasRealTakenTimestamp(takenAt: Date | null): boolean {
	return takenAt instanceof Date && takenAt.getTime() > 0;
}

function isDoseTrackingUniqueConflict(error: unknown): boolean {
	let current: unknown = error;
	const messages: string[] = [];
	while (current instanceof Error) {
		messages.push(current.message);
		current = current.cause;
	}
	const message = messages.join("\n").toLowerCase();
	return message.includes("unique") && message.includes("dose_tracking");
}

async function findDoseTrackingRow(
	userId: number,
	doseId: string
): Promise<typeof doseTracking.$inferSelect | undefined> {
	const [existing] = await db
		.select()
		.from(doseTracking)
		.where(and(eq(doseTracking.userId, userId), eq(doseTracking.doseId, doseId)));
	return existing;
}

async function isDoseOutOfStock(options: { userId: number; doseId: string }): Promise<boolean> {
	const parsedDose = parseDoseId(options.doseId);
	if (!parsedDose) {
		return false;
	}

	const [medication] = await db
		.select()
		.from(medications)
		.where(and(eq(medications.id, parsedDose.medicationId), eq(medications.userId, options.userId)));

	if (!medication) {
		return false;
	}

	const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, options.userId));
	const stockCalculationMode = (settings?.stockCalculationMode as "automatic" | "manual") ?? "automatic";

	const intakes = parseIntakesJson(
		medication.intakesJson,
		{ usageJson: medication.usageJson, everyJson: medication.everyJson, startJson: medication.startJson },
		medication.intakeRemindersEnabled ?? false
	);
	const intake = intakes[parsedDose.intakeIndex];

	const scheduledOccurrenceMs = intake
		? (() => {
				const doseDate = new Date(parsedDose.timestampMs);
				const intakeStart = parseLocalDateTime(intake.start);
				return new Date(
					doseDate.getFullYear(),
					doseDate.getMonth(),
					doseDate.getDate(),
					intakeStart.getHours(),
					intakeStart.getMinutes(),
					intakeStart.getSeconds(),
					intakeStart.getMilliseconds()
				).getTime();
			})()
		: parsedDose.timestampMs;

	const doses = await db.select().from(doseTracking).where(eq(doseTracking.userId, options.userId));
	const stockBeforeDoseMs = Math.max(0, scheduledOccurrenceMs - 1);

	return (
		computeMedicationCurrentStock({
			medication,
			doses,
			stockCalculationMode,
			nowMs: stockBeforeDoseMs,
		}) <= 0
	);
}

export async function markDoseTakenForUser(input: {
	userId: number;
	doseId: string;
	source: DoseTrackingSource;
	markedBy?: string | null;
}): Promise<MarkDoseTakenResult> {
	const parsedDose = parseDoseId(input.doseId);
	if (!parsedDose) {
		return {
			success: false,
			code: "INVALID_DOSE",
			message: "Invalid dose ID",
		};
	}

	const existing = await findDoseTrackingRow(input.userId, input.doseId);

	if (existing && !existing.dismissed) {
		return { success: true, status: "already_taken" };
	}

	if (existing?.dismissed && hasRealTakenTimestamp(existing.takenAt)) {
		return { success: true, status: "already_taken" };
	}

	if (existing?.dismissed) {
		return {
			success: false,
			code: "ALREADY_SKIPPED",
			message: "Dose is already skipped",
		};
	}

	const outOfStock = await isDoseOutOfStock({ userId: input.userId, doseId: input.doseId });
	if (outOfStock) {
		return {
			success: false,
			code: "OUT_OF_STOCK",
			message: "Medication is out of stock",
		};
	}

	try {
		await db.insert(doseTracking).values({
			userId: input.userId,
			doseId: input.doseId,
			takenAt: new Date(),
			markedBy: input.markedBy ?? null,
			takenSource: input.source,
			dismissed: false,
		});
	} catch (error) {
		if (!isDoseTrackingUniqueConflict(error)) {
			throw error;
		}

		const concurrentRow = await findDoseTrackingRow(input.userId, input.doseId);
		if (!concurrentRow) {
			throw error;
		}
		if (!concurrentRow.dismissed || (concurrentRow.dismissed && hasRealTakenTimestamp(concurrentRow.takenAt))) {
			return { success: true, status: "already_taken" };
		}
		return {
			success: false,
			code: "ALREADY_SKIPPED",
			message: "Dose is already skipped",
		};
	}

	return { success: true, status: "marked" };
}

export async function skipDosesForUser(input: { userId: number; doseIds: string[] }): Promise<SkipDosesResult> {
	let skippedCount = 0;
	let alreadySkippedCount = 0;
	let switchedFromTakenCount = 0;

	for (const doseId of input.doseIds) {
		let existing = await findDoseTrackingRow(input.userId, doseId);

		if (!existing) {
			try {
				await db.insert(doseTracking).values({
					userId: input.userId,
					doseId,
					markedBy: null,
					takenAt: new Date(0),
					dismissed: true,
				});
				skippedCount++;
				continue;
			} catch (error) {
				if (!isDoseTrackingUniqueConflict(error)) {
					throw error;
				}
				existing = await findDoseTrackingRow(input.userId, doseId);
				if (!existing) {
					throw error;
				}
			}
		}

		if (existing.dismissed) {
			alreadySkippedCount++;
			continue;
		}

		if (hasRealTakenTimestamp(existing.takenAt)) {
			switchedFromTakenCount++;
		}

		await db
			.update(doseTracking)
			.set({
				dismissed: true,
				takenAt: new Date(0),
				takenSource: "manual",
				markedBy: null,
			})
			.where(eq(doseTracking.id, existing.id));
		skippedCount++;
	}

	return {
		success: true,
		skippedCount,
		alreadySkippedCount,
		switchedFromTakenCount,
	};
}

export async function dismissDosesForUser(input: { userId: number; doseIds: string[] }): Promise<DismissDosesResult> {
	let dismissedCount = 0;
	let alreadyTakenCount = 0;

	for (const doseId of input.doseIds) {
		let existing = await findDoseTrackingRow(input.userId, doseId);

		if (!existing) {
			try {
				await db.insert(doseTracking).values({
					userId: input.userId,
					doseId,
					markedBy: null,
					takenAt: new Date(0),
					dismissed: true,
				});
				dismissedCount++;
				continue;
			} catch (error) {
				if (!isDoseTrackingUniqueConflict(error)) {
					throw error;
				}
				existing = await findDoseTrackingRow(input.userId, doseId);
				if (!existing) {
					throw error;
				}
			}
		}

		if (existing.dismissed) {
			continue;
		}

		if (hasRealTakenTimestamp(existing.takenAt)) {
			alreadyTakenCount++;
			continue;
		}

		await db
			.update(doseTracking)
			.set({
				dismissed: true,
				takenAt: new Date(0),
				takenSource: "manual",
				markedBy: null,
			})
			.where(eq(doseTracking.id, existing.id));
		dismissedCount++;
	}

	return {
		success: true,
		dismissedCount,
		alreadyTakenCount,
	};
}
