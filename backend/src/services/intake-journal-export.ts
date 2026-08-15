import { type IntakeMood, normalizeIntakeMood } from "@medassist/shared";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { asNeededIntakeEvents, doseTracking, intakeJournal } from "../db/schema.js";

type IntakeJournalWriteDatabase = Pick<typeof db, "insert">;

export type IntakeJournalExportPayload = {
	journalNote: string;
	journalMood?: IntakeMood | null;
	journalCreatedAt?: string | null;
	journalUpdatedAt?: string | null;
};

function toIsoStringOrNull(value: Date | string | number | null | undefined): string | null {
	if (!value) {
		return null;
	}

	try {
		if (value instanceof Date) {
			return Number.isNaN(value.getTime()) ? null : value.toISOString();
		}

		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
	} catch {
		return null;
	}
}

function toDateOrFallback(value: string | null | undefined, fallback: Date): Date {
	if (!value) {
		return fallback;
	}

	try {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? fallback : parsed;
	} catch {
		return fallback;
	}
}

export async function listIntakeJournalExportPayloadsForUser(
	userId: number
): Promise<Map<number, IntakeJournalExportPayload>> {
	const rows = await db
		.select({ journal: intakeJournal })
		.from(intakeJournal)
		.innerJoin(doseTracking, eq(doseTracking.id, intakeJournal.doseTrackingId))
		.leftJoin(
			asNeededIntakeEvents,
			and(eq(asNeededIntakeEvents.doseTrackingId, doseTracking.id), eq(asNeededIntakeEvents.userId, userId))
		)
		.where(and(eq(intakeJournal.userId, userId), eq(doseTracking.userId, userId), isNull(asNeededIntakeEvents.id)));

	return new Map(
		rows.map(({ journal }) => [
			journal.doseTrackingId,
			{
				journalNote: journal.note,
				journalMood: normalizeIntakeMood(journal.mood),
				journalCreatedAt: toIsoStringOrNull(journal.createdAt),
				journalUpdatedAt: toIsoStringOrNull(journal.updatedAt),
			},
		])
	);
}

export async function restoreIntakeJournalForImportedDose(input: {
	userId: number;
	doseTrackingId: number;
	medicationId: number;
	scheduledFor: Date;
	journalNote?: string | null;
	journalMood?: IntakeMood | null;
	journalCreatedAt?: string | null;
	journalUpdatedAt?: string | null;
	database?: IntakeJournalWriteDatabase;
}): Promise<boolean> {
	const normalizedNote = input.journalNote?.trim() ?? "";
	const normalizedMood = input.journalMood ?? null;
	if (normalizedNote.length === 0 && normalizedMood === null) {
		return false;
	}

	const createdAt = toDateOrFallback(input.journalCreatedAt, input.scheduledFor);
	const updatedAt = toDateOrFallback(input.journalUpdatedAt, createdAt);
	const database = input.database ?? db;

	await database.insert(intakeJournal).values({
		userId: input.userId,
		doseTrackingId: input.doseTrackingId,
		medicationId: input.medicationId,
		scheduledFor: input.scheduledFor,
		mood: normalizedMood ?? "",
		note: normalizedNote,
		createdAt,
		updatedAt,
	});

	return true;
}
