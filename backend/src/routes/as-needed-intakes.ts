import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getAnonymousUserId, isReadOnlyApiKeyRequest, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import {
	AsNeededIntakeError,
	createAsNeededIntake,
	deleteAsNeededIntake,
	getAsNeededMutationResponse,
	listAsNeededIntakes,
} from "../services/as-needed-intakes-service.js";
import type { AuthUser } from "../types/fastify.js";
import { applyOpenApiRouteStandards, genericErrorSchema } from "../utils/openapi-route-standards.js";

const medicationParamsSchema = z.object({ medicationId: z.coerce.number().int().positive() }).strict();
const eventParamsSchema = z.object({ eventId: z.string().trim().uuid() }).strict();
const idempotencyHeadersSchema = z.object({ "idempotency-key": z.string().trim().uuid() }).strict();
const includeReversedSchema = z.preprocess((value) => {
	if (value === "true") return true;
	if (value === "false") return false;
	return value;
}, z.boolean().default(true));
const listQuerySchema = z
	.object({
		includeReversed: includeReversedSchema,
		from: z.string().datetime({ offset: true }).optional(),
		to: z.string().datetime({ offset: true }).optional(),
		limit: z.coerce.number().int().min(1).max(200).default(100),
		cursor: z.string().min(1).max(512).optional(),
	})
	.strict();
const createBodySchema = z
	.object({
		quantity: z.number().positive().multipleOf(0.001),
		person: z.string().trim().min(1).max(100).nullable().optional(),
	})
	.strict();

const medicationParamsOpenApiSchema = {
	type: "object",
	required: ["medicationId"],
	properties: { medicationId: { type: "integer", minimum: 1 } },
	additionalProperties: false,
} as const;
const eventParamsOpenApiSchema = {
	type: "object",
	required: ["eventId"],
	properties: { eventId: { type: "string", format: "uuid" } },
	additionalProperties: false,
} as const;
const idempotencyHeadersOpenApiSchema = {
	type: "object",
	required: ["idempotency-key"],
	properties: { "idempotency-key": { type: "string", format: "uuid" } },
} as const;
const listQueryOpenApiSchema = {
	type: "object",
	properties: {
		includeReversed: { type: "boolean", default: true },
		from: { type: "string", format: "date-time" },
		to: { type: "string", format: "date-time" },
		limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
		cursor: { type: "string", minLength: 1, maxLength: 512 },
	},
	additionalProperties: false,
} as const;
const createBodyOpenApiSchema = {
	type: "object",
	required: ["quantity"],
	properties: {
		quantity: { type: "number", exclusiveMinimum: 0, multipleOf: 0.001 },
		person: { type: ["string", "null"], minLength: 1, maxLength: 100 },
	},
	additionalProperties: false,
} as const;
const errorResponseSchema = {
	type: "object",
	required: ["error", "code"],
	properties: { error: { type: "string" }, code: { type: "string" } },
	additionalProperties: false,
} as const;
const conflictResponseSchema = {
	type: "object",
	required: ["error", "code"],
	properties: {
		error: { type: "string" },
		code: { type: "string" },
		currentStock: { type: "number", minimum: 0 },
	},
	additionalProperties: false,
} as const;
const medicationContextSchema = {
	type: "object",
	required: [
		"name",
		"genericName",
		"medicationForm",
		"packageType",
		"isObsolete",
		"hasRegularSchedule",
		"lifecycle",
		"recordEligibility",
	],
	properties: {
		name: { type: "string" },
		genericName: { type: ["string", "null"] },
		medicationForm: { type: "string" },
		packageType: { type: "string" },
		isObsolete: { type: "boolean" },
		hasRegularSchedule: { type: "boolean" },
		lifecycle: { type: "string", enum: ["active_no_schedule", "active_scheduled", "ended", "obsolete"] },
		recordEligibility: {
			type: "object",
			required: ["eligible", "reason"],
			properties: {
				eligible: { type: "boolean" },
				reason: { type: "string", enum: ["eligible", "has_regular_schedule", "ended", "obsolete"] },
			},
			additionalProperties: false,
		},
	},
	additionalProperties: false,
} as const;
const journalSchema = {
	type: ["object", "null"],
	required: ["doseId", "mood", "note", "createdAt", "updatedAt"],
	properties: {
		doseId: { type: "string" },
		mood: { type: ["string", "null"] },
		note: { type: ["string", "null"] },
		createdAt: { type: ["string", "null"], format: "date-time" },
		updatedAt: { type: ["string", "null"], format: "date-time" },
	},
	additionalProperties: false,
} as const;
const eventResponseSchema = {
	type: "object",
	required: [
		"eventType",
		"eventId",
		"medicationId",
		"medication",
		"occurredAt",
		"recordedAt",
		"quantity",
		"quantityUnit",
		"person",
		"source",
		"status",
		"revision",
		"stockEffect",
		"stockEffectReason",
		"stockCutoffAt",
		"replacementForEventId",
		"reversedAt",
		"journal",
	],
	properties: {
		eventType: { type: "string", const: "as_needed" },
		eventId: { type: "string", format: "uuid" },
		medicationId: { type: "integer" },
		medication: medicationContextSchema,
		occurredAt: { type: "string", format: "date-time" },
		recordedAt: { type: "string", format: "date-time" },
		quantity: { type: "number", exclusiveMinimum: 0 },
		quantityUnit: { type: "string", enum: ["pills", "ml", "puffs", "injections", "application"] },
		person: { type: ["string", "null"] },
		source: { type: "string", const: "owner_as_needed" },
		status: { type: "string", enum: ["active", "reversed"] },
		revision: { type: "integer", minimum: 1 },
		stockEffect: { type: "number", minimum: 0 },
		stockEffectReason: {
			type: "string",
			enum: ["applied", "non_measurable", "before_correction", "superseded_by_correction"],
		},
		stockCutoffAt: { type: ["string", "null"], format: "date-time" },
		replacementForEventId: { type: ["string", "null"], format: "uuid" },
		reversedAt: { type: ["string", "null"], format: "date-time" },
		journal: journalSchema,
	},
	additionalProperties: false,
} as const;
const inventoryResponseSchema = {
	type: "object",
	required: ["currentStock", "unit", "capacity", "reconciliationRequired"],
	properties: {
		currentStock: { type: "number", minimum: 0 },
		unit: { type: "string", enum: ["pills", "ml", "puffs", "injections", "application"] },
		capacity: { type: ["number", "null"], minimum: 0 },
		reconciliationRequired: { type: "boolean" },
	},
	additionalProperties: false,
} as const;
const mutationResponseSchema = {
	type: "object",
	required: ["event", "inventory"],
	properties: { event: eventResponseSchema, inventory: inventoryResponseSchema },
	additionalProperties: false,
} as const;
const listResponseSchema = {
	type: "object",
	required: ["events", "nextCursor"],
	properties: {
		events: { type: "array", items: eventResponseSchema },
		nextCursor: { type: ["string", "null"] },
	},
	additionalProperties: false,
} as const;

async function getUserId(request: FastifyRequest, reply: FastifyReply): Promise<number | null> {
	if (!env.AUTH_ENABLED) return getAnonymousUserId();
	const user = request.user as AuthUser | null;
	if (user) return user.id;
	reply.status(401).send({ error: "Authentication required", code: "AUTH_REQUIRED" });
	return null;
}

function validationError(reply: FastifyReply, code: string, message: string): FastifyReply {
	return reply.status(400).send({ error: message, code });
}

function sendServiceError(
	request: FastifyRequest,
	reply: FastifyReply,
	operation: "list" | "create" | "undo",
	userId: number,
	error: unknown
): FastifyReply {
	if (!(error instanceof AsNeededIntakeError)) {
		request.log.error({ err: error, operation, userId }, "[AsNeededIntake] Owner operation failed");
		return reply.status(500).send({ error: "Internal server error", code: "INTERNAL_ERROR" });
	}

	if (error.code === "TOO_MANY_NEW_INTAKES") {
		const retryAfterSeconds = error.details?.retryAfterSeconds ?? 1;
		reply.header("Retry-After", retryAfterSeconds);
		return reply.status(429).send({ error: error.message, code: error.code });
	}
	if (error.code === "MEDICATION_NOT_FOUND") {
		return reply.status(404).send({ error: "Medication not found", code: error.code });
	}
	if (error.code === "EVENT_NOT_FOUND") {
		return reply.status(404).send({ error: "Event not found", code: "EVENT_NOT_FOUND" });
	}
	if (
		error.code === "INVALID_IDEMPOTENCY_KEY" ||
		error.code === "INVALID_QUANTITY" ||
		error.code === "INVALID_PERSON" ||
		error.code === "INVALID_DATE_RANGE" ||
		error.code === "INVALID_CURSOR"
	) {
		return reply.status(400).send({ error: error.message, code: error.code });
	}

	const codeByConflict = {
		NOT_ELIGIBLE: "MEDICATION_NOT_ELIGIBLE",
		STOCK_UNRESOLVABLE: "STOCK_UNRESOLVABLE",
		INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
		IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
	} as const;
	const code = codeByConflict[error.code];
	return reply.status(409).send({
		error: error.message,
		code,
		...(error.details?.currentStock === undefined ? {} : { currentStock: error.details.currentStock }),
	});
}

export async function asNeededIntakeRoutes(app: FastifyInstance) {
	app.addHook("preHandler", requireAuth);
	applyOpenApiRouteStandards(app, { tag: "as-needed-intakes", protectedByDefault: true });
	// The app-wide limiter remains first. The service's owner limiter runs only after same-key replay resolution.

	app.get<{ Params: Record<string, unknown>; Querystring: Record<string, unknown> }>(
		"/medications/:medicationId/as-needed-intakes",
		{
			attachValidation: true,
			schema: {
				params: medicationParamsOpenApiSchema,
				querystring: listQueryOpenApiSchema,
				response: {
					200: listResponseSchema,
					400: errorResponseSchema,
					404: errorResponseSchema,
					500: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const params = medicationParamsSchema.safeParse(request.params);
			if (!params.success) return validationError(reply, "INVALID_REQUEST", "Invalid medication id");
			const query = listQuerySchema.safeParse(request.query);
			if (!query.success || request.validationError) {
				const field = query.success ? null : query.error.issues[0]?.path[0];
				if (field === "cursor") return validationError(reply, "INVALID_CURSOR", "Invalid cursor");
				if (field === "from" || field === "to") {
					return validationError(reply, "INVALID_DATE_RANGE", "Invalid date-time range");
				}
				return validationError(reply, "INVALID_REQUEST", "Invalid list request");
			}
			const userId = await getUserId(request, reply);
			if (userId === null) return;
			try {
				return await listAsNeededIntakes({
					userId,
					medicationId: params.data.medicationId,
					includeReversed: query.data.includeReversed,
					from: query.data.from ? new Date(query.data.from) : undefined,
					to: query.data.to ? new Date(query.data.to) : undefined,
					limit: query.data.limit,
					cursor: query.data.cursor,
				});
			} catch (error) {
				return sendServiceError(request, reply, "list", userId, error);
			}
		}
	);

	app.post<{ Params: Record<string, unknown>; Body: Record<string, unknown> }>(
		"/medications/:medicationId/as-needed-intakes",
		{
			attachValidation: true,
			schema: {
				params: medicationParamsOpenApiSchema,
				headers: idempotencyHeadersOpenApiSchema,
				body: createBodyOpenApiSchema,
				response: {
					200: mutationResponseSchema,
					201: mutationResponseSchema,
					400: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
					409: conflictResponseSchema,
					429: genericErrorSchema,
					500: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const params = medicationParamsSchema.safeParse(request.params);
			if (!params.success) return validationError(reply, "INVALID_REQUEST", "Invalid medication id");
			const headers = idempotencyHeadersSchema.safeParse({
				"idempotency-key": request.headers["idempotency-key"],
			});
			if (!headers.success) {
				return validationError(reply, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be a UUID");
			}
			const body = createBodySchema.safeParse(request.body);
			if (!body.success || request.validationError) {
				const field = body.success ? null : body.error.issues[0]?.path[0];
				if (field === "quantity") return validationError(reply, "INVALID_QUANTITY", "Invalid quantity");
				if (field === "person") return validationError(reply, "INVALID_PERSON", "Invalid person");
				return validationError(reply, "INVALID_REQUEST", "Invalid create request");
			}
			const userId = await getUserId(request, reply);
			if (userId === null) return;
			if (isReadOnlyApiKeyRequest(request)) {
				return reply.status(403).send({ error: "API key is read-only", code: "READ_ONLY" });
			}
			try {
				const event = await createAsNeededIntake({
					userId,
					medicationId: params.data.medicationId,
					quantity: body.data.quantity,
					personName: body.data.person,
					idempotencyKey: headers.data["idempotency-key"],
					enforceOwnerRateLimit: true,
				});
				const response = await getAsNeededMutationResponse(userId, event.eventId);
				if (event.isReplay) {
					reply.header("Idempotent-Replay", "true");
					return reply.status(200).send(response);
				}
				return reply.status(201).send(response);
			} catch (error) {
				return sendServiceError(request, reply, "create", userId, error);
			}
		}
	);

	app.delete<{ Params: Record<string, unknown> }>(
		"/as-needed-intakes/:eventId",
		{
			attachValidation: true,
			schema: {
				params: eventParamsOpenApiSchema,
				response: {
					204: { type: "null" },
					400: errorResponseSchema,
					403: errorResponseSchema,
					500: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const params = eventParamsSchema.safeParse(request.params);
			if (!params.success) return validationError(reply, "INVALID_REQUEST", "Invalid event id");
			const userId = await getUserId(request, reply);
			if (userId === null) return;
			if (isReadOnlyApiKeyRequest(request)) {
				return reply.status(403).send({ error: "API key is read-only", code: "READ_ONLY" });
			}
			try {
				await deleteAsNeededIntake(userId, params.data.eventId);
				return reply.status(204).send();
			} catch (error) {
				return sendServiceError(request, reply, "undo", userId, error);
			}
		}
	);
}
