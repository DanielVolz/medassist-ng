import { createHash, randomUUID } from "node:crypto";
import { getAsNeededQuantityProfile, normalizeAsNeededQuantityMilli, normalizeIntakeMood } from "@medassist/shared";
import { and, desc, eq, gt, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db, withImmediateWriteTransaction } from "../db/client.js";
import { asNeededIntakeEvents, doseTracking, intakeJournal, medications, userSettings } from "../db/schema.js";
import { isAmountBasedPackageType } from "../utils/package-profiles.js";
import { getEffectiveTimezone, normalizeMedicationSchedule } from "../utils/scheduler-utils.js";
import { computeMedicationCurrentStockRaw } from "./current-stock.js";

export type AsNeededLifecycle = "active_no_schedule" | "active_scheduled" | "ended" | "obsolete";
export type AsNeededEligibilityReason = "eligible" | "has_regular_schedule" | "ended" | "obsolete";

type MedicationRow = typeof medications.$inferSelect;
type Database = typeof db;
type EventRow = typeof asNeededIntakeEvents.$inferSelect;

const OWNER_CREATE_LIMIT = 20;
const OWNER_CREATE_WINDOW_MS = 60_000;
const ownerCreateAttempts = new Map<number, number[]>();

export class AsNeededIntakeError extends Error {
	constructor(
		public readonly code:
			| "INVALID_IDEMPOTENCY_KEY"
			| "IDEMPOTENCY_KEY_REUSED"
			| "MEDICATION_NOT_FOUND"
			| "NOT_ELIGIBLE"
			| "INVALID_QUANTITY"
			| "INVALID_PERSON"
			| "STOCK_UNRESOLVABLE"
			| "INSUFFICIENT_STOCK"
			| "REPLACEMENT_NOT_FOUND"
			| "REPLACEMENT_INVALID"
			| "EVENT_NOT_FOUND"
			| "REVISION_CONFLICT"
			| "REVERSAL_KEY_REUSED"
			| "TOO_MANY_NEW_INTAKES"
			| "INVALID_CURSOR"
			| "INVALID_DATE_RANGE",
		message: string,
		public readonly details?: { currentRevision?: number; currentStock?: number; retryAfterSeconds?: number }
	) {
		super(message);
		this.name = "AsNeededIntakeError";
	}
}

function enforceOwnerCreateLimit(userId: number, nowMs: number): void {
	const recent = (ownerCreateAttempts.get(userId) ?? []).filter(
		(timestamp) => timestamp > nowMs - OWNER_CREATE_WINDOW_MS
	);
	if (recent.length >= OWNER_CREATE_LIMIT) {
		const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + OWNER_CREATE_WINDOW_MS - nowMs) / 1000));
		ownerCreateAttempts.set(userId, recent);
		throw new AsNeededIntakeError("TOO_MANY_NEW_INTAKES", "Too many new as-needed intake intents", {
			retryAfterSeconds,
		});
	}
	recent.push(nowMs);
	ownerCreateAttempts.set(userId, recent);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function normalizeIntentKey(value: string): string {
	const key = value.trim().toLowerCase();
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
		throw new AsNeededIntakeError("INVALID_IDEMPOTENCY_KEY", "Idempotency key must be a UUID");
	}
	return key;
}

function parseMedicationPeople(value: string): string[] {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((person): person is string => typeof person === "string" && person.trim().length > 0)
			: [];
	} catch {
		return [];
	}
}

export function getAsNeededLifecycle(
	medication: MedicationRow,
	now = new Date(),
	timezone?: string | null
): {
	lifecycle: AsNeededLifecycle;
	eligible: boolean;
	reason: AsNeededEligibilityReason;
} {
	if (medication.isObsolete) return { lifecycle: "obsolete", eligible: false, reason: "obsolete" };
	const endDate = medication.medicationEndDate?.trim();
	const today = now.toLocaleDateString("en-CA", { timeZone: getEffectiveTimezone(timezone) });
	if (endDate && endDate.slice(0, 10) < today) {
		return { lifecycle: "ended", eligible: false, reason: "ended" };
	}
	if (normalizeMedicationSchedule(medication).intakes.length > 0) {
		return { lifecycle: "active_scheduled", eligible: false, reason: "has_regular_schedule" };
	}
	return { lifecycle: "active_no_schedule", eligible: true, reason: "eligible" };
}

export type AsNeededEventDto = {
	eventType: "as_needed";
	eventId: string;
	medicationId: number;
	medication: {
		name: string;
		genericName: string | null;
		medicationForm: string;
		packageType: string;
		isObsolete: boolean;
		hasRegularSchedule: boolean;
		lifecycle: AsNeededLifecycle;
		recordEligibility: { eligible: boolean; reason: AsNeededEligibilityReason };
	};
	occurredAt: string;
	recordedAt: string;
	quantity: number;
	quantityUnit: string;
	person: string | null;
	source: string;
	status: string;
	revision: number;
	stockEffect: number;
	stockEffectReason: string;
	stockCutoffAt: string | null;
	replacementForEventId: string | null;
	reversedAt: string | null;
	journal: null | { doseId: string; mood: string | null; note: string; createdAt: string; updatedAt: string };
};

export type AsNeededInventoryResult = {
	currentStock: number;
	unit: string;
	capacity: number | null;
	reconciliationRequired: boolean;
};

function encodeCursor(event: EventRow): string {
	return Buffer.from(JSON.stringify([event.occurredAt.toISOString(), event.eventId])).toString("base64url");
}

function decodeCursor(cursor: string): { occurredAt: Date; eventId: string } {
	try {
		const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
		if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || typeof value[1] !== "string") {
			throw new Error("invalid");
		}
		const occurredAt = new Date(value[0]);
		if (
			Number.isNaN(occurredAt.getTime()) ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value[1])
		) {
			throw new Error("invalid");
		}
		return { occurredAt, eventId: value[1] };
	} catch {
		throw new AsNeededIntakeError("INVALID_CURSOR", "Invalid as-needed intake cursor");
	}
}

function serializeEvent(
	event: EventRow,
	medication: MedicationRow,
	lifecycle: ReturnType<typeof getAsNeededLifecycle>,
	doseId: string,
	journal: typeof intakeJournal.$inferSelect | null,
	replacementForEventId: string | null
): AsNeededEventDto {
	return {
		eventType: "as_needed",
		eventId: event.eventId,
		medicationId: medication.id,
		medication: {
			name: medication.name,
			genericName: medication.genericName,
			medicationForm: medication.medicationForm ?? "tablet",
			packageType: medication.packageType,
			isObsolete: medication.isObsolete ?? false,
			hasRegularSchedule: normalizeMedicationSchedule(medication).intakes.length > 0,
			lifecycle: lifecycle.lifecycle,
			recordEligibility: { eligible: lifecycle.eligible, reason: lifecycle.reason },
		},
		occurredAt: event.occurredAt.toISOString(),
		recordedAt: event.recordedAt.toISOString(),
		quantity: event.quantityMilli / 1000,
		quantityUnit: event.quantityUnit,
		person: event.personName || null,
		source: event.source,
		status: event.status,
		revision: event.revision,
		stockEffect: event.stockEffectMilli / 1000,
		stockEffectReason: event.stockEffectReason,
		stockCutoffAt: event.stockCutoffAt > 0 ? new Date(event.stockCutoffAt * 1000).toISOString() : null,
		replacementForEventId,
		reversedAt: event.reversedAt?.toISOString() ?? null,
		journal: journal
			? {
					doseId,
					mood: normalizeIntakeMood(journal.mood),
					note: journal.note,
					createdAt: journal.createdAt.toISOString(),
					updatedAt: journal.updatedAt.toISOString(),
				}
			: null,
	};
}

export async function getActiveAsNeededStockEffectMilli(
	database: Database,
	userId: number,
	medicationId: number
): Promise<number> {
	const [row] = await database
		.select({ total: sql<number>`coalesce(sum(${asNeededIntakeEvents.stockEffectMilli}), 0)` })
		.from(asNeededIntakeEvents)
		.where(
			and(
				eq(asNeededIntakeEvents.userId, userId),
				eq(asNeededIntakeEvents.medicationId, medicationId),
				eq(asNeededIntakeEvents.status, "active")
			)
		);
	return Number(row?.total ?? 0);
}

export async function getActiveAsNeededStockEffectsMilli(
	database: Database,
	userId: number,
	medicationIds: number[]
): Promise<Map<number, number>> {
	if (medicationIds.length === 0) return new Map();
	const rows = await database
		.select({
			medicationId: asNeededIntakeEvents.medicationId,
			total: sql<number>`coalesce(sum(${asNeededIntakeEvents.stockEffectMilli}), 0)`,
		})
		.from(asNeededIntakeEvents)
		.where(
			and(
				eq(asNeededIntakeEvents.userId, userId),
				eq(asNeededIntakeEvents.status, "active"),
				inArray(asNeededIntakeEvents.medicationId, medicationIds)
			)
		)
		.groupBy(asNeededIntakeEvents.medicationId);
	return new Map(rows.map((row) => [row.medicationId, Number(row.total ?? 0)]));
}

export async function getAsNeededAnchorIds(
	database: Database,
	userId: number,
	doseTrackingIds: number[]
): Promise<Set<number>> {
	if (doseTrackingIds.length === 0) return new Set();
	const requestedIds = new Set(doseTrackingIds);
	const rows = await database
		.select({ id: doseTracking.id })
		.from(asNeededIntakeEvents)
		.innerJoin(
			doseTracking,
			and(
				eq(doseTracking.id, asNeededIntakeEvents.doseTrackingId),
				eq(doseTracking.userId, asNeededIntakeEvents.userId)
			)
		)
		.where(and(eq(asNeededIntakeEvents.userId, userId), eq(doseTracking.userId, userId)));
	return new Set(rows.map((row) => row.id).filter((id) => requestedIds.has(id)));
}

export async function filterScheduledDoseRows<T extends { id: number }>(
	database: Database,
	userId: number,
	rows: T[]
): Promise<T[]> {
	const anchorIds = await getAsNeededAnchorIds(
		database,
		userId,
		rows.map((row) => row.id)
	);
	return rows.filter((row) => !anchorIds.has(row.id));
}

async function getReplacementEventIds(
	database: Database,
	userId: number,
	events: EventRow[]
): Promise<Map<number, string>> {
	const ids = [...new Set(events.map((event) => event.replacesEventId).filter((id): id is number => id !== null))];
	if (ids.length === 0) return new Map();
	const rows = await database
		.select({ id: asNeededIntakeEvents.id, eventId: asNeededIntakeEvents.eventId })
		.from(asNeededIntakeEvents)
		.where(and(eq(asNeededIntakeEvents.userId, userId), inArray(asNeededIntakeEvents.id, ids)));
	return new Map(rows.map((row) => [row.id, row.eventId]));
}

export async function listAsNeededIntakes(input: {
	userId: number;
	medicationId: number;
	includeReversed: boolean;
	from?: Date;
	to?: Date;
	limit: number;
	cursor?: string;
}): Promise<{ events: AsNeededEventDto[]; nextCursor: string | null }> {
	const [[medication], [settings]] = await Promise.all([
		db
			.select()
			.from(medications)
			.where(and(eq(medications.userId, input.userId), eq(medications.id, input.medicationId))),
		db.select({ timezone: userSettings.timezone }).from(userSettings).where(eq(userSettings.userId, input.userId)),
	]);
	if (!medication) throw new AsNeededIntakeError("MEDICATION_NOT_FOUND", "Medication not found");
	if (input.from && input.to && input.from > input.to) {
		throw new AsNeededIntakeError("INVALID_DATE_RANGE", "Invalid as-needed intake date range");
	}
	const cursor = input.cursor ? decodeCursor(input.cursor) : null;
	const rows = await db
		.select({ event: asNeededIntakeEvents, doseId: doseTracking.doseId, journal: intakeJournal })
		.from(asNeededIntakeEvents)
		.innerJoin(
			doseTracking,
			and(
				eq(doseTracking.id, asNeededIntakeEvents.doseTrackingId),
				eq(doseTracking.userId, asNeededIntakeEvents.userId)
			)
		)
		.leftJoin(
			intakeJournal,
			and(
				eq(intakeJournal.doseTrackingId, asNeededIntakeEvents.doseTrackingId),
				eq(intakeJournal.userId, asNeededIntakeEvents.userId)
			)
		)
		.where(
			and(
				eq(asNeededIntakeEvents.userId, input.userId),
				eq(asNeededIntakeEvents.medicationId, input.medicationId),
				input.includeReversed ? undefined : eq(asNeededIntakeEvents.status, "active"),
				input.from ? gte(asNeededIntakeEvents.occurredAt, input.from) : undefined,
				input.to ? lte(asNeededIntakeEvents.occurredAt, input.to) : undefined,
				cursor
					? or(
							lt(asNeededIntakeEvents.occurredAt, cursor.occurredAt),
							and(
								eq(asNeededIntakeEvents.occurredAt, cursor.occurredAt),
								lt(asNeededIntakeEvents.eventId, cursor.eventId)
							)
						)
					: undefined
			)
		)
		.orderBy(desc(asNeededIntakeEvents.occurredAt), desc(asNeededIntakeEvents.eventId))
		.limit(input.limit + 1);
	const page = rows.slice(0, input.limit);
	const replacementIds = await getReplacementEventIds(
		db,
		input.userId,
		page.map((row) => row.event)
	);
	const lifecycle = getAsNeededLifecycle(medication, new Date(), settings?.timezone);
	return {
		events: page.map((row) =>
			serializeEvent(
				row.event,
				medication,
				lifecycle,
				row.doseId,
				row.journal,
				row.event.replacesEventId ? (replacementIds.get(row.event.replacesEventId) ?? null) : null
			)
		),
		nextCursor: rows.length > input.limit && page.length > 0 ? encodeCursor(page[page.length - 1].event) : null,
	};
}

function getConfiguredCapacity(medication: MedicationRow): number | null {
	const profile = getAsNeededQuantityProfile(medication);
	if (!profile.measurable) return null;
	if (!isAmountBasedPackageType(medication.packageType)) {
		return medication.packCount * medication.blistersPerPack * medication.pillsPerBlister;
	}
	return medication.totalPills ?? medication.looseTablets;
}

export async function getAsNeededMutationResponse(
	userId: number,
	eventId: string
): Promise<{ event: AsNeededEventDto; inventory: AsNeededInventoryResult }> {
	const [row] = await db
		.select({
			event: asNeededIntakeEvents,
			medication: medications,
			doseId: doseTracking.doseId,
			journal: intakeJournal,
		})
		.from(asNeededIntakeEvents)
		.innerJoin(
			medications,
			and(eq(medications.id, asNeededIntakeEvents.medicationId), eq(medications.userId, asNeededIntakeEvents.userId))
		)
		.innerJoin(
			doseTracking,
			and(
				eq(doseTracking.id, asNeededIntakeEvents.doseTrackingId),
				eq(doseTracking.userId, asNeededIntakeEvents.userId)
			)
		)
		.leftJoin(
			intakeJournal,
			and(
				eq(intakeJournal.doseTrackingId, asNeededIntakeEvents.doseTrackingId),
				eq(intakeJournal.userId, asNeededIntakeEvents.userId)
			)
		)
		.where(and(eq(asNeededIntakeEvents.userId, userId), eq(asNeededIntakeEvents.eventId, eventId)));
	if (!row) throw new AsNeededIntakeError("EVENT_NOT_FOUND", "Event not found");
	const [[settings], doseRows, activeEffectMilli, replacementIds] = await Promise.all([
		db
			.select({ stockCalculationMode: userSettings.stockCalculationMode, timezone: userSettings.timezone })
			.from(userSettings)
			.where(eq(userSettings.userId, userId)),
		db.select().from(doseTracking).where(eq(doseTracking.userId, userId)),
		getActiveAsNeededStockEffectMilli(db, userId, row.medication.id),
		getReplacementEventIds(db, userId, [row.event]),
	]);
	const doses = await filterScheduledDoseRows(db, userId, doseRows);
	const currentStock =
		Math.round(
			computeMedicationCurrentStockRaw({
				medication: row.medication,
				doses,
				stockCalculationMode: settings?.stockCalculationMode === "manual" ? "manual" : "automatic",
				asNeededStockEffectMilli: activeEffectMilli,
			}) * 1000
		) / 1000;
	const capacity = getConfiguredCapacity(row.medication);
	return {
		event: serializeEvent(
			row.event,
			row.medication,
			getAsNeededLifecycle(row.medication, new Date(), settings?.timezone),
			row.doseId,
			row.journal,
			row.event.replacesEventId ? (replacementIds.get(row.event.replacesEventId) ?? null) : null
		),
		inventory: {
			currentStock,
			unit: getAsNeededQuantityProfile(row.medication).unit,
			capacity,
			reconciliationRequired: capacity !== null && currentStock > capacity,
		},
	};
}

export async function getAsNeededAnchorDoseIds(
	database: Database,
	userId: number,
	doseIds?: string[]
): Promise<Set<string>> {
	if (doseIds?.length === 0) return new Set();
	const requestedDoseIds = doseIds ? new Set(doseIds) : null;
	const rows = await database
		.select({ doseId: doseTracking.doseId })
		.from(asNeededIntakeEvents)
		.innerJoin(
			doseTracking,
			and(
				eq(doseTracking.id, asNeededIntakeEvents.doseTrackingId),
				eq(doseTracking.userId, asNeededIntakeEvents.userId)
			)
		)
		.where(and(eq(asNeededIntakeEvents.userId, userId), eq(doseTracking.userId, userId)));
	return new Set(rows.map((row) => row.doseId).filter((doseId) => !requestedDoseIds || requestedDoseIds.has(doseId)));
}

export async function isAsNeededAnchorDoseId(database: Database, userId: number, doseId: string): Promise<boolean> {
	return (await getAsNeededAnchorDoseIds(database, userId, [doseId])).has(doseId);
}

export async function neutralizeAsNeededStockEffects(
	database: Database,
	userId: number,
	medicationId: number,
	cutoff: Date
): Promise<void> {
	await database
		.update(asNeededIntakeEvents)
		.set({
			stockEffectMilli: 0,
			stockEffectReason: "superseded_by_correction",
			stockCutoffAt: Math.floor(cutoff.getTime() / 1000),
			revision: sql`${asNeededIntakeEvents.revision} + 1`,
			updatedAt: cutoff,
		})
		.where(
			and(
				eq(asNeededIntakeEvents.userId, userId),
				eq(asNeededIntakeEvents.medicationId, medicationId),
				eq(asNeededIntakeEvents.status, "active"),
				gt(asNeededIntakeEvents.stockEffectMilli, 0),
				lte(asNeededIntakeEvents.occurredAt, cutoff)
			)
		);
}

export async function deleteAsNeededAnchorsForMedication(
	database: Database,
	userId: number,
	medicationId: number
): Promise<void> {
	const anchors = await database
		.select({ doseTrackingId: asNeededIntakeEvents.doseTrackingId })
		.from(asNeededIntakeEvents)
		.where(and(eq(asNeededIntakeEvents.userId, userId), eq(asNeededIntakeEvents.medicationId, medicationId)));
	if (anchors.length === 0) return;
	await database.delete(doseTracking).where(
		and(
			eq(doseTracking.userId, userId),
			inArray(
				doseTracking.id,
				anchors.map((anchor) => anchor.doseTrackingId)
			)
		)
	);
}

export async function createAsNeededIntake(input: {
	userId: number;
	medicationId: number;
	quantity: number;
	personName?: string | null;
	idempotencyKey: string;
	replacesEventId?: string | null;
	enforceOwnerRateLimit?: boolean;
}) {
	const keyHash = sha256(normalizeIntentKey(input.idempotencyKey));
	return withImmediateWriteTransaction(async (transactionDb) => {
		const personName = input.personName?.trim() ?? "";
		const replacementId = input.replacesEventId?.trim().toLowerCase() ?? "";
		const rawQuantityMilli = input.quantity * 1000;
		const fingerprint = Number.isSafeInteger(rawQuantityMilli)
			? sha256(`${input.medicationId}:${rawQuantityMilli}:${personName}:${replacementId}`)
			: "";
		const [replay] = await transactionDb
			.select()
			.from(asNeededIntakeEvents)
			.where(and(eq(asNeededIntakeEvents.userId, input.userId), eq(asNeededIntakeEvents.idempotencyKeyHash, keyHash)));
		if (replay) {
			if (!fingerprint || replay.requestFingerprint !== fingerprint) {
				const [replacedEvent] = replay.replacesEventId
					? await transactionDb
							.select({ eventId: asNeededIntakeEvents.eventId })
							.from(asNeededIntakeEvents)
							.where(
								and(eq(asNeededIntakeEvents.userId, input.userId), eq(asNeededIntakeEvents.id, replay.replacesEventId))
							)
					: [];
				const matchesImportedIntent =
					Number.isSafeInteger(rawQuantityMilli) &&
					replay.medicationId === input.medicationId &&
					replay.quantityMilli === rawQuantityMilli &&
					replay.personName === personName &&
					(replacedEvent?.eventId ?? "") === replacementId;
				if (!matchesImportedIntent) {
					throw new AsNeededIntakeError("IDEMPOTENCY_KEY_REUSED", "Idempotency key is bound to another request");
				}
			}
			return { ...replay, isReplay: true as const };
		}
		if (input.enforceOwnerRateLimit) enforceOwnerCreateLimit(input.userId, Date.now());

		const [medication] = await transactionDb
			.select()
			.from(medications)
			.where(and(eq(medications.userId, input.userId), eq(medications.id, input.medicationId)));
		if (!medication) throw new AsNeededIntakeError("MEDICATION_NOT_FOUND", "Medication not found");

		const profile = getAsNeededQuantityProfile(medication);
		const quantityMilli = normalizeAsNeededQuantityMilli(input.quantity, profile);
		if (quantityMilli === null) throw new AsNeededIntakeError("INVALID_QUANTITY", "Invalid quantity");
		if (personName) {
			const ownerMedications = await transactionDb
				.select({ takenByJson: medications.takenByJson })
				.from(medications)
				.where(eq(medications.userId, input.userId));
			const personIsKnown = ownerMedications.some(({ takenByJson }) =>
				parseMedicationPeople(takenByJson).includes(personName)
			);
			if (!personIsKnown) {
				throw new AsNeededIntakeError("INVALID_PERSON", "Person is not assigned to an owned medication");
			}
		}
		const [settings] = await transactionDb
			.select({ stockCalculationMode: userSettings.stockCalculationMode, timezone: userSettings.timezone })
			.from(userSettings)
			.where(eq(userSettings.userId, input.userId));
		const now = new Date();
		if (!getAsNeededLifecycle(medication, now, settings?.timezone).eligible) {
			throw new AsNeededIntakeError("NOT_ELIGIBLE", "Medication is not eligible for an as-needed intake");
		}

		let replacesEventInternalId: number | null = null;
		if (replacementId) {
			const [replaced] = await transactionDb
				.select()
				.from(asNeededIntakeEvents)
				.where(and(eq(asNeededIntakeEvents.userId, input.userId), eq(asNeededIntakeEvents.eventId, replacementId)));
			if (!replaced) throw new AsNeededIntakeError("REPLACEMENT_NOT_FOUND", "Replacement event not found");
			if (replaced.medicationId !== input.medicationId || replaced.status !== "reversed") {
				throw new AsNeededIntakeError("REPLACEMENT_INVALID", "Replacement target is not a reversed medication event");
			}
			const [existingReplacement] = await transactionDb
				.select({ id: asNeededIntakeEvents.id })
				.from(asNeededIntakeEvents)
				.where(
					and(eq(asNeededIntakeEvents.userId, input.userId), eq(asNeededIntakeEvents.replacesEventId, replaced.id))
				);
			if (existingReplacement) {
				throw new AsNeededIntakeError("REPLACEMENT_INVALID", "Replacement target already has a replacement");
			}
			replacesEventInternalId = replaced.id;
		}

		const doseRows = await transactionDb.select().from(doseTracking).where(eq(doseTracking.userId, input.userId));
		const doses = await filterScheduledDoseRows(transactionDb, input.userId, doseRows);
		const activeEffectMilli = await getActiveAsNeededStockEffectMilli(transactionDb, input.userId, input.medicationId);
		const currentStockMilli = Math.round(
			computeMedicationCurrentStockRaw({
				medication,
				doses,
				stockCalculationMode: settings?.stockCalculationMode === "manual" ? "manual" : "automatic",
				asNeededStockEffectMilli: activeEffectMilli,
			}) * 1000
		);
		if (profile.measurable && (!Number.isSafeInteger(currentStockMilli) || currentStockMilli < 0)) {
			throw new AsNeededIntakeError("STOCK_UNRESOLVABLE", "Current stock cannot be resolved safely");
		}
		if (profile.measurable && quantityMilli > currentStockMilli) {
			throw new AsNeededIntakeError("INSUFFICIENT_STOCK", "Insufficient current stock", {
				currentStock: currentStockMilli / 1000,
			});
		}

		const eventId = randomUUID().toLowerCase();
		const [anchor] = await transactionDb
			.insert(doseTracking)
			.values({
				userId: input.userId,
				doseId: `as-needed:${eventId}`,
				takenAt: now,
				markedBy: personName || null,
				takenSource: "manual",
				dismissed: false,
			})
			.returning({ id: doseTracking.id });
		const [event] = await transactionDb
			.insert(asNeededIntakeEvents)
			.values({
				eventId,
				userId: input.userId,
				medicationId: input.medicationId,
				doseTrackingId: anchor.id,
				idempotencyKeyHash: keyHash,
				requestFingerprint: fingerprint,
				occurredAt: now,
				recordedAt: now,
				quantityMilli,
				quantityUnit: profile.unit,
				personName,
				stockEffectMilli: profile.measurable ? quantityMilli : 0,
				stockEffectReason: profile.measurable ? "applied" : "non_measurable",
				replacesEventId: replacesEventInternalId,
				updatedAt: now,
			})
			.returning();
		return { ...event, isReplay: false as const };
	});
}

export async function reverseAsNeededIntake(input: {
	userId: number;
	eventId: string;
	expectedRevision: number;
	idempotencyKey: string;
}) {
	const keyHash = sha256(normalizeIntentKey(input.idempotencyKey));
	const eventId = input.eventId.trim().toLowerCase();
	return withImmediateWriteTransaction(async (transactionDb) => {
		const [event] = await transactionDb
			.select()
			.from(asNeededIntakeEvents)
			.where(and(eq(asNeededIntakeEvents.userId, input.userId), eq(asNeededIntakeEvents.eventId, eventId)));
		if (!event) throw new AsNeededIntakeError("EVENT_NOT_FOUND", "Event not found");
		const [keyOwner] = await transactionDb
			.select({ id: asNeededIntakeEvents.id })
			.from(asNeededIntakeEvents)
			.where(
				and(eq(asNeededIntakeEvents.userId, input.userId), eq(asNeededIntakeEvents.reversalIdempotencyKeyHash, keyHash))
			);
		if (keyOwner && keyOwner.id !== event.id) {
			throw new AsNeededIntakeError("REVERSAL_KEY_REUSED", "Reversal key is bound to another event");
		}
		if (event.status === "reversed") return event;
		if (event.revision !== input.expectedRevision) {
			throw new AsNeededIntakeError("REVISION_CONFLICT", "Event revision changed", {
				currentRevision: event.revision,
			});
		}
		const now = new Date();
		const [reversed] = await transactionDb
			.update(asNeededIntakeEvents)
			.set({
				status: "reversed",
				reversedAt: now,
				reversalIdempotencyKeyHash: keyHash,
				revision: event.revision + 1,
				updatedAt: now,
			})
			.where(
				and(
					eq(asNeededIntakeEvents.id, event.id),
					eq(asNeededIntakeEvents.userId, input.userId),
					eq(asNeededIntakeEvents.status, "active"),
					eq(asNeededIntakeEvents.revision, input.expectedRevision)
				)
			)
			.returning();
		if (!reversed) {
			throw new AsNeededIntakeError("REVISION_CONFLICT", "Event revision changed", {
				currentRevision: event.revision,
			});
		}
		return reversed;
	});
}

export async function deleteAsNeededIntake(userId: number, eventId: string): Promise<void> {
	await withImmediateWriteTransaction(async (transactionDb) => {
		const [event] = await transactionDb
			.select({ doseTrackingId: asNeededIntakeEvents.doseTrackingId })
			.from(asNeededIntakeEvents)
			.where(
				and(
					eq(asNeededIntakeEvents.userId, userId),
					eq(asNeededIntakeEvents.eventId, eventId.trim().toLowerCase()),
					eq(asNeededIntakeEvents.status, "active")
				)
			);
		if (!event) return;

		await transactionDb
			.delete(doseTracking)
			.where(and(eq(doseTracking.id, event.doseTrackingId), eq(doseTracking.userId, userId)));
	});
}
