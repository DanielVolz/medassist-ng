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

		const { packsAdded, loosePillsAdded } = parsed.data;

		// Update medication stock
		const newPackCount = med.packCount + packsAdded;
		const newLooseTablets = med.looseTablets + loosePillsAdded;

		await db
			.update(medications)
			.set({
				packCount: newPackCount,
				looseTablets: newLooseTablets,
				stockAdjustment: 0, // Reset offset since we're adding to base stock
				lastStockCorrectionAt: new Date(), // Reset consumed counter to now
				updatedAt: new Date(),
			})
			.where(and(eq(medications.id, medId), eq(medications.userId, userId)));

		// Create refill history entry
		const [refill] = await db
			.insert(refillHistory)
			.values({
				medicationId: medId,
				userId,
				packsAdded,
				loosePillsAdded,
			})
			.returning();

		// Calculate pills added for response (packageType-aware)
		const isBottle = (med.packageType ?? "blister") === "bottle";
		const pillsPerPack = isBottle ? 0 : med.blistersPerPack * med.pillsPerBlister;
		const totalPillsAdded = isBottle ? loosePillsAdded : packsAdded * pillsPerPack + loosePillsAdded;
		const newTotalPills = isBottle
			? newLooseTablets + (med.stockAdjustment ?? 0)
			: newPackCount * pillsPerPack + newLooseTablets + (med.stockAdjustment ?? 0);

		return {
			success: true,
			refill: {
				id: refill.id,
				packsAdded,
				loosePillsAdded,
				totalPillsAdded,
				refillDate: refill.refillDate,
			},
			newStock: {
				packCount: newPackCount,
				looseTablets: newLooseTablets,
				totalPills: newTotalPills,
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

		const isBottle = (med.packageType ?? "blister") === "bottle";
		const pillsPerPack = isBottle ? 0 : med.blistersPerPack * med.pillsPerBlister;

		return refills.map((r) => ({
			id: r.id,
			packsAdded: r.packsAdded,
			loosePillsAdded: r.loosePillsAdded,
			totalPillsAdded: isBottle ? r.loosePillsAdded : r.packsAdded * pillsPerPack + r.loosePillsAdded,
			refillDate: r.refillDate,
		}));
	});
}
