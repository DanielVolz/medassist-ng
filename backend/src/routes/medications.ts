import { createWriteStream, existsSync, unlinkSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { and, eq, like } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { doseTracking, medications } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";
import { type Intake, parseIntakesJson, parseLocalDateTime, parseTakenByJson } from "../utils/scheduler-utils.js";

const IMAGES_DIR = resolve(process.cwd(), "data/images");

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
		expiryDate: z.string().nullable().optional(),
		notes: z.string().max(2000).nullable().optional(),
		intakeRemindersEnabled: z.boolean().default(false), // Medication-level (deprecated, kept for backward compat)
		// Accept either new intakes format or legacy blisters format
		intakes: z.array(intakeSchema).min(1).max(12).optional(),
		blisters: z.array(blisterSchema).min(1).max(12).optional(), // Legacy format
	})
	.refine((data) => data.intakes || data.blisters, { message: "Either 'intakes' or 'blisters' must be provided" });

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

	app.get("/medications", async (request, reply) => {
		const userId = await getUserId(request, reply);
		const rows = await db.select().from(medications).where(eq(medications.userId, userId)).orderBy(medications.id);
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
				intakes, // New unified format with per-intake takenBy
				// Legacy blisters format (for backward compat with frontend during transition)
				blisters: intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start })),
				imageUrl: row.imageUrl,
				expiryDate: row.expiryDate,
				notes: row.notes,
				intakeRemindersEnabled: row.intakeRemindersEnabled ?? false,
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
			expiryDate,
			notes,
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
				expiryDate: expiryDate || null,
				notes: notes || null,
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
			intakes,
			blisters: intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start })),
			imageUrl: inserted.imageUrl,
			expiryDate: inserted.expiryDate,
			notes: inserted.notes,
			intakeRemindersEnabled: inserted.intakeRemindersEnabled,
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
			expiryDate,
			notes,
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
				expiryDate: expiryDate || null,
				notes: notes || null,
				intakeRemindersEnabled: intakeRemindersEnabled ?? false,
				intakesJson,
				usageJson,
				everyJson,
				startJson,
				updatedAt: new Date(),
			})
			.where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
			.returning();

		if (!result.length) return reply.notFound();

		// Clean up dose tracking entries that are before the earliest start date
		// This ensures consistency when the user changes the start date
		const earliestStart = Math.min(...intakes.map((b) => parseLocalDateTime(b.start).getTime()));
		if (!Number.isNaN(earliestStart)) {
			// Get all dose tracking entries for this medication and filter out invalid ones
			const allDoses = await db
				.select()
				.from(doseTracking)
				.where(and(eq(doseTracking.userId, userId), like(doseTracking.doseId, `${idNum}-%`)));

			// Find doses with timestamps before the earliest start date
			const dosesToDelete = allDoses.filter((dose) => {
				const parts = dose.doseId.split("-");
				if (parts.length >= 3) {
					const timestamp = parseInt(parts[2], 10);
					return !Number.isNaN(timestamp) && timestamp < earliestStart;
				}
				return false;
			});

			// Delete invalid doses
			for (const dose of dosesToDelete) {
				await db.delete(doseTracking).where(eq(doseTracking.id, dose.id));
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
			intakes,
			blisters: intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start })),
			imageUrl: result[0].imageUrl,
			expiryDate: result[0].expiryDate,
			notes: result[0].notes,
			intakeRemindersEnabled: result[0].intakeRemindersEnabled,
			updatedAt: result[0].updatedAt,
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
		const schema = z.object({ startDate: z.string().datetime(), endDate: z.string().datetime() });
		const parsed = schema.safeParse(req.body);
		if (!parsed.success) return reply.status(400).send(parsed.error.format());
		const { startDate, endDate } = parsed.data;
		const start = new Date(startDate);
		const end = new Date(endDate);
		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
			return reply.badRequest("Invalid date range");
		}

		const userId = await getUserId(req, reply);
		const rows = await db.select().from(medications).where(eq(medications.userId, userId)).orderBy(medications.id);
		const now = new Date();

		const payload = rows.map((row) => {
			// Parse intakes from new format, falling back to legacy
			const intakes = parseIntakesJson(
				row.intakesJson,
				{ usageJson: row.usageJson, everyJson: row.everyJson, startJson: row.startJson },
				row.intakeRemindersEnabled ?? false
			);
			const blisters = intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start }));
			const usageTotal = calculateUsageInRange(blisters, start, end);
			const pillsPerBlister = row.pillsPerBlister ?? 1;
			const packCount = row.packCount ?? 1;
			const blistersPerPack = row.blistersPerPack ?? 1;
			const looseTablets = row.looseTablets ?? 0;
			const stockAdjustment = row.stockAdjustment ?? 0;
			const originalTotalPills = packCount * blistersPerPack * pillsPerBlister + looseTablets + stockAdjustment;

			// Calculate consumption up to now (same logic as frontend)
			let consumedUntilNow = 0;
			blisters.forEach((blister) => {
				const blisterStart = parseLocalDateTime(blister.start);
				if (Number.isNaN(blisterStart.getTime()) || blisterStart > now) return;
				const msPerDay = 86400000;
				const period = Math.max(1, blister.every) * msPerDay;
				const occurrences = Math.floor((now.getTime() - blisterStart.getTime()) / period) + 1;
				consumedUntilNow += occurrences * blister.usage;
			});

			const currentPills = Math.max(0, originalTotalPills - consumedUntilNow);
			const blistersNeeded = pillsPerBlister > 0 ? Math.ceil(usageTotal / pillsPerBlister) : 0;

			// Calculate current stock using realistic consumption order (loose first, then blisters)
			const consumed = originalTotalPills - currentPills;
			const looseConsumed = Math.min(consumed, looseTablets);
			const loosePillsRemaining = looseTablets - looseConsumed;
			const blisterPillsConsumed = consumed - looseConsumed;
			const originalBlisterPills = originalTotalPills - looseTablets;
			const blisterPillsRemaining = Math.max(0, originalBlisterPills - blisterPillsConsumed);

			const fullBlisters = pillsPerBlister > 0 ? Math.floor(blisterPillsRemaining / pillsPerBlister) : 0;
			const openBlisterPills = pillsPerBlister > 0 ? blisterPillsRemaining % pillsPerBlister : 0;
			const loosePills = loosePillsRemaining + openBlisterPills; // Combine open blister + remaining loose

			const enough = currentPills >= usageTotal;
			return {
				medicationId: row.id,
				medicationName: row.name,
				totalPills: currentPills,
				plannerUsage: usageTotal,
				blisterSize: pillsPerBlister,
				blistersNeeded,
				fullBlisters,
				loosePills,
				enough,
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
	blisters.forEach((blister) => {
		const blisterStart = parseLocalDateTime(blister.start);
		if (Number.isNaN(blisterStart.getTime())) return;
		// iterate occurrences from blisterStart up to end
		for (let dt = new Date(blisterStart); dt < end; dt.setDate(dt.getDate() + blister.every)) {
			if (dt >= start && dt < end) total += blister.usage;
		}
	});
	return Number(total.toFixed(2));
}
