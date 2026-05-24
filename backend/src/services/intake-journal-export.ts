import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { intakeJournal } from "../db/schema.js";

type IntakeJournalWriteDatabase = Pick<typeof db, "insert">;

export type IntakeJournalExportPayload = {
	journalNote: string;
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
	const rows = await db.select().from(intakeJournal).where(eq(intakeJournal.userId, userId));

	return new Map(
		rows.map((row) => [
			row.doseTrackingId,
			{
				journalNote: row.note,
				journalCreatedAt: toIsoStringOrNull(row.createdAt),
				journalUpdatedAt: toIsoStringOrNull(row.updatedAt),
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
	journalCreatedAt?: string | null;
	journalUpdatedAt?: string | null;
	database?: IntakeJournalWriteDatabase;
}): Promise<boolean> {
	const normalizedNote = input.journalNote?.trim() ?? "";
	if (normalizedNote.length === 0) {
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
		note: normalizedNote,
		createdAt,
		updatedAt,
	});

	return true;
}
