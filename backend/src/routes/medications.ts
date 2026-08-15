import { resolve } from "node:path";
import { and, eq, like } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, withImmediateWriteTransaction } from "../db/client.js";
import { getDataDir } from "../db/path-utils.js";
import { doseTracking, medications, userSettings } from "../db/schema.js";
import { getAnonymousUserId, isReadOnlyApiKeyRequest, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import {
	deleteAsNeededAnchorsForMedication,
	filterScheduledDoseRows,
	getActiveAsNeededStockEffectMilli,
	getActiveAsNeededStockEffectsMilli,
	neutralizeAsNeededStockEffects,
} from "../services/as-needed-intakes-service.js";
import { computeMedicationCurrentStockRaw } from "../services/current-stock.js";
import { normalizeDateTime, parseIntakesWithUnits } from "../services/medications-service.js";
import { calculatePlannerDemandRows } from "../services/planner-demand.js";
import type { AuthUser } from "../types/fastify.js";
import {
	ALLOWED_IMAGE_MIME_TYPES,
	removeImageFiles,
	streamToBuffer,
	writeOptimizedImageSet,
} from "../utils/image-upload.js";
import {
	applyOpenApiRouteStandards,
	genericErrorSchema,
	idParamsSchema,
	successResponseSchema,
	validationErrorSchema,
} from "../utils/openapi-route-standards.js";
import {
	isDiscreteCountPackageType,
	isLiquidContainerPackageType,
	isTubePackageType,
	normalizePackageType,
	PACKAGE_TYPES,
} from "../utils/package-profiles.js";
import {
	forEachScheduledOccurrenceInRange,
	getDateOnlyTimestamp,
	getScheduleMatchWindowMs,
	type Intake,
	normalizeIntake,
	parseLocalDateTime,
	parseTakenByJson,
} from "../utils/scheduler-utils.js";

const IMAGES_DIR = resolve(getDataDir(), "images");

// New intake schema with per-intake takenBy
const intakeSchema = z.object({
	usage: z.number().nonnegative(),
	every: z.number().int().min(1),
	start: z.string().datetime({ local: true }),
	scheduleMode: z.unknown().optional(),
	weekdays: z.unknown().optional(),
	intakeUnit: z.enum(["ml", "tsp", "tbsp"]).nullable().optional(),
	takenBy: z.string().trim().max(100).nullable().optional(), // Person for this specific intake
	intakeRemindersEnabled: z.boolean().default(false), // Per-intake reminder setting
});

// Legacy blister schema (for backward compatibility during transition)
const blisterSchema = z.object({
	usage: z.number().nonnegative(),
	every: z.number().int().min(1),
	start: z.string().datetime({ local: true }),
});

const packageTypeSchema = z.enum(PACKAGE_TYPES).default("blister");
const medicationFormSchema = z.enum(["capsule", "tablet", "liquid", "topical"]).default("tablet");
const pillFormSchema = z.enum(["capsule", "tablet"]);
const lifecycleCategorySchema = z.enum(["refill_when_empty", "treatment_period"]).default("refill_when_empty");
const doseUnitSchema = z.enum(["mg", "g", "mcg", "ml", "IU", "units", "drops", "puffs", "injections"]).default("mg");
const medicationStartDateSchema = z
	.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
	.optional();
const medicationEndDateSchema = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()]).optional();

const medicationSchema = z
	.object({
		name: z.string().trim().max(100).default(""),
		genericName: z.string().trim().max(100).nullable().optional(),
		takenBy: z.array(z.string().trim().max(100)).default([]), // Medication-level takenBy (fallback)
		medicationForm: medicationFormSchema,
		pillForm: pillFormSchema.nullable().optional(),
		lifecycleCategory: lifecycleCategorySchema,
		packageType: packageTypeSchema,
		packCount: z.number().int().min(0).default(1),
		blistersPerPack: z.number().int().min(1).default(1),
		pillsPerBlister: z.number().int().min(1).default(1),
		packageAmountValue: z.number().int().min(0).default(0),
		packageAmountUnit: z.enum(["ml", "g"]).default("ml"),
		totalPills: z.number().int().min(1).nullable().optional(), // For bottle type: total capacity
		looseTablets: z.number().int().min(0).default(0),
		pillWeightMg: z.number().nonnegative().nullable().optional(),
		doseUnit: doseUnitSchema,
		medicationStartDate: medicationStartDateSchema,
		medicationEndDate: medicationEndDateSchema,
		autoMarkObsoleteAfterEndDate: z.boolean().default(true),
		expiryDate: z.string().nullable().optional(),
		notes: z.string().max(2000).nullable().optional(),
		prescriptionEnabled: z.boolean().default(false),
		prescriptionAuthorizedRefills: z.number().int().min(0).nullable().optional(),
		prescriptionRemainingRefills: z.number().int().min(0).nullable().optional(),
		prescriptionLowRefillThreshold: z.number().int().min(0).default(1),
		prescriptionExpiryDate: z.string().nullable().optional(),
		intakeRemindersEnabled: z.boolean().default(false), // Medication-level (deprecated, kept for backward compat)
		// Accept either new intakes format or legacy blisters format
		intakes: z.array(intakeSchema).max(12).optional(),
		blisters: z.array(blisterSchema).min(1).max(12).optional(), // Legacy format
	})
	.refine((data) => (data.name && data.name.length > 0) || (data.genericName && data.genericName.length > 0), {
		message: "Either 'name' or 'genericName' must be provided",
		path: ["name"],
	})
	.refine((data) => data.intakes !== undefined || data.blisters !== undefined, {
		message: "Either 'intakes' or 'blisters' must be provided",
	})
	.refine(
		(data) => {
			const startDate = data.medicationStartDate ?? "";
			if (!startDate) return true;

			const scheduleStarts = data.intakes?.map((i) => i.start) ?? data.blisters?.map((b) => b.start) ?? [];
			return scheduleStarts.every((scheduleStart) => scheduleStart.slice(0, 10) >= startDate);
		},
		{
			message: "Medication start date must be on or before all intake dates",
			path: ["medicationStartDate"],
		}
	)
	.refine(
		(data) => {
			const startDate = data.medicationStartDate ?? "";
			const endDate = data.medicationEndDate ?? "";
			if (!startDate || !endDate) return true;
			return startDate <= endDate;
		},
		{
			message: "Medication end date must be on or after medication start date",
			path: ["medicationEndDate"],
		}
	)
	.refine(
		(data) => {
			if (data.medicationForm === "capsule" || data.medicationForm === "tablet") {
				return data.pillForm == null || data.pillForm === "capsule" || data.pillForm === "tablet";
			}
			return true;
		},
		{
			message: "pillForm must be capsule or tablet for capsule/tablet medications",
			path: ["pillForm"],
		}
	)
	.refine(
		(data) => {
			if (data.medicationForm === "topical") {
				return isTubePackageType(data.packageType);
			}
			return true;
		},
		{
			message: "Topical medications must use tube package type",
			path: ["packageType"],
		}
	)
	.refine(
		(data) => {
			if (data.medicationForm === "liquid") {
				return isLiquidContainerPackageType(data.packageType);
			}
			return true;
		},
		{
			message: "Liquid medications must use liquid_container package type",
			path: ["packageType"],
		}
	)
	.refine(
		(data) => {
			if (data.medicationForm === "capsule" || data.medicationForm === "tablet") {
				return !isTubePackageType(data.packageType) && !isLiquidContainerPackageType(data.packageType);
			}
			return true;
		},
		{
			message: "Capsule and tablet medications cannot use tube or liquid_container package type",
			path: ["packageType"],
		}
	)
	.refine(
		(data) => {
			const schedules = data.intakes ?? data.blisters ?? [];
			if (data.pillForm !== "capsule") return true;
			return schedules.every((entry) => Number.isInteger(entry.usage));
		},
		{
			message: "Fractional intake is not allowed for capsule",
			path: ["intakes"],
		}
	)
	.refine(
		(data) => {
			if (!data.prescriptionEnabled) return true;
			if (data.prescriptionAuthorizedRefills == null || data.prescriptionRemainingRefills == null) return false;
			return data.prescriptionRemainingRefills <= data.prescriptionAuthorizedRefills;
		},
		{
			message: "When prescription is enabled, remaining refills must be <= authorized refills",
			path: ["prescriptionRemainingRefills"],
		}
	)
	.refine(
		(data) => {
			if (!data.prescriptionEnabled) return true;
			if (data.prescriptionAuthorizedRefills == null) return false;
			return data.prescriptionLowRefillThreshold <= data.prescriptionAuthorizedRefills;
		},
		{
			message: "When prescription is enabled, low refill threshold must be <= authorized refills",
			path: ["prescriptionLowRefillThreshold"],
		}
	);

const intakeOpenApiSchema = {
	type: "object",
	required: ["usage", "every", "start"],
	properties: {
		usage: { type: "number", minimum: 0 },
		every: { type: "integer", minimum: 1 },
		start: { type: "string", description: "ISO datetime string; timezone suffix optional." },
		scheduleMode: { type: "string", enum: ["interval", "weekdays"] },
		weekdays: {
			type: "array",
			items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
		},
		intakeUnit: { type: ["string", "null"], enum: ["ml", "tsp", "tbsp", null] },
		takenBy: { type: ["string", "null"], maxLength: 100 },
		intakeRemindersEnabled: { type: "boolean" },
	},
} as const;

const blisterOpenApiSchema = {
	type: "object",
	required: ["usage", "every", "start"],
	properties: {
		usage: { type: "number", minimum: 0 },
		every: { type: "integer", minimum: 1 },
		start: { type: "string", description: "ISO datetime string; timezone suffix optional." },
	},
} as const;

const medicationBodyOpenApiSchema = {
	type: "object",
	properties: {
		name: { type: "string", maxLength: 100 },
		genericName: { type: ["string", "null"], maxLength: 100 },
		takenBy: { type: "array", items: { type: "string", maxLength: 100 } },
		medicationForm: { type: "string", enum: ["capsule", "tablet", "liquid", "topical"] },
		pillForm: { type: ["string", "null"], enum: ["capsule", "tablet", null] },
		lifecycleCategory: { type: "string", enum: ["refill_when_empty", "treatment_period"] },
		packageType: { type: "string", enum: PACKAGE_TYPES },
		packCount: { type: "integer", minimum: 0 },
		blistersPerPack: { type: "integer", minimum: 1 },
		pillsPerBlister: { type: "integer", minimum: 1 },
		packageAmountValue: { type: "integer", minimum: 0 },
		packageAmountUnit: { type: "string", enum: ["ml", "g"] },
		totalPills: { type: ["integer", "null"], minimum: 1 },
		looseTablets: { type: "integer", minimum: 0 },
		pillWeightMg: { type: ["number", "null"], minimum: 0 },
		doseUnit: { type: "string", enum: ["mg", "g", "mcg", "ml", "IU", "units", "drops", "puffs", "injections"] },
		medicationStartDate: {
			anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }, { const: "" }],
		},
		medicationEndDate: {
			anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }, { const: "" }],
		},
		autoMarkObsoleteAfterEndDate: { type: "boolean" },
		expiryDate: { type: ["string", "null"] },
		notes: { type: ["string", "null"], maxLength: 2000 },
		prescriptionEnabled: { type: "boolean" },
		prescriptionAuthorizedRefills: { type: ["integer", "null"], minimum: 0 },
		prescriptionRemainingRefills: { type: ["integer", "null"], minimum: 0 },
		prescriptionLowRefillThreshold: { type: "integer", minimum: 0 },
		prescriptionExpiryDate: { type: ["string", "null"] },
		intakeRemindersEnabled: { type: "boolean" },
		intakes: { type: "array", maxItems: 12, items: intakeOpenApiSchema },
		blisters: { type: "array", minItems: 1, maxItems: 12, items: blisterOpenApiSchema },
	},
	description:
		"Medication payload. Runtime validation allows defaults and legacy shapes; provide either intakes or legacy blisters.",
	example: {
		name: "Ibuprofen 400",
		genericName: "Ibuprofen",
		takenBy: ["Daniel"],
		medicationForm: "tablet",
		pillForm: "tablet",
		lifecycleCategory: "refill_when_empty",
		packageType: "box",
		packCount: 1,
		blistersPerPack: 2,
		pillsPerBlister: 10,
		totalPills: 20,
		looseTablets: 8,
		pillWeightMg: 400,
		doseUnit: "mg",
		medicationStartDate: "2026-03-01",
		autoMarkObsoleteAfterEndDate: false,
		expiryDate: "2027-12-31",
		notes: "Take after meals.",
		prescriptionEnabled: true,
		prescriptionAuthorizedRefills: 3,
		prescriptionRemainingRefills: 2,
		prescriptionLowRefillThreshold: 1,
		prescriptionExpiryDate: "2026-12-31",
		intakeRemindersEnabled: true,
		intakes: [
			{
				usage: 1,
				every: 8,
				start: "2026-03-11T08:00:00.000Z",
				scheduleMode: "interval",
				weekdays: [],
				takenBy: "Daniel",
				intakeRemindersEnabled: true,
			},
		],
	},
} as const;

const medicationResponseSchema = {
	type: "object",
	properties: {
		id: { type: "number" },
		name: { type: "string" },
		genericName: { type: ["string", "null"] },
		takenBy: { type: "array", items: { type: "string" } },
		medicationForm: { type: "string" },
		pillForm: { type: ["string", "null"] },
		lifecycleCategory: { type: "string" },
		packageType: { type: "string" },
		packCount: { type: "integer" },
		blistersPerPack: { type: "integer" },
		pillsPerBlister: { type: "integer" },
		packageAmountValue: { type: "integer" },
		packageAmountUnit: { type: "string" },
		totalPills: { type: ["number", "null"] },
		looseTablets: { type: "number" },
		stockAdjustment: { type: "number" },
		scheduleStockRebaseMilli: { type: "integer" },
		lastStockCorrectionAt: { type: ["string", "null"] },
		pillWeightMg: { type: ["number", "null"] },
		doseUnit: { type: "string" },
		medicationStartDate: { type: ["string", "null"] },
		medicationEndDate: { type: ["string", "null"] },
		autoMarkObsoleteAfterEndDate: { type: "boolean" },
		intakes: { type: "array", items: intakeOpenApiSchema },
		blisters: { type: "array", items: blisterOpenApiSchema },
		hasRegularSchedule: { type: "boolean" },
		asNeededStockEffect: { type: "number" },
		imageUrl: { type: ["string", "null"] },
		expiryDate: { type: ["string", "null"] },
		notes: { type: ["string", "null"] },
		intakeRemindersEnabled: { type: "boolean" },
		isObsolete: { type: "boolean" },
		obsoleteAt: { type: ["string", "null"] },
		prescriptionEnabled: { type: "boolean" },
		prescriptionAuthorizedRefills: { type: ["integer", "null"] },
		prescriptionRemainingRefills: { type: ["integer", "null"] },
		prescriptionLowRefillThreshold: { type: "integer" },
		prescriptionExpiryDate: { type: ["string", "null"] },
		dismissedUntil: { type: ["string", "null"] },
		updatedAt: { type: ["string", "null"], format: "date-time" },
	},
} as const;

const usageRequestSchema = {
	type: "object",
	required: ["startDate", "endDate"],
	properties: {
		startDate: { type: "string", format: "date-time" },
		endDate: { type: "string", format: "date-time" },
		includeUntilStart: { type: "boolean", default: false },
	},
	example: {
		startDate: "2026-03-01T00:00:00.000Z",
		endDate: "2026-03-31T23:59:59.000Z",
		includeUntilStart: false,
	},
} as const;

const usageItemSchema = {
	type: "object",
	properties: {
		medicationId: { type: "number" },
		medicationName: { type: "string" },
		totalPills: { type: "number" },
		currentPills: { type: "number" },
		plannerUsage: { type: "number" },
		blisterSize: { type: "number" },
		blistersNeeded: { type: "number" },
		fullBlisters: { type: "number" },
		loosePills: { type: "number" },
		enough: { type: "boolean" },
		packageType: { type: "string" },
	},
} as const;

const stockAdjustmentBodySchema = {
	type: "object",
	required: ["stockAdjustment"],
	properties: {
		stockAdjustment: { type: "number" },
		looseTablets: { type: "integer", minimum: 0 },
		totalPills: { type: "integer", minimum: 0 },
		packageAmountValue: { type: "integer", minimum: 0 },
		packCount: { type: "integer", minimum: 0 },
	},
	example: {
		stockAdjustment: -2,
		looseTablets: 6,
		totalPills: 16,
		packCount: 1,
	},
} as const;

const stockAdjustmentResponseSchema = {
	type: "object",
	properties: {
		id: { type: "number" },
		stockAdjustment: { type: "number" },
		scheduleStockRebaseMilli: { type: "integer" },
		lastStockCorrectionAt: { type: "string" },
		updatedAt: { type: "string", format: "date-time" },
	},
} as const;

const obsoleteStateResponseSchema = {
	type: "object",
	properties: {
		id: { type: "number" },
		isObsolete: { type: "boolean" },
		obsoleteAt: { type: "string" },
		updatedAt: { type: "string", format: "date-time" },
	},
} as const;

const dismissUntilBodySchema = {
	type: "object",
	required: ["medicationIds", "until"],
	properties: {
		medicationIds: { type: "array", minItems: 1, items: { type: "integer", minimum: 1 } },
		until: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
	},
	example: {
		medicationIds: [1, 2],
		until: "2026-03-20",
	},
} as const;

export async function medicationRoutes(app: FastifyInstance) {
	// All medication routes require auth
	app.addHook("preHandler", requireAuth);
	applyOpenApiRouteStandards(app, { tag: "medications", protectedByDefault: true });

	// Helper to get user ID from request
	// Returns anonymous user ID when auth is disabled
	async function getUserId(request: FastifyRequest, reply: FastifyReply): Promise<number> {
		// If auth is disabled, use the anonymous user
		if (!env.AUTH_ENABLED) {
			return getAnonymousUserId();
		}

		const authUser = request.user as unknown as AuthUser | null;
		if (!authUser) {
			// This should never happen if requireAuth worked, but be safe
			reply.status(401).send({ error: "User not authenticated", code: "AUTH_REQUIRED" });
			throw new Error("AUTH_REQUIRED");
		}
		return authUser.id;
	}

	app.get<{ Querystring: { includeObsolete?: string } }>(
		"/medications",
		{
			schema: {
				querystring: {
					type: "object",
					properties: {
						includeObsolete: { type: "string", enum: ["true", "false"] },
					},
				},
				response: {
					200: { type: "array", items: medicationResponseSchema },
					401: genericErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = await getUserId(request, reply);
			const includeObsolete = request.query.includeObsolete === "true";
			const initialRows = await db
				.select()
				.from(medications)
				.where(eq(medications.userId, userId))
				.orderBy(medications.id);
			const todayDate = new Date().toISOString().slice(0, 10);

			if (!isReadOnlyApiKeyRequest(request)) {
				for (const row of initialRows) {
					if (row.isObsolete) continue;
					if (!(row.autoMarkObsoleteAfterEndDate ?? true)) continue;
					const endDate = row.medicationEndDate?.slice(0, 10);
					if (!endDate) continue;
					if (endDate > todayDate) continue;

					await db
						.update(medications)
						.set({ isObsolete: true, obsoleteAt: new Date(), updatedAt: new Date() })
						.where(and(eq(medications.id, row.id), eq(medications.userId, userId)));
				}
			}

			const whereClause = includeObsolete
				? eq(medications.userId, userId)
				: and(eq(medications.userId, userId), eq(medications.isObsolete, false));
			const rows = await db.select().from(medications).where(whereClause).orderBy(medications.id);
			const asNeededEffects = await getActiveAsNeededStockEffectsMilli(
				db,
				userId,
				rows.map((row) => row.id)
			);
			return rows.map((row) => {
				const intakes = parseIntakesWithUnits(row);

				return {
					id: row.id,
					name: row.name,
					genericName: row.genericName,
					takenBy: parseTakenByJson(row.takenByJson),
					medicationForm: row.medicationForm ?? "tablet",
					pillForm: row.pillForm ?? null,
					lifecycleCategory: row.lifecycleCategory ?? "refill_when_empty",
					packageType: normalizePackageType(row.packageType),
					packCount: row.packCount ?? 1,
					blistersPerPack: row.blistersPerPack ?? 1,
					pillsPerBlister: row.pillsPerBlister ?? 1,
					packageAmountValue: row.packageAmountValue ?? 0,
					packageAmountUnit: (row.packageAmountUnit ?? "ml") as "ml" | "g",
					totalPills: row.totalPills ?? null,
					looseTablets: row.looseTablets ?? 0,
					stockAdjustment: row.stockAdjustment ?? 0,
					scheduleStockRebaseMilli: row.scheduleStockRebaseMilli ?? 0,
					lastStockCorrectionAt: row.lastStockCorrectionAt?.toISOString() ?? null,
					pillWeightMg: row.pillWeightMg,
					doseUnit: row.doseUnit ?? "mg",
					medicationStartDate: row.medicationStartDate || null,
					medicationEndDate: row.medicationEndDate || null,
					autoMarkObsoleteAfterEndDate: row.autoMarkObsoleteAfterEndDate ?? true,
					intakes, // New unified format with per-intake takenBy
					// Legacy blisters format (for backward compat with frontend during transition)
					blisters: intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start })),
					hasRegularSchedule: intakes.length > 0,
					asNeededStockEffect: (asNeededEffects.get(row.id) ?? 0) / 1000,
					imageUrl: row.imageUrl,
					expiryDate: row.expiryDate,
					notes: row.notes,
					intakeRemindersEnabled: row.intakeRemindersEnabled ?? false,
					isObsolete: row.isObsolete ?? false,
					obsoleteAt: row.obsoleteAt?.toISOString() ?? null,
					prescriptionEnabled: row.prescriptionEnabled ?? false,
					prescriptionAuthorizedRefills: row.prescriptionAuthorizedRefills ?? null,
					prescriptionRemainingRefills: row.prescriptionRemainingRefills ?? null,
					prescriptionLowRefillThreshold: row.prescriptionLowRefillThreshold ?? 1,
					prescriptionExpiryDate: row.prescriptionExpiryDate ?? null,
					dismissedUntil: row.dismissedUntil ?? null,
					updatedAt: normalizeDateTime(row.updatedAt),
				};
			});
		}
	);

	app.post(
		"/medications",
		{
			schema: {
				body: medicationBodyOpenApiSchema,
				response: {
					200: medicationResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const parsed = medicationSchema.safeParse(req.body);
			if (!parsed.success) return reply.status(400).send(parsed.error.format());

			const userId = await getUserId(req, reply);
			const {
				name,
				genericName,
				takenBy,
				medicationForm,
				pillForm,
				lifecycleCategory,
				packageType,
				packCount,
				blistersPerPack,
				pillsPerBlister,
				packageAmountValue,
				packageAmountUnit,
				totalPills,
				looseTablets,
				pillWeightMg,
				doseUnit,
				medicationStartDate,
				medicationEndDate,
				autoMarkObsoleteAfterEndDate,
				expiryDate,
				notes,
				prescriptionEnabled,
				prescriptionAuthorizedRefills,
				prescriptionRemainingRefills,
				prescriptionLowRefillThreshold,
				prescriptionExpiryDate,
				intakeRemindersEnabled,
				intakes: inputIntakes,
				blisters: inputBlisters,
			} = parsed.data;

			const normalizedPillForm =
				medicationForm === "capsule" || medicationForm === "tablet" ? (pillForm ?? medicationForm) : null;

			// Convert to unified intakes format
			let intakes: Intake[];
			if (inputIntakes !== undefined) {
				intakes = inputIntakes.map((intake) => normalizeIntake(intake));
			} else if (inputBlisters !== undefined) {
				intakes = inputBlisters.map((blister) =>
					normalizeIntake(
						{
							usage: blister.usage,
							every: blister.every,
							start: blister.start,
							intakeUnit: null,
							takenBy: null,
						},
						intakeRemindersEnabled ?? false
					)
				);
			} else {
				return reply.status(400).send({ error: "Either 'intakes' or 'blisters' must be provided" });
			}

			// Store both formats for backward compatibility
			const intakesJson = JSON.stringify(intakes);
			const usageJson = JSON.stringify(intakes.map((s) => s.usage));
			const everyJson = JSON.stringify(intakes.map((s) => s.every));
			const startJson = JSON.stringify(intakes.map((s) => s.start));
			const takenByJson = JSON.stringify(takenBy || []);

			const [inserted] = await db
				.insert(medications)
				.values({
					userId,
					name,
					genericName: genericName || null,
					takenByJson,
					medicationForm: medicationForm ?? "tablet",
					pillForm: normalizedPillForm,
					lifecycleCategory: lifecycleCategory ?? "refill_when_empty",
					packageType: normalizePackageType(packageType),
					packCount,
					blistersPerPack,
					pillsPerBlister,
					packageAmountValue,
					packageAmountUnit,
					totalPills: totalPills || null,
					looseTablets,
					pillWeightMg: pillWeightMg || null,
					doseUnit: doseUnit ?? "mg",
					medicationStartDate: medicationStartDate ?? "",
					medicationEndDate: medicationEndDate || null,
					autoMarkObsoleteAfterEndDate: autoMarkObsoleteAfterEndDate ?? true,
					expiryDate: expiryDate || null,
					notes: notes || null,
					prescriptionEnabled: prescriptionEnabled ?? false,
					prescriptionAuthorizedRefills: prescriptionEnabled ? (prescriptionAuthorizedRefills ?? null) : null,
					prescriptionRemainingRefills: prescriptionEnabled ? (prescriptionRemainingRefills ?? null) : null,
					prescriptionLowRefillThreshold: prescriptionLowRefillThreshold ?? 1,
					prescriptionExpiryDate: prescriptionExpiryDate || null,
					intakeRemindersEnabled: intakeRemindersEnabled ?? false,
					intakesJson,
					usageJson,
					everyJson,
					startJson,
				})
				.returning();

			return {
				id: inserted.id,
				name: inserted.name,
				genericName: inserted.genericName,
				takenBy: parseTakenByJson(inserted.takenByJson),
				medicationForm: inserted.medicationForm ?? "tablet",
				pillForm: inserted.pillForm ?? null,
				lifecycleCategory: inserted.lifecycleCategory ?? "refill_when_empty",
				packageType: normalizePackageType(inserted.packageType),
				packCount: inserted.packCount,
				blistersPerPack: inserted.blistersPerPack,
				pillsPerBlister: inserted.pillsPerBlister,
				packageAmountValue: inserted.packageAmountValue ?? 0,
				packageAmountUnit: (inserted.packageAmountUnit ?? "ml") as "ml" | "g",
				totalPills: inserted.totalPills ?? null,
				looseTablets: inserted.looseTablets,
				stockAdjustment: inserted.stockAdjustment ?? 0,
				scheduleStockRebaseMilli: inserted.scheduleStockRebaseMilli ?? 0,
				lastStockCorrectionAt: inserted.lastStockCorrectionAt?.toISOString() ?? null,
				pillWeightMg: inserted.pillWeightMg,
				doseUnit: inserted.doseUnit ?? "mg",
				medicationStartDate: inserted.medicationStartDate || null,
				medicationEndDate: inserted.medicationEndDate || null,
				autoMarkObsoleteAfterEndDate: inserted.autoMarkObsoleteAfterEndDate ?? true,
				intakes,
				blisters: intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start })),
				hasRegularSchedule: intakes.length > 0,
				asNeededStockEffect: 0,
				imageUrl: inserted.imageUrl,
				expiryDate: inserted.expiryDate,
				notes: inserted.notes,
				intakeRemindersEnabled: inserted.intakeRemindersEnabled,
				isObsolete: inserted.isObsolete ?? false,
				obsoleteAt: inserted.obsoleteAt?.toISOString() ?? null,
				prescriptionEnabled: inserted.prescriptionEnabled ?? false,
				prescriptionAuthorizedRefills: inserted.prescriptionAuthorizedRefills ?? null,
				prescriptionRemainingRefills: inserted.prescriptionRemainingRefills ?? null,
				prescriptionLowRefillThreshold: inserted.prescriptionLowRefillThreshold ?? 1,
				prescriptionExpiryDate: inserted.prescriptionExpiryDate ?? null,
				updatedAt: normalizeDateTime(inserted.updatedAt),
			};
		}
	);

	app.put<{ Params: { id: string } }>(
		"/medications/:id",
		{
			schema: {
				params: idParamsSchema,
				body: medicationBodyOpenApiSchema,
				response: {
					200: medicationResponseSchema,
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const parsed = medicationSchema.safeParse(req.body);
			if (!parsed.success) return reply.status(400).send(parsed.error.format());
			const idNum = Number(req.params.id);
			if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

			const userId = await getUserId(req, reply);

			// Verify ownership
			const [existing] = await db
				.select()
				.from(medications)
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
			if (!existing) return reply.notFound();

			const {
				name,
				genericName,
				takenBy,
				medicationForm,
				pillForm,
				lifecycleCategory,
				packageType,
				packCount,
				blistersPerPack,
				pillsPerBlister,
				packageAmountValue,
				packageAmountUnit,
				totalPills,
				looseTablets,
				pillWeightMg,
				doseUnit,
				medicationStartDate,
				medicationEndDate,
				autoMarkObsoleteAfterEndDate,
				expiryDate,
				notes,
				prescriptionEnabled,
				prescriptionAuthorizedRefills,
				prescriptionRemainingRefills,
				prescriptionLowRefillThreshold,
				prescriptionExpiryDate,
				intakeRemindersEnabled,
				intakes: inputIntakes,
				blisters: inputBlisters,
			} = parsed.data;

			const normalizedPillForm =
				medicationForm === "capsule" || medicationForm === "tablet" ? (pillForm ?? medicationForm) : null;

			// Convert to unified intakes format
			let intakes: Intake[];
			if (inputIntakes !== undefined) {
				intakes = inputIntakes.map((intake) => normalizeIntake(intake));
			} else if (inputBlisters !== undefined) {
				intakes = inputBlisters.map((blister) =>
					normalizeIntake(
						{
							usage: blister.usage,
							every: blister.every,
							start: blister.start,
							intakeUnit: null,
							takenBy: null,
						},
						intakeRemindersEnabled ?? false
					)
				);
			} else {
				return reply.status(400).send({ error: "Either 'intakes' or 'blisters' must be provided" });
			}

			// Store both formats for backward compatibility
			const intakesJson = JSON.stringify(intakes);
			const usageJson = JSON.stringify(intakes.map((s) => s.usage));
			const everyJson = JSON.stringify(intakes.map((s) => s.every));
			const startJson = JSON.stringify(intakes.map((s) => s.start));
			const takenByJson = JSON.stringify(takenBy || []);

			const transition = await withImmediateWriteTransaction(async (transactionDb) => {
				const [current] = await transactionDb
					.select()
					.from(medications)
					.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
				if (!current) return null;

				const oldIntakes = parseIntakesWithUnits(current);
				const crossesZeroScheduleBoundary = (oldIntakes.length === 0) !== (intakes.length === 0);
				const hasScheduleOnBothSides = oldIntakes.length > 0 && intakes.length > 0;
				const normalizedPackageType = normalizePackageType(packageType);
				const normalizedTotalPills = totalPills || null;
				const stockFieldsChanged =
					current.packCount !== packCount ||
					current.blistersPerPack !== blistersPerPack ||
					current.pillsPerBlister !== pillsPerBlister ||
					(current.looseTablets ?? 0) !== (looseTablets ?? 0) ||
					normalizePackageType(current.packageType) !== normalizedPackageType ||
					(current.totalPills ?? null) !== normalizedTotalPills ||
					(current.packageAmountValue ?? 0) !== packageAmountValue ||
					(current.packageAmountUnit ?? "ml") !== packageAmountUnit;
				const changedAt = new Date();
				const stockResetFields = stockFieldsChanged
					? { stockAdjustment: 0, scheduleStockRebaseMilli: 0, lastStockCorrectionAt: changedAt }
					: {};

				let dosesForProjection: Array<typeof doseTracking.$inferSelect> = [];
				let asNeededStockEffectMilli = 0;
				let stockCalculationMode: "automatic" | "manual" = "automatic";
				let stockBeforeTransition = 0;
				if (crossesZeroScheduleBoundary && !stockFieldsChanged) {
					dosesForProjection = await transactionDb
						.select()
						.from(doseTracking)
						.where(and(eq(doseTracking.userId, userId), like(doseTracking.doseId, `${idNum}-%`)));
					dosesForProjection = await filterScheduledDoseRows(transactionDb, userId, dosesForProjection);
					const [settings] = await transactionDb
						.select({ stockCalculationMode: userSettings.stockCalculationMode })
						.from(userSettings)
						.where(eq(userSettings.userId, userId));
					stockCalculationMode = settings?.stockCalculationMode === "manual" ? "manual" : "automatic";
					asNeededStockEffectMilli = await getActiveAsNeededStockEffectMilli(transactionDb, userId, idNum);
					stockBeforeTransition = computeMedicationCurrentStockRaw({
						medication: current,
						doses: dosesForProjection,
						stockCalculationMode,
						asNeededStockEffectMilli,
						nowMs: changedAt.getTime(),
					});
				}

				const [updated] = await transactionDb
					.update(medications)
					.set({
						name,
						genericName: genericName || null,
						takenByJson,
						medicationForm: medicationForm ?? "tablet",
						pillForm: normalizedPillForm,
						lifecycleCategory: lifecycleCategory ?? "refill_when_empty",
						packageType: normalizedPackageType,
						packCount,
						blistersPerPack,
						pillsPerBlister,
						totalPills: normalizedTotalPills,
						packageAmountValue,
						packageAmountUnit,
						looseTablets,
						pillWeightMg: pillWeightMg || null,
						doseUnit: doseUnit ?? "mg",
						medicationStartDate: medicationStartDate ?? "",
						medicationEndDate: medicationEndDate || null,
						autoMarkObsoleteAfterEndDate: autoMarkObsoleteAfterEndDate ?? true,
						expiryDate: expiryDate || null,
						notes: notes || null,
						prescriptionEnabled: prescriptionEnabled ?? false,
						prescriptionAuthorizedRefills: prescriptionEnabled ? (prescriptionAuthorizedRefills ?? null) : null,
						prescriptionRemainingRefills: prescriptionEnabled ? (prescriptionRemainingRefills ?? null) : null,
						prescriptionLowRefillThreshold: prescriptionLowRefillThreshold ?? 1,
						prescriptionExpiryDate: prescriptionExpiryDate || null,
						intakeRemindersEnabled: intakeRemindersEnabled ?? false,
						intakesJson,
						usageJson,
						everyJson,
						startJson,
						updatedAt: changedAt,
						...stockResetFields,
					})
					.where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
					.returning();

				if (!updated) return null;
				if (stockFieldsChanged) {
					await neutralizeAsNeededStockEffects(transactionDb, userId, idNum, changedAt);
				}
				if (!crossesZeroScheduleBoundary || stockFieldsChanged) {
					return { medication: updated, oldIntakes, hasScheduleOnBothSides };
				}

				const stockAfterTransition = computeMedicationCurrentStockRaw({
					medication: updated,
					doses: dosesForProjection,
					stockCalculationMode,
					asNeededStockEffectMilli,
					nowMs: changedAt.getTime(),
				});
				const scheduleStockRebaseMilli =
					(current.scheduleStockRebaseMilli ?? 0) + Math.round((stockBeforeTransition - stockAfterTransition) * 1000);
				const [rebased] = await transactionDb
					.update(medications)
					.set({ scheduleStockRebaseMilli })
					.where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
					.returning();
				if (!rebased) throw new Error("Medication disappeared during schedule stock rebase");

				return { medication: rebased, oldIntakes, hasScheduleOnBothSides };
			});

			if (!transition) return reply.notFound();
			const result = [transition.medication];
			const asNeededStockEffect = (await getActiveAsNeededStockEffectMilli(db, userId, result[0].id)) / 1000;

			// ---------------------------------------------------------------
			// Migrate dose tracking IDs when intake schedule changes
			// ---------------------------------------------------------------
			const oldIntakes = transition.oldIntakes;

			// Get all dose tracking entries for this medication
			const doseRows = transition.hasScheduleOnBothSides
				? await db
						.select()
						.from(doseTracking)
						.where(and(eq(doseTracking.userId, userId), like(doseTracking.doseId, `${idNum}-%`)))
				: [];
			const allDoses = await filterScheduledDoseRows(db, userId, doseRows);

			// A zero schedule is a snapshot boundary: keep historical dose IDs untouched instead of
			// reinterpreting or deleting them against a schedule that did not exist when they were recorded.
			if (transition.hasScheduleOnBothSides && allDoses.length > 0) {
				// Build migration map: for each intake index, map old dateOnlyMs → new dateOnlyMs
				const now = new Date();
				const migrationEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

				for (let idx = 0; idx < Math.max(oldIntakes.length, intakes.length); idx++) {
					const oldIntake = oldIntakes[idx];
					const newIntake = intakes[idx];

					// Skip if this intake index doesn't exist in both old and new
					if (!oldIntake || !newIntake) continue;

					const oldStart = parseLocalDateTime(oldIntake.start);
					const newStart = parseLocalDateTime(newIntake.start);
					// Check if start date or schedule changed (time-of-day changes don't matter for dateOnlyMs)
					const oldStartDateOnly = new Date(oldStart.getFullYear(), oldStart.getMonth(), oldStart.getDate()).getTime();
					const newStartDateOnly = new Date(newStart.getFullYear(), newStart.getMonth(), newStart.getDate()).getTime();

					const scheduleUnchanged =
						oldStartDateOnly === newStartDateOnly &&
						oldIntake.every === newIntake.every &&
						oldIntake.scheduleMode === newIntake.scheduleMode &&
						(oldIntake.weekdays ?? []).join(",") === (newIntake.weekdays ?? []).join(",");

					if (scheduleUnchanged) {
						continue; // No schedule change that affects dose IDs
					}

					// Build set of new valid dateOnlyMs values for this intake
					const newDates = new Set<number>();
					forEachScheduledOccurrenceInRange(newIntake, newStart.getTime(), migrationEnd.getTime(), (occurrenceMs) => {
						newDates.add(getDateOnlyTimestamp(new Date(occurrenceMs)));
					});

					// Build set of old dateOnlyMs values with mapping to nearest new date
					const oldToNewMap = new Map<number, number>();
					const scheduleMatchWindowMs = getScheduleMatchWindowMs(newIntake);
					forEachScheduledOccurrenceInRange(oldIntake, oldStart.getTime(), migrationEnd.getTime(), (occurrenceMs) => {
						const oldDateMs = getDateOnlyTimestamp(new Date(occurrenceMs));
						let bestMatch: number | null = null;
						let bestDistance = Infinity;
						for (const newDateMs of newDates) {
							const distance = Math.abs(newDateMs - oldDateMs);
							if (distance < bestDistance && distance <= scheduleMatchWindowMs) {
								bestDistance = distance;
								bestMatch = newDateMs;
							}
						}
						if (bestMatch !== null && bestMatch !== oldDateMs) {
							oldToNewMap.set(oldDateMs, bestMatch);
							newDates.delete(bestMatch);
						}
					});

					// Apply migrations to dose tracking entries
					if (oldToNewMap.size > 0) {
						const prefix = `${idNum}-${idx}-`;
						const dosesToMigrate = allDoses.filter((d) => d.doseId.startsWith(prefix));

						for (const dose of dosesToMigrate) {
							const parts = dose.doseId.split("-");
							if (parts.length >= 3) {
								const oldTimestamp = parseInt(parts[2], 10);
								const newTimestamp = oldToNewMap.get(oldTimestamp);
								if (newTimestamp !== undefined) {
									// Replace the timestamp in the dose ID, keeping any person suffix
									const newDoseId = `${idNum}-${idx}-${newTimestamp}${parts.length > 3 ? `-${parts.slice(3).join("-")}` : ""}`;
									await db.update(doseTracking).set({ doseId: newDoseId }).where(eq(doseTracking.id, dose.id));
								}
							}
						}
					}
				}

				// Also clean up dose tracking entries before the earliest new start date
				const earliestStartDate = intakes.reduce((min, b) => {
					const d = parseLocalDateTime(b.start);
					// Use date-only (midnight) to match dose ID format
					const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
					return dateOnly < min ? dateOnly : min;
				}, Infinity);
				if (!Number.isNaN(earliestStartDate)) {
					// Re-fetch after possible migrations
					const updatedDoseRows = await db
						.select()
						.from(doseTracking)
						.where(and(eq(doseTracking.userId, userId), like(doseTracking.doseId, `${idNum}-%`)));
					const updatedDoses = await filterScheduledDoseRows(db, userId, updatedDoseRows);

					const dosesToDelete = updatedDoses.filter((dose) => {
						const parts = dose.doseId.split("-");
						if (parts.length >= 3) {
							const timestamp = parseInt(parts[2], 10);
							return !Number.isNaN(timestamp) && timestamp < earliestStartDate;
						}
						return false;
					});

					for (const dose of dosesToDelete) {
						await db.delete(doseTracking).where(eq(doseTracking.id, dose.id));
					}
				}
			}

			return {
				id: result[0].id,
				name: result[0].name,
				genericName: result[0].genericName,
				takenBy: parseTakenByJson(result[0].takenByJson),
				medicationForm: result[0].medicationForm ?? "tablet",
				pillForm: result[0].pillForm ?? null,
				lifecycleCategory: result[0].lifecycleCategory ?? "refill_when_empty",
				packageType: normalizePackageType(result[0].packageType),
				packCount: result[0].packCount,
				blistersPerPack: result[0].blistersPerPack,
				pillsPerBlister: result[0].pillsPerBlister,
				packageAmountValue: result[0].packageAmountValue ?? 0,
				packageAmountUnit: (result[0].packageAmountUnit ?? "ml") as "ml" | "g",
				totalPills: result[0].totalPills ?? null,
				looseTablets: result[0].looseTablets,
				stockAdjustment: result[0].stockAdjustment ?? 0,
				scheduleStockRebaseMilli: result[0].scheduleStockRebaseMilli ?? 0,
				lastStockCorrectionAt: result[0].lastStockCorrectionAt?.toISOString() ?? null,
				pillWeightMg: result[0].pillWeightMg,
				doseUnit: result[0].doseUnit ?? "mg",
				medicationStartDate: result[0].medicationStartDate || null,
				medicationEndDate: result[0].medicationEndDate || null,
				autoMarkObsoleteAfterEndDate: result[0].autoMarkObsoleteAfterEndDate ?? true,
				intakes,
				blisters: intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start })),
				hasRegularSchedule: intakes.length > 0,
				asNeededStockEffect,
				imageUrl: result[0].imageUrl,
				expiryDate: result[0].expiryDate,
				notes: result[0].notes,
				intakeRemindersEnabled: result[0].intakeRemindersEnabled,
				isObsolete: result[0].isObsolete ?? false,
				obsoleteAt: result[0].obsoleteAt?.toISOString() ?? null,
				prescriptionEnabled: result[0].prescriptionEnabled ?? false,
				prescriptionAuthorizedRefills: result[0].prescriptionAuthorizedRefills ?? null,
				prescriptionRemainingRefills: result[0].prescriptionRemainingRefills ?? null,
				prescriptionLowRefillThreshold: result[0].prescriptionLowRefillThreshold ?? 1,
				prescriptionExpiryDate: result[0].prescriptionExpiryDate ?? null,
				updatedAt: normalizeDateTime(result[0].updatedAt),
			};
		}
	);

	app.post<{ Params: { id: string } }>(
		"/medications/:id/obsolete",
		{
			schema: {
				params: idParamsSchema,
				response: {
					200: obsoleteStateResponseSchema,
					400: genericErrorSchema,
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const idNum = Number(req.params.id);
			if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

			const userId = await getUserId(req, reply);
			const [existing] = await db
				.select()
				.from(medications)
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
			if (!existing) return reply.notFound();

			const [updated] = await db
				.update(medications)
				.set({
					isObsolete: true,
					obsoleteAt: new Date(),
					updatedAt: new Date(),
				})
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
				.returning();

			return {
				id: updated.id,
				isObsolete: updated.isObsolete ?? false,
				obsoleteAt: updated.obsoleteAt?.toISOString() ?? null,
				updatedAt: normalizeDateTime(updated.updatedAt),
			};
		}
	);

	app.post<{ Params: { id: string } }>(
		"/medications/:id/reactivate",
		{
			schema: {
				params: idParamsSchema,
				response: {
					200: obsoleteStateResponseSchema,
					400: genericErrorSchema,
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const idNum = Number(req.params.id);
			if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

			const userId = await getUserId(req, reply);
			const [existing] = await db
				.select()
				.from(medications)
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
			if (!existing) return reply.notFound();

			const [updated] = await db
				.update(medications)
				.set({
					isObsolete: false,
					obsoleteAt: null,
					updatedAt: new Date(),
				})
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
				.returning();

			return {
				id: updated.id,
				isObsolete: updated.isObsolete ?? false,
				obsoleteAt: updated.obsoleteAt?.toISOString() ?? null,
				updatedAt: normalizeDateTime(updated.updatedAt),
			};
		}
	);

	// Stock correction endpoint - updates stockAdjustment and optionally base amount fields for amount-based corrections
	// Also sets lastStockCorrectionAt so consumed doses before this point don't count
	app.patch<{
		Params: { id: string };
		Body: {
			stockAdjustment: number;
			looseTablets?: number;
			totalPills?: number;
			packageAmountValue?: number;
			packCount?: number;
		};
	}>(
		"/medications/:id/stock-adjustment",
		{
			schema: {
				params: idParamsSchema,
				body: stockAdjustmentBodySchema,
				response: {
					200: stockAdjustmentResponseSchema,
					400: genericErrorSchema,
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const idNum = Number(req.params.id);
			if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

			const userId = await getUserId(req, reply);

			const { stockAdjustment, looseTablets, totalPills, packageAmountValue, packCount } = req.body as {
				stockAdjustment: number;
				looseTablets?: number;
				totalPills?: number;
				packageAmountValue?: number;
				packCount?: number;
			};
			if (typeof stockAdjustment !== "number") return reply.badRequest("stockAdjustment must be a number");
			if (
				looseTablets !== undefined &&
				(typeof looseTablets !== "number" || !Number.isInteger(looseTablets) || looseTablets < 0)
			) {
				return reply.badRequest("looseTablets must be a non-negative integer");
			}
			if (
				totalPills !== undefined &&
				(typeof totalPills !== "number" || !Number.isInteger(totalPills) || totalPills < 0)
			) {
				return reply.badRequest("totalPills must be a non-negative integer");
			}
			if (
				packageAmountValue !== undefined &&
				(typeof packageAmountValue !== "number" || !Number.isInteger(packageAmountValue) || packageAmountValue < 0)
			) {
				return reply.badRequest("packageAmountValue must be a non-negative integer");
			}
			if (packCount !== undefined && (typeof packCount !== "number" || !Number.isInteger(packCount) || packCount < 0)) {
				return reply.badRequest("packCount must be a non-negative integer");
			}

			const corrected = await withImmediateWriteTransaction(async (transactionDb) => {
				const correctionAt = new Date();
				const [existing] = await transactionDb
					.select()
					.from(medications)
					.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
				if (!existing) return null;

				const updateFields: {
					stockAdjustment: number;
					scheduleStockRebaseMilli: number;
					lastStockCorrectionAt: Date;
					updatedAt: Date;
					looseTablets?: number;
					totalPills?: number | null;
					packageAmountValue?: number;
					packCount?: number;
				} = {
					stockAdjustment,
					scheduleStockRebaseMilli: 0,
					lastStockCorrectionAt: correctionAt,
					updatedAt: correctionAt,
				};

				const packageType = normalizePackageType(existing.packageType);
				const allowsAmountBaseUpdate = isTubePackageType(packageType) || isLiquidContainerPackageType(packageType);
				const allowsDiscreteCapacityUpdate = isDiscreteCountPackageType(packageType);
				if (allowsAmountBaseUpdate) {
					const normalizedAmountBase = looseTablets ?? totalPills;
					if (normalizedAmountBase !== undefined) {
						updateFields.totalPills = normalizedAmountBase;
						updateFields.looseTablets = normalizedAmountBase;
					}
					if (packageAmountValue !== undefined && packageAmountValue > 0) {
						updateFields.packageAmountValue = packageAmountValue;
					}
				}
				if (allowsDiscreteCapacityUpdate && totalPills !== undefined && totalPills > 0) {
					updateFields.totalPills = totalPills;
				}
				if (packCount !== undefined) updateFields.packCount = packCount;
				if (!allowsAmountBaseUpdate && looseTablets !== undefined) {
					updateFields.looseTablets = looseTablets;
				}

				const [result] = await transactionDb
					.update(medications)
					.set(updateFields)
					.where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
					.returning();
				if (!result) return null;
				await neutralizeAsNeededStockEffects(transactionDb, userId, idNum, correctionAt);
				return result;
			});

			if (!corrected) return reply.notFound();

			return {
				id: corrected.id,
				stockAdjustment: corrected.stockAdjustment ?? 0,
				scheduleStockRebaseMilli: corrected.scheduleStockRebaseMilli ?? 0,
				lastStockCorrectionAt: corrected.lastStockCorrectionAt?.toISOString() ?? null,
				updatedAt: normalizeDateTime(corrected.updatedAt),
			};
		}
	);

	app.delete<{ Params: { id: string } }>(
		"/medications/:id",
		{
			schema: {
				params: idParamsSchema,
				response: {
					204: { type: "null" },
					400: genericErrorSchema,
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const idNum = Number(req.params.id);
			if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

			const userId = await getUserId(req, reply);

			const deleted = await withImmediateWriteTransaction(async (transactionDb) => {
				const [current] = await transactionDb
					.select()
					.from(medications)
					.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
				if (!current) return null;
				await deleteAsNeededAnchorsForMedication(transactionDb, userId, idNum);
				const [removed] = await transactionDb
					.delete(medications)
					.where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
					.returning();
				return removed ? current : null;
			});
			if (!deleted) return reply.notFound();
			if (deleted.imageUrl) removeImageFiles(IMAGES_DIR, deleted.imageUrl);
			return reply.status(204).send();
		}
	);

	// Upload medication image
	app.post<{ Params: { id: string } }>(
		"/medications/:id/image",
		{
			schema: {
				params: idParamsSchema,
				consumes: ["multipart/form-data"],
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							imageUrl: { type: "string" },
						},
					},
					400: genericErrorSchema,
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const idNum = Number(req.params.id);
			if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

			const userId = await getUserId(req, reply);
			const [existing] = await db
				.select()
				.from(medications)
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
			if (!existing) return reply.notFound();

			const data = await req.file();
			if (!data) return reply.status(400).send({ error: "No file uploaded", code: "NO_FILE" });

			if (!ALLOWED_IMAGE_MIME_TYPES.includes(data.mimetype)) {
				return reply.status(400).send({ error: "Invalid file type", code: "INVALID_TYPE" });
			}

			let uploadBuffer: Buffer;
			try {
				uploadBuffer = await streamToBuffer(data.file);
			} catch (error) {
				if (error instanceof Error && error.message === "IMAGE_TOO_LARGE") {
					return reply.status(400).send({ error: "Image too large", code: "IMAGE_TOO_LARGE" });
				}
				throw error;
			}

			let filename: string;
			try {
				({ filename } = await writeOptimizedImageSet(IMAGES_DIR, `med-${idNum}`, uploadBuffer));
			} catch {
				return reply.status(400).send({ error: "Invalid image", code: "INVALID_IMAGE" });
			}

			// Delete old image if exists
			if (existing.imageUrl) removeImageFiles(IMAGES_DIR, existing.imageUrl);

			await db
				.update(medications)
				.set({ imageUrl: filename, updatedAt: new Date() })
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));

			return { success: true, imageUrl: filename };
		}
	);

	// Delete medication image
	app.delete<{ Params: { id: string } }>(
		"/medications/:id/image",
		{
			schema: {
				params: idParamsSchema,
				response: {
					204: { type: "null" },
					400: genericErrorSchema,
					401: genericErrorSchema,
					404: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const idNum = Number(req.params.id);
			if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

			const userId = await getUserId(req, reply);
			const [existing] = await db
				.select()
				.from(medications)
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
			if (!existing) return reply.notFound();

			if (existing.imageUrl) removeImageFiles(IMAGES_DIR, existing.imageUrl);

			await db
				.update(medications)
				.set({ imageUrl: null, updatedAt: new Date() })
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
			return reply.status(204).send();
		}
	);

	app.post(
		"/medications/usage",
		{
			schema: {
				body: usageRequestSchema,
				response: {
					200: { type: "array", items: usageItemSchema },
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const schema = z.object({
				startDate: z.string().datetime(),
				endDate: z.string().datetime(),
				includeUntilStart: z.boolean().optional().default(false),
			});
			const parsed = schema.safeParse(req.body);
			if (!parsed.success) return reply.status(400).send(parsed.error.format());
			const { startDate, endDate, includeUntilStart } = parsed.data;
			const start = new Date(startDate);
			const end = new Date(endDate);
			if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
				return reply.badRequest("Invalid date range");
			}

			const userId = await getUserId(req, reply);
			return calculatePlannerDemandRows({ userId, startDate: start, endDate: end, includeUntilStart });
		}
	);

	// ---------------------------------------------------------------------------
	// POST /medications/dismiss-until - Set dismissedUntil date for multiple medications
	// This is more robust than storing individual dose IDs (which can change with schedule updates)
	// ---------------------------------------------------------------------------
	const dismissUntilSchema = z.object({
		medicationIds: z.array(z.number().int().positive()).min(1),
		until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
	});

	app.post<{ Body: z.infer<typeof dismissUntilSchema> }>(
		"/medications/dismiss-until",
		{
			schema: {
				body: dismissUntilBodySchema,
				response: {
					200: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							updatedCount: { type: "integer" },
						},
					},
					400: { anyOf: [genericErrorSchema, validationErrorSchema] },
					401: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const parsed = dismissUntilSchema.safeParse(req.body);
			if (!parsed.success) {
				return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
			}

			const userId = await getUserId(req, reply);
			const { medicationIds, until } = parsed.data;

			// Update dismissedUntil for all specified medications owned by this user
			let updatedCount = 0;
			for (const medId of medicationIds) {
				const result = await db
					.update(medications)
					.set({ dismissedUntil: until })
					.where(and(eq(medications.id, medId), eq(medications.userId, userId)));
				if (result.rowsAffected > 0) {
					updatedCount++;
				}
			}

			return { success: true, updatedCount };
		}
	);

	// ---------------------------------------------------------------------------
	// DELETE /medications/:id/dismiss-until - Clear dismissedUntil for a medication
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { id: string } }>(
		"/medications/:id/dismiss-until",
		{
			schema: {
				params: idParamsSchema,
				response: {
					200: successResponseSchema,
					400: genericErrorSchema,
					401: genericErrorSchema,
				},
			},
		},
		async (req, reply) => {
			const medId = parseInt(req.params.id, 10);
			if (Number.isNaN(medId)) {
				return reply.status(400).send({ error: "Invalid medication ID" });
			}

			const userId = await getUserId(req, reply);

			await db
				.update(medications)
				.set({ dismissedUntil: null })
				.where(and(eq(medications.id, medId), eq(medications.userId, userId)));

			return { success: true };
		}
	);
}
