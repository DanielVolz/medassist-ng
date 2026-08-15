import { INTAKE_MOODS, normalizeIntakeMood } from "@medassist/shared";
import { and, eq, inArray, like, or } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, intakeJournal, medications, type shareTokens, userSettings } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { getActiveAsNeededStockEffectMilli } from "../services/as-needed-intakes-service.js";
import { computeMedicationCurrentStock } from "../services/current-stock.js";
import { markDoseTakenForUser } from "../services/dose-tracking-service.js";
import {
	getIntakeJournalForDoseEvent,
	resolveTrackedDoseEventForUser,
	upsertIntakeJournalForDoseEvent,
} from "../services/intake-journal-service.js";
import { getActiveShareToken, shareTokenRateLimitKey } from "../services/share-token-service.js";
import type { AuthUser } from "../types/fastify.js";
import { type ParsedDoseId, parseDoseId } from "../utils/dose-id.js";
import { toLocalDateTimeOffsetString } from "../utils/local-date-time.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	tokenParamsSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import { tokenFingerprint, valueFingerprint } from "../utils/redaction.js";
import {
	normalizeMedicationIntakes,
	normalizeMedicationSchedule,
	parseLocalDateTime,
	personTakesMedication,
} from "../utils/scheduler-utils.js";

// =============================================================================
// Validation Schemas
// =============================================================================
const markDoseSchema = z.object({
	doseId: z.string().min(1, "doseId is required"),
});

const shareDoseSchema = z.object({
	doseId: z.string().min(1, "doseId is required"),
});

const shareJournalUpsertSchema = z.object({
	note: z.string().max(4000),
	mood: z.enum(INTAKE_MOODS).nullable().optional(),
});

const dismissDosesSchema = z.object({
	doseIds: z.array(z.string().min(1)).min(1, "At least one doseId is required"),
});

const protectedEndpointSecurity: ReadonlyArray<Record<string, readonly string[]>> = [
	{ bearerAuth: [] },
	{ cookieAuth: [] },
];

const publicShareReadRateLimit = {
	max: 60,
	timeWindow: "1 minute",
	keyGenerator: shareTokenRateLimitKey,
	errorResponseBuilder: () => ({ statusCode: 429, error: "rate_limited" }),
} as const;

const publicShareMutationRateLimit = {
	max: 20,
	timeWindow: "1 minute",
	keyGenerator: shareTokenRateLimitKey,
	errorResponseBuilder: () => ({ statusCode: 429, error: "rate_limited" }),
} as const;

const doseReadResponseSchema = {
	type: "object",
	properties: {
		doses: {
			type: "array",
			items: {
				type: "object",
				properties: {
					doseId: { type: "string" },
					takenAt: { type: "number" },
					markedBy: { type: ["string", "null"] },
					takenSource: { type: "string" },
					dismissed: { type: "boolean" },
					hasJournalNote: { type: "boolean" },
				},
			},
		},
	},
} as const;

const shareJournalEntrySchema = {
	type: "object",
	required: [
		"doseTrackingId",
		"doseId",
		"medicationId",
		"medicationName",
		"scheduledFor",
		"dismissed",
		"takenSource",
		"mood",
		"note",
		"updatedAt",
	],
	properties: {
		doseTrackingId: { type: "integer" },
		doseId: { type: "string" },
		medicationId: { type: "integer" },
		medicationName: { type: "string" },
		scheduledFor: { type: "string", format: "date-time" },
		takenAt: { type: ["string", "null"], format: "date-time" },
		dismissed: { type: "boolean" },
		takenSource: { type: "string", enum: ["manual", "automatic", "notification"] },
		markedBy: { type: ["string", "null"] },
		mood: { type: ["string", "null"], enum: [...INTAKE_MOODS, null] },
		note: { type: ["string", "null"] },
		updatedAt: { type: ["string", "null"], format: "date-time" },
		createdAt: { type: ["string", "null"], format: "date-time" },
	},
	additionalProperties: false,
} as const;

const shareJournalResponseSchema = {
	type: "object",
	required: ["entry"],
	properties: {
		entry: shareJournalEntrySchema,
	},
	additionalProperties: false,
} as const;

function getValidationErrorMessage(error: z.ZodError): string {
	const firstIssue = error.issues[0];
	if (!firstIssue) {
		return "Invalid input";
	}

	return firstIssue.code === "invalid_type" && firstIssue.input === undefined ? "Required" : firstIssue.message;
}

function serializeJournalTakenAt(value: Date | null, dismissed: boolean): string | null {
	if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
		return null;
	}

	if (dismissed && value.getTime() <= 0) {
		return null;
	}

	return value.toISOString();
}

// Helper to get user ID from request
// Returns anonymous user ID when auth is disabled
async function getUserId(request: FastifyRequest, reply: FastifyReply): Promise<number> {
	// If auth is disabled, use the anonymous user
	if (!env.AUTH_ENABLED) {
		return getAnonymousUserId();
	}

	const authUser = request.user as unknown as AuthUser | null;
	if (!authUser) {
		reply.status(401).send({ error: "Not authenticated" });
		throw new Error("AUTH_REQUIRED");
	}
	return authUser.id;
}

type MedicationRow = typeof medications.$inferSelect;

async function loadShareVisibleMedicationMap(
	share: typeof shareTokens.$inferSelect
): Promise<Map<number, MedicationRow>> {
	const shareMedications = await db
		.select()
		.from(medications)
		.where(and(eq(medications.userId, share.userId), eq(medications.isObsolete, false)));

	const visibleMedications = shareMedications.filter((medication) => {
		const schedule = normalizeMedicationSchedule(medication);
		return personTakesMedication(share.takenBy, schedule.takenBy, schedule.intakes);
	});

	return new Map(visibleMedications.map((medication) => [medication.id, medication]));
}

function validateShareDoseIdWithMedicationMap(
	share: typeof shareTokens.$inferSelect,
	doseId: string,
	medicationById: Map<number, MedicationRow>
): boolean {
	const parsedDose = parseDoseId(doseId);
	if (!parsedDose) {
		return false;
	}

	if (!isDoseInsideShareScheduleWindow(share, parsedDose)) {
		return false;
	}

	const medication = medicationById.get(parsedDose.medicationId);
	if (!medication) {
		return false;
	}

	const schedule = normalizeMedicationSchedule(medication);
	const intakes = schedule.intakes;

	if (!personTakesMedication(share.takenBy, schedule.takenBy, intakes)) {
		return false;
	}

	const intake = intakes[parsedDose.intakeIndex];
	if (!intake) {
		return false;
	}

	const expectedPersons = intake.takenBy ? [intake.takenBy] : schedule.takenBy;
	if (expectedPersons.length === 0) {
		return parsedDose.personSuffix === null;
	}

	if (!parsedDose.personSuffix) {
		return intake.takenBy === null;
	}

	return expectedPersons.includes(parsedDose.personSuffix);
}

async function validateShareDoseId(share: typeof shareTokens.$inferSelect, doseId: string): Promise<boolean> {
	const medicationById = await loadShareVisibleMedicationMap(share);
	return validateShareDoseIdWithMedicationMap(share, doseId, medicationById);
}

function hasShareWriteAccess(share: typeof shareTokens.$inferSelect): boolean {
	return share.allowMarkTaken ?? true;
}

function logShareDoseDebug(
	request: FastifyRequest,
	message: string,
	details: { token: string; doseId?: string; ownerUserId?: number; personName?: string | null; reason?: string }
) {
	if (!env.SENSITIVE_LOGGING_ENABLED || env.LOG_LEVEL !== "debug") {
		return;
	}

	request.log.debug(
		`${message}: tokenFingerprint=${tokenFingerprint(details.token)}${details.ownerUserId == null ? "" : `, ownerUserId=${details.ownerUserId}`}${details.reason ? `, reason=${details.reason}` : ""}${details.doseId ? `, doseId=${details.doseId}` : ""}${details.personName ? `, personName=${details.personName}` : ""}`
	);
}

function getLocalDayStartMs(value: Date | number): number {
	const date = typeof value === "number" ? new Date(value) : new Date(value.getTime());
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

function isDoseInsideShareScheduleWindow(share: typeof shareTokens.$inferSelect, parsedDose: ParsedDoseId): boolean {
	const scheduleDays = Math.max(1, share.scheduleDays ?? 30);
	const todayStart = getLocalDayStartMs(new Date());
	const earliestVisible = new Date(todayStart);
	earliestVisible.setDate(earliestVisible.getDate() - (scheduleDays - 1));
	const latestVisibleExclusive = new Date(todayStart);
	latestVisibleExclusive.setDate(latestVisibleExclusive.getDate() + scheduleDays);
	const doseDayStart = getLocalDayStartMs(parsedDose.timestampMs);

	return doseDayStart >= earliestVisible.getTime() && doseDayStart < latestVisibleExclusive.getTime();
}

function isFutureDoseDay(parsedDose: ParsedDoseId): boolean {
	return getLocalDayStartMs(parsedDose.timestampMs) > getLocalDayStartMs(new Date());
}

function getExpectedShareMarkedBy(share: typeof shareTokens.$inferSelect, parsedDose: ParsedDoseId): string {
	if (share.takenBy !== "all") return share.takenBy;
	return parsedDose.personSuffix ?? "all";
}

function isDoseMarkedOutsideShareLink(
	share: typeof shareTokens.$inferSelect,
	parsedDose: ParsedDoseId,
	existing: typeof doseTracking.$inferSelect
): boolean {
	if (existing.dismissed) return false;
	return existing.markedBy !== getExpectedShareMarkedBy(share, parsedDose);
}

async function isDoseOutOfStock(options: {
	userId: number;
	doseId: string;
	stockCalculationMode: "automatic" | "manual";
}): Promise<boolean> {
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

	const intakes = normalizeMedicationIntakes(medication);
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
	const asNeededStockEffectMilli = await getActiveAsNeededStockEffectMilli(db, options.userId, medication.id);
	const stockBeforeDoseMs = Math.max(0, scheduledOccurrenceMs - 1);
	return (
		computeMedicationCurrentStock({
			medication,
			doses,
			stockCalculationMode: options.stockCalculationMode,
			asNeededStockEffectMilli,
			nowMs: stockBeforeDoseMs,
		}) <= 0
	);
}

async function markDoseSkippedForUser(input: {
	userId: number;
	doseId: string;
}): Promise<"created" | "updated" | "already_skipped"> {
	const [existing] = await db
		.select()
		.from(doseTracking)
		.where(and(eq(doseTracking.userId, input.userId), eq(doseTracking.doseId, input.doseId)));

	if (existing) {
		if (existing.dismissed) {
			return "already_skipped";
		}

		await db
			.update(doseTracking)
			.set({ dismissed: true })
			.where(and(eq(doseTracking.userId, input.userId), eq(doseTracking.doseId, input.doseId)));
		return "updated";
	}

	await db.insert(doseTracking).values({
		userId: input.userId,
		doseId: input.doseId,
		markedBy: null,
		takenAt: new Date(0),
		dismissed: true,
	});

	return "created";
}

async function undoDoseSkippedForUser(input: { userId: number; doseId: string }): Promise<boolean> {
	const [existing] = await db
		.select()
		.from(doseTracking)
		.where(and(eq(doseTracking.userId, input.userId), eq(doseTracking.doseId, input.doseId)));

	if (!existing?.dismissed) {
		return false;
	}

	const hasRealTakenTimestamp =
		existing.takenAt instanceof Date ? existing.takenAt.getTime() > 0 : Boolean(existing.takenAt);
	if (existing.markedBy !== null || hasRealTakenTimestamp) {
		await db.update(doseTracking).set({ dismissed: false }).where(eq(doseTracking.id, existing.id));
		return true;
	}

	await db.delete(doseTracking).where(eq(doseTracking.id, existing.id));
	return true;
}

function buildSharedJournalEntryDto(input: {
	event: NonNullable<Awaited<ReturnType<typeof resolveTrackedDoseEventForUser>>>;
	journalEntry: Awaited<ReturnType<typeof getIntakeJournalForDoseEvent>>;
}) {
	const { event, journalEntry } = input;

	return {
		doseTrackingId: event.doseTrackingId,
		doseId: event.doseId,
		medicationId: event.medicationId,
		medicationName: event.medicationName,
		scheduledFor: toLocalDateTimeOffsetString(journalEntry?.scheduledFor ?? event.scheduledFor),
		takenAt: serializeJournalTakenAt(event.takenAt, event.dismissed),
		dismissed: event.dismissed,
		takenSource: event.takenSource,
		markedBy: event.markedBy,
		mood: normalizeIntakeMood(journalEntry?.mood),
		note: journalEntry?.note ?? null,
		updatedAt: journalEntry?.updatedAt?.toISOString() ?? null,
		createdAt: journalEntry?.createdAt?.toISOString() ?? null,
	};
}

// =============================================================================
// Dose Tracking Routes
// =============================================================================
export async function doseRoutes(app: FastifyInstance) {
	applyOpenApiRouteStandards(app, {
		tag: "doses",
		protectedByDefault: false,
		protectedPaths: [
			/^\/doses\/taken$/,
			/^\/doses\/taken\/:doseId$/,
			/^\/doses\/dismiss$/,
			/^\/doses\/skip$/,
			/^\/doses\/skip\/:doseId$/,
		],
	});

	// ---------------------------------------------------------------------------
	// GET /doses/taken - PROTECTED: Get all taken doses for the user
	// Suppress request logs — polled every 5s by frontend
	// ---------------------------------------------------------------------------
	app.get(
		"/doses/taken",
		{
			preHandler: requireAuth,
			logLevel: "warn",
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				response: {
					200: doseReadResponseSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			// Get all taken doses for this user (no time limit)
			const doses = await db.select().from(doseTracking).where(eq(doseTracking.userId, userId));

			return {
				doses: doses.map((d) => ({
					doseId: d.doseId,
					takenAt: d.takenAt?.getTime() ?? Date.now(),
					markedBy: d.markedBy,
					takenSource: d.takenSource ?? "manual",
					dismissed: d.dismissed ?? false,
				})),
			};
		}
	);

	// ---------------------------------------------------------------------------
	// POST /doses/taken - PROTECTED: Mark a dose as taken
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof markDoseSchema> }>(
		"/doses/taken",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				body: {
					type: "object",
					properties: {
						doseId: { type: "string" },
					},
					example: {
						doseId: "1:2026-03-11T08:00:00.000Z:Daniel",
					},
				},
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							message: { type: "string" },
						},
					},
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					409: genericErrorSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			const parsed = markDoseSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: getValidationErrorMessage(parsed.error),
				});
			}

			const { doseId } = parsed.data;

			const result = await markDoseTakenForUser({
				userId,
				doseId,
				source: "manual",
				markedBy: null,
			});

			if (!result.success) {
				const statusCode = result.code === "INVALID_DOSE" ? 400 : 409;
				return reply.status(statusCode).send({ error: result.message, code: result.code });
			}

			if (result.status === "already_taken") {
				return { success: true, message: "Already marked" };
			}

			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /doses/taken/:doseId - PROTECTED: Unmark a dose
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { doseId: string } }>(
		"/doses/taken/:doseId",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				params: {
					type: "object",
					required: ["doseId"],
					properties: {
						doseId: { type: "string", minLength: 1 },
					},
				},
				response: {
					200: { type: "object", properties: { success: { type: "boolean" } } },
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			const { doseId } = request.params;

			// Check if this dose was dismissed
			const [existing] = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, userId), eq(doseTracking.doseId, doseId)));

			if (existing?.dismissed) {
				// Already dismissed - keep the record as-is
				// The dose stays dismissed, we just acknowledge the undo request
			} else {
				// Not dismissed - delete the record entirely
				await db.delete(doseTracking).where(and(eq(doseTracking.userId, userId), eq(doseTracking.doseId, doseId)));
			}

			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// POST /doses/skip - PROTECTED: Mark a single dose as skipped
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof markDoseSchema> }>(
		"/doses/skip",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				body: {
					type: "object",
					required: ["doseId"],
					properties: {
						doseId: { type: "string", minLength: 1 },
					},
				},
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							message: { type: "string" },
						},
					},
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					409: genericErrorSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const parsed = markDoseSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({ error: getValidationErrorMessage(parsed.error) });
			}

			const { doseId } = parsed.data;
			const parsedDose = parseDoseId(doseId);
			if (parsedDose && isFutureDoseDay(parsedDose)) {
				return reply.status(409).send({
					error: "Future doses cannot be skipped",
					code: "FUTURE_DOSE",
				});
			}

			const status = await markDoseSkippedForUser({ userId, doseId });
			if (status === "already_skipped") {
				return { success: true, message: "Already skipped" };
			}

			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /doses/skip/:doseId - PROTECTED: Undo a single skipped dose
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { doseId: string } }>(
		"/doses/skip/:doseId",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				params: {
					type: "object",
					required: ["doseId"],
					properties: {
						doseId: { type: "string", minLength: 1 },
					},
				},
				response: {
					200: { type: "object", properties: { success: { type: "boolean" } } },
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			await undoDoseSkippedForUser({ userId, doseId: request.params.doseId });

			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// POST /doses/dismiss - PROTECTED: Dismiss missed doses without deducting stock
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof dismissDosesSchema> }>(
		"/doses/dismiss",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				body: {
					type: "object",
					properties: {
						doseIds: { type: "array", items: { type: "string" } },
					},
					example: {
						doseIds: ["1:2026-03-11T08:00:00.000Z:Daniel", "1:2026-03-11T20:00:00.000Z:Daniel"],
					},
				},
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							dismissedCount: { type: "integer" },
						},
					},
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					409: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			const parsed = dismissDosesSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: getValidationErrorMessage(parsed.error),
				});
			}

			const { doseIds } = parsed.data;
			const hasFutureDose = doseIds.some((doseId) => {
				const parsedDose = parseDoseId(doseId);
				return parsedDose ? isFutureDoseDay(parsedDose) : false;
			});
			if (hasFutureDose) {
				return reply.status(409).send({
					error: "Future doses cannot be skipped",
					code: "FUTURE_DOSE",
				});
			}

			// Preserve the existing route semantics for dismiss: any non-dismissed record
			// becomes dismissed, regardless of whether it already has a taken timestamp.
			let dismissedCount = 0;
			for (const doseId of doseIds) {
				const status = await markDoseSkippedForUser({ userId, doseId });
				if (status !== "already_skipped") {
					dismissedCount++;
				}
			}

			return { success: true, dismissedCount };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /doses/dismiss - PROTECTED: Clear all dismissed doses (un-dismiss)
	// ---------------------------------------------------------------------------
	app.delete(
		"/doses/dismiss",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							clearedCount: { type: "integer" },
						},
					},
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			// Delete all dismissed-only records (not taken ones)
			// For taken+dismissed, just remove the dismissed flag
			const dismissed = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, userId), eq(doseTracking.dismissed, true)));

			for (const d of dismissed) {
				const hasRealTakenTimestamp = d.takenAt instanceof Date ? d.takenAt.getTime() > 0 : Boolean(d.takenAt);

				if (d.markedBy !== null || hasRealTakenTimestamp) {
					// This was also marked as taken - just remove dismissed flag
					await db.update(doseTracking).set({ dismissed: false }).where(eq(doseTracking.id, d.id));
				} else {
					// This was only dismissed - delete it
					await db.delete(doseTracking).where(eq(doseTracking.id, d.id));
				}
			}

			return { success: true, clearedCount: dismissed.length };
		}
	);

	// ---------------------------------------------------------------------------
	// GET /share/:token/doses - PUBLIC: Get taken doses for a share link
	// Suppress request logs — polled every 5s by SharedSchedule
	// ---------------------------------------------------------------------------
	app.get<{ Params: { token: string } }>(
		"/share/:token/doses",
		{
			schema: {
				params: tokenParamsSchema,
				response: {
					200: doseReadResponseSchema,
					404: genericErrorSchema,
				},
			},
			logLevel: "warn",
			config: {
				rateLimit: publicShareReadRateLimit,
			},
		},
		async (request, reply) => {
			const { token } = request.params;
			const fingerprint = tokenFingerprint(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share || reason !== "ok") {
				request.log.warn(`[ShareDose] Rejected read: tokenFingerprint=${fingerprint}, reason=${reason}`);
				return reply.notFound("Share link not found");
			}

			// Keep public dose reads scoped to the selected share person and visible schedule window.
			const medicationById = await loadShareVisibleMedicationMap(share);
			const visibleMedicationIds = [...medicationById.keys()];
			let doses: (typeof doseTracking.$inferSelect)[] = [];
			if (visibleMedicationIds.length > 0) {
				const medicationDoseFilter =
					visibleMedicationIds.length === 1
						? like(doseTracking.doseId, `${visibleMedicationIds[0]}-%`)
						: or(...visibleMedicationIds.map((medicationId) => like(doseTracking.doseId, `${medicationId}-%`)));
				doses = await db
					.select()
					.from(doseTracking)
					.where(and(eq(doseTracking.userId, share.userId), medicationDoseFilter));
			}
			const visibleDoses = doses.filter((dose) =>
				validateShareDoseIdWithMedicationMap(share, dose.doseId, medicationById)
			);

			const journalDoseTrackingIds = new Set<number>();
			if ((share.allowJournalNotes ?? false) && visibleDoses.length > 0) {
				const journalRows = await db
					.select({ doseTrackingId: intakeJournal.doseTrackingId })
					.from(intakeJournal)
					.where(
						and(
							eq(intakeJournal.userId, share.userId),
							inArray(
								intakeJournal.doseTrackingId,
								visibleDoses.map((dose) => dose.id)
							)
						)
					);

				for (const row of journalRows) {
					journalDoseTrackingIds.add(row.doseTrackingId);
				}
			}

			return {
				doses: visibleDoses.map((d) => ({
					doseId: d.doseId,
					takenAt: d.takenAt?.getTime() ?? Date.now(),
					markedBy: d.markedBy,
					takenSource: d.takenSource ?? "manual",
					dismissed: d.dismissed ?? false,
					hasJournalNote: journalDoseTrackingIds.has(d.id),
				})),
			};
		}
	);

	app.get<{ Params: { token: string; doseId: string } }>(
		"/share/:token/journal/event/:doseId",
		{
			logLevel: "warn",
			schema: {
				params: {
					type: "object",
					required: ["token", "doseId"],
					properties: {
						token: tokenParamsSchema.properties.token,
						doseId: { type: "string", minLength: 1 },
					},
				},
				response: {
					200: shareJournalResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					403: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { token, doseId } = request.params;
			const fingerprint = tokenFingerprint(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share || reason !== "ok") {
				request.log.warn(
					`[ShareJournal] Rejected read: tokenFingerprint=${fingerprint}, doseIdFingerprint=${valueFingerprint(doseId)}, reason=${reason}`
				);
				logShareDoseDebug(request, "[ShareJournal] Sensitive rejected read details", { token, doseId, reason });
				return reply.notFound("Share link not found");
			}

			if (!(share.allowJournalNotes ?? false)) {
				return reply
					.status(403)
					.send({ error: "Journal notes are not enabled for this share link", code: "NOT_ENABLED" });
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				return reply.status(400).send({ error: "Invalid or unauthorized doseId", code: "INVALID_DOSE" });
			}

			const event = await resolveTrackedDoseEventForUser({ userId: share.userId, doseId });
			if (!event) {
				return reply
					.status(404)
					.send({ error: "Tracked dose event not found for this share link", code: "DOSE_NOT_FOUND" });
			}

			const journalEntry = await getIntakeJournalForDoseEvent({ userId: share.userId, doseId });
			return { entry: buildSharedJournalEntryDto({ event, journalEntry }) };
		}
	);

	app.put<{ Params: { token: string; doseId: string }; Body: z.infer<typeof shareJournalUpsertSchema> }>(
		"/share/:token/journal/event/:doseId",
		{
			logLevel: "warn",
			schema: {
				params: {
					type: "object",
					required: ["token", "doseId"],
					properties: {
						token: tokenParamsSchema.properties.token,
						doseId: { type: "string", minLength: 1 },
					},
				},
				body: {
					type: "object",
					required: ["note"],
					properties: {
						note: { type: "string", maxLength: 4000 },
						mood: { type: ["string", "null"], enum: [...INTAKE_MOODS, null] },
					},
					additionalProperties: false,
				},
				response: {
					200: shareJournalResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					403: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { token, doseId } = request.params;
			const fingerprint = tokenFingerprint(token);

			const parsed = shareJournalUpsertSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({ error: getValidationErrorMessage(parsed.error), code: "VALIDATION_ERROR" });
			}

			const normalizedNote = parsed.data.note.trim();
			const normalizedMood = parsed.data.mood ?? null;
			if (normalizedNote.length === 0 && normalizedMood === null) {
				return reply.status(400).send({ error: "Journal note cannot be empty", code: "EMPTY_NOTE" });
			}

			const { share, reason } = await getActiveShareToken(token);
			if (!share || reason !== "ok") {
				request.log.warn(
					`[ShareJournal] Rejected save: tokenFingerprint=${fingerprint}, doseIdFingerprint=${valueFingerprint(doseId)}, reason=${reason}`
				);
				logShareDoseDebug(request, "[ShareJournal] Sensitive rejected save details", { token, doseId, reason });
				return reply.notFound("Share link not found");
			}

			if (!(share.allowJournalNotes ?? false)) {
				return reply
					.status(403)
					.send({ error: "Journal notes are not enabled for this share link", code: "NOT_ENABLED" });
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				return reply.status(400).send({ error: "Invalid or unauthorized doseId", code: "INVALID_DOSE" });
			}

			const event = await resolveTrackedDoseEventForUser({ userId: share.userId, doseId });
			if (!event) {
				return reply
					.status(404)
					.send({ error: "Tracked dose event not found for this share link", code: "DOSE_NOT_FOUND" });
			}

			const journalEntry = await upsertIntakeJournalForDoseEvent({
				userId: share.userId,
				doseId,
				note: normalizedNote,
				mood: normalizedMood,
			});

			return { entry: buildSharedJournalEntryDto({ event, journalEntry }) };
		}
	);

	app.delete<{ Params: { token: string; doseId: string } }>(
		"/share/:token/journal/event/:doseId",
		{
			logLevel: "warn",
			schema: {
				params: {
					type: "object",
					required: ["token", "doseId"],
					properties: {
						token: tokenParamsSchema.properties.token,
						doseId: { type: "string", minLength: 1 },
					},
				},
				response: {
					403: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { token, doseId } = request.params;
			const fingerprint = tokenFingerprint(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share || reason !== "ok") {
				request.log.warn(
					`[ShareJournal] Rejected delete: tokenFingerprint=${fingerprint}, doseIdFingerprint=${valueFingerprint(doseId)}, reason=${reason}`
				);
				logShareDoseDebug(request, "[ShareJournal] Sensitive rejected delete details", { token, doseId, reason });
				return reply.notFound("Share link not found");
			}

			if (!(share.allowJournalNotes ?? false)) {
				return reply
					.status(403)
					.send({ error: "Journal notes are not enabled for this share link", code: "NOT_ENABLED" });
			}

			return reply.status(403).send({ error: "Shared links cannot delete journal notes", code: "DELETE_NOT_ALLOWED" });
		}
	);

	// ---------------------------------------------------------------------------
	// POST /share/:token/doses/skip - PUBLIC: Mark a dose as skipped via share link
	// ---------------------------------------------------------------------------
	app.post<{ Params: { token: string }; Body: z.infer<typeof shareDoseSchema> }>(
		"/share/:token/doses/skip",
		{
			logLevel: "warn",
			schema: {
				params: tokenParamsSchema,
				body: {
					type: "object",
					required: ["doseId"],
					properties: {
						doseId: { type: "string", minLength: 1 },
					},
				},
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							message: { type: "string" },
						},
					},
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					403: genericErrorSchema,
					409: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
			config: {
				rateLimit: publicShareMutationRateLimit,
			},
		},
		async (request, reply) => {
			const { token } = request.params;
			const fingerprint = tokenFingerprint(token);

			const parsed = shareDoseSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({ error: getValidationErrorMessage(parsed.error) });
			}

			const { doseId } = parsed.data;
			const { share, reason } = await getActiveShareToken(token);
			if (!share || reason !== "ok") {
				request.log.warn(
					`[ShareDose] Rejected skip: tokenFingerprint=${fingerprint}, doseIdFingerprint=${valueFingerprint(doseId)}, reason=${reason}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive rejected skip details", { token, doseId, reason });
				return reply.notFound("Share link not found");
			}

			if (!hasShareWriteAccess(share)) {
				request.log.warn(
					`[ShareDose] Rejected read-only skip: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive read-only skip details", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
				return reply.status(403).send({ error: "Share link is read-only", code: "READ_ONLY" });
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				request.log.warn(
					`[ShareDose] Rejected invalid dose in skip request: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}, doseIdFingerprint=${valueFingerprint(doseId)}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive invalid skip details", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
				return reply.status(400).send({ error: "Invalid or unauthorized doseId" });
			}

			const parsedShareDose = parseDoseId(doseId);
			if (parsedShareDose && isFutureDoseDay(parsedShareDose)) {
				return reply.status(409).send({
					error: "Future doses cannot be skipped via share link",
					code: "FUTURE_DOSE",
				});
			}

			const [existing] = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));
			if (existing && parsedShareDose && isDoseMarkedOutsideShareLink(share, parsedShareDose, existing)) {
				return reply.status(409).send({
					error: "Dose was already marked as taken in the main app",
					code: "MAIN_APP_TAKEN",
				});
			}

			const status = await markDoseSkippedForUser({ userId: share.userId, doseId });
			if (status === "already_skipped") {
				return { success: true, message: "Already skipped" };
			}

			request.log.info(
				`[ShareDose] Dose skipped via share link: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}, doseIdFingerprint=${valueFingerprint(doseId)}`
			);
			logShareDoseDebug(request, "[ShareDose] Sensitive skipped dose details", {
				token,
				doseId,
				ownerUserId: share.userId,
				personName: share.takenBy,
			});
			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /share/:token/doses/skip/:doseId - PUBLIC: Undo a skipped dose via share link
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { token: string; doseId: string } }>(
		"/share/:token/doses/skip/:doseId",
		{
			logLevel: "warn",
			schema: {
				params: {
					type: "object",
					required: ["token", "doseId"],
					properties: {
						token: tokenParamsSchema.properties.token,
						doseId: { type: "string", minLength: 1 },
					},
				},
				response: {
					200: { type: "object", properties: { success: { type: "boolean" } } },
					400: genericErrorSchema,
					403: genericErrorSchema,
					409: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
			config: {
				rateLimit: publicShareMutationRateLimit,
			},
		},
		async (request, reply) => {
			const { token, doseId } = request.params;
			const fingerprint = tokenFingerprint(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share || reason !== "ok") {
				request.log.warn(
					`[ShareDose] Rejected undo skip: tokenFingerprint=${fingerprint}, doseIdFingerprint=${valueFingerprint(doseId)}, reason=${reason}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive rejected undo skip details", { token, doseId, reason });
				return reply.notFound("Share link not found");
			}

			if (!hasShareWriteAccess(share)) {
				request.log.warn(
					`[ShareDose] Rejected read-only undo skip: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive read-only undo skip details", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
				return reply.status(403).send({ error: "Share link is read-only", code: "READ_ONLY" });
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				request.log.warn(
					`[ShareDose] Rejected invalid dose in undo skip request: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}, doseIdFingerprint=${valueFingerprint(doseId)}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive invalid undo skip details", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
				return reply.status(400).send({ error: "Invalid or unauthorized doseId" });
			}

			await undoDoseSkippedForUser({ userId: share.userId, doseId });
			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// POST /share/:token/doses - PUBLIC: Mark a dose as taken via share link
	// ---------------------------------------------------------------------------
	app.post<{ Params: { token: string }; Body: z.infer<typeof shareDoseSchema> }>(
		"/share/:token/doses",
		{
			logLevel: "warn",
			schema: {
				params: tokenParamsSchema,
				body: {
					type: "object",
					properties: {
						doseId: { type: "string" },
					},
					example: {
						doseId: "1:2026-03-11T08:00:00.000Z:Daniel",
					},
				},
				response: {
					200: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" } } },
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					409: genericErrorSchema,
					403: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
			config: {
				rateLimit: publicShareMutationRateLimit,
			},
		},
		async (request, reply) => {
			const { token } = request.params;
			const fingerprint = tokenFingerprint(token);

			const parsed = shareDoseSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: getValidationErrorMessage(parsed.error),
				});
			}

			const { doseId } = parsed.data;

			const { share, reason } = await getActiveShareToken(token);
			if (!share || reason !== "ok") {
				request.log.warn(
					`[ShareDose] Rejected mark: tokenFingerprint=${fingerprint}, doseIdFingerprint=${valueFingerprint(doseId)}, reason=${reason}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive rejected mark details", { token, doseId, reason });
				return reply.notFound("Share link not found");
			}

			if (!hasShareWriteAccess(share)) {
				request.log.warn(
					`[ShareDose] Rejected read-only mark: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive read-only mark details", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
				return reply.status(403).send({ error: "Share link is read-only", code: "READ_ONLY" });
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				request.log.warn(
					`[ShareDose] Rejected invalid dose in mark request: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}, doseIdFingerprint=${valueFingerprint(doseId)}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive invalid mark details", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
				return reply.status(400).send({ error: "Invalid or unauthorized doseId" });
			}

			const parsedShareDose = parseDoseId(doseId);
			if (parsedShareDose && isFutureDoseDay(parsedShareDose)) {
				return reply.status(409).send({
					error: "Future doses cannot be marked as taken via share link",
					code: "FUTURE_DOSE",
				});
			}

			// Check if already marked
			const [existing] = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));

			if (existing) {
				if (parsedShareDose && isDoseMarkedOutsideShareLink(share, parsedShareDose, existing)) {
					return reply.status(409).send({
						error: "Dose was already marked as taken in the main app",
						code: "MAIN_APP_TAKEN",
					});
				}
				logShareDoseDebug(request, "[ShareDose] Duplicate mark ignored", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
				return { success: true, message: "Already marked" };
			}

			const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, share.userId));
			const outOfStock = await isDoseOutOfStock({
				userId: share.userId,
				doseId,
				stockCalculationMode: (settings?.stockCalculationMode as "automatic" | "manual") ?? "automatic",
			});
			if (outOfStock) {
				request.log.info(
					`[ShareDose] Rejected out-of-stock mark request: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}, doseIdFingerprint=${valueFingerprint(doseId)}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive out-of-stock mark details", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
				return reply.status(409).send({ error: "Medication is out of stock", code: "OUT_OF_STOCK" });
			}

			// Insert new record - marked by the shared person, or the concrete intake person for an "all" link.
			const markedBy = share.takenBy === "all" ? (parsedShareDose?.personSuffix ?? share.takenBy) : share.takenBy;

			await db.insert(doseTracking).values({
				userId: share.userId,
				doseId,
				markedBy,
				takenSource: "manual",
			});

			request.log.info(
				`[ShareDose] Dose marked via share link: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}, doseIdFingerprint=${valueFingerprint(doseId)}`
			);
			logShareDoseDebug(request, "[ShareDose] Sensitive marked dose details", {
				token,
				doseId,
				ownerUserId: share.userId,
				personName: markedBy,
			});

			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /share/:token/doses/:doseId - PUBLIC: Unmark a dose via share link
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { token: string; doseId: string } }>(
		"/share/:token/doses/:doseId",
		{
			logLevel: "warn",
			schema: {
				params: {
					type: "object",
					required: ["token", "doseId"],
					properties: {
						token: tokenParamsSchema.properties.token,
						doseId: { type: "string", minLength: 1 },
					},
				},
				response: {
					200: { type: "object", properties: { success: { type: "boolean" } } },
					400: genericErrorSchema,
					403: genericErrorSchema,
					409: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
			config: {
				rateLimit: publicShareMutationRateLimit,
			},
		},
		async (request, reply) => {
			const { token, doseId } = request.params;
			const fingerprint = tokenFingerprint(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share || reason !== "ok") {
				request.log.warn(
					`[ShareDose] Rejected unmark: tokenFingerprint=${fingerprint}, doseIdFingerprint=${valueFingerprint(doseId)}, reason=${reason}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive rejected unmark details", { token, doseId, reason });
				return reply.notFound("Share link not found");
			}

			if (!hasShareWriteAccess(share)) {
				request.log.warn(
					`[ShareDose] Rejected read-only unmark: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive read-only unmark details", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
				return reply.status(403).send({ error: "Share link is read-only", code: "READ_ONLY" });
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				request.log.warn(
					`[ShareDose] Rejected invalid dose in unmark request: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}, doseIdFingerprint=${valueFingerprint(doseId)}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive invalid unmark details", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
				return reply.status(400).send({ error: "Invalid or unauthorized doseId" });
			}

			// Check if this dose was dismissed
			const [existing] = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));

			const parsedShareDose = parseDoseId(doseId);
			if (existing && parsedShareDose && isDoseMarkedOutsideShareLink(share, parsedShareDose, existing)) {
				return reply.status(409).send({
					error: "Dose was already marked as taken in the main app",
					code: "MAIN_APP_TAKEN",
				});
			}

			if (existing?.dismissed) {
				// Already dismissed - keep the record as-is
				logShareDoseDebug(request, "[ShareDose] Unmark ignored for dismissed dose", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
			} else {
				// Not dismissed - delete the record entirely
				await db
					.delete(doseTracking)
					.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));
				request.log.info(
					`[ShareDose] Dose unmarked via share link: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}, doseIdFingerprint=${valueFingerprint(doseId)}`
				);
				logShareDoseDebug(request, "[ShareDose] Sensitive unmarked dose details", {
					token,
					doseId,
					ownerUserId: share.userId,
					personName: share.takenBy,
				});
			}

			return { success: true };
		}
	);
}
