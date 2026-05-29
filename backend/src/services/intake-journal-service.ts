import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { doseTracking, intakeJournal, medications } from "../db/schema.js";
import { type ParsedDoseId, parseDoseId } from "../utils/dose-id.js";
import { parseIntakesJson, parseLocalDateTime } from "../utils/scheduler-utils.js";
import type { DoseTrackingSource } from "./dose-tracking-service.js";

type MedicationTimingRow = {
	id: number;
	name: string | null;
	genericName: string | null;
	intakesJson: string;
	usageJson: string;
	everyJson: string;
	startJson: string;
	intakeRemindersEnabled: boolean;
};

export type ResolvedTrackedDoseEvent = {
	doseTrackingId: number;
	userId: number;
	doseId: string;
	medicationId: number;
	medicationName: string;
	scheduledFor: Date;
	takenAt: Date;
	markedBy: string | null;
	takenSource: DoseTrackingSource;
	dismissed: boolean;
	personSuffix: string | null;
};

export type IntakeJournalEntry = typeof intakeJournal.$inferSelect;

export type IntakeJournalHistoryEntry = {
	id: number;
	doseTrackingId: number;
	doseId: string;
	medicationId: number;
	medicationName: string;
	scheduledFor: Date;
	takenAt: Date;
	markedBy: string | null;
	takenSource: DoseTrackingSource;
	dismissed: boolean;
	note: string;
	createdAt: Date;
	updatedAt: Date;
};

export function isTrackedDoseIdFormat(doseId: string): boolean {
	return parseDoseId(doseId) !== null;
}

function getMedicationDisplayName(medication: Pick<MedicationTimingRow, "id" | "name" | "genericName">): string {
	const commercialName = medication.name?.trim() ?? "";
	if (commercialName.length > 0) {
		return commercialName;
	}

	const genericName = medication.genericName?.trim() ?? "";
	if (genericName.length > 0) {
		return genericName;
	}

	return `Medication #${medication.id}`;
}

function resolveScheduledFor(parsedDose: ParsedDoseId, medication: MedicationTimingRow): Date {
	const intakes = parseIntakesJson(
		medication.intakesJson,
		{
			usageJson: medication.usageJson,
			everyJson: medication.everyJson,
			startJson: medication.startJson,
		},
		medication.intakeRemindersEnabled
	);
	const intake = intakes[parsedDose.intakeIndex];
	if (!intake) {
		return new Date(parsedDose.timestampMs);
	}

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
	);
}

export async function resolveTrackedDoseEventForUser(input: {
	userId: number;
	doseId: string;
}): Promise<ResolvedTrackedDoseEvent | null> {
	const parsedDose = parseDoseId(input.doseId);
	if (!parsedDose) {
		return null;
	}

	const [event] = await db
		.select({
			doseTrackingId: doseTracking.id,
			userId: doseTracking.userId,
			doseId: doseTracking.doseId,
			takenAt: doseTracking.takenAt,
			markedBy: doseTracking.markedBy,
			takenSource: doseTracking.takenSource,
			dismissed: doseTracking.dismissed,
			medicationId: medications.id,
			medicationName: medications.name,
			medicationGenericName: medications.genericName,
			intakesJson: medications.intakesJson,
			usageJson: medications.usageJson,
			everyJson: medications.everyJson,
			startJson: medications.startJson,
			intakeRemindersEnabled: medications.intakeRemindersEnabled,
		})
		.from(doseTracking)
		.innerJoin(medications, and(eq(medications.id, parsedDose.medicationId), eq(medications.userId, input.userId)))
		.where(and(eq(doseTracking.userId, input.userId), eq(doseTracking.doseId, input.doseId)))
		.limit(1);

	if (!event) {
		return null;
	}

	const scheduledFor = resolveScheduledFor(parsedDose, {
		id: event.medicationId,
		name: event.medicationName,
		genericName: event.medicationGenericName,
		intakesJson: event.intakesJson,
		usageJson: event.usageJson,
		everyJson: event.everyJson,
		startJson: event.startJson,
		intakeRemindersEnabled: event.intakeRemindersEnabled ?? false,
	});

	return {
		doseTrackingId: event.doseTrackingId,
		userId: event.userId,
		doseId: event.doseId,
		medicationId: event.medicationId,
		medicationName: getMedicationDisplayName({
			id: event.medicationId,
			name: event.medicationName,
			genericName: event.medicationGenericName,
		}),
		scheduledFor,
		takenAt: event.takenAt,
		markedBy: event.markedBy,
		takenSource: event.takenSource as DoseTrackingSource,
		dismissed: event.dismissed ?? false,
		personSuffix: parsedDose.personSuffix,
	};
}

export async function getIntakeJournalForDoseEvent(input: {
	userId: number;
	doseId: string;
}): Promise<IntakeJournalEntry | null> {
	const event = await resolveTrackedDoseEventForUser(input);
	if (!event) {
		return null;
	}

	const [journalEntry] = await db
		.select()
		.from(intakeJournal)
		.where(and(eq(intakeJournal.userId, input.userId), eq(intakeJournal.doseTrackingId, event.doseTrackingId)))
		.limit(1);

	return journalEntry ?? null;
}

export async function upsertIntakeJournalForDoseEvent(input: {
	userId: number;
	doseId: string;
	note: string;
}): Promise<IntakeJournalEntry | null> {
	const normalizedNote = input.note.trim();
	if (normalizedNote.length === 0) {
		await deleteIntakeJournalForDoseEvent({ userId: input.userId, doseId: input.doseId });
		return null;
	}

	const event = await resolveTrackedDoseEventForUser({ userId: input.userId, doseId: input.doseId });
	if (!event) {
		return null;
	}

	const now = new Date();

	await db
		.insert(intakeJournal)
		.values({
			userId: input.userId,
			doseTrackingId: event.doseTrackingId,
			medicationId: event.medicationId,
			scheduledFor: event.scheduledFor,
			note: normalizedNote,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: intakeJournal.doseTrackingId,
			set: {
				userId: input.userId,
				medicationId: event.medicationId,
				note: normalizedNote,
				updatedAt: now,
			},
		});

	return getIntakeJournalForDoseEvent({ userId: input.userId, doseId: input.doseId });
}

export async function deleteIntakeJournalForDoseEvent(input: { userId: number; doseId: string }): Promise<boolean> {
	const event = await resolveTrackedDoseEventForUser(input);
	if (!event) {
		return false;
	}

	await db
		.delete(intakeJournal)
		.where(and(eq(intakeJournal.userId, input.userId), eq(intakeJournal.doseTrackingId, event.doseTrackingId)));

	return true;
}

export async function listIntakeJournalEntriesForUser(input: {
	userId: number;
	medicationId?: number;
	from?: Date;
	to?: Date;
	limit?: number;
}): Promise<IntakeJournalHistoryEntry[]> {
	const filters = [eq(intakeJournal.userId, input.userId)];

	if (typeof input.medicationId === "number") {
		filters.push(eq(intakeJournal.medicationId, input.medicationId));
	}

	if (input.from) {
		filters.push(gte(intakeJournal.scheduledFor, input.from));
	}

	if (input.to) {
		filters.push(lte(intakeJournal.scheduledFor, input.to));
	}

	const rows = await db
		.select({
			id: intakeJournal.id,
			doseTrackingId: intakeJournal.doseTrackingId,
			doseId: doseTracking.doseId,
			medicationId: intakeJournal.medicationId,
			medicationName: medications.name,
			medicationGenericName: medications.genericName,
			scheduledFor: intakeJournal.scheduledFor,
			takenAt: doseTracking.takenAt,
			markedBy: doseTracking.markedBy,
			takenSource: doseTracking.takenSource,
			dismissed: doseTracking.dismissed,
			note: intakeJournal.note,
			createdAt: intakeJournal.createdAt,
			updatedAt: intakeJournal.updatedAt,
		})
		.from(intakeJournal)
		.innerJoin(doseTracking, eq(doseTracking.id, intakeJournal.doseTrackingId))
		.innerJoin(medications, eq(medications.id, intakeJournal.medicationId))
		.where(and(...filters))
		.orderBy(desc(intakeJournal.scheduledFor), desc(intakeJournal.updatedAt))
		.limit(input.limit ?? 100);

	return rows.map((row) => ({
		id: row.id,
		doseTrackingId: row.doseTrackingId,
		doseId: row.doseId,
		medicationId: row.medicationId,
		medicationName: getMedicationDisplayName({
			id: row.medicationId,
			name: row.medicationName,
			genericName: row.medicationGenericName,
		}),
		scheduledFor: row.scheduledFor,
		takenAt: row.takenAt,
		markedBy: row.markedBy,
		takenSource: row.takenSource as DoseTrackingSource,
		dismissed: row.dismissed ?? false,
		note: row.note,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}));
}
