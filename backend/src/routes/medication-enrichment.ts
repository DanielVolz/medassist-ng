import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth.js";
import {
	enrichMedicationSelection,
	MEDICATION_ENRICHMENT_SEARCH_DEFAULT_LIMIT,
	MEDICATION_ENRICHMENT_SEARCH_MAX_LIMIT,
	type MedicationEnrichmentEnrichRequest,
	MedicationEnrichmentServiceError,
	searchMedicationEnrichment,
} from "../services/medication-enrichment.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";

const searchQuerySchema = z.object({
	q: z.string().trim().min(1).max(120),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(MEDICATION_ENRICHMENT_SEARCH_MAX_LIMIT)
		.default(MEDICATION_ENRICHMENT_SEARCH_DEFAULT_LIMIT),
});

const enrichBodySchema = z.object({
	query: z.string().trim().min(1).max(120),
	name: z.string().trim().min(1).max(140),
	genericName: z.string().trim().max(140).nullable().optional(),
	code: z.string().trim().min(1).max(160).nullable().optional(),
	source: z.enum(["ema", "rxnorm", "openfda"]).nullable().optional(),
});

const searchQueryOpenApiSchema = {
	type: "object",
	required: ["q"],
	properties: {
		q: { type: "string", minLength: 1, maxLength: 120 },
		limit: {
			anyOf: [
				{ type: "string", pattern: "^[0-9]+$" },
				{
					type: "integer",
					minimum: 1,
					maximum: MEDICATION_ENRICHMENT_SEARCH_MAX_LIMIT,
					default: MEDICATION_ENRICHMENT_SEARCH_DEFAULT_LIMIT,
				},
			],
		},
	},
} as const;

const enrichBodyOpenApiSchema = {
	type: "object",
	required: ["query", "name"],
	properties: {
		query: { type: "string", minLength: 1, maxLength: 120 },
		name: { type: "string", minLength: 1, maxLength: 140 },
		genericName: { type: "string", nullable: true, maxLength: 140 },
		code: { type: "string", nullable: true, maxLength: 160 },
		source: { type: "string", nullable: true, enum: ["ema", "rxnorm", "openfda"] },
	},
} as const;

const strengthOptionSchema = {
	type: "object",
	properties: {
		label: { type: "string" },
		pillWeightMg: { type: "number", nullable: true },
		doseUnit: {
			anyOf: [
				{ type: "string", enum: ["mg", "g", "mcg", "ml", "IU", "units", "drops", "puffs", "injections"] },
				{ type: "null" },
			],
		},
	},
} as const;

const packageOptionSchema = {
	type: "object",
	properties: {
		label: { type: "string" },
		description: { type: "string" },
		packageType: { type: "string", enum: ["blister", "bottle", "tube", "liquid_container", "inhaler", "injection"] },
		packCount: { type: "integer", minimum: 1 },
		blistersPerPack: { type: "integer", minimum: 1, nullable: true },
		pillsPerBlister: { type: "integer", minimum: 1, nullable: true },
		totalPills: { type: "integer", minimum: 0, nullable: true },
		looseTablets: { type: "integer", minimum: 0, nullable: true },
		packageAmountValue: { type: "integer", minimum: 1, nullable: true },
		packageAmountUnit: {
			anyOf: [{ type: "string", enum: ["ml", "g"] }, { type: "null" }],
		},
	},
} as const;

const searchResponseSchema = {
	type: "object",
	properties: {
		query: { type: "string" },
		normalizedQuery: { type: "string" },
		hasMore: { type: "boolean" },
		results: {
			type: "array",
			items: {
				type: "object",
				properties: {
					code: { type: "string" },
					name: { type: "string" },
					genericName: { type: "string", nullable: true },
					authorisationHolder: { type: "string", nullable: true },
					therapeuticArea: { type: "string", nullable: true },
					matchType: { type: "string", enum: ["brand", "ingredient"] },
					genericStatus: { type: "string", enum: ["generic", "original", "unknown"] },
					authorisationDate: { type: "string", nullable: true },
					source: { type: "string", enum: ["ema", "rxnorm", "openfda"] },
					packageOptions: { type: "array", items: packageOptionSchema },
				},
			},
		},
	},
} as const;

const enrichResponseSchema = {
	type: "object",
	properties: {
		selection: {
			type: "object",
			properties: {
				name: { type: "string" },
				genericName: { type: "string", nullable: true },
				therapeuticArea: { type: "string", nullable: true },
				indication: { type: "string", nullable: true },
				atcCode: { type: "string", nullable: true },
				source: {
					type: "string",
					enum: ["ema", "rxnorm", "openfda", "ema+rxnorm", "ema+openfda", "rxnorm+openfda", "ema+rxnorm+openfda"],
				},
			},
		},
		suggestions: {
			type: "object",
			properties: {
				name: { type: "string" },
				genericName: { type: "string", nullable: true },
				medicationForm: {
					anyOf: [{ type: "string", enum: ["capsule", "tablet", "liquid", "topical"] }, { type: "null" }],
				},
				strengthOptions: { type: "array", items: strengthOptionSchema },
				packageOptions: { type: "array", items: packageOptionSchema },
			},
		},
		meta: {
			type: "object",
			properties: {
				rxNormMatched: { type: "boolean" },
				openFdaMatched: { type: "boolean" },
				partial: { type: "boolean" },
				note: { type: "string", nullable: true },
			},
		},
	},
} as const;

function sendServiceError(error: unknown, reply: FastifyReply) {
	if (error instanceof MedicationEnrichmentServiceError) {
		return reply.status(error.statusCode).send({ error: error.message, code: error.code });
	}

	return reply.status(503).send({
		error: "Medication enrichment request failed.",
		code: "MEDICATION_ENRICHMENT_REQUEST_FAILED",
	});
}

export async function medicationEnrichmentRoutes(app: FastifyInstance) {
	app.addHook("preHandler", requireAuth);
	applyOpenApiRouteStandards(app, { tag: "medication-enrichment", protectedByDefault: true });

	app.get(
		"/medication-enrichment/search",
		{
			schema: {
				querystring: searchQueryOpenApiSchema,
				response: {
					200: searchResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					503: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const parsed = searchQuerySchema.safeParse(request.query);
			if (!parsed.success) return reply.status(400).send(parsed.error.format());

			try {
				return await searchMedicationEnrichment(parsed.data.q, parsed.data.limit);
			} catch (error) {
				request.log.warn(
					{
						code:
							error instanceof MedicationEnrichmentServiceError ? error.code : "MEDICATION_ENRICHMENT_REQUEST_FAILED",
					},
					"[MedicationEnrichment] Search request failed"
				);
				return sendServiceError(error, reply);
			}
		}
	);

	app.post<{ Body: MedicationEnrichmentEnrichRequest }>(
		"/medication-enrichment/enrich",
		{
			schema: {
				body: enrichBodyOpenApiSchema,
				response: {
					200: enrichResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					404: genericErrorSchema,
					503: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const parsed = enrichBodySchema.safeParse(request.body);
			if (!parsed.success) return reply.status(400).send(parsed.error.format());

			try {
				return await enrichMedicationSelection(parsed.data, request.log);
			} catch (error) {
				request.log.warn(
					{
						code:
							error instanceof MedicationEnrichmentServiceError ? error.code : "MEDICATION_ENRICHMENT_REQUEST_FAILED",
					},
					"[MedicationEnrichment] Enrich request failed"
				);
				return sendServiceError(error, reply);
			}
		}
	);
}
