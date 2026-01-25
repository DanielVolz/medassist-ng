/**
 * Tests for /medications/:id/refill and /medications/:id/refills API endpoints.
 * Tests adding refills to medication stock and retrieving refill history.
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

// Store userId at module level so routes can access it
let currentUserId = 1;

// =============================================================================
// Route Registration
// =============================================================================

async function registerRefillRoutes(ctx: TestContext) {
	const { app, client } = ctx;

	// POST /medications/:id/refill - Add stock and record history
	app.post<{ Params: { id: string }; Body: { packsAdded?: number; loosePillsAdded?: number } }>(
		"/medications/:id/refill",
		async (request, reply) => {
			const userId = currentUserId;
			const medId = parseInt(request.params.id, 10);
			const { packsAdded = 0, loosePillsAdded = 0 } = request.body || {};

			// Validate input
			if (packsAdded < 0 || loosePillsAdded < 0) {
				return reply.status(400).send({ error: "packsAdded and loosePillsAdded must be non-negative" });
			}
			if (packsAdded === 0 && loosePillsAdded === 0) {
				return reply
					.status(400)
					.send({ error: "At least one of packsAdded or loosePillsAdded must be greater than 0" });
			}

			// Check medication exists and belongs to user
			const medResult = await client.execute({
				sql: `SELECT id, pack_count, loose_tablets, blisters_per_pack, pills_per_blister 
              FROM medications WHERE id = ? AND user_id = ?`,
				args: [medId, userId],
			});

			if (medResult.rows.length === 0) {
				return reply.status(404).send({ error: "Medication not found" });
			}

			const med = medResult.rows[0];
			const newPackCount = (med.pack_count as number) + packsAdded;
			const newLooseTablets = (med.loose_tablets as number) + loosePillsAdded;
			const pillsPerPack = (med.blisters_per_pack as number) * (med.pills_per_blister as number);
			const totalPillsAdded = packsAdded * pillsPerPack + loosePillsAdded;

			// Update medication stock
			await client.execute({
				sql: `UPDATE medications SET pack_count = ?, loose_tablets = ? WHERE id = ?`,
				args: [newPackCount, newLooseTablets, medId],
			});

			// Record refill history
			await client.execute({
				sql: `INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added) 
              VALUES (?, ?, ?, ?)`,
				args: [medId, userId, packsAdded, loosePillsAdded],
			});

			return {
				success: true,
				pillsAdded: totalPillsAdded,
				newPackCount,
				newLooseTablets,
			};
		}
	);

	// GET /medications/:id/refills - Get refill history
	app.get<{ Params: { id: string } }>("/medications/:id/refills", async (request, reply) => {
		const userId = currentUserId;
		const medId = parseInt(request.params.id, 10);

		// Check medication exists and belongs to user
		const medResult = await client.execute({
			sql: `SELECT id FROM medications WHERE id = ? AND user_id = ?`,
			args: [medId, userId],
		});

		if (medResult.rows.length === 0) {
			return reply.status(404).send({ error: "Medication not found" });
		}

		// Get refill history, newest first
		const refillResult = await client.execute({
			sql: `SELECT id, packs_added, loose_pills_added, refill_date 
            FROM refill_history 
            WHERE medication_id = ? AND user_id = ?
            ORDER BY refill_date DESC`,
			args: [medId, userId],
		});

		return {
			refills: refillResult.rows.map((r) => ({
				id: r.id,
				packsAdded: r.packs_added,
				loosePillsAdded: r.loose_pills_added,
				refillDate: r.refill_date,
			})),
		};
	});
}

// =============================================================================
// Tests
// =============================================================================

describe("Refill API", () => {
	let ctx: TestContext;
	let userId: number;
	let medId: number;

	beforeAll(async () => {
		ctx = await buildTestApp();
		await registerRefillRoutes(ctx);
		await ctx.app.ready();
	});

	afterAll(async () => {
		await closeTestApp(ctx);
	});

	beforeEach(async () => {
		await clearTestData(ctx.client);
		// Create test user
		userId = await createTestUser(ctx.client, { username: "testuser" });
		// Update the module-level userId so routes use the correct one
		currentUserId = userId;
		// Create a test medication with 1 pack (10 blisters × 10 pills = 100 pills/pack)
		medId = await createTestMedication(ctx.client, {
			userId,
			name: "Test Med",
			packCount: 1,
			blistersPerPack: 10,
			pillsPerBlister: 10,
			looseTablets: 5,
		});
	});

	// ---------------------------------------------------------------------------
	// POST /medications/:id/refill
	// ---------------------------------------------------------------------------

	describe("POST /medications/:id/refill", () => {
		it("should add packs to medication stock", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 2 },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.success).toBe(true);
			expect(data.pillsAdded).toBe(200); // 2 packs × 100 pills
			expect(data.newPackCount).toBe(3); // 1 + 2

			// Verify in database
			const result = await ctx.client.execute({
				sql: `SELECT pack_count FROM medications WHERE id = ?`,
				args: [medId],
			});
			expect(result.rows[0].pack_count).toBe(3);
		});

		it("should add loose pills to medication stock", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { loosePillsAdded: 15 },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.success).toBe(true);
			expect(data.pillsAdded).toBe(15);
			expect(data.newLooseTablets).toBe(20); // 5 + 15

			// Verify in database
			const result = await ctx.client.execute({
				sql: `SELECT loose_tablets FROM medications WHERE id = ?`,
				args: [medId],
			});
			expect(result.rows[0].loose_tablets).toBe(20);
		});

		it("should add both packs and loose pills", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 10 },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.success).toBe(true);
			expect(data.pillsAdded).toBe(110); // 1 pack (100) + 10 loose
			expect(data.newPackCount).toBe(2);
			expect(data.newLooseTablets).toBe(15);
		});

		it("should record refill in history", async () => {
			await ctx.app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 2, loosePillsAdded: 5 },
			});

			// Check history
			const result = await ctx.client.execute({
				sql: `SELECT packs_added, loose_pills_added FROM refill_history WHERE medication_id = ?`,
				args: [medId],
			});
			expect(result.rows.length).toBe(1);
			expect(result.rows[0].packs_added).toBe(2);
			expect(result.rows[0].loose_pills_added).toBe(5);
		});

		it("should reject refill with zero amounts", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 0, loosePillsAdded: 0 },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toContain("At least one");
		});

		it("should reject refill with negative amounts", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: -1 },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toContain("non-negative");
		});

		it("should return 404 for non-existent medication", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: `/medications/99999/refill`,
				payload: { packsAdded: 1 },
			});

			expect(response.statusCode).toBe(404);
			expect(response.json().error).toBe("Medication not found");
		});
	});

	// ---------------------------------------------------------------------------
	// GET /medications/:id/refills
	// ---------------------------------------------------------------------------

	describe("GET /medications/:id/refills", () => {
		it("should return empty array when no refills", async () => {
			const response = await ctx.app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ refills: [] });
		});

		it("should return refill history newest first", async () => {
			// Add two refills with different values so we can identify them
			await ctx.app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 0 },
			});

			// Increase delay to ensure different timestamps (SQLite datetime has second precision)
			await new Promise((r) => setTimeout(r, 1100));

			await ctx.app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 0, loosePillsAdded: 20 },
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.refills).toHaveLength(2);

			// Newest first (loose pills - added second)
			expect(data.refills[0].packsAdded).toBe(0);
			expect(data.refills[0].loosePillsAdded).toBe(20);

			// Older (packs - added first)
			expect(data.refills[1].packsAdded).toBe(1);
			expect(data.refills[1].loosePillsAdded).toBe(0);

			// Each entry should have an id and refillDate
			for (const refill of data.refills) {
				expect(refill.id).toBeTypeOf("number");
				expect(refill.refillDate).toBeTruthy();
			}
		});

		it("should return 404 for non-existent medication", async () => {
			const response = await ctx.app.inject({
				method: "GET",
				url: `/medications/99999/refills`,
			});

			expect(response.statusCode).toBe(404);
			expect(response.json().error).toBe("Medication not found");
		});
	});

	// ---------------------------------------------------------------------------
	// Cascade Delete Tests
	// ---------------------------------------------------------------------------

	describe("Cascade Delete", () => {
		it("should delete refill history when medication is deleted", async () => {
			// Add a refill
			await ctx.app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1 },
			});

			// Verify refill exists
			let result = await ctx.client.execute({
				sql: `SELECT COUNT(*) as count FROM refill_history WHERE medication_id = ?`,
				args: [medId],
			});
			expect(result.rows[0].count).toBe(1);

			// Delete medication
			await ctx.client.execute({
				sql: `DELETE FROM medications WHERE id = ?`,
				args: [medId],
			});

			// Verify refill history was cascade deleted
			result = await ctx.client.execute({
				sql: `SELECT COUNT(*) as count FROM refill_history WHERE medication_id = ?`,
				args: [medId],
			});
			expect(result.rows[0].count).toBe(0);
		});

		it("should delete refill history when user is deleted", async () => {
			// Add a refill
			await ctx.app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1 },
			});

			// Verify refill exists
			let result = await ctx.client.execute({
				sql: `SELECT COUNT(*) as count FROM refill_history WHERE user_id = ?`,
				args: [userId],
			});
			expect(result.rows[0].count).toBe(1);

			// Delete user
			await ctx.client.execute({
				sql: `DELETE FROM users WHERE id = ?`,
				args: [userId],
			});

			// Verify refill history was cascade deleted
			result = await ctx.client.execute({
				sql: `SELECT COUNT(*) as count FROM refill_history WHERE user_id = ?`,
				args: [userId],
			});
			expect(result.rows[0].count).toBe(0);
		});
	});
});
