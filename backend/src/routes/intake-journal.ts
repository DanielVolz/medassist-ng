import { INTAKE_MOODS, normalizeIntakeMood } from "@medassist/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import {
	deleteIntakeJournalForDoseEvent,
	getIntakeJournalForDoseEvent,
	IntakeJournalMutationError,
	isTrackedDoseIdFormat,
	listIntakeJournalEntriesForUser,
	resolveTrackedDoseEventForUser,
	upsertIntakeJournalForDoseEvent,
} from "../services/intake-journal-service.js";
import type { AuthUser } from "../types/fastify.js";
import { toLocalDateTimeOffsetString } from "../utils/local-date-time.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";

const intakeJournalEndpointSecurity: ReadonlyArray<Record<string, readonly string[]>> = [
	{ bearerAuth: [] },
	{ cookieAuth: [] },
];

const doseIdParamsSchema = {
	type: "object",
	required: ["doseId"],
	properties: {
		doseId: { type: "string", minLength: 1 },
	},
} as const;

const intakeJournalEntrySchema = {
	type: "object",
	required: [
		"eventType",
		"eventId",
		"doseTrackingId",
		"doseId",
		"medicationId",
		"medicationName",
		"scheduledFor",
		"occurredAt",
		"status",
		"takenAt",
		"dismissed",
		"takenSource",
		"markedBy",
		"mood",
		"note",
		"createdAt",
		"updatedAt",
	],
	properties: {
		eventType: { type: "string", enum: ["scheduled", "as_needed"] },
		eventId: { type: ["string", "null"], format: "uuid" },
		doseTrackingId: { type: "integer" },
		doseId: { type: "string" },
		medicationId: { type: "integer" },
		medicationName: { type: "string" },
		scheduledFor: { type: ["string", "null"], format: "date-time" },
		occurredAt: { type: ["string", "null"], format: "date-time" },
		status: { type: "string", enum: ["taken", "skipped", "active", "reversed"] },
		takenAt: { type: ["string", "null"], format: "date-time" },
		dismissed: { type: "boolean" },
		takenSource: { type: "string", enum: ["manual", "automatic", "notification", "owner_as_needed"] },
		markedBy: { type: ["string", "null"] },
		mood: { type: ["string", "null"], enum: [...INTAKE_MOODS, null] },
		note: { type: ["string", "null"] },
		updatedAt: { type: ["string", "null"], format: "date-time" },
		createdAt: { type: ["string", "null"], format: "date-time" },
	},
	additionalProperties: false,
} as const;

const intakeJournalEventResponseSchema = {
	type: "object",
	required: ["entry"],
	properties: {
		entry: intakeJournalEntrySchema,
	},
	additionalProperties: false,
} as const;

const intakeJournalHistoryResponseSchema = {
	type: "object",
	required: ["entries"],
	properties: {
		entries: {
			type: "array",
			items: intakeJournalEntrySchema,
		},
	},
	additionalProperties: false,
} as const;

const intakeJournalHistoryQuerySchema = z.object({
	medicationId: z.coerce.number().int().positive().optional(),
	from: z.string().trim().min(1).optional(),
	to: z.string().trim().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

const intakeJournalUpsertSchema = z.object({
	note: z.string().max(4000),
	mood: z.enum(INTAKE_MOODS).nullable().optional(),
});

function getValidationErrorMessage(error: z.ZodError): string {
	const issue = error.issues[0];
	if (!issue) {
		return "Invalid request payload";
	}

	return issue.message;
}

function parseOptionalDate(value: string | undefined): Date | null {
	if (!value) {
		return null;
	}

	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeTakenAt(value: Date | null, dismissed: boolean): string | null {
	if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
		return null;
	}

	if (dismissed && value.getTime() <= 0) {
		return null;
	}

	return value.toISOString();
}

function buildJournalEntryDto(input: {
	event: Awaited<ReturnType<typeof resolveTrackedDoseEventForUser>> extends infer T
		? T extends null
			? never
			: T
		: never;
	journalEntry: Awaited<ReturnType<typeof getIntakeJournalForDoseEvent>>;
}) {
	const { event, journalEntry } = input;
	const scheduledFor =
		event.eventType === "scheduled" && event.scheduledFor
			? toLocalDateTimeOffsetString(journalEntry?.scheduledFor ?? event.scheduledFor)
			: null;

	return {
		eventType: event.eventType,
		eventId: event.eventId,
		doseTrackingId: event.doseTrackingId,
		doseId: event.doseId,
		medicationId: event.medicationId,
		medicationName: event.medicationName,
		scheduledFor,
		occurredAt: event.occurredAt?.toISOString() ?? null,
		status: event.status,
		takenAt: serializeTakenAt(event.takenAt, event.dismissed),
		dismissed: event.dismissed,
		takenSource: event.takenSource,
		markedBy: event.markedBy,
		mood: normalizeIntakeMood(journalEntry?.mood),
		note: journalEntry?.note ?? null,
		updatedAt: journalEntry?.updatedAt?.toISOString() ?? null,
		createdAt: journalEntry?.createdAt?.toISOString() ?? null,
	};
}

function sendJournalMutationError(
	request: FastifyRequest,
	reply: FastifyReply,
	operation: "upsert" | "delete",
	error: unknown
): FastifyReply {
	if (error instanceof IntakeJournalMutationError) {
		return reply.status(409).send({ error: error.message, code: error.code });
	}
	request.log.error({ err: error, operation }, "[IntakeJournal] Owner mutation failed");
	return reply.status(500).send({ error: "Internal server error", code: "INTERNAL_ERROR" });
}

async function getUserId(request: FastifyRequest, reply: FastifyReply): Promise<number> {
	if (!env.AUTH_ENABLED) {
		return getAnonymousUserId();
	}

	const authUser = request.user as AuthUser | null;
	if (!authUser) {
		reply.status(401).send({ error: "Not authenticated" });
		throw new Error("AUTH_REQUIRED");
	}

	return authUser.id;
}

export async function intakeJournalRoutes(app: FastifyInstance) {
	app.addHook("preHandler", requireAuth);
	applyOpenApiRouteStandards(app, { tag: "intake-journal", protectedByDefault: true });

	app.get<{ Querystring: z.infer<typeof intakeJournalHistoryQuerySchema> }>(
		"/intake-journal",
		{
			schema: {
				tags: ["intake-journal"],
				summary: "List intake journal history for the current owner",
				security: intakeJournalEndpointSecurity,
				querystring: {
					type: "object",
					properties: {
						medicationId: { type: "integer", minimum: 1 },
						from: { type: "string", format: "date-time" },
						to: { type: "string", format: "date-time" },
						limit: { type: "integer", minimum: 1, maximum: 200 },
					},
				},
				response: {
					200: intakeJournalHistoryResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const parsed = intakeJournalHistoryQuerySchema.safeParse(request.query);

			if (!parsed.success) {
				return reply.status(400).send({ error: getValidationErrorMessage(parsed.error) });
			}

			const from = parseOptionalDate(parsed.data.from);
			if (parsed.data.from && !from) {
				return reply.status(400).send({ error: "Invalid 'from' date-time filter", code: "INVALID_FROM" });
			}

			const to = parseOptionalDate(parsed.data.to);
			if (parsed.data.to && !to) {
				return reply.status(400).send({ error: "Invalid 'to' date-time filter", code: "INVALID_TO" });
			}

			if (from && to && from.getTime() > to.getTime()) {
				return reply.status(400).send({ error: "'from' must be before or equal to 'to'", code: "INVALID_RANGE" });
			}

			const entries = await listIntakeJournalEntriesForUser({
				userId,
				medicationId: parsed.data.medicationId,
				from: from ?? undefined,
				to: to ?? undefined,
				limit: parsed.data.limit,
			});

			return {
				entries: entries.map((entry) => ({
					eventType: entry.eventType,
					eventId: entry.eventId,
					doseTrackingId: entry.doseTrackingId,
					doseId: entry.doseId,
					medicationId: entry.medicationId,
					medicationName: entry.medicationName,
					scheduledFor:
						entry.eventType === "scheduled" && entry.scheduledFor
							? toLocalDateTimeOffsetString(entry.scheduledFor)
							: null,
					occurredAt: entry.occurredAt?.toISOString() ?? null,
					status: entry.status,
					takenAt: serializeTakenAt(entry.takenAt, entry.dismissed),
					dismissed: entry.dismissed,
					takenSource: entry.takenSource,
					markedBy: entry.markedBy,
					mood: entry.mood,
					note: entry.note,
					updatedAt: entry.updatedAt.toISOString(),
					createdAt: entry.createdAt.toISOString(),
				})),
			};
		}
	);

	app.get<{ Params: { doseId: string } }>(
		"/intake-journal/event/:doseId",
		{
			schema: {
				tags: ["intake-journal"],
				summary: "Get intake journal context for a tracked dose event",
				security: intakeJournalEndpointSecurity,
				params: doseIdParamsSchema,
				response: {
					200: intakeJournalEventResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const { doseId } = request.params;

			if (!isTrackedDoseIdFormat(doseId)) {
				return reply.status(400).send({ error: "Invalid doseId format", code: "INVALID_DOSE" });
			}

			const event = await resolveTrackedDoseEventForUser({ userId, doseId });
			if (!event) {
				return reply
					.status(404)
					.send({ error: "Tracked dose event not found for the current owner", code: "DOSE_NOT_FOUND" });
			}

			const journalEntry = await getIntakeJournalForDoseEvent({ userId, doseId });
			return { entry: buildJournalEntryDto({ event, journalEntry }) };
		}
	);

	app.put<{ Body: z.infer<typeof intakeJournalUpsertSchema>; Params: { doseId: string } }>(
		"/intake-journal/event/:doseId",
		{
			schema: {
				tags: ["intake-journal"],
				summary: "Create or update an intake journal note for a tracked dose event",
				security: intakeJournalEndpointSecurity,
				params: doseIdParamsSchema,
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
					200: intakeJournalEventResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					404: genericErrorSchema,
					409: genericErrorSchema,
					500: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const { doseId } = request.params;

			if (!isTrackedDoseIdFormat(doseId)) {
				return reply.status(400).send({ error: "Invalid doseId format", code: "INVALID_DOSE" });
			}

			const parsed = intakeJournalUpsertSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({ error: getValidationErrorMessage(parsed.error) });
			}

			const event = await resolveTrackedDoseEventForUser({ userId, doseId });
			if (!event) {
				return reply
					.status(404)
					.send({ error: "Tracked dose event not found for the current owner", code: "DOSE_NOT_FOUND" });
			}

			let journalEntry: Awaited<ReturnType<typeof upsertIntakeJournalForDoseEvent>>;
			try {
				journalEntry = await upsertIntakeJournalForDoseEvent({
					userId,
					doseId,
					note: parsed.data.note,
					mood: parsed.data.mood ?? null,
				});
			} catch (error) {
				return sendJournalMutationError(request, reply, "upsert", error);
			}

			return { entry: buildJournalEntryDto({ event, journalEntry }) };
		}
	);

	app.delete<{ Params: { doseId: string } }>(
		"/intake-journal/event/:doseId",
		{
			schema: {
				tags: ["intake-journal"],
				summary: "Delete an intake journal note for a tracked dose event",
				security: intakeJournalEndpointSecurity,
				params: doseIdParamsSchema,
				response: {
					200: {
						type: "object",
						required: ["success"],
						properties: {
							success: { type: "boolean" },
						},
						additionalProperties: false,
					},
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					404: genericErrorSchema,
					409: genericErrorSchema,
					500: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const { doseId } = request.params;

			if (!isTrackedDoseIdFormat(doseId)) {
				return reply.status(400).send({ error: "Invalid doseId format", code: "INVALID_DOSE" });
			}

			let deleted: boolean;
			try {
				deleted = await deleteIntakeJournalForDoseEvent({ userId, doseId });
			} catch (error) {
				return sendJournalMutationError(request, reply, "delete", error);
			}
			if (!deleted) {
				return reply
					.status(404)
					.send({ error: "Tracked dose event not found for the current owner", code: "DOSE_NOT_FOUND" });
			}

			return { success: true };
		}
	);
}
