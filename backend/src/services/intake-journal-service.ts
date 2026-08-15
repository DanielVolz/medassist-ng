import { type IntakeMood, normalizeIntakeMood } from "@medassist/shared";
import { and, desc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db, withImmediateWriteTransaction } from "../db/client.js";
import { asNeededIntakeEvents, doseTracking, intakeJournal, medications } from "../db/schema.js";
import { type ParsedDoseId, parseDoseId } from "../utils/dose-id.js";
import { normalizeMedicationIntakes, parseLocalDateTime } from "../utils/scheduler-utils.js";
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
	eventType: "scheduled" | "as_needed";
	eventId: string | null;
	scheduledFor: Date | null;
	occurredAt: Date | null;
	status: "taken" | "skipped" | "active" | "reversed";
	takenAt: Date;
	markedBy: string | null;
	takenSource: DoseTrackingSource | "owner_as_needed";
	dismissed: boolean;
	personSuffix: string | null;
};

export class IntakeJournalMutationError extends Error {
	readonly code = "EVENT_REVERSED";

	constructor() {
		super("Reversed as-needed intake journals are read-only");
		this.name = "IntakeJournalMutationError";
	}
}

export type IntakeJournalEntry = typeof intakeJournal.$inferSelect;

export type IntakeJournalHistoryEntry = {
	id: number;
	doseTrackingId: number;
	doseId: string;
	medicationId: number;
	medicationName: string;
	eventType: "scheduled" | "as_needed";
	eventId: string | null;
	scheduledFor: Date | null;
	occurredAt: Date | null;
	status: "taken" | "skipped" | "active" | "reversed";
	takenAt: Date;
	markedBy: string | null;
	takenSource: DoseTrackingSource | "owner_as_needed";
	dismissed: boolean;
	mood: IntakeMood | null;
	note: string;
	createdAt: Date;
	updatedAt: Date;
};

export function isTrackedDoseIdFormat(doseId: string): boolean {
	return (
		parseDoseId(doseId) !== null ||
		/^as-needed:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(doseId)
	);
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
	const intakes = normalizeMedicationIntakes(medication);
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

export async function resolveTrackedDoseEventForUser(
	input: {
		userId: number;
		doseId: string;
	},
	database = db
): Promise<ResolvedTrackedDoseEvent | null> {
	const [asNeededEvent] = await database
		.select({
			doseTrackingId: doseTracking.id,
			userId: doseTracking.userId,
			doseId: doseTracking.doseId,
			eventId: asNeededIntakeEvents.eventId,
			occurredAt: asNeededIntakeEvents.occurredAt,
			status: asNeededIntakeEvents.status,
			medicationId: medications.id,
			medicationName: medications.name,
			medicationGenericName: medications.genericName,
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
			and(eq(medications.id, asNeededIntakeEvents.medicationId), eq(medications.userId, asNeededIntakeEvents.userId))
		)
		.where(
			and(
				eq(asNeededIntakeEvents.userId, input.userId),
				eq(doseTracking.userId, input.userId),
				eq(doseTracking.doseId, input.doseId)
			)
		)
		.limit(1);

	if (asNeededEvent) {
		return {
			doseTrackingId: asNeededEvent.doseTrackingId,
			userId: asNeededEvent.userId,
			doseId: asNeededEvent.doseId,
			medicationId: asNeededEvent.medicationId,
			medicationName: getMedicationDisplayName({
				id: asNeededEvent.medicationId,
				name: asNeededEvent.medicationName,
				genericName: asNeededEvent.medicationGenericName,
			}),
			eventType: "as_needed",
			eventId: asNeededEvent.eventId,
			scheduledFor: null,
			occurredAt: asNeededEvent.occurredAt,
			status: asNeededEvent.status === "reversed" ? "reversed" : "active",
			takenAt: asNeededEvent.occurredAt,
			markedBy: null,
			takenSource: "owner_as_needed",
			dismissed: false,
			personSuffix: null,
		};
	}

	const parsedDose = parseDoseId(input.doseId);
	if (!parsedDose) {
		return null;
	}

	const [event] = await database
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
		.leftJoin(
			asNeededIntakeEvents,
			and(eq(asNeededIntakeEvents.doseTrackingId, doseTracking.id), eq(asNeededIntakeEvents.userId, input.userId))
		)
		.innerJoin(medications, and(eq(medications.id, parsedDose.medicationId), eq(medications.userId, input.userId)))
		.where(
			and(eq(doseTracking.userId, input.userId), eq(doseTracking.doseId, input.doseId), isNull(asNeededIntakeEvents.id))
		)
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
		eventType: "scheduled",
		eventId: null,
		scheduledFor,
		occurredAt: null,
		status: event.dismissed ? "skipped" : "taken",
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
	mood?: IntakeMood | null;
}): Promise<IntakeJournalEntry | null> {
	const normalizedNote = input.note.trim();
	const normalizedMood = input.mood ?? null;
	return withImmediateWriteTransaction(async (transactionDb) => {
		const event = await resolveTrackedDoseEventForUser({ userId: input.userId, doseId: input.doseId }, transactionDb);
		if (!event) return null;
		if (event.eventType === "as_needed" && event.status === "reversed") {
			throw new IntakeJournalMutationError();
		}

		if (normalizedNote.length === 0 && normalizedMood === null) {
			await transactionDb
				.delete(intakeJournal)
				.where(and(eq(intakeJournal.userId, input.userId), eq(intakeJournal.doseTrackingId, event.doseTrackingId)));
			return null;
		}

		const journalTimestamp = event.occurredAt ?? event.scheduledFor;
		if (!journalTimestamp) throw new Error("Resolved journal event has no authoritative timestamp");
		const now = new Date();
		await transactionDb
			.insert(intakeJournal)
			.values({
				userId: input.userId,
				doseTrackingId: event.doseTrackingId,
				medicationId: event.medicationId,
				scheduledFor: journalTimestamp,
				mood: normalizedMood ?? "",
				note: normalizedNote,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: intakeJournal.doseTrackingId,
				set: {
					userId: input.userId,
					medicationId: event.medicationId,
					mood: normalizedMood ?? "",
					note: normalizedNote,
					updatedAt: now,
				},
			});

		const [journalEntry] = await transactionDb
			.select()
			.from(intakeJournal)
			.where(and(eq(intakeJournal.userId, input.userId), eq(intakeJournal.doseTrackingId, event.doseTrackingId)))
			.limit(1);
		return journalEntry ?? null;
	});
}

export async function deleteIntakeJournalForDoseEvent(input: { userId: number; doseId: string }): Promise<boolean> {
	return withImmediateWriteTransaction(async (transactionDb) => {
		const event = await resolveTrackedDoseEventForUser(input, transactionDb);
		if (!event) return false;
		if (event.eventType === "as_needed" && event.status === "reversed") {
			throw new IntakeJournalMutationError();
		}

		await transactionDb
			.delete(intakeJournal)
			.where(and(eq(intakeJournal.userId, input.userId), eq(intakeJournal.doseTrackingId, event.doseTrackingId)));
		return true;
	});
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
		filters.push(
			or(
				and(isNotNull(asNeededIntakeEvents.id), gte(asNeededIntakeEvents.occurredAt, input.from)),
				and(isNull(asNeededIntakeEvents.id), gte(intakeJournal.scheduledFor, input.from))
			)!
		);
	}

	if (input.to) {
		filters.push(
			or(
				and(isNotNull(asNeededIntakeEvents.id), lte(asNeededIntakeEvents.occurredAt, input.to)),
				and(isNull(asNeededIntakeEvents.id), lte(intakeJournal.scheduledFor, input.to))
			)!
		);
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
			mood: intakeJournal.mood,
			note: intakeJournal.note,
			createdAt: intakeJournal.createdAt,
			updatedAt: intakeJournal.updatedAt,
			eventId: asNeededIntakeEvents.eventId,
			eventOccurredAt: asNeededIntakeEvents.occurredAt,
			eventStatus: asNeededIntakeEvents.status,
		})
		.from(intakeJournal)
		.innerJoin(doseTracking, eq(doseTracking.id, intakeJournal.doseTrackingId))
		.leftJoin(
			asNeededIntakeEvents,
			and(
				eq(asNeededIntakeEvents.doseTrackingId, doseTracking.id),
				eq(asNeededIntakeEvents.userId, input.userId),
				eq(asNeededIntakeEvents.medicationId, intakeJournal.medicationId)
			)
		)
		.innerJoin(medications, eq(medications.id, intakeJournal.medicationId))
		.where(and(...filters, eq(doseTracking.userId, input.userId), eq(medications.userId, input.userId)))
		.orderBy(
			desc(sql`coalesce(${asNeededIntakeEvents.occurredAt}, ${intakeJournal.scheduledFor})`),
			desc(intakeJournal.updatedAt)
		)
		.limit(input.limit ?? 100);

	return rows.map((row) => {
		const isAsNeeded = row.eventId !== null && row.eventOccurredAt !== null;
		let status: IntakeJournalHistoryEntry["status"];
		let takenAt: Date;
		let takenSource: IntakeJournalHistoryEntry["takenSource"];
		if (isAsNeeded) {
			status = row.eventStatus === "reversed" ? "reversed" : "active";
			takenAt = row.eventOccurredAt ?? row.takenAt;
			takenSource = "owner_as_needed";
		} else {
			status = row.dismissed ? "skipped" : "taken";
			takenAt = row.takenAt;
			takenSource = row.takenSource as DoseTrackingSource;
		}
		return {
			id: row.id,
			doseTrackingId: row.doseTrackingId,
			doseId: row.doseId,
			medicationId: row.medicationId,
			medicationName: getMedicationDisplayName({
				id: row.medicationId,
				name: row.medicationName,
				genericName: row.medicationGenericName,
			}),
			eventType: isAsNeeded ? "as_needed" : "scheduled",
			eventId: isAsNeeded ? row.eventId : null,
			scheduledFor: isAsNeeded ? null : row.scheduledFor,
			occurredAt: isAsNeeded ? row.eventOccurredAt : null,
			status,
			takenAt,
			markedBy: isAsNeeded ? null : row.markedBy,
			takenSource,
			dismissed: isAsNeeded ? false : (row.dismissed ?? false),
			mood: normalizeIntakeMood(row.mood),
			note: row.note,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	});
}
