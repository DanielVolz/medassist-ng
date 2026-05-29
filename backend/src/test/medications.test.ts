/**
 * Tests for /medications API endpoints.
 * Tests CRUD operations for medications.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	buildTestApp,
	clearTestData,
	closeTestApp,
	createTestMedication,
	createTestUser,
	type TestContext,
} from "./setup.js";

// =============================================================================
// Route Registration
// =============================================================================

async function registerMedicationRoutes(ctx: TestContext) {
	const { app, client } = ctx;

	function serializeMedicationRow(m: Record<string, unknown>) {
		return {
			id: m.id,
			name: m.name,
			genericName: m.generic_name,
			takenBy: JSON.parse((m.taken_by_json as string) || "[]"),
			packCount: m.pack_count,
			blistersPerPack: m.blisters_per_pack,
			pillsPerBlister: m.pills_per_blister,
			looseTablets: m.loose_tablets,
			pillWeightMg: m.pill_weight_mg,
			imageUrl: m.image_url,
			expiryDate: m.expiry_date,
			notes: m.notes,
			intakeRemindersEnabled: Boolean(m.intake_reminders_enabled),
			blisters: (() => {
				const usage: number[] = JSON.parse((m.usage_json as string) || "[]");
				const every: number[] = JSON.parse((m.every_json as string) || "[]");
				const start: string[] = JSON.parse((m.start_json as string) || "[]");
				return usage.map((u, i) => ({
					usage: u,
					every: every[i] || 1,
					start: start[i] || new Date().toISOString(),
				}));
			})(),
		};
	}

	// GET /medications - List all medications
	app.get("/medications", async (_request, _reply) => {
		const userId = 1;

		const result = await client.execute({
			sql: `SELECT * FROM medications WHERE user_id = ? ORDER BY name`,
			args: [userId],
		});

		return result.rows.map((m) => serializeMedicationRow(m as Record<string, unknown>));
	});

	// POST /medications - Create medication
	app.post<{
		Body: {
			name: string;
			genericName?: string;
			takenBy?: string[];
			packCount?: number;
			blistersPerPack?: number;
			pillsPerBlister?: number;
			looseTablets?: number;
			pillWeightMg?: number;
			expiryDate?: string;
			notes?: string;
			intakeRemindersEnabled?: boolean;
			blisters: Array<{ usage: number; every: number; start: string }>;
		};
	}>("/medications", async (request, reply) => {
		const userId = 1;
		const body = request.body || {};

		// Validation
		if (!body.name || body.name.length === 0) {
			return reply.status(400).send({ error: "Name is required" });
		}
		if (body.name.length > 100) {
			return reply.status(400).send({ error: "Name must be 100 characters or less" });
		}
		if (!body.blisters || body.blisters.length === 0) {
			return reply.status(400).send({ error: "At least one intake schedule is required" });
		}
		if (body.blisters.length > 12) {
			return reply.status(400).send({ error: "Maximum 12 intake schedules allowed" });
		}

		const usageJson = JSON.stringify(body.blisters.map((b) => b.usage));
		const everyJson = JSON.stringify(body.blisters.map((b) => b.every));
		const startJson = JSON.stringify(body.blisters.map((b) => b.start));
		const takenByJson = JSON.stringify(body.takenBy || []);

		const result = await client.execute({
			sql: `INSERT INTO medications (
        user_id, name, generic_name, taken_by_json,
        pack_count, blisters_per_pack, pills_per_blister, loose_tablets,
        pill_weight_mg, expiry_date, notes, intake_reminders_enabled,
        usage_json, every_json, start_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
			args: [
				userId,
				body.name,
				body.genericName || null,
				takenByJson,
				body.packCount ?? 1,
				body.blistersPerPack ?? 1,
				body.pillsPerBlister ?? 1,
				body.looseTablets ?? 0,
				body.pillWeightMg ?? null,
				body.expiryDate || null,
				body.notes || null,
				body.intakeRemindersEnabled ? 1 : 0,
				usageJson,
				everyJson,
				startJson,
			],
		});

		return { id: result.rows[0].id, success: true };
	});

	// PUT /medications/:id - Update medication
	app.put<{
		Params: { id: string };
		Body: {
			name: string;
			genericName?: string;
			takenBy?: string[];
			packCount?: number;
			blistersPerPack?: number;
			pillsPerBlister?: number;
			looseTablets?: number;
			pillWeightMg?: number;
			expiryDate?: string;
			notes?: string;
			intakeRemindersEnabled?: boolean;
			blisters: Array<{ usage: number; every: number; start: string }>;
		};
	}>("/medications/:id", async (request, reply) => {
		const userId = 1;
		const medId = parseInt(request.params.id, 10);
		const body = request.body || {};

		// Check ownership
		const existing = await client.execute({
			sql: `SELECT id FROM medications WHERE id = ? AND user_id = ?`,
			args: [medId, userId],
		});

		if (existing.rows.length === 0) {
			return reply.status(404).send({ error: "Medication not found" });
		}

		// Validation
		if (!body.name || body.name.length === 0) {
			return reply.status(400).send({ error: "Name is required" });
		}
		if (!body.blisters || body.blisters.length === 0) {
			return reply.status(400).send({ error: "At least one intake schedule is required" });
		}

		const usageJson = JSON.stringify(body.blisters.map((b) => b.usage));
		const everyJson = JSON.stringify(body.blisters.map((b) => b.every));
		const startJson = JSON.stringify(body.blisters.map((b) => b.start));
		const takenByJson = JSON.stringify(body.takenBy || []);

		await client.execute({
			sql: `UPDATE medications SET
        name = ?, generic_name = ?, taken_by_json = ?,
        pack_count = ?, blisters_per_pack = ?, pills_per_blister = ?, loose_tablets = ?,
        pill_weight_mg = ?, expiry_date = ?, notes = ?, intake_reminders_enabled = ?,
        usage_json = ?, every_json = ?, start_json = ?,
        updated_at = strftime('%s','now')
      WHERE id = ? AND user_id = ?`,
			args: [
				body.name,
				body.genericName || null,
				takenByJson,
				body.packCount ?? 1,
				body.blistersPerPack ?? 1,
				body.pillsPerBlister ?? 1,
				body.looseTablets ?? 0,
				body.pillWeightMg ?? null,
				body.expiryDate || null,
				body.notes || null,
				body.intakeRemindersEnabled ? 1 : 0,
				usageJson,
				everyJson,
				startJson,
				medId,
				userId,
			],
		});

		return { success: true };
	});

	// DELETE /medications/:id - Delete medication
	app.delete<{ Params: { id: string } }>("/medications/:id", async (request, reply) => {
		const userId = 1;
		const medId = parseInt(request.params.id, 10);

		// Check ownership
		const existing = await client.execute({
			sql: `SELECT id FROM medications WHERE id = ? AND user_id = ?`,
			args: [medId, userId],
		});

		if (existing.rows.length === 0) {
			return reply.status(404).send({ error: "Medication not found" });
		}

		await client.execute({
			sql: `DELETE FROM medications WHERE id = ? AND user_id = ?`,
			args: [medId, userId],
		});

		return { success: true };
	});

	// GET /medications/:id - Get single medication
	app.get<{ Params: { id: string } }>("/medications/:id", async (request, reply) => {
		const userId = 1;
		const medId = parseInt(request.params.id, 10);

		const result = await client.execute({
			sql: `SELECT * FROM medications WHERE id = ? AND user_id = ?`,
			args: [medId, userId],
		});

		if (result.rows.length === 0) {
			return reply.status(404).send({ error: "Medication not found" });
		}

		const m = result.rows[0];
		return serializeMedicationRow(m as Record<string, unknown>);
	});
}

// =============================================================================
// Tests
// =============================================================================

describe("Medications API", () => {
	let ctx: TestContext;
	let userId: number;

	beforeAll(async () => {
		ctx = await buildTestApp();
		await registerMedicationRoutes(ctx);
		await ctx.app.ready();
	});

	afterAll(async () => {
		await closeTestApp(ctx);
	});

	beforeEach(async () => {
		await clearTestData(ctx.client);
		await ctx.client.execute("DELETE FROM sqlite_sequence WHERE name='users'");
		await ctx.client.execute("DELETE FROM sqlite_sequence WHERE name='medications'");
		userId = await createTestUser(ctx.client, { username: "testuser" });
	});

	// ---------------------------------------------------------------------------
	// GET /medications
	// ---------------------------------------------------------------------------

	describe("GET /medications", () => {
		it("should return empty array when no medications", async () => {
			const response = await ctx.app.inject({
				method: "GET",
				url: "/medications",
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual([]);
		});

		it("should return list of medications", async () => {
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				genericName: "Acetylsalicylic acid",
				takenBy: ["Daniel"],
				packCount: 2,
				pillsPerBlister: 10,
			});
			await createTestMedication(ctx.client, {
				userId,
				name: "Ibuprofen",
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/medications",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data).toHaveLength(2);
			// Sorted by name
			expect(data[0].name).toBe("Aspirin");
			expect(data[0].genericName).toBe("Acetylsalicylic acid");
			expect(data[0].takenBy).toEqual(["Daniel"]);
			expect(data[1].name).toBe("Ibuprofen");
		});

		it("should return medication with all fields", async () => {
			const startDate = "2025-01-01T08:00:00.000Z";
			await createTestMedication(ctx.client, {
				userId,
				name: "Test Med",
				genericName: "Generic Name",
				takenBy: ["Person1", "Person2"],
				packCount: 3,
				blistersPerPack: 2,
				pillsPerBlister: 14,
				looseTablets: 5,
				pillWeightMg: 500,
				blisters: [
					{ usage: 1, every: 1, start: startDate },
					{ usage: 2, every: 2, start: startDate },
				],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/medications",
			});

			expect(response.statusCode).toBe(200);
			const [med] = response.json();
			expect(med.name).toBe("Test Med");
			expect(med.genericName).toBe("Generic Name");
			expect(med.takenBy).toEqual(["Person1", "Person2"]);
			expect(med.packCount).toBe(3);
			expect(med.blistersPerPack).toBe(2);
			expect(med.pillsPerBlister).toBe(14);
			expect(med.looseTablets).toBe(5);
			expect(med.pillWeightMg).toBe(500);
			expect(med.blisters).toHaveLength(2);
			expect(med.blisters[0]).toEqual({ usage: 1, every: 1, start: startDate });
			expect(med.blisters[1]).toEqual({ usage: 2, every: 2, start: startDate });
		});
	});

	// ---------------------------------------------------------------------------
	// POST /medications
	// ---------------------------------------------------------------------------

	describe("POST /medications", () => {
		it("should create a medication", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "New Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.success).toBe(true);
			expect(data.id).toBeDefined();

			// Verify in database
			const result = await ctx.client.execute({
				sql: `SELECT name FROM medications WHERE id = ?`,
				args: [data.id],
			});
			expect(result.rows[0].name).toBe("New Med");
		});

		it("should create medication with all fields", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Full Med",
					genericName: "Generic",
					takenBy: ["Alice", "Bob"],
					packCount: 2,
					blistersPerPack: 3,
					pillsPerBlister: 10,
					looseTablets: 5,
					pillWeightMg: 250,
					expiryDate: "2026-12-31",
					notes: "Take with food",
					intakeRemindersEnabled: true,
					blisters: [
						{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" },
						{ usage: 2, every: 1, start: "2025-01-01T20:00:00.000Z" },
					],
				},
			});

			expect(response.statusCode).toBe(200);

			// Verify
			const medId = response.json().id;
			const result = await ctx.client.execute({
				sql: `SELECT * FROM medications WHERE id = ?`,
				args: [medId],
			});
			const med = result.rows[0];
			expect(med.name).toBe("Full Med");
			expect(med.generic_name).toBe("Generic");
			expect(JSON.parse(med.taken_by_json as string)).toEqual(["Alice", "Bob"]);
			expect(med.pack_count).toBe(2);
			expect(med.blisters_per_pack).toBe(3);
			expect(med.pills_per_blister).toBe(10);
			expect(med.loose_tablets).toBe(5);
			expect(med.pill_weight_mg).toBe(250);
			expect(med.expiry_date).toBe("2026-12-31");
			expect(med.notes).toBe("Take with food");
			expect(med.intake_reminders_enabled).toBe(1);
		});

		it("should reject request without name", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("Name is required");
		});

		it("should reject request without blisters", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Test",
					blisters: [],
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("At least one intake schedule is required");
		});

		it("should reject name over 100 characters", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "A".repeat(101),
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("Name must be 100 characters or less");
		});

		it("should reject more than 12 blisters", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Test",
					blisters: Array(13).fill({ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }),
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("Maximum 12 intake schedules allowed");
		});
	});

	// ---------------------------------------------------------------------------
	// PUT /medications/:id
	// ---------------------------------------------------------------------------

	describe("PUT /medications/:id", () => {
		it("should update a medication", async () => {
			const medId = await createTestMedication(ctx.client, {
				userId,
				name: "Old Name",
			});

			const response = await ctx.app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "New Name",
					blisters: [{ usage: 2, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify
			const result = await ctx.client.execute({
				sql: `SELECT name, usage_json FROM medications WHERE id = ?`,
				args: [medId],
			});
			expect(result.rows[0].name).toBe("New Name");
			expect(JSON.parse(result.rows[0].usage_json as string)).toEqual([2]);
		});

		it("should return 404 for non-existent medication", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/medications/99999",
				payload: {
					name: "Test",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(response.statusCode).toBe(404);
			expect(response.json().error).toBe("Medication not found");
		});

		it("should not update medication of another user", async () => {
			// Create another user
			const otherUserId = await createTestUser(ctx.client, { username: "other" });
			const medId = await createTestMedication(ctx.client, {
				userId: otherUserId,
				name: "Other Med",
			});

			const response = await ctx.app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Hacked",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(response.statusCode).toBe(404);
		});
	});

	// ---------------------------------------------------------------------------
	// DELETE /medications/:id
	// ---------------------------------------------------------------------------

	describe("DELETE /medications/:id", () => {
		it("should delete a medication", async () => {
			const medId = await createTestMedication(ctx.client, {
				userId,
				name: "To Delete",
			});

			const response = await ctx.app.inject({
				method: "DELETE",
				url: `/medications/${medId}`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify deleted
			const result = await ctx.client.execute({
				sql: `SELECT COUNT(*) as count FROM medications WHERE id = ?`,
				args: [medId],
			});
			expect(result.rows[0].count).toBe(0);
		});

		it("should return 404 for non-existent medication", async () => {
			const response = await ctx.app.inject({
				method: "DELETE",
				url: "/medications/99999",
			});

			expect(response.statusCode).toBe(404);
		});
	});

	// ---------------------------------------------------------------------------
	// GET /medications/:id
	// ---------------------------------------------------------------------------

	describe("GET /medications/:id", () => {
		it("should return single medication", async () => {
			const medId = await createTestMedication(ctx.client, {
				userId,
				name: "Single Med",
				genericName: "Generic",
				takenBy: ["Daniel"],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: `/medications/${medId}`,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.id).toBe(medId);
			expect(data.name).toBe("Single Med");
			expect(data.genericName).toBe("Generic");
			expect(data.takenBy).toEqual(["Daniel"]);
		});

		it("should return 404 for non-existent medication", async () => {
			const response = await ctx.app.inject({
				method: "GET",
				url: "/medications/99999",
			});

			expect(response.statusCode).toBe(404);
		});
	});

	// ---------------------------------------------------------------------------
	// Stock Calculation Tests
	// ---------------------------------------------------------------------------

	describe("Stock Calculation", () => {
		it("should calculate total pills correctly", async () => {
			await createTestMedication(ctx.client, {
				userId,
				name: "Stock Test",
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				looseTablets: 5,
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/medications",
			});

			const [med] = response.json();
			// Total = (2 packs × 3 blisters × 10 pills) + 5 loose = 65
			const totalPills = med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets;
			expect(totalPills).toBe(65);
		});
	});
});
