import { createHash, randomUUID } from "node:crypto";
import { getAsNeededQuantityProfile, normalizeAsNeededQuantityMilli } from "@medassist/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type db, withImmediateWriteTransaction } from "../db/client.js";
import { asNeededIntakeEvents, doseTracking, medications, userSettings } from "../db/schema.js";
import { normalizeMedicationSchedule } from "../utils/scheduler-utils.js";
import { computeMedicationCurrentStockRaw } from "./current-stock.js";

export type AsNeededLifecycle = "active_no_schedule" | "active_scheduled" | "ended" | "obsolete";
export type AsNeededEligibilityReason = "eligible" | "has_regular_schedule" | "ended" | "obsolete";

type MedicationRow = typeof medications.$inferSelect;
type Database = typeof db;

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
			| "REVERSAL_KEY_REUSED",
		message: string
	) {
		super(message);
		this.name = "AsNeededIntakeError";
	}
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
	now = new Date()
): {
	lifecycle: AsNeededLifecycle;
	eligible: boolean;
	reason: AsNeededEligibilityReason;
} {
	if (medication.isObsolete) return { lifecycle: "obsolete", eligible: false, reason: "obsolete" };
	const endDate = medication.medicationEndDate?.trim();
	if (endDate && endDate.slice(0, 10) < now.toISOString().slice(0, 10)) {
		return { lifecycle: "ended", eligible: false, reason: "ended" };
	}
	if (normalizeMedicationSchedule(medication).intakes.length > 0) {
		return { lifecycle: "active_scheduled", eligible: false, reason: "has_regular_schedule" };
	}
	return { lifecycle: "active_no_schedule", eligible: true, reason: "eligible" };
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

export async function createAsNeededIntake(input: {
	userId: number;
	medicationId: number;
	quantity: number;
	personName?: string | null;
	idempotencyKey: string;
	replacesEventId?: string | null;
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
				throw new AsNeededIntakeError("IDEMPOTENCY_KEY_REUSED", "Idempotency key is bound to another request");
			}
			return replay;
		}

		const [medication] = await transactionDb
			.select()
			.from(medications)
			.where(and(eq(medications.userId, input.userId), eq(medications.id, input.medicationId)));
		if (!medication) throw new AsNeededIntakeError("MEDICATION_NOT_FOUND", "Medication not found");

		const profile = getAsNeededQuantityProfile(medication);
		const quantityMilli = normalizeAsNeededQuantityMilli(input.quantity, profile);
		if (quantityMilli === null) throw new AsNeededIntakeError("INVALID_QUANTITY", "Invalid quantity");
		if (personName && !parseMedicationPeople(medication.takenByJson).includes(personName)) {
			throw new AsNeededIntakeError("INVALID_PERSON", "Person is not assigned to this medication");
		}
		if (!getAsNeededLifecycle(medication).eligible) {
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
			replacesEventInternalId = replaced.id;
		}

		const [settings] = await transactionDb
			.select({ stockCalculationMode: userSettings.stockCalculationMode })
			.from(userSettings)
			.where(eq(userSettings.userId, input.userId));
		const doses = await transactionDb.select().from(doseTracking).where(eq(doseTracking.userId, input.userId));
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
			throw new AsNeededIntakeError("INSUFFICIENT_STOCK", "Insufficient current stock");
		}

		const now = new Date();
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
		return event;
	});
}

export async function reverseAsNeededIntake(input: {
	userId: number;
	eventId: string;
	expectedRevision: number;
	idempotencyKey: string;
}) {
	const keyHash = sha256(normalizeIntentKey(input.idempotencyKey));
	return withImmediateWriteTransaction(async (transactionDb) => {
		const [event] = await transactionDb
			.select()
			.from(asNeededIntakeEvents)
			.where(and(eq(asNeededIntakeEvents.userId, input.userId), eq(asNeededIntakeEvents.eventId, input.eventId)));
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
			throw new AsNeededIntakeError("REVISION_CONFLICT", "Event revision changed");
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
		if (!reversed) throw new AsNeededIntakeError("REVISION_CONFLICT", "Event revision changed");
		return reversed;
	});
}
