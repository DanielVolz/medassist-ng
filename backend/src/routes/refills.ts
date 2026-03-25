import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { medications, refillHistory } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	idParamsSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import { isAmountBasedPackageType, normalizePackageType } from "../utils/package-profiles.js";

const refillSchema = z
	.object({
		packsAdded: z.number().int().min(0).default(0),
		loosePillsAdded: z.number().int().min(0).default(0),
		usePrescription: z.boolean().default(false),
	})
	.refine((data) => data.packsAdded > 0 || data.loosePillsAdded > 0, {
		message: "Must add at least one pack or some loose pills",
	});

const refillBodyOpenApiSchema = {
	type: "object",
	properties: {
		packsAdded: { type: "integer", minimum: 0, default: 0 },
		loosePillsAdded: { type: "integer", minimum: 0, default: 0 },
		usePrescription: { type: "boolean", default: false },
	},
	description: "Provide at least one pack or some loose pills.",
	example: {
		packsAdded: 1,
		loosePillsAdded: 4,
		usePrescription: true,
	},
} as const;

const refillResponseSchema = {
	type: "object",
	properties: {
		success: { type: "boolean" },
		refill: {
			type: "object",
			properties: {
				id: { type: "number" },
				packsAdded: { type: "integer" },
				loosePillsAdded: { type: "integer" },
				totalPillsAdded: { type: "number" },
				refillDate: { type: "string", format: "date-time" },
			},
		},
		newStock: {
			type: "object",
			properties: {
				packCount: { type: "integer" },
				looseTablets: { type: "integer" },
				totalPills: { type: "number" },
			},
		},
		prescription: {
			type: "object",
			properties: {
				used: { type: "boolean" },
				remainingRefills: { type: "integer" },
				authorizedRefills: { type: "integer" },
				lowRefillThreshold: { type: "integer" },
				enabled: { type: "boolean" },
			},
		},
	},
} as const;

const refillHistoryItemSchema = {
	type: "object",
	properties: {
		id: { type: "number" },
		packsAdded: { type: "integer" },
		loosePillsAdded: { type: "integer" },
		totalPillsAdded: { type: "number" },
		usedPrescription: { type: "boolean" },
		refillDate: { type: "string", format: "date-time" },
	},
} as const;

export async function refillRoutes(app: FastifyInstance) {
	// All refill routes require auth
	app.addHook("preHandler", requireAuth);
	applyOpenApiRouteStandards(app, { tag: "refills", protectedByDefault: true });

	// Helper to get user ID from request
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

	// POST /medications/:id/refill - Add stock to medication
	app.post<{ Params: { id: string } }>(
		"/medications/:id/refill",
		{
			schema: {
				params: idParamsSchema,
				body: refillBodyOpenApiSchema,
				response: {
					200: refillResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					404: genericErrorSchema,
					409: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const parsed = refillSchema.safeParse(req.body);
			if (!parsed.success) return reply.status(400).send(parsed.error.format());

			const medId = Number(req.params.id);
			if (Number.isNaN(medId)) return reply.badRequest("Invalid medication id");

			const userId = await getUserId(req, reply);

			// Verify ownership
			const [med] = await db
				.select()
				.from(medications)
				.where(and(eq(medications.id, medId), eq(medications.userId, userId)));
			if (!med) return reply.notFound("Medication not found");

			const { packsAdded, loosePillsAdded, usePrescription } = parsed.data;
			const packageType = normalizePackageType(med.packageType);
			const isBottle = packageType === "bottle";
			const isAmountBased = isAmountBasedPackageType(packageType);
			const isCountBasedAmountPackage = isAmountBased && !isBottle;

			const configuredAmountPerPackage = Number(med.packageAmountValue ?? 0);
			const fallbackAmountPerPackage = Math.max(
				1,
				Math.round((med.totalPills ?? med.looseTablets ?? 0) / Math.max(1, med.packCount || 1))
			);
			const amountPerPackage =
				Number.isFinite(configuredAmountPerPackage) && configuredAmountPerPackage > 0
					? configuredAmountPerPackage
					: fallbackAmountPerPackage;

			const requestedPackAdds = Math.max(0, packsAdded);
			const requestedAmountAdds = Math.max(0, loosePillsAdded);
			const derivedCountFromAmount = Math.max(0, Math.round(requestedAmountAdds / amountPerPackage));

			let effectivePacksAdded = requestedPackAdds;
			if (isBottle) {
				effectivePacksAdded = 0;
			} else if (isCountBasedAmountPackage) {
				effectivePacksAdded = Math.max(requestedPackAdds, derivedCountFromAmount);
			}
			const effectiveLoosePillsAdded = isCountBasedAmountPackage
				? effectivePacksAdded * amountPerPackage
				: requestedAmountAdds;
			const remainingPrescriptionRefills = med.prescriptionRemainingRefills ?? 0;

			if (effectivePacksAdded < 1 && effectiveLoosePillsAdded < 1) {
				return reply.status(400).send({ error: "Must add at least one pack or some loose pills" });
			}

			if (usePrescription) {
				if (!(med.prescriptionEnabled ?? false)) {
					return reply.status(400).send({ error: "Prescription refill is not enabled for this medication" });
				}
				if (remainingPrescriptionRefills <= 0) {
					return reply.status(409).send({ error: "No remaining prescription refills" });
				}
				if (!isBottle && effectivePacksAdded > remainingPrescriptionRefills) {
					return reply.status(409).send({ error: "Packs to add exceed remaining prescription refills" });
				}
			}

			// Update medication stock
			const newPackCount = med.packCount + effectivePacksAdded;
			const newLooseTablets = med.looseTablets + effectiveLoosePillsAdded;
			const previousAmountBase = med.totalPills ?? med.looseTablets;
			const newTotalAmount = previousAmountBase + effectiveLoosePillsAdded;

			let consumedRefills = 0;
			if (usePrescription) {
				consumedRefills = isBottle ? 1 : effectivePacksAdded;
			}
			const newRemainingRefills = usePrescription
				? Math.max(0, remainingPrescriptionRefills - consumedRefills)
				: (med.prescriptionRemainingRefills ?? null);

			const refillBaselineAt = new Date();
			const updatePayload: {
				packCount: number;
				looseTablets: number;
				totalPills?: number;
				packageAmountValue?: number;
				prescriptionRemainingRefills: number | null;
				lastStockCorrectionAt: Date;
				updatedAt: Date;
			} = {
				packCount: newPackCount,
				looseTablets: newLooseTablets,
				prescriptionRemainingRefills: newRemainingRefills,
				lastStockCorrectionAt: refillBaselineAt,
				updatedAt: refillBaselineAt,
			};

			if (isCountBasedAmountPackage) {
				updatePayload.totalPills = newTotalAmount;
				updatePayload.packageAmountValue = amountPerPackage;
			}

			await db
				.update(medications)
				.set(updatePayload)
				.where(and(eq(medications.id, medId), eq(medications.userId, userId)));

			// Create refill history entry
			const [refill] = await db
				.insert(refillHistory)
				.values({
					medicationId: medId,
					userId,
					packsAdded: effectivePacksAdded,
					loosePillsAdded: effectiveLoosePillsAdded,
					usedPrescription: usePrescription,
				})
				.returning();

			// Calculate pills added for response (packageType-aware)
			const pillsPerPack = isBottle ? 0 : med.blistersPerPack * med.pillsPerBlister;
			const totalPillsAdded = isAmountBased
				? effectiveLoosePillsAdded
				: effectivePacksAdded * pillsPerPack + effectiveLoosePillsAdded;
			let newTotalPills = newPackCount * pillsPerPack + newLooseTablets + (med.stockAdjustment ?? 0);
			if (isCountBasedAmountPackage) {
				newTotalPills = (newTotalAmount ?? 0) + (med.stockAdjustment ?? 0);
			} else if (isBottle) {
				newTotalPills = newLooseTablets + (med.stockAdjustment ?? 0);
			}

			return {
				success: true,
				refill: {
					id: refill.id,
					packsAdded: effectivePacksAdded,
					loosePillsAdded: effectiveLoosePillsAdded,
					totalPillsAdded,
					refillDate: refill.refillDate,
				},
				newStock: {
					packCount: newPackCount,
					looseTablets: newLooseTablets,
					totalPills: newTotalPills,
				},
				prescription: {
					used: usePrescription,
					remainingRefills: newRemainingRefills,
					authorizedRefills: med.prescriptionAuthorizedRefills ?? null,
					lowRefillThreshold: med.prescriptionLowRefillThreshold ?? 1,
					enabled: med.prescriptionEnabled ?? false,
				},
			};
		}
	);

	// GET /medications/:id/refills - Get refill history for a medication
	app.get<{ Params: { id: string } }>(
		"/medications/:id/refills",
		{
			schema: {
				params: idParamsSchema,
				response: {
					200: { type: "array", items: refillHistoryItemSchema },
					400: genericErrorSchema,
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const medId = Number(req.params.id);
			if (Number.isNaN(medId)) return reply.badRequest("Invalid medication id");

			const userId = await getUserId(req, reply);

			// Verify ownership
			const [med] = await db
				.select()
				.from(medications)
				.where(and(eq(medications.id, medId), eq(medications.userId, userId)));
			if (!med) return reply.notFound("Medication not found");

			// Get refill history, newest first
			const refills = await db
				.select()
				.from(refillHistory)
				.where(and(eq(refillHistory.medicationId, medId), eq(refillHistory.userId, userId)))
				.orderBy(desc(refillHistory.refillDate));

			const packageType = normalizePackageType(med.packageType);
			const isBottle = packageType === "bottle";
			const isAmountBased = isAmountBasedPackageType(packageType);
			const pillsPerPack = isBottle ? 0 : med.blistersPerPack * med.pillsPerBlister;

			return refills.map((r) => ({
				id: r.id,
				packsAdded: r.packsAdded,
				loosePillsAdded: r.loosePillsAdded,
				totalPillsAdded: isAmountBased ? r.loosePillsAdded : r.packsAdded * pillsPerPack + r.loosePillsAdded,
				usedPrescription: r.usedPrescription ?? false,
				refillDate: r.refillDate,
			}));
		}
	);
}
