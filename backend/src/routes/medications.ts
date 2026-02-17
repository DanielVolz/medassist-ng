import { createWriteStream, existsSync, unlinkSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { and, eq, like } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { getDataDir } from "../db/db-utils.js";
import { doseTracking, medications } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";
import { type Intake, parseIntakesJson, parseLocalDateTime, parseTakenByJson } from "../utils/scheduler-utils.js";

const IMAGES_DIR = resolve(getDataDir(), "images");

// New intake schema with per-intake takenBy
const intakeSchema = z.object({
	usage: z.number().nonnegative(),
	every: z.number().int().min(1),
	start: z.string().datetime({ local: true }),
	takenBy: z.string().trim().max(100).nullable().optional(), // Person for this specific intake
	intakeRemindersEnabled: z.boolean().default(false), // Per-intake reminder setting
});

// Legacy blister schema (for backward compatibility during transition)
const blisterSchema = z.object({
	usage: z.number().nonnegative(),
	every: z.number().int().min(1),
	start: z.string().datetime({ local: true }),
});

const packageTypeSchema = z.enum(["blister", "bottle"]).default("blister");
const doseUnitSchema = z.enum(["mg", "g", "mcg", "ml", "IU", "units", "drops", "puffs"]).default("mg");
const medicationStartDateSchema = z
	.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
	.optional();

const medicationSchema = z
	.object({
		name: z.string().trim().min(1).max(100),
		genericName: z.string().trim().max(100).nullable().optional(),
		takenBy: z.array(z.string().trim().max(100)).default([]), // Medication-level takenBy (fallback)
		packageType: packageTypeSchema,
		packCount: z.number().int().min(0).default(1),
		blistersPerPack: z.number().int().min(1).default(1),
		pillsPerBlister: z.number().int().min(1).default(1),
		totalPills: z.number().int().min(1).nullable().optional(), // For bottle type: total capacity
		looseTablets: z.number().int().min(0).default(0),
		pillWeightMg: z.number().nonnegative().nullable().optional(),
		doseUnit: doseUnitSchema,
		medicationStartDate: medicationStartDateSchema,
		expiryDate: z.string().nullable().optional(),
		notes: z.string().max(2000).nullable().optional(),
		prescriptionEnabled: z.boolean().default(false),
		prescriptionAuthorizedRefills: z.number().int().min(0).nullable().optional(),
		prescriptionRemainingRefills: z.number().int().min(0).nullable().optional(),
		prescriptionLowRefillThreshold: z.number().int().min(0).default(1),
		prescriptionExpiryDate: z.string().nullable().optional(),
		intakeRemindersEnabled: z.boolean().default(false), // Medication-level (deprecated, kept for backward compat)
		// Accept either new intakes format or legacy blisters format
		intakes: z.array(intakeSchema).min(1).max(12).optional(),
		blisters: z.array(blisterSchema).min(1).max(12).optional(), // Legacy format
	})
	.refine((data) => data.intakes || data.blisters, { message: "Either 'intakes' or 'blisters' must be provided" })
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

export async function medicationRoutes(app: FastifyInstance) {
	// All medication routes require auth
	app.addHook("preHandler", requireAuth);

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

	app.get<{ Querystring: { includeObsolete?: string } }>("/medications", async (request, reply) => {
		const userId = await getUserId(request, reply);
		const includeObsolete = request.query.includeObsolete === "true";
		const whereClause = includeObsolete
			? eq(medications.userId, userId)
			: and(eq(medications.userId, userId), eq(medications.isObsolete, false));
		const rows = await db.select().from(medications).where(whereClause).orderBy(medications.id);
		return rows.map((row) => {
			// Parse intakes from new format, falling back to legacy
			const intakes = parseIntakesJson(
				row.intakesJson,
				{ usageJson: row.usageJson, everyJson: row.everyJson, startJson: row.startJson },
				row.intakeRemindersEnabled ?? false
			);

			return {
				id: row.id,
				name: row.name,
				genericName: row.genericName,
				takenBy: parseTakenByJson(row.takenByJson),
				packageType: row.packageType ?? "blister",
				packCount: row.packCount ?? 1,
				blistersPerPack: row.blistersPerPack ?? 1,
				pillsPerBlister: row.pillsPerBlister ?? 1,
				totalPills: row.totalPills ?? null,
				looseTablets: row.looseTablets ?? 0,
				stockAdjustment: row.stockAdjustment ?? 0,
				lastStockCorrectionAt: row.lastStockCorrectionAt?.toISOString() ?? null,
				pillWeightMg: row.pillWeightMg,
				doseUnit: row.doseUnit ?? "mg",
				medicationStartDate: row.medicationStartDate || null,
				intakes, // New unified format with per-intake takenBy
				// Legacy blisters format (for backward compat with frontend during transition)
				blisters: intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start })),
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
				updatedAt: row.updatedAt,
			};
		});
	});

	app.post("/medications", async (req, reply) => {
		const parsed = medicationSchema.safeParse(req.body);
		if (!parsed.success) return reply.status(400).send(parsed.error.format());

		const userId = await getUserId(req, reply);
		const {
			name,
			genericName,
			takenBy,
			packageType,
			packCount,
			blistersPerPack,
			pillsPerBlister,
			totalPills,
			looseTablets,
			pillWeightMg,
			doseUnit,
			medicationStartDate,
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

		// Convert to unified intakes format
		let intakes: Intake[];
		if (inputIntakes) {
			// New format with per-intake takenBy
			intakes = inputIntakes.map((i) => ({
				usage: i.usage,
				every: i.every,
				start: i.start,
				takenBy: i.takenBy || null,
				intakeRemindersEnabled: i.intakeRemindersEnabled ?? false,
			}));
		} else if (inputBlisters) {
			// Legacy format - convert to new format
			intakes = inputBlisters.map((b) => ({
				usage: b.usage,
				every: b.every,
				start: b.start,
				takenBy: null, // No per-intake takenBy from legacy
				intakeRemindersEnabled: intakeRemindersEnabled ?? false,
			}));
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
				packageType: packageType ?? "blister",
				packCount,
				blistersPerPack,
				pillsPerBlister,
				totalPills: totalPills || null,
				looseTablets,
				pillWeightMg: pillWeightMg || null,
				doseUnit: doseUnit ?? "mg",
				medicationStartDate: medicationStartDate ?? "",
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
			packageType: inserted.packageType ?? "blister",
			packCount: inserted.packCount,
			blistersPerPack: inserted.blistersPerPack,
			pillsPerBlister: inserted.pillsPerBlister,
			totalPills: inserted.totalPills ?? null,
			looseTablets: inserted.looseTablets,
			stockAdjustment: inserted.stockAdjustment ?? 0,
			lastStockCorrectionAt: inserted.lastStockCorrectionAt?.toISOString() ?? null,
			pillWeightMg: inserted.pillWeightMg,
			doseUnit: inserted.doseUnit ?? "mg",
			medicationStartDate: inserted.medicationStartDate || null,
			intakes,
			blisters: intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start })),
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
			updatedAt: inserted.updatedAt,
		};
	});

	app.put<{ Params: { id: string } }>("/medications/:id", async (req, reply) => {
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
			packageType,
			packCount,
			blistersPerPack,
			pillsPerBlister,
			totalPills,
			looseTablets,
			pillWeightMg,
			doseUnit,
			medicationStartDate,
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

		// Convert to unified intakes format
		let intakes: Intake[];
		if (inputIntakes) {
			// New format with per-intake takenBy
			intakes = inputIntakes.map((i) => ({
				usage: i.usage,
				every: i.every,
				start: i.start,
				takenBy: i.takenBy || null,
				intakeRemindersEnabled: i.intakeRemindersEnabled ?? false,
			}));
		} else if (inputBlisters) {
			// Legacy format - convert to new format
			intakes = inputBlisters.map((b) => ({
				usage: b.usage,
				every: b.every,
				start: b.start,
				takenBy: null, // No per-intake takenBy from legacy
				intakeRemindersEnabled: intakeRemindersEnabled ?? false,
			}));
		} else {
			return reply.status(400).send({ error: "Either 'intakes' or 'blisters' must be provided" });
		}

		// Store both formats for backward compatibility
		const intakesJson = JSON.stringify(intakes);
		const usageJson = JSON.stringify(intakes.map((s) => s.usage));
		const everyJson = JSON.stringify(intakes.map((s) => s.every));
		const startJson = JSON.stringify(intakes.map((s) => s.start));
		const takenByJson = JSON.stringify(takenBy || []);

		// If stock-defining fields changed, reset stockAdjustment so the new
		// base stock reflects actual inventory.  This prevents the old
		// correction offset from skewing the total after an edit.
		const stockFieldsChanged =
			existing.packCount !== packCount ||
			existing.blistersPerPack !== blistersPerPack ||
			existing.pillsPerBlister !== pillsPerBlister ||
			(existing.looseTablets ?? 0) !== (looseTablets ?? 0);

		const stockResetFields = stockFieldsChanged ? { stockAdjustment: 0, lastStockCorrectionAt: new Date() } : {};

		const result = await db
			.update(medications)
			.set({
				name,
				genericName: genericName || null,
				takenByJson,
				packageType: packageType ?? "blister",
				packCount,
				blistersPerPack,
				pillsPerBlister,
				totalPills: totalPills || null,
				looseTablets,
				pillWeightMg: pillWeightMg || null,
				doseUnit: doseUnit ?? "mg",
				medicationStartDate: medicationStartDate ?? "",
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
				updatedAt: new Date(),
				...stockResetFields,
			})
			.where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
			.returning();

		if (!result.length) return reply.notFound();

		// ---------------------------------------------------------------
		// Migrate dose tracking IDs when intake schedule changes
		// ---------------------------------------------------------------
		// Parse old intakes from the existing medication row
		const oldIntakes = parseIntakesJson(
			existing.intakesJson,
			{ usageJson: existing.usageJson, everyJson: existing.everyJson, startJson: existing.startJson },
			existing.intakeRemindersEnabled
		);

		// Get all dose tracking entries for this medication
		const allDoses = await db
			.select()
			.from(doseTracking)
			.where(and(eq(doseTracking.userId, userId), like(doseTracking.doseId, `${idNum}-%`)));

		if (allDoses.length > 0) {
			// Build migration map: for each intake index, map old dateOnlyMs → new dateOnlyMs
			const now = new Date();
			const migrationEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const MS_PER_DAY = 86_400_000;

			for (let idx = 0; idx < Math.max(oldIntakes.length, intakes.length); idx++) {
				const oldIntake = oldIntakes[idx];
				const newIntake = intakes[idx];

				// Skip if this intake index doesn't exist in both old and new
				if (!oldIntake || !newIntake) continue;

				const oldStart = parseLocalDateTime(oldIntake.start);
				const newStart = parseLocalDateTime(newIntake.start);
				const oldEvery = oldIntake.every;
				const newEvery = newIntake.every;

				// Check if start date or interval changed (time-of-day changes don't matter for dateOnlyMs)
				const oldStartDateOnly = new Date(oldStart.getFullYear(), oldStart.getMonth(), oldStart.getDate()).getTime();
				const newStartDateOnly = new Date(newStart.getFullYear(), newStart.getMonth(), newStart.getDate()).getTime();

				if (oldStartDateOnly === newStartDateOnly && oldEvery === newEvery) {
					continue; // No schedule change that affects dose IDs
				}

				// Build set of new valid dateOnlyMs values for this intake
				const newDates = new Set<number>();
				for (let d = new Date(newStart); d <= migrationEnd; d.setDate(d.getDate() + newEvery)) {
					newDates.add(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
				}

				// Build set of old dateOnlyMs values with mapping to nearest new date
				const oldToNewMap = new Map<number, number>();
				for (let d = new Date(oldStart); d <= migrationEnd; d.setDate(d.getDate() + oldEvery)) {
					const oldDateMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
					// Find the closest new date within ±(newEvery/2) days
					const halfInterval = (newEvery * MS_PER_DAY) / 2;
					let bestMatch: number | null = null;
					let bestDist = Infinity;
					for (const newDateMs of newDates) {
						const dist = Math.abs(newDateMs - oldDateMs);
						if (dist < bestDist && dist <= halfInterval) {
							bestDist = dist;
							bestMatch = newDateMs;
						}
					}
					if (bestMatch !== null && bestMatch !== oldDateMs) {
						oldToNewMap.set(oldDateMs, bestMatch);
						// Remove matched new date to prevent double-mapping
						newDates.delete(bestMatch);
					}
				}

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
				const updatedDoses = await db
					.select()
					.from(doseTracking)
					.where(and(eq(doseTracking.userId, userId), like(doseTracking.doseId, `${idNum}-%`)));

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
			packageType: result[0].packageType ?? "blister",
			packCount: result[0].packCount,
			blistersPerPack: result[0].blistersPerPack,
			pillsPerBlister: result[0].pillsPerBlister,
			totalPills: result[0].totalPills ?? null,
			looseTablets: result[0].looseTablets,
			stockAdjustment: result[0].stockAdjustment ?? 0,
			lastStockCorrectionAt: result[0].lastStockCorrectionAt?.toISOString() ?? null,
			pillWeightMg: result[0].pillWeightMg,
			doseUnit: result[0].doseUnit ?? "mg",
			medicationStartDate: result[0].medicationStartDate || null,
			intakes,
			blisters: intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start })),
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
			updatedAt: result[0].updatedAt,
		};
	});

	app.post<{ Params: { id: string } }>("/medications/:id/obsolete", async (req, reply) => {
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
			updatedAt: updated.updatedAt,
		};
	});

	app.post<{ Params: { id: string } }>("/medications/:id/reactivate", async (req, reply) => {
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
			updatedAt: updated.updatedAt,
		};
	});

	// Stock correction endpoint - only updates stockAdjustment, preserves looseTablets
	// Also sets lastStockCorrectionAt so consumed doses before this point don't count
	app.patch<{ Params: { id: string }; Body: { stockAdjustment: number } }>(
		"/medications/:id/stock-adjustment",
		async (req, reply) => {
			const idNum = Number(req.params.id);
			if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

			const userId = await getUserId(req, reply);

			// Verify ownership
			const [existing] = await db
				.select()
				.from(medications)
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
			if (!existing) return reply.notFound();

			const { stockAdjustment } = req.body as { stockAdjustment: number };
			if (typeof stockAdjustment !== "number") return reply.badRequest("stockAdjustment must be a number");

			const result = await db
				.update(medications)
				.set({
					stockAdjustment,
					lastStockCorrectionAt: new Date(), // Mark when correction was made
					updatedAt: new Date(),
				})
				.where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
				.returning();

			if (!result.length) return reply.notFound();

			return {
				id: result[0].id,
				stockAdjustment: result[0].stockAdjustment ?? 0,
				lastStockCorrectionAt: result[0].lastStockCorrectionAt?.toISOString() ?? null,
				updatedAt: result[0].updatedAt,
			};
		}
	);

	app.delete<{ Params: { id: string } }>("/medications/:id", async (req, reply) => {
		const idNum = Number(req.params.id);
		if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

		const userId = await getUserId(req, reply);

		// Delete associated image if exists (with ownership check)
		const [existing] = await db
			.select()
			.from(medications)
			.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
		if (!existing) return reply.notFound();

		if (existing.imageUrl) {
			const imagePath = resolve(IMAGES_DIR, existing.imageUrl);
			if (existsSync(imagePath)) unlinkSync(imagePath);
		}

		const deleted = await db
			.delete(medications)
			.where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
			.returning();
		if (!deleted.length) return reply.notFound();
		return reply.status(204).send();
	});

	// Upload medication image
	app.post<{ Params: { id: string } }>("/medications/:id/image", async (req, reply) => {
		const idNum = Number(req.params.id);
		if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

		const userId = await getUserId(req, reply);
		const [existing] = await db
			.select()
			.from(medications)
			.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
		if (!existing) return reply.notFound();

		const data = await req.file();
		if (!data) return reply.badRequest("No file uploaded");

		const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
		if (!allowedTypes.includes(data.mimetype)) {
			return reply.badRequest("Invalid file type. Allowed: JPEG, PNG, WebP, GIF");
		}

		const ext = extname(data.filename) || ".jpg";
		const filename = `med-${idNum}-${Date.now()}${ext}`;
		const filepath = resolve(IMAGES_DIR, filename);

		await pipeline(data.file, createWriteStream(filepath));

		// Delete old image if exists
		if (existing.imageUrl) {
			const oldPath = resolve(IMAGES_DIR, existing.imageUrl);
			if (existsSync(oldPath)) unlinkSync(oldPath);
		}

		await db
			.update(medications)
			.set({ imageUrl: filename, updatedAt: new Date() })
			.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));

		return { success: true, imageUrl: filename };
	});

	// Delete medication image
	app.delete<{ Params: { id: string } }>("/medications/:id/image", async (req, reply) => {
		const idNum = Number(req.params.id);
		if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

		const userId = await getUserId(req, reply);
		const [existing] = await db
			.select()
			.from(medications)
			.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
		if (!existing) return reply.notFound();

		if (existing.imageUrl) {
			const filepath = resolve(IMAGES_DIR, existing.imageUrl);
			if (existsSync(filepath)) unlinkSync(filepath);
		}

		await db
			.update(medications)
			.set({ imageUrl: null, updatedAt: new Date() })
			.where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
		return reply.status(204).send();
	});

	app.post("/medications/usage", async (req, reply) => {
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
		const rows = await db
			.select()
			.from(medications)
			.where(and(eq(medications.userId, userId), eq(medications.isObsolete, false)))
			.orderBy(medications.id);

		// Get all taken doses for this user to calculate actual consumption
		const takenDoses = await db
			.select()
			.from(doseTracking)
			.where(and(eq(doseTracking.userId, userId), eq(doseTracking.dismissed, false)));

		// Create a map of medication ID to taken dose count
		const takenDosesMap = new Map<number, { blisterIdx: number; usage: number }[]>();
		takenDoses.forEach((dose) => {
			const parts = dose.doseId.split("-");
			if (parts.length >= 3) {
				const medId = parseInt(parts[0], 10);
				const blisterIdx = parseInt(parts[1], 10);
				if (!Number.isNaN(medId) && !Number.isNaN(blisterIdx)) {
					if (!takenDosesMap.has(medId)) {
						takenDosesMap.set(medId, []);
					}
					takenDosesMap.get(medId)!.push({ blisterIdx, usage: 0 }); // usage filled later
				}
			}
		});

		// Use current time as the reference point for "available" stock
		const now = new Date();

		const payload = rows.map((row) => {
			// Parse intakes from new format, falling back to legacy
			const intakes = parseIntakesJson(
				row.intakesJson,
				{ usageJson: row.usageJson, everyJson: row.everyJson, startJson: row.startJson },
				row.intakeRemindersEnabled ?? false
			);
			const blisters = intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start }));
			const pillsPerBlister = row.pillsPerBlister ?? 1;
			const packCount = row.packCount ?? 1;
			const blistersPerPack = row.blistersPerPack ?? 1;
			const looseTablets = row.looseTablets ?? 0;
			const stockAdjustment = row.stockAdjustment ?? 0;
			const packageType = row.packageType ?? "blister";

			// For bottle type, looseTablets IS the current stock (no blister math)
			const originalTotalPills =
				packageType === "bottle"
					? looseTablets + stockAdjustment
					: packCount * blistersPerPack * pillsPerBlister + looseTablets + stockAdjustment;

			// Calculate consumption based on ACTUAL taken doses from dose_tracking
			// This ensures Planner shows the same "current stock" as the Dashboard/Modal
			// Use the same logic as frontend: generate expected doses and check which are marked
			const stockCorrectionCutoff = row.lastStockCorrectionAt ? new Date(row.lastStockCorrectionAt).getTime() : 0;

			// Build a Set of taken dose IDs for quick lookup
			const takenDoseIds = new Set(
				takenDoses
					.filter((dose) => {
						const parts = dose.doseId.split("-");
						return parts.length >= 3 && parseInt(parts[0], 10) === row.id;
					})
					.map((dose) => dose.doseId)
			);

			// Count consumed pills by generating expected doses and checking if they're taken
			let consumedUntilNow = 0;
			const msPerDay = 86400000;

			blisters.forEach((blister, blisterIdx) => {
				const blisterStart = parseLocalDateTime(blister.start);
				if (Number.isNaN(blisterStart.getTime())) return;

				const period = Math.max(1, blister.every) * msPerDay;

				// After a stock correction, start counting from the NEXT scheduled
				// dose, because the user's pill count already reflects all
				// consumption up to the correction time.
				let effectiveStart: number;
				if (stockCorrectionCutoff > 0 && stockCorrectionCutoff >= blisterStart.getTime()) {
					effectiveStart = stockCorrectionCutoff + period;
				} else {
					effectiveStart = blisterStart.getTime();
				}
				if (effectiveStart > now.getTime()) return;

				const occurrences = Math.floor((now.getTime() - effectiveStart) / period) + 1;

				// Get the people for this intake (from intakes array or medication takenBy)
				const takenByJson = row.takenByJson ? JSON.parse(row.takenByJson) : [];
				const intake = intakes[blisterIdx];
				const intakePerson = intake?.takenBy;
				const takenByFallback: (string | null)[] = takenByJson.length > 0 ? takenByJson : [null];
				const peopleForThisIntake: (string | null)[] = intakePerson ? [intakePerson] : takenByFallback;

				// Generate expected dose IDs and check if they're taken
				for (let i = 0; i < occurrences; i++) {
					const doseDate = new Date(effectiveStart + i * period);
					const dateOnlyMs = new Date(doseDate.getFullYear(), doseDate.getMonth(), doseDate.getDate()).getTime();
					const baseDoseId = `${row.id}-${blisterIdx}-${dateOnlyMs}`;

					// Check if each person has taken this dose
					for (const person of peopleForThisIntake) {
						const doseId = person ? `${baseDoseId}-${person}` : baseDoseId;
						if (takenDoseIds.has(doseId)) {
							consumedUntilNow += blister.usage;
						}
					}
				}
			});

			const currentStock = Math.max(0, originalTotalPills - consumedUntilNow);

			// Calculate usage for the planning period
			// Always use the user-selected start date for the usage calculation.
			// Using max(now, start) would cause asymmetric counting when now falls
			// between morning and evening doses on the start day (e.g., morning dose
			// skipped but evening counted), leading to confusing off-by-one results.
			// The stock already reflects consumed doses, so no double-counting occurs.
			// When includeUntilStart is true, calculate from now to end (useful for trip planning)
			const effectivePlannerStart = includeUntilStart ? now : start;
			const usageTotal = calculateUsageInRange(blisters, effectivePlannerStart, end);

			const blistersNeeded = pillsPerBlister > 0 ? Math.ceil(usageTotal / pillsPerBlister) : 0;

			// Calculate AVAILABLE = stock AFTER the planned period (currentStock - usageTotal)
			const availableAfterPeriod = Math.max(0, currentStock - usageTotal);

			let fullBlisters: number;
			let loosePills: number;

			if (packageType === "bottle") {
				// Bottle type: no blisters, everything is loose pills
				fullBlisters = 0;
				loosePills = availableAfterPeriod;
			} else {
				// Blister type: calculate stock breakdown
				// Consumption order: loose pills first, then from blisters
				const totalConsumedByEnd = originalTotalPills - availableAfterPeriod;
				const looseConsumedByEnd = Math.min(totalConsumedByEnd, looseTablets);
				const loosePillsRemaining = Math.max(0, looseTablets - looseConsumedByEnd);
				const blisterPillsConsumed = totalConsumedByEnd - looseConsumedByEnd;
				const originalBlisterPills = originalTotalPills - looseTablets;
				const blisterPillsRemaining = Math.max(0, originalBlisterPills - blisterPillsConsumed);

				fullBlisters = pillsPerBlister > 0 ? Math.floor(blisterPillsRemaining / pillsPerBlister) : 0;
				const openBlisterPills = pillsPerBlister > 0 ? blisterPillsRemaining % pillsPerBlister : 0;
				loosePills = loosePillsRemaining + openBlisterPills; // Combine open blister + remaining loose
			}

			const enough = currentStock >= usageTotal;
			return {
				medicationId: row.id,
				medicationName: row.name,
				totalPills: currentStock,
				plannerUsage: usageTotal,
				blisterSize: pillsPerBlister,
				blistersNeeded,
				fullBlisters,
				loosePills,
				enough,
				packageType,
			};
		});

		return payload;
	});

	// ---------------------------------------------------------------------------
	// POST /medications/dismiss-until - Set dismissedUntil date for multiple medications
	// This is more robust than storing individual dose IDs (which can change with schedule updates)
	// ---------------------------------------------------------------------------
	const dismissUntilSchema = z.object({
		medicationIds: z.array(z.number().int().positive()).min(1),
		until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
	});

	app.post<{ Body: z.infer<typeof dismissUntilSchema> }>("/medications/dismiss-until", async (req, reply) => {
		const parsed = dismissUntilSchema.safeParse(req.body);
		if (!parsed.success) {
			return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
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
	});

	// ---------------------------------------------------------------------------
	// DELETE /medications/:id/dismiss-until - Clear dismissedUntil for a medication
	// ---------------------------------------------------------------------------
	app.delete<{ Params: { id: string } }>("/medications/:id/dismiss-until", async (req, reply) => {
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
	});
}

function calculateUsageInRange(
	blisters: Array<{ usage: number; every: number; start: string }>,
	start: Date,
	end: Date
) {
	let total = 0;
	const msPerDay = 86400000;
	blisters.forEach((blister) => {
		const blisterStart = parseLocalDateTime(blister.start);
		if (Number.isNaN(blisterStart.getTime())) return;

		const every = Math.max(1, blister.every);

		// Skip ahead to the first occurrence at or after start to avoid
		// iterating through months/years of past doses
		const dt = new Date(blisterStart);
		if (dt < start) {
			const daysToSkip = Math.floor((start.getTime() - dt.getTime()) / (every * msPerDay));
			dt.setDate(dt.getDate() + daysToSkip * every);
			// Fine-tune: advance until we reach or pass start
			while (dt < start) {
				dt.setDate(dt.getDate() + every);
			}
		}

		// Count occurrences in [start, end)
		for (; dt < end; dt.setDate(dt.getDate() + every)) {
			total += blister.usage;
		}
	});
	return Number(total.toFixed(2));
}
