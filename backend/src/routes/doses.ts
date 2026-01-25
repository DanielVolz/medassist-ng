import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, shareTokens } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";

// =============================================================================
// Validation Schemas
// =============================================================================
const markDoseSchema = z.object({
	doseId: z.string().min(1, "doseId is required"),
});

const shareDoseSchema = z.object({
	doseId: z.string().min(1, "doseId is required"),
});

const dismissDosesSchema = z.object({
	doseIds: z.array(z.string().min(1)).min(1, "At least one doseId is required"),
});

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

// =============================================================================
// Dose Tracking Routes
// =============================================================================
export async function doseRoutes(app: FastifyInstance) {
	// ---------------------------------------------------------------------------
	// GET /doses/taken - PROTECTED: Get all taken doses for the user
	// ---------------------------------------------------------------------------
	app.get("/doses/taken", { preHandler: requireAuth }, async (request, reply) => {
		const userId = await getUserId(request, reply);

		// Get all taken doses for this user (no time limit)
		const doses = await db.select().from(doseTracking).where(eq(doseTracking.userId, userId));

		return {
			doses: doses.map((d) => ({
				doseId: d.doseId,
				takenAt: d.takenAt?.getTime() ?? Date.now(),
				markedBy: d.markedBy,
				dismissed: d.dismissed ?? false,
			})),
		};
	});

	// ---------------------------------------------------------------------------
	// POST /doses/taken - PROTECTED: Mark a dose as taken
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof markDoseSchema> }>(
		"/doses/taken",
		{ preHandler: requireAuth },
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			const parsed = markDoseSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: parsed.error.errors[0]?.message ?? "Invalid input",
				});
			}

			const { doseId } = parsed.data;

			// Check if already marked
			const [existing] = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, userId), eq(doseTracking.doseId, doseId)));

			if (existing) {
				return { success: true, message: "Already marked" };
			}

			// Insert new record
			await db.insert(doseTracking).values({
				userId,
				doseId,
				markedBy: null, // Marked by the user themselves
			});

			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /doses/taken/:doseId - PROTECTED: Unmark a dose
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { doseId: string } }>(
		"/doses/taken/:doseId",
		{ preHandler: requireAuth },
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
	// POST /doses/dismiss - PROTECTED: Dismiss missed doses without deducting stock
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof dismissDosesSchema> }>(
		"/doses/dismiss",
		{ preHandler: requireAuth },
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			const parsed = dismissDosesSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: parsed.error.errors[0]?.message ?? "Invalid input",
				});
			}

			const { doseIds } = parsed.data;

			// Insert dismissed records for each dose that doesn't exist yet
			let dismissedCount = 0;
			for (const doseId of doseIds) {
				// Check if already exists (taken or dismissed)
				const [existing] = await db
					.select()
					.from(doseTracking)
					.where(and(eq(doseTracking.userId, userId), eq(doseTracking.doseId, doseId)));

				if (existing) {
					// Already exists - update to dismissed if not already
					if (!existing.dismissed) {
						await db
							.update(doseTracking)
							.set({ dismissed: true })
							.where(and(eq(doseTracking.userId, userId), eq(doseTracking.doseId, doseId)));
						dismissedCount++;
					}
				} else {
					// Create new dismissed record
					await db.insert(doseTracking).values({
						userId,
						doseId,
						markedBy: null,
						dismissed: true,
					});
					dismissedCount++;
				}
			}

			return { success: true, dismissedCount };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /doses/dismiss - PROTECTED: Clear all dismissed doses (un-dismiss)
	// ---------------------------------------------------------------------------
	app.delete("/doses/dismiss", { preHandler: requireAuth }, async (request, reply) => {
		const userId = await getUserId(request, reply);

		// Delete all dismissed-only records (not taken ones)
		// For taken+dismissed, just remove the dismissed flag
		const dismissed = await db
			.select()
			.from(doseTracking)
			.where(and(eq(doseTracking.userId, userId), eq(doseTracking.dismissed, true)));

		for (const d of dismissed) {
			if (d.markedBy !== null || d.takenAt) {
				// This was also marked as taken - just remove dismissed flag
				await db.update(doseTracking).set({ dismissed: false }).where(eq(doseTracking.id, d.id));
			} else {
				// This was only dismissed - delete it
				await db.delete(doseTracking).where(eq(doseTracking.id, d.id));
			}
		}

		return { success: true, clearedCount: dismissed.length };
	});

	// ---------------------------------------------------------------------------
	// GET /share/:token/doses - PUBLIC: Get taken doses for a share link
	// ---------------------------------------------------------------------------
	app.get<{ Params: { token: string } }>("/share/:token/doses", async (request, reply) => {
		const { token } = request.params;

		// Find share token
		const [share] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
		if (!share) {
			return reply.notFound("Share link not found");
		}

		// Get all taken doses for this user (no time limit)
		const doses = await db.select().from(doseTracking).where(eq(doseTracking.userId, share.userId));

		return {
			doses: doses.map((d) => ({
				doseId: d.doseId,
				takenAt: d.takenAt?.getTime() ?? Date.now(),
				markedBy: d.markedBy,
				dismissed: d.dismissed ?? false,
			})),
		};
	});

	// ---------------------------------------------------------------------------
	// POST /share/:token/doses - PUBLIC: Mark a dose as taken via share link
	// ---------------------------------------------------------------------------
	app.post<{ Params: { token: string }; Body: z.infer<typeof shareDoseSchema> }>(
		"/share/:token/doses",
		async (request, reply) => {
			const { token } = request.params;

			const parsed = shareDoseSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: parsed.error.errors[0]?.message ?? "Invalid input",
				});
			}

			const { doseId } = parsed.data;

			// Find share token
			const [share] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
			if (!share) {
				return reply.notFound("Share link not found");
			}

			// Check if already marked
			const [existing] = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));

			if (existing) {
				return { success: true, message: "Already marked" };
			}

			// Insert new record - marked by the takenBy person
			await db.insert(doseTracking).values({
				userId: share.userId,
				doseId,
				markedBy: share.takenBy, // e.g. "Daniel"
			});

			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /share/:token/doses/:doseId - PUBLIC: Unmark a dose via share link
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { token: string; doseId: string } }>("/share/:token/doses/:doseId", async (request, reply) => {
		const { token, doseId } = request.params;

		// Find share token
		const [share] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
		if (!share) {
			return reply.notFound("Share link not found");
		}

		// Check if this dose was dismissed
		const [existing] = await db
			.select()
			.from(doseTracking)
			.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));

		if (existing?.dismissed) {
			// Already dismissed - keep the record as-is
		} else {
			// Not dismissed - delete the record entirely
			await db.delete(doseTracking).where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));
		}

		return { success: true };
	});
}
