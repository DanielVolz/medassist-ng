import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, medications, shareTokens, userSettings, users } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { buildSharedMedicationOverview } from "../services/coverage.js";
import type { AuthUser } from "../types/fastify.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	tokenParamsSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import { isAmountBasedPackageType, normalizePackageType } from "../utils/package-profiles.js";
import {
	getAllTakenByForMedication,
	parseIntakesJson,
	parseTakenByJson,
	personTakesMedication,
} from "../utils/scheduler-utils.js";

// =============================================================================
// Validation Schemas
// =============================================================================
const createShareSchema = z.object({
	takenBy: z.string().min(1, "takenBy is required"),
	scheduleDays: z.number().int().min(1).max(365).default(30),
});

const protectedEndpointSecurity: ReadonlyArray<Record<string, readonly string[]>> = [
	{ bearerAuth: [] },
	{ cookieAuth: [] },
];

const shareTokenPattern = /^[a-f0-9]{16}$/;

const createShareBodyOpenApiSchema = {
	type: "object",
	properties: {
		takenBy: { type: "string" },
		scheduleDays: { type: "integer", minimum: 1, maximum: 365, default: 30 },
	},
	example: {
		takenBy: "Daniel",
		scheduleDays: 14,
	},
} as const;

const shareReadResponseSchema = {
	type: "object",
	properties: {
		takenBy: { type: "string" },
		sharedBy: { type: "string" },
		scheduleDays: { type: "integer" },
		medications: { type: "array", items: { type: "object", additionalProperties: true } },
		stockThresholds: { type: "object", additionalProperties: { type: "number" } },
		stockCalculationMode: { type: "string", enum: ["automatic", "manual"] },
		shareStockStatus: { type: "boolean" },
		upcomingTodayOnly: { type: "boolean" },
		shareScheduleTodayOnly: { type: "boolean" },
	},
} as const;

const shareExpiredResponseSchema = {
	type: "object",
	properties: {
		error: { type: "string" },
		code: { type: "string" },
		ownerUsername: { type: "string" },
		takenBy: { type: "string" },
		expiredAt: { type: "string", format: "date-time" },
	},
} as const;

const shareOverviewExpiredResponseSchema = {
	type: "object",
	properties: {
		error: { type: "string" },
		expiredAt: { type: "string", format: "date-time" },
	},
} as const;

const shareOverviewResponseSchema = {
	type: "object",
	properties: {
		takenBy: { type: "string" },
		sharedBy: { type: "string" },
		generatedAt: { type: "string", format: "date-time" },
		medications: { type: "array", items: { type: "object", additionalProperties: true } },
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

// =============================================================================
// Share Routes
// =============================================================================
export async function shareRoutes(app: FastifyInstance) {
	applyOpenApiRouteStandards(app, {
		tag: "share",
		protectedByDefault: false,
		protectedPaths: [/^\/share$/, /^\/share\/people$/],
	});

	// ---------------------------------------------------------------------------
	// GET /share/:token - PUBLIC: Get shared schedule by token
	// ---------------------------------------------------------------------------
	app.get<{ Params: { token: string } }>(
		"/share/:token",
		{
			schema: {
				params: tokenParamsSchema,
				response: {
					200: shareReadResponseSchema,
					404: genericErrorSchema,
					410: shareExpiredResponseSchema,
				},
			},
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

			// Find share token
			const [share] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
			if (!share) {
				request.log.warn(`[Share] Invalid share token requested: ${maskToken(token)}`);
				return reply.status(404).send({
					error: "Share link not found",
					code: "NOT_FOUND",
				});
			}

			// Check if token has expired
			if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
				request.log.warn(
					`[Share] Expired token requested: ${maskToken(token)} (owner=${share.userId}, takenBy=${share.takenBy})`
				);
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

			// Filter medications where takenBy matches either medication-level OR any intake-level takenBy
			const meds = allMeds.filter((med) => {
				const takenByArray = parseTakenByJson(med.takenByJson);
				const intakes = parseIntakesJson(
					med.intakesJson,
					{ usageJson: med.usageJson, everyJson: med.everyJson, startJson: med.startJson },
					med.intakeRemindersEnabled ?? false
				);
				return personTakesMedication(share.takenBy, takenByArray, intakes);
			});

			// Parse blisters and build schedule data
			const medicationsWithBlisters = meds.map((med) => {
				// Parse intakes from new format, falling back to legacy
				const intakes = parseIntakesJson(
					med.intakesJson,
					{ usageJson: med.usageJson, everyJson: med.everyJson, startJson: med.startJson },
					med.intakeRemindersEnabled ?? false
				);

				// Convert to legacy blisters format for backward compat
				const blisters = intakes.map((i) => ({
					usage: i.usage,
					every: i.every,
					start: i.start,
				}));

				// Parse takenBy JSON array
				const takenByArray = parseTakenByJson(med.takenByJson);

				const totalPills = isAmountBasedPackageType(med.packageType)
					? med.looseTablets + (med.stockAdjustment ?? 0)
					: med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets + (med.stockAdjustment ?? 0);
				return {
					id: med.id,
					name: med.name,
					genericName: med.genericName,
					pillWeightMg: med.pillWeightMg,
					doseUnit: med.doseUnit ?? "mg",
					imageUrl: med.imageUrl,
					totalPills,
					packageType: normalizePackageType(med.packageType),
					packCount: med.packCount,
					blistersPerPack: med.blistersPerPack,
					looseTablets: med.looseTablets,
					pillsPerBlister: med.pillsPerBlister,
					takenBy: takenByArray,
					intakes, // New unified format with per-intake takenBy
					blisters, // Legacy format for backward compat
					dismissedUntil: med.dismissedUntil,
					updatedAt: med.updatedAt, // For filtering out doses from previous schedule configurations
					lastStockCorrectionAt: med.lastStockCorrectionAt?.getTime() ?? null,
					stockAdjustment: med.stockAdjustment ?? 0,
				};
			});

			return {
				takenBy: share.takenBy,
				sharedBy: owner?.username ?? null,
				scheduleDays: share.scheduleDays,
				medications: medicationsWithBlisters,
				stockThresholds: {
					lowStockDays: settings?.lowStockDays ?? 30,
					normalStockDays: settings?.normalStockDays ?? 60,
					highStockDays: settings?.highStockDays ?? 90,
					reminderDaysBefore: settings?.reminderDaysBefore ?? 7,
					expiryWarningDays: settings?.expiryWarningDays ?? 90,
				},
				stockCalculationMode: (settings?.stockCalculationMode as "automatic" | "manual") ?? "automatic",
				shareStockStatus: settings?.shareStockStatus ?? true,
				upcomingTodayOnly: settings?.upcomingTodayOnly ?? false,
				shareScheduleTodayOnly: settings?.shareScheduleTodayOnly ?? false,
			};
		}
	);

	// ---------------------------------------------------------------------------
	// GET /share/:token/overview - PUBLIC: Read-only medication overview by token
	// ---------------------------------------------------------------------------
	app.get<{ Params: { token: string } }>(
		"/share/:token/overview",
		{
			schema: {
				params: tokenParamsSchema,
				response: {
					200: shareOverviewResponseSchema,
					404: genericErrorSchema,
					410: shareOverviewExpiredResponseSchema,
				},
			},
			config: {
				rateLimit: {
					max: 60,
					timeWindow: "1 minute",
					errorResponseBuilder: () => ({ error: "rate_limited" }),
				},
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");

			const { token } = request.params;
			if (!shareTokenPattern.test(token)) {
				request.log.warn(`[ShareOverview] Rejected invalid token format: ${maskToken(token)}`);
				return reply.status(404).send({ error: "not_found" });
			}

			const [share] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
			if (!share) {
				request.log.warn(`[ShareOverview] Unknown token requested: ${maskToken(token)}`);
				return reply.status(404).send({ error: "not_found" });
			}

			if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
				request.log.warn(
					`[ShareOverview] Expired token requested: ${maskToken(token)} (owner=${share.userId}, takenBy=${share.takenBy})`
				);
				return reply.status(410).send({
					error: "expired",
					expiredAt: share.expiresAt.toISOString(),
				});
			}

			const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, share.userId));
			const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, share.userId));

			const allMeds = await db.select().from(medications).where(eq(medications.userId, share.userId));
			const meds = allMeds.filter((med) => {
				const takenByArray = parseTakenByJson(med.takenByJson);
				const intakes = parseIntakesJson(
					med.intakesJson,
					{ usageJson: med.usageJson, everyJson: med.everyJson, startJson: med.startJson },
					med.intakeRemindersEnabled ?? false
				);
				return personTakesMedication(share.takenBy, takenByArray, intakes);
			});

			const doses = await db.select().from(doseTracking).where(eq(doseTracking.userId, share.userId));

			const overview = buildSharedMedicationOverview({
				medications: meds,
				doses,
				thresholdDays: settings?.lowStockDays ?? 30,
				shareStockStatus: settings?.shareStockStatus ?? true,
			});

			return {
				takenBy: share.takenBy,
				sharedBy: owner?.username ?? null,
				generatedAt: new Date().toISOString(),
				medications: overview,
			};
		}
	);

	// ---------------------------------------------------------------------------
	// POST /share - PROTECTED: Create a new share link
	// ---------------------------------------------------------------------------
	app.post<{ Body: z.infer<typeof createShareSchema> }>(
		"/share",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["share"],
				security: protectedEndpointSecurity,
				body: createShareBodyOpenApiSchema,
				response: {
					200: {
						type: "object",
						properties: {
							reused: { type: "boolean" },
							token: { type: "string" },
							shareUrl: { type: "string" },
							expiresAt: { type: ["string", "null"] },
						},
					},
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
				},
			},
		},
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

			// Check if user has medications for this takenBy (search in both medication-level and intake-level)
			const allMeds = await db.select().from(medications).where(eq(medications.userId, userId));
			const medsForPerson = allMeds.filter((med) => {
				const takenByArray = parseTakenByJson(med.takenByJson);
				const intakes = parseIntakesJson(
					med.intakesJson,
					{ usageJson: med.usageJson, everyJson: med.everyJson, startJson: med.startJson },
					med.intakeRemindersEnabled ?? false
				);
				return personTakesMedication(takenBy, takenByArray, intakes);
			});

			if (medsForPerson.length === 0) {
				return reply.status(400).send({
					error: "No medications found for this person",
					code: "NO_MEDICATIONS",
				});
			}

			// Keep exactly one active share link per person/user.
			// If a link already exists, return the same token and only update settings.
			const [existingShare] = await db
				.select()
				.from(shareTokens)
				.where(and(eq(shareTokens.userId, userId), eq(shareTokens.takenBy, takenBy)));

			if (existingShare) {
				await db.update(shareTokens).set({ scheduleDays, expiresAt: null }).where(eq(shareTokens.id, existingShare.id));

				request.log.info(
					`[Share] Reused existing share token (owner=${userId}, takenBy=${takenBy}, scheduleDays=${scheduleDays})`
				);

				return {
					reused: true,
					token: existingShare.token,
					shareUrl: `/share/${existingShare.token}`,
					expiresAt: null,
				};
			}

			const token = randomBytes(8).toString("hex");

			await db.insert(shareTokens).values({
				userId,
				token,
				takenBy,
				scheduleDays,
				expiresAt: null,
			});

			request.log.info(
				`[Share] Created new share token (owner=${userId}, takenBy=${takenBy}, scheduleDays=${scheduleDays})`
			);

			return {
				reused: false,
				token,
				shareUrl: `/share/${token}`,
				expiresAt: null,
			};
		}
	);

	// ---------------------------------------------------------------------------
	// GET /share/people - PROTECTED: Get list of unique takenBy values
	// ---------------------------------------------------------------------------
	app.get(
		"/share/people",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["share"],
				security: protectedEndpointSecurity,
				response: {
					200: {
						type: "object",
						properties: {
							people: { type: "array", items: { type: "string" } },
						},
					},
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);

			// Get all unique takenBy values for this user (from both medication-level and intake-level)
			const meds = await db
				.select({
					takenByJson: medications.takenByJson,
					intakesJson: medications.intakesJson,
					usageJson: medications.usageJson,
					everyJson: medications.everyJson,
					startJson: medications.startJson,
					intakeRemindersEnabled: medications.intakeRemindersEnabled,
				})
				.from(medications)
				.where(eq(medications.userId, userId));

			// Collect all unique person names from medication-level AND intake-level takenBy
			const allPeople = new Set<string>();
			for (const med of meds) {
				const takenByArray = parseTakenByJson(med.takenByJson);
				const intakes = parseIntakesJson(
					med.intakesJson,
					{ usageJson: med.usageJson, everyJson: med.everyJson, startJson: med.startJson },
					med.intakeRemindersEnabled ?? false
				);
				const allForMed = getAllTakenByForMedication(takenByArray, intakes);
				for (const person of allForMed) {
					if (person) allPeople.add(person);
				}
			}

			return { people: [...allPeople].sort() };
		}
	);
}
