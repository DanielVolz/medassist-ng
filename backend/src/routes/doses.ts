import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, intakeJournal, medications, shareTokens, userSettings } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { computeMedicationCurrentStock } from "../services/current-stock.js";
import { markDoseTakenForUser } from "../services/dose-tracking-service.js";
import {
	getIntakeJournalForDoseEvent,
	resolveTrackedDoseEventForUser,
	upsertIntakeJournalForDoseEvent,
} from "../services/intake-journal-service.js";
import type { AuthUser } from "../types/fastify.js";
import { toLocalDateTimeOffsetString } from "../utils/local-date-time.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	tokenParamsSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import { redactTokenForLog } from "../utils/redaction.js";
import {
	parseIntakesJson,
	parseLocalDateTime,
	parseTakenByJson,
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
});

const dismissDosesSchema = z.object({
	doseIds: z.array(z.string().min(1)).min(1, "At least one doseId is required"),
});

const protectedEndpointSecurity: ReadonlyArray<Record<string, readonly string[]>> = [
	{ bearerAuth: [] },
	{ cookieAuth: [] },
];

const doseIdPattern = /^(\d+)-(\d+)-(\d+)(?:-(.+))?$/;

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
		takenSource: { type: "string", enum: ["manual", "automatic"] },
		markedBy: { type: ["string", "null"] },
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

type ParsedDoseId = {
	medicationId: number;
	intakeIndex: number;
	timestampMs: number;
	personSuffix: string | null;
};

function parseDoseId(doseId: string): ParsedDoseId | null {
	const match = doseIdPattern.exec(doseId);
	if (!match) return null;

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

async function getActiveShareToken(token: string): Promise<{
	share: typeof shareTokens.$inferSelect | null;
	reason: "not_found" | "expired" | "ok";
}> {
	const [share] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
	if (!share) return { share: null, reason: "not_found" };

	if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
		return { share: null, reason: "expired" };
	}

	return { share, reason: "ok" };
}

async function validateShareDoseId(share: typeof shareTokens.$inferSelect, doseId: string): Promise<boolean> {
	const parsedDose = parseDoseId(doseId);
	if (!parsedDose) {
		return false;
	}

	if (!isDoseInsideShareScheduleWindow(share, parsedDose)) {
		return false;
	}

	const [medication] = await db
		.select()
		.from(medications)
		.where(and(eq(medications.id, parsedDose.medicationId), eq(medications.userId, share.userId)));

	if (!medication) {
		return false;
	}

	const medTakenBy = parseTakenByJson(medication.takenByJson);
	const intakes = parseIntakesJson(
		medication.intakesJson,
		{ usageJson: medication.usageJson, everyJson: medication.everyJson, startJson: medication.startJson },
		medication.intakeRemindersEnabled ?? false
	);

	if (!personTakesMedication(share.takenBy, medTakenBy, intakes)) {
		return false;
	}

	const intake = intakes[parsedDose.intakeIndex];
	if (!intake) {
		return false;
	}

	const expectedPersons = intake.takenBy ? [intake.takenBy] : medTakenBy;
	if (expectedPersons.length === 0) {
		return parsedDose.personSuffix === null;
	}

	if (!parsedDose.personSuffix) {
		return intake.takenBy === null;
	}

	return expectedPersons.includes(parsedDose.personSuffix);
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
			stockCalculationMode: options.stockCalculationMode,
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

			const status = await markDoseSkippedForUser({ userId, doseId: parsed.data.doseId });
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
				rateLimit: {
					max: 60,
					timeWindow: "1 minute",
					errorResponseBuilder: () => ({ error: "rate_limited" }),
				},
			},
		},
		async (request, reply) => {
			const { token } = request.params;
			const tokenRef = redactTokenForLog(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share) {
				request.log.warn(`[ShareDose] Rejected read: tokenRef=${tokenRef}, reason=${reason}`);
				return reply.notFound("Share link not found");
			}

			// Keep public dose reads scoped to the selected share person and visible schedule window.
			const doses = await db.select().from(doseTracking).where(eq(doseTracking.userId, share.userId));
			const visibleDoses: (typeof doseTracking.$inferSelect)[] = [];
			for (const dose of doses) {
				if (await validateShareDoseId(share, dose.doseId)) {
					visibleDoses.push(dose);
				}
			}

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
			const tokenRef = redactTokenForLog(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share) {
				request.log.warn(`[ShareJournal] Rejected read: tokenRef=${tokenRef}, doseId=${doseId}, reason=${reason}`);
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
			const tokenRef = redactTokenForLog(token);

			const parsed = shareJournalUpsertSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({ error: getValidationErrorMessage(parsed.error), code: "VALIDATION_ERROR" });
			}

			const normalizedNote = parsed.data.note.trim();
			if (normalizedNote.length === 0) {
				return reply.status(400).send({ error: "Journal note cannot be empty", code: "EMPTY_NOTE" });
			}

			const { share, reason } = await getActiveShareToken(token);
			if (!share) {
				request.log.warn(`[ShareJournal] Rejected save: tokenRef=${tokenRef}, doseId=${doseId}, reason=${reason}`);
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
			});

			return { entry: buildSharedJournalEntryDto({ event, journalEntry }) };
		}
	);

	app.delete<{ Params: { token: string; doseId: string } }>(
		"/share/:token/journal/event/:doseId",
		{
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
			const tokenRef = redactTokenForLog(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share) {
				request.log.warn(`[ShareJournal] Rejected delete: tokenRef=${tokenRef}, doseId=${doseId}, reason=${reason}`);
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
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { token } = request.params;
			const tokenRef = redactTokenForLog(token);

			const parsed = shareDoseSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({ error: getValidationErrorMessage(parsed.error) });
			}

			const { doseId } = parsed.data;
			const { share, reason } = await getActiveShareToken(token);
			if (!share) {
				request.log.warn(`[ShareDose] Rejected skip: tokenRef=${tokenRef}, doseId=${doseId}, reason=${reason}`);
				return reply.notFound("Share link not found");
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				request.log.warn(
					`[ShareDose] Rejected invalid doseId in skip request: tokenRef=${tokenRef}, ownerUserId=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId}`
				);
				return reply.status(400).send({ error: "Invalid or unauthorized doseId" });
			}

			const status = await markDoseSkippedForUser({ userId: share.userId, doseId });
			if (status === "already_skipped") {
				return { success: true, message: "Already skipped" };
			}

			request.log.info(
				`[ShareDose] Dose skipped via share link: tokenRef=${tokenRef}, ownerUserId=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId}`
			);
			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /share/:token/doses/skip/:doseId - PUBLIC: Undo a skipped dose via share link
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { token: string; doseId: string } }>(
		"/share/:token/doses/skip/:doseId",
		{
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
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { token, doseId } = request.params;
			const tokenRef = redactTokenForLog(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share) {
				request.log.warn(`[ShareDose] Rejected undo skip: tokenRef=${tokenRef}, doseId=${doseId}, reason=${reason}`);
				return reply.notFound("Share link not found");
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				request.log.warn(
					`[ShareDose] Rejected invalid doseId in undo skip request: tokenRef=${tokenRef}, ownerUserId=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId}`
				);
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
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { token } = request.params;
			const tokenRef = redactTokenForLog(token);

			const parsed = shareDoseSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: getValidationErrorMessage(parsed.error),
				});
			}

			const { doseId } = parsed.data;

			const { share, reason } = await getActiveShareToken(token);
			if (!share) {
				request.log.warn(`[ShareDose] Rejected mark: tokenRef=${tokenRef}, doseId=${doseId}, reason=${reason}`);
				return reply.notFound("Share link not found");
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				request.log.warn(
					`[ShareDose] Rejected invalid doseId in mark request: tokenRef=${tokenRef}, ownerUserId=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId}`
				);
				return reply.status(400).send({ error: "Invalid or unauthorized doseId" });
			}

			// Check if already marked
			const [existing] = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));

			if (existing) {
				request.log.debug(
					`[ShareDose] Duplicate mark ignored: tokenRef=${tokenRef}, ownerUserId=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId}`
				);
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
					`[ShareDose] Rejected out-of-stock mark request: tokenRef=${tokenRef}, ownerUserId=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId}`
				);
				return reply.status(409).send({ error: "Medication is out of stock", code: "OUT_OF_STOCK" });
			}

			// Insert new record - marked by the shared person, or the concrete intake person for an "all" link.
			const parsedShareDose = parseDoseId(doseId);
			const markedBy = share.takenBy === "all" ? (parsedShareDose?.personSuffix ?? share.takenBy) : share.takenBy;

			await db.insert(doseTracking).values({
				userId: share.userId,
				doseId,
				markedBy,
				takenSource: "manual",
			});

			request.log.info(
				`[ShareDose] Dose marked via share link: tokenRef=${tokenRef}, ownerUserId=${share.userId}, shareTakenBy=${share.takenBy}, markedBy=${markedBy}, doseId=${doseId}`
			);

			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /share/:token/doses/:doseId - PUBLIC: Unmark a dose via share link
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { token: string; doseId: string } }>(
		"/share/:token/doses/:doseId",
		{
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
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { token, doseId } = request.params;
			const tokenRef = redactTokenForLog(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share) {
				request.log.warn(`[ShareDose] Rejected unmark: tokenRef=${tokenRef}, doseId=${doseId}, reason=${reason}`);
				return reply.notFound("Share link not found");
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				request.log.warn(
					`[ShareDose] Rejected invalid doseId in unmark request: tokenRef=${tokenRef}, ownerUserId=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId}`
				);
				return reply.status(400).send({ error: "Invalid or unauthorized doseId" });
			}

			// Check if this dose was dismissed
			const [existing] = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));

			if (existing?.dismissed) {
				// Already dismissed - keep the record as-is
				request.log.debug(
					`[ShareDose] Unmark ignored for dismissed dose: tokenRef=${tokenRef}, ownerUserId=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId}`
				);
			} else {
				// Not dismissed - delete the record entirely
				await db
					.delete(doseTracking)
					.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));
				request.log.info(
					`[ShareDose] Dose unmarked via share link: tokenRef=${tokenRef}, ownerUserId=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId}`
				);
			}

			return { success: true };
		}
	);
}
