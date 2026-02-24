import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, medications, shareTokens } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";
import {
	parseIntakesJson,
	parseLocalDateTime,
	parseTakenByJson,
	personTakesMedication,
} from "../utils/scheduler-utils.js";

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

const doseIdPattern = /^(\d+)-(\d+)-(\d+)(?:-(.+))?$/;
const MAX_SCHEDULE_VALIDATION_STEPS = 40000;

function maskToken(token: string): string {
	if (token.length <= 8) return token;
	return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

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

type ParsedDoseId = {
	medicationId: number;
	intakeIndex: number;
	timestampMs: number;
	personSuffix: string | null;
};

function parseDoseId(doseId: string): ParsedDoseId | null {
	const match = doseIdPattern.exec(doseId);
	if (!match) return null;

	const medicationId = Number.parseInt(match[1], 10);
	const intakeIndex = Number.parseInt(match[2], 10);
	const timestampMs = Number.parseInt(match[3], 10);
	const personSuffix = match[4] ? match[4].trim() : null;

	if (Number.isNaN(medicationId) || Number.isNaN(intakeIndex) || Number.isNaN(timestampMs) || intakeIndex < 0) {
		return null;
	}

	return {
		medicationId,
		intakeIndex,
		timestampMs,
		personSuffix,
	};
}

function isSameDate(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isScheduledDate(timestampMs: number, startLocal: string, everyDays: number): boolean {
	if (!Number.isFinite(timestampMs) || everyDays < 1) return false;

	const targetDate = new Date(timestampMs);
	if (Number.isNaN(targetDate.getTime())) return false;

	const targetDateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
	const startDate = parseLocalDateTime(startLocal);
	const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());

	if (targetDateOnly < startDateOnly) return false;

	const cursor = new Date(startDateOnly);
	let steps = 0;
	while (cursor <= targetDateOnly && steps < MAX_SCHEDULE_VALIDATION_STEPS) {
		if (isSameDate(cursor, targetDateOnly)) {
			return true;
		}
		cursor.setDate(cursor.getDate() + everyDays);
		steps += 1;
	}

	return false;
}

async function getActiveShareToken(token: string): Promise<{
	share: typeof shareTokens.$inferSelect | null;
	reason: "not_found" | "expired" | "ok";
}> {
	const [share] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
	if (!share) return { share: null, reason: "not_found" };

	if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
		return { share: null, reason: "expired" };
	}

	return { share, reason: "ok" };
}

async function validateShareDoseId(share: typeof shareTokens.$inferSelect, doseId: string): Promise<boolean> {
	const parsedDose = parseDoseId(doseId);
	if (!parsedDose) {
		return false;
	}

	const [medication] = await db
		.select()
		.from(medications)
		.where(and(eq(medications.id, parsedDose.medicationId), eq(medications.userId, share.userId)));

	if (!medication) {
		return false;
	}

	const medTakenBy = parseTakenByJson(medication.takenByJson);
	const intakes = parseIntakesJson(
		medication.intakesJson,
		{ usageJson: medication.usageJson, everyJson: medication.everyJson, startJson: medication.startJson },
		medication.intakeRemindersEnabled ?? false
	);

	if (!personTakesMedication(share.takenBy, medTakenBy, intakes)) {
		return false;
	}

	const intake = intakes[parsedDose.intakeIndex];
	if (!intake) {
		return false;
	}

	if (!isScheduledDate(parsedDose.timestampMs, intake.start, intake.every)) {
		return false;
	}

	const expectedPersons = intake.takenBy ? [intake.takenBy] : medTakenBy;
	if (expectedPersons.length === 0) {
		return parsedDose.personSuffix === null;
	}

	if (!parsedDose.personSuffix) {
		return false;
	}

	return expectedPersons.includes(parsedDose.personSuffix);
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
				takenSource: d.takenSource ?? "manual",
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
				takenSource: "manual",
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

		const { share, reason } = await getActiveShareToken(token);
		if (!share) {
			request.log.warn(`[ShareDose] Rejected read for token ${maskToken(token)} (reason=${reason})`);
			return reply.notFound("Share link not found");
		}

		// Get all taken doses for this user (no time limit)
		const doses = await db.select().from(doseTracking).where(eq(doseTracking.userId, share.userId));

		return {
			doses: doses.map((d) => ({
				doseId: d.doseId,
				takenAt: d.takenAt?.getTime() ?? Date.now(),
				markedBy: d.markedBy,
				takenSource: d.takenSource ?? "manual",
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

			const { share, reason } = await getActiveShareToken(token);
			if (!share) {
				request.log.warn(`[ShareDose] Rejected mark for token ${maskToken(token)} (reason=${reason})`);
				return reply.notFound("Share link not found");
			}

			const isValidShareDoseId = await validateShareDoseId(share, doseId);
			if (!isValidShareDoseId) {
				request.log.warn(
					`[ShareDose] Rejected invalid doseId in mark request (owner=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId})`
				);
				return reply.status(400).send({ error: "Invalid or unauthorized doseId" });
			}

			// Check if already marked
			const [existing] = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));

			if (existing) {
				request.log.debug(`[ShareDose] Duplicate mark ignored (owner=${share.userId}, doseId=${doseId})`);
				return { success: true, message: "Already marked" };
			}

			// Insert new record - marked by the takenBy person
			await db.insert(doseTracking).values({
				userId: share.userId,
				doseId,
				markedBy: share.takenBy, // e.g. "Daniel"
				takenSource: "manual",
			});

			request.log.info(
				`[ShareDose] Dose marked via share link (owner=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId})`
			);

			return { success: true };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /share/:token/doses/:doseId - PUBLIC: Unmark a dose via share link
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { token: string; doseId: string } }>("/share/:token/doses/:doseId", async (request, reply) => {
		const { token, doseId } = request.params;

		const { share, reason } = await getActiveShareToken(token);
		if (!share) {
			request.log.warn(`[ShareDose] Rejected unmark for token ${maskToken(token)} (reason=${reason})`);
			return reply.notFound("Share link not found");
		}

		const isValidShareDoseId = await validateShareDoseId(share, doseId);
		if (!isValidShareDoseId) {
			request.log.warn(
				`[ShareDose] Rejected invalid doseId in unmark request (owner=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId})`
			);
			return reply.status(400).send({ error: "Invalid or unauthorized doseId" });
		}

		// Check if this dose was dismissed
		const [existing] = await db
			.select()
			.from(doseTracking)
			.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));

		if (existing?.dismissed) {
			// Already dismissed - keep the record as-is
			request.log.debug(`[ShareDose] Unmark ignored for dismissed dose (owner=${share.userId}, doseId=${doseId})`);
		} else {
			// Not dismissed - delete the record entirely
			await db.delete(doseTracking).where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));
			request.log.info(
				`[ShareDose] Dose unmarked via share link (owner=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId})`
			);
		}

		return { success: true };
	});
}
