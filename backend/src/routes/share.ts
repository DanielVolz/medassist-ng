import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, medications, shareTokens, userSettings, users } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { getActiveAsNeededStockEffectsMilli } from "../services/as-needed-intakes-service.js";
import { buildSharedMedicationOverview } from "../services/coverage.js";
import {
	getPublicShareContext,
	getPublicShareLanguage,
	getPublicShareOwnerName,
} from "../services/public-share-service.js";
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
	normalizeMedicationSchedule,
	personTakesMedication,
	scopeIntakesToTakenBy,
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
		language: { type: "string", enum: ["en", "de"] },
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
		language: { type: "string", enum: ["en", "de"] },
		expiredAt: { type: "string", format: "date-time" },
	},
} as const;

const shareOverviewExpiredResponseSchema = {
	type: "object",
	properties: {
		error: { type: "string" },
		language: { type: "string", enum: ["en", "de"] },
		expiredAt: { type: "string", format: "date-time" },
	},
} as const;

const shareOverviewResponseSchema = {
	type: "object",
	properties: {
		takenBy: { type: "string" },
		sharedBy: { type: "string" },
		language: { type: "string", enum: ["en", "de"] },
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

type MedicationRow = typeof medications.$inferSelect;

async function getActiveMedicationsForPerson(userId: number, takenBy: string): Promise<MedicationRow[]> {
	const allMeds = await db
		.select()
		.from(medications)
		.where(and(eq(medications.userId, userId), eq(medications.isObsolete, false)));

	return allMeds.filter((medication) => {
		const schedule = normalizeMedicationSchedule(medication);
		return personTakesMedication(takenBy, schedule.takenBy, schedule.intakes);
	});
}

function toSharedScheduleMedication(medication: MedicationRow, shareTakenBy: string) {
	const schedule = normalizeMedicationSchedule(medication);
	const intakes = scopeIntakesToTakenBy(schedule.intakes, schedule.takenBy, shareTakenBy);
	const blisters = intakes.map((intake) => ({
		usage: intake.usage,
		every: intake.every,
		start: intake.start,
	}));
	const takenBy =
		shareTakenBy === "all" ? schedule.takenBy : schedule.takenBy.filter((person) => person === shareTakenBy);
	const totalPills = isAmountBasedPackageType(medication.packageType)
		? medication.looseTablets + (medication.stockAdjustment ?? 0)
		: medication.packCount * medication.blistersPerPack * medication.pillsPerBlister +
			medication.looseTablets +
			(medication.stockAdjustment ?? 0);

	return {
		id: medication.id,
		name: medication.name,
		genericName: medication.genericName,
		pillWeightMg: medication.pillWeightMg,
		doseUnit: medication.doseUnit ?? "mg",
		imageUrl: medication.imageUrl,
		totalPills,
		packageType: normalizePackageType(medication.packageType),
		packCount: medication.packCount,
		blistersPerPack: medication.blistersPerPack,
		looseTablets: medication.looseTablets,
		pillsPerBlister: medication.pillsPerBlister,
		takenBy,
		intakes,
		blisters,
		dismissedUntil: medication.dismissedUntil,
		updatedAt: medication.updatedAt,
		lastStockCorrectionAt: medication.lastStockCorrectionAt?.getTime() ?? null,
		stockAdjustment: medication.stockAdjustment ?? 0,
	};
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
				const [settings] = await db
					.select({ language: userSettings.language })
					.from(userSettings)
					.where(eq(userSettings.userId, share.userId));
				return reply.status(410).send({
					error: "Share link has expired",
					code: "EXPIRED",
					ownerUsername: getPublicShareOwnerName(owner?.username, "the owner"),
					takenBy: share.takenBy,
					language: getPublicShareLanguage(settings?.language),
					expiredAt: share.expiresAt.toISOString(),
				});
			}

			// Get user settings for stock thresholds
			const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, share.userId));

			// Get the username of the owner who created this share link
			const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, share.userId));

			const meds = await getActiveMedicationsForPerson(share.userId, share.takenBy);
			const medicationsWithBlisters = meds.map((medication) => toSharedScheduleMedication(medication, share.takenBy));
			const shareMedicationOverview = settings?.shareMedicationOverview ?? false;
			const asNeededStockEffectsMilli = shareMedicationOverview
				? await getActiveAsNeededStockEffectsMilli(
						db,
						share.userId,
						meds.map((medication) => medication.id)
					)
				: new Map<number, number>();
			const medicationOverview = shareMedicationOverview
				? buildSharedMedicationOverview({
						medications: meds,
						doses: await db.select().from(doseTracking).where(eq(doseTracking.userId, share.userId)),
						thresholdDays: settings?.lowStockDays ?? 30,
						shareTakenBy: share.takenBy,
						asNeededStockEffectsMilli,
					})
				: null;

			return {
				...getPublicShareContext({
					share,
					ownerUsername: owner?.username,
					language: settings?.language,
				}),
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
				const [settings] = await db
					.select({ language: userSettings.language })
					.from(userSettings)
					.where(eq(userSettings.userId, share.userId));
				return reply.status(410).send({
					error: "expired",
					language: getPublicShareLanguage(settings?.language),
					expiredAt: share.expiresAt.toISOString(),
				});
			}

			const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, share.userId));
			const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, share.userId));

			const meds = await getActiveMedicationsForPerson(share.userId, share.takenBy);
			const asNeededStockEffectsMilli = await getActiveAsNeededStockEffectsMilli(
				db,
				share.userId,
				meds.map((medication) => medication.id)
			);

			const doses = await db.select().from(doseTracking).where(eq(doseTracking.userId, share.userId));

			const overview = buildSharedMedicationOverview({
				medications: meds,
				doses,
				thresholdDays: settings?.lowStockDays ?? 30,
				shareTakenBy: share.takenBy,
				asNeededStockEffectsMilli,
			});

			return {
				takenBy: share.takenBy,
				sharedBy: getPublicShareOwnerName(owner?.username),
				language: getPublicShareLanguage(settings?.language),
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

			const medsForPerson = await getActiveMedicationsForPerson(userId, takenBy);

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
				const schedule = normalizeMedicationSchedule(med);
				const allForMed = getAllTakenByForMedication(schedule.takenBy, schedule.intakes);
				for (const person of allForMed) {
					if (person) allPeople.add(person);
				}
			}

			return { people: [...allPeople].sort() };
		}
	);
}
