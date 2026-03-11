import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, medications, shareTokens } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	tokenParamsSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import { parseIntakesJson, parseTakenByJson, personTakesMedication } from "../utils/scheduler-utils.js";

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

const protectedEndpointSecurity: ReadonlyArray<Record<string, readonly string[]>> = [
	{ bearerAuth: [] },
	{ cookieAuth: [] },
];

const doseIdPattern = /^(\d+)-(\d+)-(\d+)(?:-(.+))?$/;

const doseReadResponseSchema = {
	type: "object",
	properties: {
		doses: {
			type: "array",
			items: {
				type: "object",
				properties: {
					doseId: { type: "string" },
					takenAt: { type: "number" },
					markedBy: { type: ["string", "null"] },
					takenSource: { type: "string" },
					dismissed: { type: "boolean" },
				},
			},
		},
	},
} as const;

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

	const expectedPersons = intake.takenBy ? [intake.takenBy] : medTakenBy;
	if (expectedPersons.length === 0) {
		return parsedDose.personSuffix === null;
	}

	if (!parsedDose.personSuffix) {
		return true;
	}

	return expectedPersons.includes(parsedDose.personSuffix);
}

// =============================================================================
// Dose Tracking Routes
// =============================================================================
export async function doseRoutes(app: FastifyInstance) {
	applyOpenApiRouteStandards(app, {
		tag: "doses",
		protectedByDefault: false,
		protectedPaths: [/^\/doses\/taken$/, /^\/doses\/taken\/:doseId$/, /^\/doses\/dismiss$/],
	});

	// ---------------------------------------------------------------------------
	// GET /doses/taken - PROTECTED: Get all taken doses for the user
	// Suppress request logs — polled every 5s by frontend
	// ---------------------------------------------------------------------------
	app.get(
		"/doses/taken",
		{
			preHandler: requireAuth,
			logLevel: "warn",
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				response: {
					200: doseReadResponseSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
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
		}
	);

	// ---------------------------------------------------------------------------
	// POST /doses/taken - PROTECTED: Mark a dose as taken
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof markDoseSchema> }>(
		"/doses/taken",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				body: {
					type: "object",
					properties: {
						doseId: { type: "string" },
					},
					example: {
						doseId: "1:2026-03-11T08:00:00.000Z:Daniel",
					},
				},
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							message: { type: "string" },
						},
					},
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
				},
			},
		},
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
		{
			preHandler: requireAuth,
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				params: {
					type: "object",
					required: ["doseId"],
					properties: {
						doseId: { type: "string", minLength: 1 },
					},
				},
				response: {
					200: { type: "object", properties: { success: { type: "boolean" } } },
					401: genericErrorSchema,
				},
			},
		},
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
		{
			preHandler: requireAuth,
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				body: {
					type: "object",
					properties: {
						doseIds: { type: "array", items: { type: "string" } },
					},
					example: {
						doseIds: ["1:2026-03-11T08:00:00.000Z:Daniel", "1:2026-03-11T20:00:00.000Z:Daniel"],
					},
				},
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							dismissedCount: { type: "integer" },
						},
					},
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
				},
			},
		},
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
						takenAt: new Date(0),
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
	app.delete(
		"/doses/dismiss",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["doses"],
				security: protectedEndpointSecurity,
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							clearedCount: { type: "integer" },
						},
					},
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			// Delete all dismissed-only records (not taken ones)
			// For taken+dismissed, just remove the dismissed flag
			const dismissed = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, userId), eq(doseTracking.dismissed, true)));

			for (const d of dismissed) {
				const hasRealTakenTimestamp = d.takenAt instanceof Date ? d.takenAt.getTime() > 0 : Boolean(d.takenAt);

				if (d.markedBy !== null || hasRealTakenTimestamp) {
					// This was also marked as taken - just remove dismissed flag
					await db.update(doseTracking).set({ dismissed: false }).where(eq(doseTracking.id, d.id));
				} else {
					// This was only dismissed - delete it
					await db.delete(doseTracking).where(eq(doseTracking.id, d.id));
				}
			}

			return { success: true, clearedCount: dismissed.length };
		}
	);

	// ---------------------------------------------------------------------------
	// GET /share/:token/doses - PUBLIC: Get taken doses for a share link
	// Suppress request logs — polled every 5s by SharedSchedule
	// ---------------------------------------------------------------------------
	app.get<{ Params: { token: string } }>(
		"/share/:token/doses",
		{
			schema: {
				params: tokenParamsSchema,
				response: {
					200: doseReadResponseSchema,
					404: genericErrorSchema,
				},
			},
			logLevel: "warn",
			config: {
				rateLimit: {
					max: 60,
					timeWindow: "1 minute",
					errorResponseBuilder: () => ({ error: "rate_limited" }),
				},
			},
		},
		async (request, reply) => {
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
		}
	);

	// ---------------------------------------------------------------------------
	// POST /share/:token/doses - PUBLIC: Mark a dose as taken via share link
	// ---------------------------------------------------------------------------
	app.post<{ Params: { token: string }; Body: z.infer<typeof shareDoseSchema> }>(
		"/share/:token/doses",
		{
			schema: {
				params: tokenParamsSchema,
				body: {
					type: "object",
					properties: {
						doseId: { type: "string" },
					},
					example: {
						doseId: "1:2026-03-11T08:00:00.000Z:Daniel",
					},
				},
				response: {
					200: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" } } },
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					404: genericErrorSchema,
				},
			},
		},
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
	app.delete<{ Params: { token: string; doseId: string } }>(
		"/share/:token/doses/:doseId",
		{
			schema: {
				params: {
					type: "object",
					required: ["token", "doseId"],
					properties: {
						token: tokenParamsSchema.properties.token,
						doseId: { type: "string", minLength: 1 },
					},
				},
				response: {
					200: { type: "object", properties: { success: { type: "boolean" } } },
					400: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
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
				await db
					.delete(doseTracking)
					.where(and(eq(doseTracking.userId, share.userId), eq(doseTracking.doseId, doseId)));
				request.log.info(
					`[ShareDose] Dose unmarked via share link (owner=${share.userId}, takenBy=${share.takenBy}, doseId=${doseId})`
				);
			}

			return { success: true };
		}
	);
}
