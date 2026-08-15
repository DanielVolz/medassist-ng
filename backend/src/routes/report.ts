import {
	AS_NEEDED_QUANTITY_UNITS,
	type AsNeededQuantityUnit,
	INTAKE_MOODS,
	type IntakeMood,
	normalizeIntakeMood,
} from "@medassist/shared";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { asNeededIntakeEvents, doseTracking, intakeJournal, medications, refillHistory } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { filterScheduledDoseRows } from "../services/as-needed-intakes-service.js";
import type { AuthUser } from "../types/fastify.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";

const reportDataSchema = z
	.object({
		medicationIds: z.array(z.number().int().positive()).min(1).max(100),
		startDate: z.string().datetime().optional(),
		endDate: z.string().datetime().optional(),
		takenByFilter: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
	})
	.superRefine((value, ctx) => {
		const hasStartDate = typeof value.startDate === "string";
		const hasEndDate = typeof value.endDate === "string";

		if (hasStartDate !== hasEndDate) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "startDate and endDate must be provided together",
				path: hasStartDate ? ["endDate"] : ["startDate"],
			});
			return;
		}

		if (!hasStartDate || !hasEndDate) {
			return;
		}

		const startDateValue = value.startDate!;
		const endDateValue = value.endDate!;
		const startDate = new Date(startDateValue);
		const endDate = new Date(endDateValue);
		if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Invalid date range",
				path: ["endDate"],
			});
		}
	});

const reportDataBodyOpenApiSchema = {
	type: "object",
	required: ["medicationIds"],
	properties: {
		medicationIds: {
			type: "array",
			minItems: 1,
			maxItems: 100,
			items: { type: "integer", minimum: 1 },
		},
		startDate: {
			type: "string",
			format: "date-time",
		},
		endDate: {
			type: "string",
			format: "date-time",
		},
		takenByFilter: {
			type: "array",
			maxItems: 50,
			items: { type: "string", minLength: 1, maxLength: 100 },
		},
	},
	example: {
		medicationIds: [1, 3, 5],
		startDate: "2026-05-01T00:00:00.000Z",
		endDate: "2026-06-01T00:00:00.000Z",
		takenByFilter: ["Daniel"],
	},
} as const;

const trackedDoseIdPattern = /^(\d+)-(\d+)-(\d+)(?:-(.+))?$/;

function getPersonTagKey(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function matchesTakenByFilter(doseId: string, takenByFilter: Set<string> | null): boolean {
	if (!takenByFilter) return true;
	const match = trackedDoseIdPattern.exec(doseId);
	const takenBy = match?.[4]?.trim();
	if (!takenBy) return false;
	return takenByFilter.has(getPersonTagKey(takenBy));
}

function getDoseTakenByPerson(doseId: string): string | null {
	const match = trackedDoseIdPattern.exec(doseId);
	const takenBy = match?.[4]?.trim();
	return takenBy && takenBy.length > 0 ? takenBy : null;
}

function getDoseScheduledAtMs(doseId: string): number | null {
	const match = trackedDoseIdPattern.exec(doseId);
	if (!match) {
		return null;
	}

	const scheduledAtMs = Number.parseInt(match[3], 10);
	return Number.isNaN(scheduledAtMs) ? null : scheduledAtMs;
}

function isWithinDateRange(timestampMs: number | null, range: { startMs: number; endMs: number } | null): boolean {
	if (!range) {
		return true;
	}

	if (timestampMs === null) {
		return false;
	}

	return timestampMs >= range.startMs && timestampMs < range.endMs;
}

type AsNeededStatus = "active" | "reversed";
type AsNeededStockEffectReason = "applied" | "non_measurable" | "before_correction" | "superseded_by_correction";

type AsNeededReportEntry = {
	eventId: string;
	status: AsNeededStatus;
	occurredAt: string;
	recordedAt: string;
	quantity: number;
	quantityUnit: AsNeededQuantityUnit;
	person: string | null;
	source: "owner_as_needed";
	stockEffect: number;
	stockEffectReason: AsNeededStockEffectReason;
	replacementForEventId: string | null;
	reversedAt: string | null;
	revision: number;
	mood: IntakeMood | null;
	note: string | null;
};

const reportDataResponseSchema = {
	type: "object",
	additionalProperties: {
		type: "object",
		properties: {
			dosesTaken: { type: "integer" },
			automaticDosesTaken: { type: "integer" },
			dosesSkipped: { type: "integer" },
			asNeededIntakesTaken: { type: "integer" },
			asNeededQuantityByUnit: {
				type: "object",
				properties: Object.fromEntries(AS_NEEDED_QUANTITY_UNITS.map((unit) => [unit, { type: "number" }])),
				additionalProperties: false,
			},
			asNeededIntakes: {
				type: "array",
				items: {
					type: "object",
					properties: {
						eventId: { type: "string", format: "uuid" },
						status: { type: "string", enum: ["active", "reversed"] },
						occurredAt: { type: "string", format: "date-time" },
						recordedAt: { type: "string", format: "date-time" },
						quantity: { type: "number" },
						quantityUnit: { type: "string", enum: AS_NEEDED_QUANTITY_UNITS },
						person: { type: ["string", "null"] },
						source: { type: "string", const: "owner_as_needed" },
						stockEffect: { type: "number" },
						stockEffectReason: {
							type: "string",
							enum: ["applied", "non_measurable", "before_correction", "superseded_by_correction"],
						},
						replacementForEventId: { type: ["string", "null"], format: "uuid" },
						reversedAt: { type: ["string", "null"], format: "date-time" },
						revision: { type: "integer", minimum: 1 },
						mood: { type: ["string", "null"], enum: [...INTAKE_MOODS, null] },
						note: { type: ["string", "null"] },
					},
				},
			},
			firstDoseAt: { type: "string" },
			lastDoseAt: { type: "string" },
			moodSummary: {
				type: "object",
				properties: Object.fromEntries(INTAKE_MOODS.map((mood) => [mood, { type: "integer" }])),
				additionalProperties: false,
			},
			journalEntries: {
				type: "array",
				items: {
					type: "object",
					properties: {
						scheduledFor: { type: "string", format: "date-time" },
						takenAt: { type: ["string", "null"], format: "date-time" },
						dismissed: { type: "boolean" },
						takenSource: { type: "string" },
						takenByPerson: { type: ["string", "null"] },
						mood: { type: ["string", "null"], enum: [...INTAKE_MOODS, null] },
						note: { type: ["string", "null"] },
					},
				},
			},
			refills: {
				type: "array",
				items: {
					type: "object",
					properties: {
						packsAdded: { type: "integer" },
						loosePillsAdded: { type: "integer" },
						quantityAdded: { type: "integer" },
						usedPrescription: { type: "boolean" },
						refillDate: { type: "string", format: "date-time" },
					},
				},
			},
		},
	},
} as const;

export async function reportRoutes(app: FastifyInstance) {
	app.addHook("preHandler", requireAuth);
	applyOpenApiRouteStandards(app, { tag: "report", protectedByDefault: true });

	async function getUserId(request: FastifyRequest, reply: FastifyReply): Promise<number> {
		if (!env.AUTH_ENABLED) {
			return getAnonymousUserId();
		}
		const authUser = request.user as unknown as AuthUser | null;
		if (!authUser) {
			reply.status(401).send({ error: "User not authenticated", code: "AUTH_REQUIRED" });
			throw new Error("AUTH_REQUIRED");
		}
		return authUser.id;
	}

	// POST /medications/report-data - Get aggregated dose/refill data for report generation
	app.post(
		"/medications/report-data",
		{
			schema: {
				body: reportDataBodyOpenApiSchema,
				response: {
					200: reportDataResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					403: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const parsed = reportDataSchema.safeParse(req.body);
			if (!parsed.success) return reply.status(400).send(parsed.error.format());

			const userId = await getUserId(req, reply);
			const { medicationIds, startDate, endDate, takenByFilter } = parsed.data;
			const normalizedTakenByFilter = takenByFilter?.length
				? new Set(takenByFilter.map((value) => getPersonTagKey(value)))
				: null;
			const dateRange =
				startDate && endDate
					? {
							startMs: new Date(startDate).getTime(),
							endMs: new Date(endDate).getTime(),
						}
					: null;

			// Verify all medications belong to this user
			const userMeds = await db
				.select({
					id: medications.id,
					packageType: medications.packageType,
					blistersPerPack: medications.blistersPerPack,
					pillsPerBlister: medications.pillsPerBlister,
				})
				.from(medications)
				.where(eq(medications.userId, userId));
			const medMap = new Map(userMeds.map((med) => [med.id, med]));
			const userMedIds = new Set(userMeds.map((m) => m.id));

			for (const id of medicationIds) {
				if (!userMedIds.has(id)) {
					return reply.status(403).send({ error: "Access denied to medication" });
				}
			}

			// Fetch dose tracking for all requested medications
			// doseId format: "{medicationId}-{blisterIndex}-{dateMs}" or "{medicationId}-{blisterIndex}-{dateMs}-{takenBy}"
			const doseRows = await db
				.select({
					id: doseTracking.id,
					doseId: doseTracking.doseId,
					takenAt: doseTracking.takenAt,
					dismissed: doseTracking.dismissed,
					takenSource: doseTracking.takenSource,
				})
				.from(doseTracking)
				.where(eq(doseTracking.userId, userId));
			const allDoses = await filterScheduledDoseRows(db, userId, doseRows);

			// Group doses by medication ID
			const dosesByMed = new Map<
				number,
				{
					id: number;
					doseId: string;
					scheduledAtMs: number | null;
					takenAt: Date;
					dismissed: boolean;
					takenSource: string;
					takenByPerson: string | null;
				}[]
			>();
			const filteredDoseTrackingIds: number[] = [];
			for (const dose of allDoses) {
				const medId = Number.parseInt(dose.doseId.split("-")[0], 10);
				if (Number.isNaN(medId) || !medicationIds.includes(medId)) continue;
				if (!matchesTakenByFilter(dose.doseId, normalizedTakenByFilter)) continue;
				const scheduledAtMs = getDoseScheduledAtMs(dose.doseId);
				if (!isWithinDateRange(scheduledAtMs, dateRange)) continue;
				if (!dosesByMed.has(medId)) dosesByMed.set(medId, []);
				filteredDoseTrackingIds.push(dose.id);
				dosesByMed.get(medId)!.push({
					id: dose.id,
					doseId: dose.doseId,
					scheduledAtMs,
					takenAt: dose.takenAt,
					dismissed: dose.dismissed,
					takenSource: dose.takenSource ?? "manual",
					takenByPerson: getDoseTakenByPerson(dose.doseId),
				});
			}

			const journalByDoseTrackingId = new Map<number, { scheduledFor: Date; mood: IntakeMood | null; note: string }>();
			if (filteredDoseTrackingIds.length > 0) {
				const journalRows = await db
					.select({
						doseTrackingId: intakeJournal.doseTrackingId,
						scheduledFor: intakeJournal.scheduledFor,
						mood: intakeJournal.mood,
						note: intakeJournal.note,
					})
					.from(intakeJournal)
					.where(and(eq(intakeJournal.userId, userId), inArray(intakeJournal.doseTrackingId, filteredDoseTrackingIds)));

				for (const row of journalRows) {
					journalByDoseTrackingId.set(row.doseTrackingId, {
						scheduledFor: row.scheduledFor,
						mood: normalizeIntakeMood(row.mood),
						note: row.note,
					});
				}
			}

			const asNeededFilters = [
				eq(asNeededIntakeEvents.userId, userId),
				inArray(asNeededIntakeEvents.medicationId, medicationIds),
			];
			if (dateRange) {
				asNeededFilters.push(gte(asNeededIntakeEvents.occurredAt, new Date(dateRange.startMs)));
				asNeededFilters.push(lt(asNeededIntakeEvents.occurredAt, new Date(dateRange.endMs)));
			}
			const asNeededRows = await db
				.select({
					event: asNeededIntakeEvents,
					journalMood: intakeJournal.mood,
					journalNote: intakeJournal.note,
				})
				.from(asNeededIntakeEvents)
				.leftJoin(
					intakeJournal,
					and(
						eq(intakeJournal.doseTrackingId, asNeededIntakeEvents.doseTrackingId),
						eq(intakeJournal.userId, asNeededIntakeEvents.userId),
						eq(intakeJournal.medicationId, asNeededIntakeEvents.medicationId)
					)
				)
				.where(and(...asNeededFilters));

			const replacementTargetIds = [
				...new Set(
					asNeededRows
						.map(({ event }) => event.replacesEventId)
						.filter((eventId): eventId is number => eventId !== null)
				),
			];
			const replacementEventIdById = new Map<number, string>();
			if (replacementTargetIds.length > 0) {
				const replacementTargets = await db
					.select({ id: asNeededIntakeEvents.id, eventId: asNeededIntakeEvents.eventId })
					.from(asNeededIntakeEvents)
					.where(and(eq(asNeededIntakeEvents.userId, userId), inArray(asNeededIntakeEvents.id, replacementTargetIds)));
				for (const target of replacementTargets) {
					replacementEventIdById.set(target.id, target.eventId);
				}
			}

			const asNeededRowsByMed = new Map<number, (typeof asNeededRows)[number][]>();
			for (const row of asNeededRows) {
				const person = row.event.personName.trim();
				if (normalizedTakenByFilter && !normalizedTakenByFilter.has(getPersonTagKey(person))) {
					continue;
				}
				const medicationRows = asNeededRowsByMed.get(row.event.medicationId) ?? [];
				medicationRows.push(row);
				asNeededRowsByMed.set(row.event.medicationId, medicationRows);
			}

			// Fetch refill history for requested medications
			const result: Record<
				number,
				{
					dosesTaken: number;
					automaticDosesTaken: number;
					dosesSkipped: number;
					firstDoseAt: string | null;
					lastDoseAt: string | null;
					moodSummary: Record<IntakeMood, number>;
					asNeededIntakesTaken: number;
					asNeededQuantityByUnit: Partial<Record<AsNeededQuantityUnit, number>>;
					asNeededIntakes: AsNeededReportEntry[];
					journalEntries: {
						scheduledFor: string;
						takenAt: string | null;
						dismissed: boolean;
						takenSource: string;
						takenByPerson: string | null;
						mood: IntakeMood | null;
						note: string | null;
					}[];
					refills: {
						packsAdded: number;
						loosePillsAdded: number;
						quantityAdded: number;
						usedPrescription: boolean;
						refillDate: string;
					}[];
				}
			> = {};

			for (const medId of medicationIds) {
				const doses = dosesByMed.get(medId) ?? [];
				const takenDoses = doses.filter((d) => !d.dismissed);
				const automaticTakenDoses = takenDoses.filter((d) => d.takenSource === "automatic");
				const skippedDoses = doses.filter((d) => d.dismissed);
				const asNeededRowsForMedication = asNeededRowsByMed.get(medId) ?? [];

				const sortedTaken = takenDoses.map((d) => d.takenAt.getTime()).sort((a, b) => a - b);
				const moodSummary = Object.fromEntries(INTAKE_MOODS.map((mood) => [mood, 0])) as Record<IntakeMood, number>;
				const journalEntries = doses
					.map((dose) => {
						const journal = journalByDoseTrackingId.get(dose.id);
						if (!journal) {
							return null;
						}

						const mood = journal.mood;
						if (mood) {
							moodSummary[mood] += 1;
						}

						const scheduledFor =
							journal.scheduledFor instanceof Date && !Number.isNaN(journal.scheduledFor.getTime())
								? journal.scheduledFor
								: new Date(dose.scheduledAtMs ?? dose.takenAt.getTime());
						const hasRecordedTakenAt =
							dose.takenAt instanceof Date && !Number.isNaN(dose.takenAt.getTime()) && dose.takenAt.getTime() > 0;

						return {
							scheduledFor: scheduledFor.toISOString(),
							takenAt: hasRecordedTakenAt ? dose.takenAt.toISOString() : null,
							dismissed: dose.dismissed,
							takenSource: dose.takenSource,
							takenByPerson: dose.takenByPerson,
							mood,
							note: journal.note.trim().length > 0 ? journal.note : null,
						};
					})
					.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
					.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
				const asNeededQuantityMilliByUnit: Partial<Record<AsNeededQuantityUnit, number>> = {};
				const asNeededIntakes = asNeededRowsForMedication
					.map(({ event, journalMood, journalNote }): AsNeededReportEntry => {
						const mood = normalizeIntakeMood(journalMood);
						if (event.status === "active") {
							const unit = event.quantityUnit as AsNeededQuantityUnit;
							asNeededQuantityMilliByUnit[unit] = (asNeededQuantityMilliByUnit[unit] ?? 0) + event.quantityMilli;
							if (mood) {
								moodSummary[mood] += 1;
							}
						}
						return {
							eventId: event.eventId,
							status: event.status as AsNeededStatus,
							occurredAt: event.occurredAt.toISOString(),
							recordedAt: event.recordedAt.toISOString(),
							quantity: event.quantityMilli / 1000,
							quantityUnit: event.quantityUnit as AsNeededQuantityUnit,
							person: event.personName.trim().length > 0 ? event.personName : null,
							source: "owner_as_needed",
							stockEffect: event.stockEffectMilli / 1000,
							stockEffectReason: event.stockEffectReason as AsNeededStockEffectReason,
							replacementForEventId: event.replacesEventId
								? (replacementEventIdById.get(event.replacesEventId) ?? null)
								: null,
							reversedAt: event.reversedAt?.toISOString() ?? null,
							revision: event.revision,
							mood,
							note: journalNote && journalNote.trim().length > 0 ? journalNote : null,
						};
					})
					.sort((a, b) => {
						const occurredDifference = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
						return occurredDifference !== 0 ? occurredDifference : b.eventId.localeCompare(a.eventId);
					});
				const asNeededQuantityByUnit = Object.fromEntries(
					Object.entries(asNeededQuantityMilliByUnit).map(([unit, quantityMilli]) => [unit, quantityMilli / 1000])
				) as Partial<Record<AsNeededQuantityUnit, number>>;
				const medication = medMap.get(medId);
				const pillsPerPack = Math.max(1, (medication?.blistersPerPack ?? 1) * (medication?.pillsPerBlister ?? 1));
				const isAmountBased = medication?.packageType === "liquid_container" || medication?.packageType === "tube";

				// Get refills for this medication scoped to the authenticated user.
				const refillFilters = [eq(refillHistory.medicationId, medId), eq(refillHistory.userId, userId)];
				if (dateRange) {
					refillFilters.push(gte(refillHistory.refillDate, new Date(dateRange.startMs)));
					refillFilters.push(lt(refillHistory.refillDate, new Date(dateRange.endMs)));
				}
				const refills = await db
					.select()
					.from(refillHistory)
					.where(and(...refillFilters));

				result[medId] = {
					dosesTaken: takenDoses.length,
					automaticDosesTaken: automaticTakenDoses.length,
					dosesSkipped: skippedDoses.length,
					asNeededIntakesTaken: asNeededRowsForMedication.filter(({ event }) => event.status === "active").length,
					asNeededQuantityByUnit,
					asNeededIntakes,
					firstDoseAt: sortedTaken.length > 0 ? new Date(sortedTaken[0]).toISOString() : null,
					lastDoseAt: sortedTaken.length > 0 ? new Date(sortedTaken[sortedTaken.length - 1]).toISOString() : null,
					moodSummary,
					journalEntries,
					refills: refills.map((r) => ({
						packsAdded: r.packsAdded,
						loosePillsAdded: r.loosePillsAdded,
						quantityAdded: isAmountBased ? r.loosePillsAdded : r.packsAdded * pillsPerPack + r.loosePillsAdded,
						usedPrescription: r.usedPrescription ?? false,
						refillDate: r.refillDate instanceof Date ? r.refillDate.toISOString() : String(r.refillDate),
					})),
				};
			}

			return result;
		}
	);
}
