import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { doseTracking, medications, userSettings } from "../db/schema.js";
import { parseIntakesJson, parseLocalDateTime } from "../utils/scheduler-utils.js";
import { computeMedicationCurrentStock } from "./current-stock.js";

const doseIdPattern = /^(\d+)-(\d+)-(\d+)(?:-(.+))?$/;

type ParsedDoseId = {
	medicationId: number;
	intakeIndex: number;
	timestampMs: number;
	personSuffix: string | null;
};

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

function parseDoseId(doseId: string): ParsedDoseId | null {
	const match = doseIdPattern.exec(doseId);
	if (!match) {
		return null;
	}

	const medicationId = Number.parseInt(match[1], 10);
	const intakeIndex = Number.parseInt(match[2], 10);
	const timestampMs = Number.parseInt(match[3], 10);
	const personSuffix = match[4] ? match[4].trim() : null;

	if (Number.isNaN(medicationId) || Number.isNaN(intakeIndex) || Number.isNaN(timestampMs) || intakeIndex < 0) {
		return null;
	}

	return {
		medicationId,
		intakeIndex,
		timestampMs,
		personSuffix,
	};
}

function hasRealTakenTimestamp(takenAt: Date | null): boolean {
	return takenAt instanceof Date && takenAt.getTime() > 0;
}

async function isDoseOutOfStock(options: { userId: number; doseId: string }): Promise<boolean | null> {
	const parsedDose = parseDoseId(options.doseId);
	if (!parsedDose) {
		return null;
	}

	const [medication] = await db
		.select()
		.from(medications)
		.where(and(eq(medications.id, parsedDose.medicationId), eq(medications.userId, options.userId)));

	if (!medication) {
		return null;
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

	const [existing] = await db
		.select()
		.from(doseTracking)
		.where(and(eq(doseTracking.userId, input.userId), eq(doseTracking.doseId, input.doseId)));

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
	if (outOfStock === null) {
		return {
			success: false,
			code: "INVALID_DOSE",
			message: "Invalid dose ID",
		};
	}

	if (outOfStock) {
		return {
			success: false,
			code: "OUT_OF_STOCK",
			message: "Medication is out of stock",
		};
	}

	await db.insert(doseTracking).values({
		userId: input.userId,
		doseId: input.doseId,
		takenAt: new Date(),
		markedBy: input.markedBy ?? null,
		takenSource: input.source,
		dismissed: false,
	});

	return { success: true, status: "marked" };
}

export async function skipDosesForUser(input: { userId: number; doseIds: string[] }): Promise<SkipDosesResult> {
	let skippedCount = 0;
	let alreadySkippedCount = 0;
	let switchedFromTakenCount = 0;

	for (const doseId of input.doseIds) {
		const [existing] = await db
			.select()
			.from(doseTracking)
			.where(and(eq(doseTracking.userId, input.userId), eq(doseTracking.doseId, doseId)));

		if (!existing) {
			await db.insert(doseTracking).values({
				userId: input.userId,
				doseId,
				markedBy: null,
				takenAt: new Date(0),
				dismissed: true,
			});
			skippedCount++;
			continue;
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
		const [existing] = await db
			.select()
			.from(doseTracking)
			.where(and(eq(doseTracking.userId, input.userId), eq(doseTracking.doseId, doseId)));

		if (!existing) {
			await db.insert(doseTracking).values({
				userId: input.userId,
				doseId,
				markedBy: null,
				takenAt: new Date(0),
				dismissed: true,
			});
			dismissedCount++;
			continue;
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
