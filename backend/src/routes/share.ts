import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, medications, shareTokens, userSettings, users } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { buildSharedMedicationOverview } from "../services/coverage.js";
import { generateShareToken, getActiveShareToken, isShareTokenFormat } from "../services/share-token-service.js";
import type { AuthUser } from "../types/fastify.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	tokenParamsSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import { isAmountBasedPackageType, normalizePackageType } from "../utils/package-profiles.js";
import { tokenFingerprint } from "../utils/redaction.js";
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
	expiryDays: z.union([z.number().int().min(1).max(365), z.null()]).optional(),
	allowJournalNotes: z.boolean().optional().default(false),
	allowMarkTaken: z.boolean().optional().default(false),
});

const protectedEndpointSecurity: ReadonlyArray<Record<string, readonly string[]>> = [
	{ bearerAuth: [] },
	{ cookieAuth: [] },
];

function toIsoTimestamp(value: Date | string | number | null | undefined): string | null {
	if (value == null) {
		return null;
	}

	try {
		if (value instanceof Date) {
			return Number.isNaN(value.getTime()) ? null : value.toISOString();
		}

		if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
			const numericValue = typeof value === "number" ? value : Number(value);
			const timestampMs = numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
			const date = new Date(timestampMs);
			return Number.isNaN(date.getTime()) ? null : date.toISOString();
		}

		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	} catch {
		return null;
	}
}

function resolveExpiryDate(expiryDays: number | null | undefined): Date | null {
	const effectiveExpiryDays = expiryDays === undefined ? (env.SHARE_TOKEN_TTL_DAYS ?? 90) : expiryDays;
	if (effectiveExpiryDays == null) {
		return null;
	}

	return new Date(Date.now() + effectiveExpiryDays * 24 * 60 * 60 * 1000);
}

function isExpiredTimestamp(value: Date | string | number | null | undefined): boolean {
	const isoValue = toIsoTimestamp(value);
	return isoValue != null && new Date(isoValue).getTime() < Date.now();
}

const createShareBodyOpenApiSchema = {
	type: "object",
	properties: {
		takenBy: { type: "string" },
		scheduleDays: { type: "integer", minimum: 1, maximum: 365, default: 30 },
		allowMarkTaken: { type: "boolean", default: false },
		allowJournalNotes: { type: "boolean", default: false },
		expiryDays: {
			anyOf: [{ type: "integer", minimum: 1, maximum: 365 }, { type: "null" }],
			default: 90,
		},
	},
	example: {
		takenBy: "Daniel",
		scheduleDays: 14,
		allowMarkTaken: true,
		allowJournalNotes: true,
		expiryDays: 30,
	},
} as const;

const shareReadResponseSchema = {
	type: "object",
	properties: {
		takenBy: { type: "string" },
		sharedBy: { type: "string" },
		scheduleDays: { type: "integer" },
		medications: { type: "array", items: { type: "object", additionalProperties: true } },
		shareMedicationOverview: { type: "boolean" },
		medicationOverview: {
			anyOf: [{ type: "array", items: { type: "object", additionalProperties: true } }, { type: "null" }],
		},
		stockThresholds: { type: "object", additionalProperties: { type: "number" } },
		stockCalculationMode: { type: "string", enum: ["automatic", "manual"] },
		upcomingTodayOnly: { type: "boolean" },
		shareScheduleTodayOnly: { type: "boolean" },
		allowJournalNotes: { type: "boolean" },
		allowMarkTaken: { type: "boolean" },
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

const shareListResponseSchema = {
	type: "object",
	properties: {
		shareLinks: {
			type: "array",
			items: {
				type: "object",
				properties: {
					token: { type: "string" },
					takenBy: { type: "string" },
					scheduleDays: { type: "integer" },
					createdAt: { type: "string", format: "date-time" },
					expiresAt: { type: ["string", "null"], format: "date-time" },
					lastUsedAt: { type: ["string", "null"], format: "date-time" },
					allowJournalNotes: { type: "boolean" },
					allowMarkTaken: { type: "boolean" },
					legacyNeverExpires: { type: "boolean" },
					shareUrl: { type: "string" },
				},
				required: [
					"token",
					"takenBy",
					"scheduleDays",
					"createdAt",
					"expiresAt",
					"lastUsedAt",
					"allowJournalNotes",
					"allowMarkTaken",
					"legacyNeverExpires",
					"shareUrl",
				],
			},
		},
	},
	required: ["shareLinks"],
} as const;

const ownerTokenParamsSchema = {
	type: "object",
	properties: {
		token: { type: "string" },
	},
	required: ["token"],
} as const;

function isShareRevoked(share: typeof shareTokens.$inferSelect): boolean {
	return share.revokedAt != null;
}

function isShareActive(share: typeof shareTokens.$inferSelect): boolean {
	return !isShareRevoked(share) && !isExpiredTimestamp(share.expiresAt);
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
			logLevel: "warn",
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
					errorResponseBuilder: () => ({ statusCode: 429, error: "rate_limited" }),
				},
			},
		},
		async (request, reply) => {
			const { token } = request.params;
			const fingerprint = tokenFingerprint(token);

			const { share, reason } = await getActiveShareToken(token);
			if (!share || reason === "invalid_format" || reason === "not_found" || reason === "revoked") {
				request.log.warn(`[Share] Rejected share token request: tokenFingerprint=${fingerprint}, reason=${reason}`);
				return reply.status(404).send({
					error: "Share link not found",
					code: "NOT_FOUND",
				});
			}

			// Check if token has expired
			if (reason === "expired" && share.expiresAt) {
				request.log.warn(
					`[Share] Expired token requested: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}`
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
			const allMeds = await db
				.select()
				.from(medications)
				.where(and(eq(medications.userId, share.userId), eq(medications.isObsolete, false)));

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

			const shareMedicationOverview = settings?.shareMedicationOverview ?? false;
			const medicationOverview = shareMedicationOverview
				? buildSharedMedicationOverview({
						medications: meds,
						doses: await db.select().from(doseTracking).where(eq(doseTracking.userId, share.userId)),
						thresholdDays: settings?.lowStockDays ?? 30,
					})
				: null;

			return {
				takenBy: share.takenBy,
				sharedBy: owner?.username ?? null,
				scheduleDays: share.scheduleDays,
				allowJournalNotes: share.allowJournalNotes ?? false,
				allowMarkTaken: share.allowMarkTaken ?? true,
				medications: medicationsWithBlisters,
				shareMedicationOverview,
				medicationOverview,
				stockThresholds: {
					lowStockDays: settings?.lowStockDays ?? 30,
					normalStockDays: settings?.normalStockDays ?? 60,
					highStockDays: settings?.highStockDays ?? 90,
					reminderDaysBefore: settings?.reminderDaysBefore ?? 7,
					expiryWarningDays: settings?.expiryWarningDays ?? 90,
				},
				stockCalculationMode: (settings?.stockCalculationMode as "automatic" | "manual") ?? "automatic",
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
			logLevel: "warn",
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
					errorResponseBuilder: () => ({ statusCode: 429, error: "rate_limited" }),
				},
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");

			const { token } = request.params;
			const fingerprint = tokenFingerprint(token);
			if (!isShareTokenFormat(token)) {
				request.log.warn(`[ShareOverview] Rejected invalid token format: tokenFingerprint=${fingerprint}`);
				return reply.status(404).send({ error: "not_found" });
			}

			const { share, reason } = await getActiveShareToken(token);
			if (!share || reason === "not_found" || reason === "revoked") {
				request.log.warn(`[ShareOverview] Rejected token request: tokenFingerprint=${fingerprint}, reason=${reason}`);
				return reply.status(404).send({ error: "not_found" });
			}

			if (reason === "expired" && share.expiresAt) {
				request.log.warn(
					`[ShareOverview] Expired token requested: tokenFingerprint=${fingerprint}, ownerUserId=${share.userId}`
				);
				return reply.status(410).send({
					error: "expired",
					expiredAt: share.expiresAt.toISOString(),
				});
			}

			const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, share.userId));
			const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, share.userId));

			const allMeds = await db
				.select()
				.from(medications)
				.where(and(eq(medications.userId, share.userId), eq(medications.isObsolete, false)));
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
							allowJournalNotes: { type: "boolean" },
							allowMarkTaken: { type: "boolean" },
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
					error: parsed.error.issues[0]?.message ?? "Invalid input",
					code: "VALIDATION_ERROR",
				});
			}

			const { takenBy, scheduleDays, expiryDays, allowJournalNotes, allowMarkTaken } = parsed.data;
			const expiresAt = resolveExpiryDate(expiryDays);

			// Check if user has medications for this takenBy (search in both medication-level and intake-level)
			const allMeds = await db
				.select()
				.from(medications)
				.where(and(eq(medications.userId, userId), eq(medications.isObsolete, false)));
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
			const existingShares = await db
				.select()
				.from(shareTokens)
				.where(and(eq(shareTokens.userId, userId), eq(shareTokens.takenBy, takenBy)));
			const existingShare = existingShares.find(isShareActive);

			if (existingShare) {
				const existingTokenFingerprint = tokenFingerprint(existingShare.token);
				await db
					.update(shareTokens)
					.set({ scheduleDays, expiresAt, allowJournalNotes, allowMarkTaken })
					.where(eq(shareTokens.id, existingShare.id));

				request.log.info(
					`[Share] Reused existing share token: tokenFingerprint=${existingTokenFingerprint}, ownerUserId=${userId}, scheduleDays=${scheduleDays}, allowMarkTaken=${allowMarkTaken}, allowJournalNotes=${allowJournalNotes}, expiresAt=${expiresAt?.toISOString() ?? "never"}`
				);

				return {
					reused: true,
					token: existingShare.token,
					shareUrl: `/share/${existingShare.token}`,
					allowJournalNotes,
					allowMarkTaken,
					expiresAt: toIsoTimestamp(expiresAt),
				};
			}

			const token = generateShareToken();
			const fingerprint = tokenFingerprint(token);

			await db.insert(shareTokens).values({
				userId,
				token,
				takenBy,
				scheduleDays,
				allowJournalNotes,
				allowMarkTaken,
				expiresAt,
			});

			request.log.info(
				`[Share] Created new share token: tokenFingerprint=${fingerprint}, ownerUserId=${userId}, scheduleDays=${scheduleDays}, allowMarkTaken=${allowMarkTaken}, allowJournalNotes=${allowJournalNotes}, expiresAt=${expiresAt?.toISOString() ?? "never"}`
			);

			return {
				reused: false,
				token,
				shareUrl: `/share/${token}`,
				allowJournalNotes,
				allowMarkTaken,
				expiresAt: toIsoTimestamp(expiresAt),
			};
		}
	);

	// ---------------------------------------------------------------------------
	// GET /share - PROTECTED: List active share links for current owner
	// ---------------------------------------------------------------------------
	app.get(
		"/share",
		{
			preHandler: requireAuth,
			schema: {
				tags: ["share"],
				security: protectedEndpointSecurity,
				response: {
					200: shareListResponseSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const shares = await db
				.select()
				.from(shareTokens)
				.where(eq(shareTokens.userId, userId))
				.orderBy(desc(shareTokens.createdAt));

			return {
				shareLinks: shares.filter(isShareActive).map((share) => ({
					token: share.token,
					takenBy: share.takenBy,
					scheduleDays: share.scheduleDays,
					createdAt: toIsoTimestamp(share.createdAt) ?? new Date().toISOString(),
					expiresAt: toIsoTimestamp(share.expiresAt),
					lastUsedAt: toIsoTimestamp(share.lastUsedAt),
					allowJournalNotes: share.allowJournalNotes ?? false,
					allowMarkTaken: share.allowMarkTaken ?? true,
					legacyNeverExpires: share.expiresAt == null,
					shareUrl: `/share/${share.token}`,
				})),
			};
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /share/:token - PROTECTED: Revoke an existing share link
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { token: string } }>(
		"/share/:token",
		{
			preHandler: requireAuth,
			logLevel: "warn",
			schema: {
				tags: ["share"],
				security: protectedEndpointSecurity,
				params: ownerTokenParamsSchema,
				response: {
					204: { type: "null" },
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const { token } = request.params;
			const fingerprint = tokenFingerprint(token);

			const [share] = await db
				.select()
				.from(shareTokens)
				.where(and(eq(shareTokens.userId, userId), eq(shareTokens.token, token)));

			if (!share || isShareRevoked(share)) {
				return reply.status(404).send({
					error: "Share link not found",
					code: "NOT_FOUND",
				});
			}

			await db.update(shareTokens).set({ revokedAt: new Date() }).where(eq(shareTokens.id, share.id));

			request.log.info(`[Share] Revoked share token: tokenFingerprint=${fingerprint}, ownerUserId=${userId}`);

			return reply.status(204).send();
		}
	);

	// ---------------------------------------------------------------------------
	// POST /share/:token/regenerate - PROTECTED: Rotate an existing share token
	// ---------------------------------------------------------------------------
	app.post<{ Params: { token: string } }>(
		"/share/:token/regenerate",
		{
			preHandler: requireAuth,
			logLevel: "warn",
			schema: {
				tags: ["share"],
				security: protectedEndpointSecurity,
				params: ownerTokenParamsSchema,
				response: {
					200: {
						type: "object",
						properties: {
							token: { type: "string" },
							shareUrl: { type: "string" },
							createdAt: { type: "string", format: "date-time" },
							expiresAt: { type: ["string", "null"], format: "date-time" },
							lastUsedAt: { type: ["string", "null"], format: "date-time" },
							allowJournalNotes: { type: "boolean" },
							allowMarkTaken: { type: "boolean" },
						},
					},
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const { token } = request.params;
			const oldFingerprint = tokenFingerprint(token);

			const [share] = await db
				.select()
				.from(shareTokens)
				.where(and(eq(shareTokens.userId, userId), eq(shareTokens.token, token)));

			if (!share || !isShareActive(share)) {
				return reply.status(404).send({
					error: "Share link not found",
					code: "NOT_FOUND",
				});
			}

			const newToken = generateShareToken();
			const createdAt = new Date();
			await db
				.update(shareTokens)
				.set({
					token: newToken,
					createdAt,
					lastUsedAt: null,
					revokedAt: null,
				})
				.where(eq(shareTokens.id, share.id));

			request.log.info(
				`[Share] Regenerated share token: oldTokenFingerprint=${oldFingerprint}, newTokenFingerprint=${tokenFingerprint(newToken)}, ownerUserId=${userId}`
			);

			return {
				token: newToken,
				shareUrl: `/share/${newToken}`,
				createdAt: createdAt.toISOString(),
				expiresAt: toIsoTimestamp(share.expiresAt),
				lastUsedAt: null,
				allowJournalNotes: share.allowJournalNotes ?? false,
				allowMarkTaken: share.allowMarkTaken ?? true,
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
				.where(and(eq(medications.userId, userId), eq(medications.isObsolete, false)));

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
