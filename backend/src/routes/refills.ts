import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { medications, refillHistory } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";

const refillSchema = z
	.object({
		packsAdded: z.number().int().min(0).default(0),
		loosePillsAdded: z.number().int().min(0).default(0),
		usePrescription: z.boolean().default(false),
	})
	.refine((data) => data.packsAdded > 0 || data.loosePillsAdded > 0, {
		message: "Must add at least one pack or some loose pills",
	});

export async function refillRoutes(app: FastifyInstance) {
	// All refill routes require auth
	app.addHook("preHandler", requireAuth);

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
	app.post<{ Params: { id: string } }>("/medications/:id/refill", async (req, reply) => {
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
		const isBottle =
			(med.packageType ?? "blister") === "bottle" ||
			(med.packageType ?? "blister") === "tube" ||
			(med.packageType ?? "blister") === "liquid_container";
		const effectivePacksAdded = isBottle ? 0 : packsAdded;
		const effectiveLoosePillsAdded = loosePillsAdded;
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

		let consumedRefills = 0;
		if (usePrescription) {
			consumedRefills = isBottle ? 1 : effectivePacksAdded;
		}
		const newRemainingRefills = usePrescription
			? Math.max(0, remainingPrescriptionRefills - consumedRefills)
			: (med.prescriptionRemainingRefills ?? null);

		await db
			.update(medications)
			.set({
				packCount: newPackCount,
				looseTablets: newLooseTablets,
				prescriptionRemainingRefills: newRemainingRefills,
				updatedAt: new Date(),
			})
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
		const totalPillsAdded = isBottle
			? effectiveLoosePillsAdded
			: effectivePacksAdded * pillsPerPack + effectiveLoosePillsAdded;
		const newTotalPills = isBottle
			? newLooseTablets + (med.stockAdjustment ?? 0)
			: newPackCount * pillsPerPack + newLooseTablets + (med.stockAdjustment ?? 0);

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
	});

	// GET /medications/:id/refills - Get refill history for a medication
	app.get<{ Params: { id: string } }>("/medications/:id/refills", async (req, reply) => {
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
			.where(eq(refillHistory.medicationId, medId))
			.orderBy(desc(refillHistory.refillDate));

		const isBottle =
			(med.packageType ?? "blister") === "bottle" ||
			(med.packageType ?? "blister") === "tube" ||
			(med.packageType ?? "blister") === "liquid_container";
		const pillsPerPack = isBottle ? 0 : med.blistersPerPack * med.pillsPerBlister;

		return refills.map((r) => ({
			id: r.id,
			packsAdded: r.packsAdded,
			loosePillsAdded: r.loosePillsAdded,
			totalPillsAdded: isBottle ? r.loosePillsAdded : r.packsAdded * pillsPerPack + r.loosePillsAdded,
			usedPrescription: r.usedPrescription ?? false,
			refillDate: r.refillDate,
		}));
	});
}
