import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, medications, refillHistory } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";

const reportDataSchema = z.object({
	medicationIds: z.array(z.number().int().positive()).min(1).max(100),
});

export async function reportRoutes(app: FastifyInstance) {
	app.addHook("preHandler", requireAuth);

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
	app.post("/medications/report-data", async (req, reply) => {
		const parsed = reportDataSchema.safeParse(req.body);
		if (!parsed.success) return reply.status(400).send(parsed.error.format());

		const userId = await getUserId(req, reply);
		const { medicationIds } = parsed.data;

		// Verify all medications belong to this user
		const userMeds = await db.select({ id: medications.id }).from(medications).where(eq(medications.userId, userId));
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
				dosesDismissed: number;
				firstDoseAt: string | null;
				lastDoseAt: string | null;
				refills: { packsAdded: number; loosePillsAdded: number; usedPrescription: boolean; refillDate: string }[];
			}
		> = {};

		for (const medId of medicationIds) {
			const doses = dosesByMed.get(medId) ?? [];
			const takenDoses = doses.filter((d) => !d.dismissed);
			const automaticTakenDoses = takenDoses.filter((d) => d.takenSource === "automatic");
			const dismissedDoses = doses.filter((d) => d.dismissed);

			const sortedTaken = takenDoses.map((d) => d.takenAt.getTime()).sort((a, b) => a - b);

			// Get refills for this medication
			const refills = await db.select().from(refillHistory).where(eq(refillHistory.medicationId, medId));

			result[medId] = {
				dosesTaken: takenDoses.length,
				automaticDosesTaken: automaticTakenDoses.length,
				dosesDismissed: dismissedDoses.length,
				firstDoseAt: sortedTaken.length > 0 ? new Date(sortedTaken[0]).toISOString() : null,
				lastDoseAt: sortedTaken.length > 0 ? new Date(sortedTaken[sortedTaken.length - 1]).toISOString() : null,
				refills: refills.map((r) => ({
					packsAdded: r.packsAdded,
					loosePillsAdded: r.loosePillsAdded,
					usedPrescription: r.usedPrescription ?? false,
					refillDate: r.refillDate instanceof Date ? r.refillDate.toISOString() : String(r.refillDate),
				})),
			};
		}

		return result;
	});
}
