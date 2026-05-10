import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, medications, refillHistory } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";

const reportDataSchema = z.object({
	medicationIds: z.array(z.number().int().positive()).min(1).max(100),
	takenByFilter: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
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
		takenByFilter: {
			type: "array",
			maxItems: 50,
			items: { type: "string", minLength: 1, maxLength: 100 },
		},
	},
	example: {
		medicationIds: [1, 3, 5],
		takenByFilter: ["Daniel"],
	},
} as const;

function matchesTakenByFilter(doseId: string, takenByFilter: Set<string> | null): boolean {
	if (!takenByFilter) return true;
	const parts = doseId.split("-");
	if (parts.length < 4) return false;
	const takenBy = parts.at(-1)?.trim();
	if (!takenBy) return false;
	return takenByFilter.has(takenBy);
}

const reportDataResponseSchema = {
	type: "object",
	additionalProperties: {
		type: "object",
		properties: {
			dosesTaken: { type: "integer" },
			automaticDosesTaken: { type: "integer" },
			dosesSkipped: { type: "integer" },
			firstDoseAt: { type: "string" },
			lastDoseAt: { type: "string" },
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
			const { medicationIds, takenByFilter } = parsed.data;
			const normalizedTakenByFilter = takenByFilter?.length
				? new Set(takenByFilter.map((value) => value.trim()))
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
			const allDoses = await db
				.select({
					doseId: doseTracking.doseId,
					takenAt: doseTracking.takenAt,
					dismissed: doseTracking.dismissed,
					takenSource: doseTracking.takenSource,
				})
				.from(doseTracking)
				.where(eq(doseTracking.userId, userId));

			// Group doses by medication ID
			const dosesByMed = new Map<number, { takenAt: Date; dismissed: boolean; takenSource: string }[]>();
			for (const dose of allDoses) {
				const medId = Number.parseInt(dose.doseId.split("-")[0], 10);
				if (Number.isNaN(medId) || !medicationIds.includes(medId)) continue;
				if (!matchesTakenByFilter(dose.doseId, normalizedTakenByFilter)) continue;
				if (!dosesByMed.has(medId)) dosesByMed.set(medId, []);
				dosesByMed.get(medId)!.push({
					takenAt: dose.takenAt,
					dismissed: dose.dismissed,
					takenSource: dose.takenSource ?? "manual",
				});
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

				const sortedTaken = takenDoses.map((d) => d.takenAt.getTime()).sort((a, b) => a - b);
				const medication = medMap.get(medId);
				const pillsPerPack = Math.max(1, (medication?.blistersPerPack ?? 1) * (medication?.pillsPerBlister ?? 1));
				const isAmountBased = medication?.packageType === "liquid_container" || medication?.packageType === "tube";

				// Get refills for this medication scoped to the authenticated user.
				const refills = await db
					.select()
					.from(refillHistory)
					.where(and(eq(refillHistory.medicationId, medId), eq(refillHistory.userId, userId)));

				result[medId] = {
					dosesTaken: takenDoses.length,
					automaticDosesTaken: automaticTakenDoses.length,
					dosesSkipped: skippedDoses.length,
					firstDoseAt: sortedTaken.length > 0 ? new Date(sortedTaken[0]).toISOString() : null,
					lastDoseAt: sortedTaken.length > 0 ? new Date(sortedTaken[sortedTaken.length - 1]).toISOString() : null,
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
