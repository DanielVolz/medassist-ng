import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, withImmediateWriteTransaction } from "../db/client.js";
import { medications, refillHistory } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import {
	getActiveAsNeededStockEffectMilli,
	neutralizeAsNeededStockEffects,
} from "../services/as-needed-intakes-service.js";
import type { AuthUser } from "../types/fastify.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	idParamsSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import {
	isAmountBasedPackageType,
	isDiscreteCountPackageType,
	isPackageAmountPackageType,
	normalizePackageType,
} from "../utils/package-profiles.js";

const refillSchema = z
	.object({
		packsAdded: z.number().int().min(0).default(0),
		loosePillsAdded: z.number().int().min(0).default(0),
		quantityAdded: z.number().int().min(0).default(0),
		usePrescription: z.boolean().default(false),
	})
	.refine((data) => data.packsAdded > 0 || data.loosePillsAdded > 0 || data.quantityAdded > 0, {
		message: "Must add at least one pack or some quantity",
	});

const refillBodyOpenApiSchema = {
	type: "object",
	properties: {
		packsAdded: { type: "integer", minimum: 0, default: 0 },
		loosePillsAdded: { type: "integer", minimum: 0, default: 0 },
		quantityAdded: { type: "integer", minimum: 0, default: 0 },
		usePrescription: { type: "boolean", default: false },
	},
	description: "Provide at least one pack or some quantity.",
	example: {
		packsAdded: 1,
		loosePillsAdded: 4,
		quantityAdded: 4,
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
				quantityAdded: { type: "number" },
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
		quantityAdded: { type: "number" },
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

			const { packsAdded, loosePillsAdded, quantityAdded, usePrescription } = parsed.data;
			const packageType = normalizePackageType(med.packageType);
			const isDiscreteCountPackage = isDiscreteCountPackageType(packageType);
			const isAmountBased = isAmountBasedPackageType(packageType);
			const isPackageAmountPackage = isPackageAmountPackageType(packageType);
			const pillsPerPack = isDiscreteCountPackage ? 0 : med.blistersPerPack * med.pillsPerBlister;

			const requestedPackAdds = Math.max(0, packsAdded);
			const requestedLooseAdds = Math.max(0, loosePillsAdded);
			const requestedQuantityAdds = Math.max(0, quantityAdded > 0 ? quantityAdded : requestedLooseAdds);
			let effectivePacksAdded = requestedPackAdds;
			if (isDiscreteCountPackage) {
				effectivePacksAdded = 0;
			}
			const effectiveLoosePillsAdded = isPackageAmountPackage ? requestedQuantityAdds : requestedLooseAdds;
			const remainingPrescriptionRefills = med.prescriptionRemainingRefills ?? 0;
			const totalPillsAdded = isAmountBased
				? effectiveLoosePillsAdded
				: effectivePacksAdded * pillsPerPack + effectiveLoosePillsAdded;

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
				if (!isDiscreteCountPackage && effectivePacksAdded > remainingPrescriptionRefills) {
					return reply.status(409).send({ error: "Packs to add exceed remaining prescription refills" });
				}
			}

			let consumedRefills = 0;
			if (usePrescription) {
				consumedRefills = isDiscreteCountPackage ? 1 : effectivePacksAdded;
			}
			const newRemainingRefills = usePrescription
				? Math.max(0, remainingPrescriptionRefills - consumedRefills)
				: (med.prescriptionRemainingRefills ?? null);

			const mutation = await withImmediateWriteTransaction(async (transactionDb) => {
				const [current] = await transactionDb
					.select()
					.from(medications)
					.where(and(eq(medications.id, medId), eq(medications.userId, userId)));
				if (!current) return null;
				const refillInputsChanged =
					normalizePackageType(current.packageType) !== packageType ||
					current.blistersPerPack !== med.blistersPerPack ||
					current.pillsPerBlister !== med.pillsPerBlister ||
					current.prescriptionEnabled !== med.prescriptionEnabled ||
					current.prescriptionRemainingRefills !== med.prescriptionRemainingRefills;
				if (refillInputsChanged) return "conflict" as const;

				const refillBaselineAt = new Date();
				const activeEffectMilli = await getActiveAsNeededStockEffectMilli(transactionDb, userId, medId);
				const structuralStock = isAmountBased
					? current.looseTablets + (current.stockAdjustment ?? 0)
					: current.packCount * pillsPerPack + current.looseTablets + (current.stockAdjustment ?? 0);
				const targetCurrentStock =
					structuralStock + (current.scheduleStockRebaseMilli ?? 0) / 1000 - activeEffectMilli / 1000 + totalPillsAdded;
				const targetMilli = Math.round(targetCurrentStock * 1000);
				if (!Number.isSafeInteger(targetMilli)) return "unresolvable" as const;
				const targetWhole = Math.trunc(targetMilli / 1000);
				const rebaseMilli = targetMilli - targetWhole * 1000;
				const configuredAmountPerPackage = Number(current.packageAmountValue ?? 0);
				const fallbackAmountPerPackage = Math.max(
					1,
					Math.round((current.totalPills ?? current.looseTablets ?? 0) / Math.max(1, current.packCount || 1))
				);
				const amountPerPackage =
					Number.isFinite(configuredAmountPerPackage) && configuredAmountPerPackage > 0
						? configuredAmountPerPackage
						: fallbackAmountPerPackage;

				let newPackCount = current.packCount + effectivePacksAdded;
				let newLooseTablets = current.looseTablets + effectiveLoosePillsAdded;
				let newStockAdjustment = current.stockAdjustment ?? 0;
				let newTotalAmount = current.totalPills ?? current.looseTablets;
				if (isDiscreteCountPackage) {
					newLooseTablets = targetWhole;
					newTotalAmount = Math.max(newTotalAmount, targetWhole);
					newStockAdjustment = 0;
				} else if (isPackageAmountPackage) {
					newPackCount = Math.max(1, Math.ceil(targetWhole / amountPerPackage));
					newLooseTablets = targetWhole;
					newTotalAmount = targetWhole;
					newStockAdjustment = 0;
				} else {
					newStockAdjustment = targetWhole - (newPackCount * pillsPerPack + newLooseTablets);
				}

				await transactionDb
					.update(medications)
					.set({
						packCount: newPackCount,
						looseTablets: newLooseTablets,
						stockAdjustment: newStockAdjustment,
						scheduleStockRebaseMilli: rebaseMilli,
						totalPills: isPackageAmountPackage ? newTotalAmount : current.totalPills,
						packageAmountValue: isPackageAmountPackage ? amountPerPackage : current.packageAmountValue,
						prescriptionRemainingRefills: newRemainingRefills,
						lastStockCorrectionAt: refillBaselineAt,
						updatedAt: refillBaselineAt,
					})
					.where(and(eq(medications.id, medId), eq(medications.userId, userId)));
				await neutralizeAsNeededStockEffects(transactionDb, userId, medId, refillBaselineAt);
				const [refill] = await transactionDb
					.insert(refillHistory)
					.values({
						medicationId: medId,
						userId,
						packsAdded: effectivePacksAdded,
						loosePillsAdded: effectiveLoosePillsAdded,
						usedPrescription: usePrescription,
					})
					.returning();
				return { refill, targetCurrentStock, newPackCount, newLooseTablets };
			});
			if (!mutation) return reply.notFound("Medication not found");
			if (mutation === "conflict") return reply.status(409).send({ error: "Medication changed; retry refill" });
			if (mutation === "unresolvable") {
				return reply.status(409).send({ error: "Current stock cannot be resolved safely" });
			}
			const { refill, targetCurrentStock, newPackCount, newLooseTablets } = mutation;

			return {
				success: true,
				refill: {
					id: refill.id,
					packsAdded: effectivePacksAdded,
					loosePillsAdded: effectiveLoosePillsAdded,
					quantityAdded: totalPillsAdded,
					totalPillsAdded,
					refillDate: refill.refillDate,
				},
				newStock: {
					packCount: newPackCount,
					looseTablets: newLooseTablets,
					totalPills: targetCurrentStock,
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
			const isDiscreteCountPackage = isDiscreteCountPackageType(packageType);
			const isAmountBased = isAmountBasedPackageType(packageType);
			const pillsPerPack = isDiscreteCountPackage ? 0 : med.blistersPerPack * med.pillsPerBlister;

			return refills.map((r) => ({
				id: r.id,
				packsAdded: r.packsAdded,
				loosePillsAdded: r.loosePillsAdded,
				quantityAdded: isAmountBased ? r.loosePillsAdded : r.packsAdded * pillsPerPack + r.loosePillsAdded,
				totalPillsAdded: isAmountBased ? r.loosePillsAdded : r.packsAdded * pillsPerPack + r.loosePillsAdded,
				usedPrescription: r.usedPrescription ?? false,
				refillDate: r.refillDate,
			}));
		}
	);
}
