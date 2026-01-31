import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { medications, shareTokens, userSettings, users } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";
import { parseTakenByJson } from "../utils/scheduler-utils.js";

// Share token validity: 1 year in milliseconds
const SHARE_TOKEN_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

// =============================================================================
// Validation Schemas
// =============================================================================
const createShareSchema = z.object({
	takenBy: z.string().min(1, "takenBy is required"),
	scheduleDays: z.number().int().min(1).max(365).default(30),
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
// Share Routes
// =============================================================================
export async function shareRoutes(app: FastifyInstance) {
	// ---------------------------------------------------------------------------
	// GET /share/:token - PUBLIC: Get shared schedule by token
	// ---------------------------------------------------------------------------
	app.get<{ Params: { token: string } }>("/share/:token", async (request, reply) => {
		const { token } = request.params;

		// Find share token
		const [share] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
		if (!share) {
			return reply.status(404).send({
				error: "Share link not found",
				code: "NOT_FOUND",
			});
		}

		// Check if token has expired
		if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
			// Get the username of the owner to show in the expired message
			const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, share.userId));
			return reply.status(410).send({
				error: "Share link has expired",
				code: "EXPIRED",
				ownerUsername: owner?.username ?? "the owner",
				takenBy: share.takenBy,
				expiredAt: share.expiresAt.toISOString(),
			});
		}

		// Get user settings for stock thresholds
		const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, share.userId));

		// Get the username of the owner who created this share link
		const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, share.userId));

		// Get medications for this user filtered by takenBy (search in JSON array)
		// Use SQLite JSON function to check if takenBy is in the array
		const allMeds = await db.select().from(medications).where(eq(medications.userId, share.userId));

		// Filter medications where takenByJson array contains the share.takenBy value
		const meds = allMeds.filter((med) => {
			const takenByArray = parseTakenByJson(med.takenByJson);
			return takenByArray.includes(share.takenBy);
		});

		// Parse blisters and build schedule data
		const medicationsWithBlisters = meds.map((med) => {
			let blisters: { usage: number; every: number; start: string }[] = [];
			try {
				const usageArr = JSON.parse(med.usageJson || "[]");
				const everyArr = JSON.parse(med.everyJson || "[]");
				const startArr = JSON.parse(med.startJson || "[]");
				blisters = usageArr.map((usage: number, i: number) => ({
					usage,
					every: everyArr[i] ?? 1,
					start: startArr[i] ?? new Date().toISOString(),
				}));
			} catch {
				blisters = [];
			}

			// Parse takenBy JSON array
			const takenByArray = parseTakenByJson(med.takenByJson);

			const totalPills =
				med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets + (med.stockAdjustment ?? 0);
			return {
				id: med.id,
				name: med.name,
				genericName: med.genericName,
				pillWeightMg: med.pillWeightMg,
				imageUrl: med.imageUrl,
				totalPills,
				packCount: med.packCount,
				blistersPerPack: med.blistersPerPack,
				looseTablets: med.looseTablets,
				pillsPerBlister: med.pillsPerBlister,
				takenBy: takenByArray,
				blisters,
				dismissedUntil: med.dismissedUntil,
				updatedAt: med.updatedAt, // For filtering out doses from previous schedule configurations
			};
		});

		return {
			takenBy: share.takenBy,
			sharedBy: owner?.username ?? null,
			scheduleDays: share.scheduleDays,
			medications: medicationsWithBlisters,
			stockThresholds: {
				lowStockDays: settings?.lowStockDays ?? 30,
			},
		};
	});

	// ---------------------------------------------------------------------------
	// POST /share - PROTECTED: Create a new share link
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof createShareSchema> }>(
		"/share",
		{ preHandler: requireAuth },
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			const parsed = createShareSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: parsed.error.errors[0]?.message ?? "Invalid input",
					code: "VALIDATION_ERROR",
				});
			}

			const { takenBy, scheduleDays } = parsed.data;

			// Check if user has medications for this takenBy (search in JSON array)
			const allMeds = await db.select().from(medications).where(eq(medications.userId, userId));
			const medsForPerson = allMeds.filter((med) => {
				const takenByArray = parseTakenByJson(med.takenByJson);
				return takenByArray.includes(takenBy);
			});

			if (medsForPerson.length === 0) {
				return reply.status(400).send({
					error: "No medications found for this person",
					code: "NO_MEDICATIONS",
				});
			}

			// Generate unique token (8 bytes = 16 hex chars)
			const token = randomBytes(8).toString("hex");

			// Set expiration date (1 year from now)
			const expiresAt = new Date(Date.now() + SHARE_TOKEN_VALIDITY_MS);

			// Create share token
			await db.insert(shareTokens).values({
				userId: userId,
				token,
				takenBy,
				scheduleDays,
				expiresAt,
			});

			return {
				token,
				shareUrl: `/share/${token}`,
				expiresAt: expiresAt.toISOString(),
			};
		}
	);

	// ---------------------------------------------------------------------------
	// GET /share/people - PROTECTED: Get list of unique takenBy values
	// ---------------------------------------------------------------------------
	app.get("/share/people", { preHandler: requireAuth }, async (request, reply) => {
		const userId = await getUserId(request, reply);

		// Get all unique takenBy values for this user (from JSON arrays)
		const meds = await db
			.select({ takenByJson: medications.takenByJson })
			.from(medications)
			.where(eq(medications.userId, userId));

		// Collect all unique person names from all takenByJson arrays
		const allPeople = new Set<string>();
		for (const med of meds) {
			const takenByArray = parseTakenByJson(med.takenByJson);
			for (const person of takenByArray) {
				if (person) allPeople.add(person);
			}
		}

		return { people: [...allPeople].sort() };
	});
}
