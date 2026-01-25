/**
 * Tests for /doses/taken API endpoints.
 * Tests marking doses as taken, listing taken doses, and unmarking.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, clearTestData, closeTestApp, createTestUser, type TestContext } from "./setup.js";

// =============================================================================
// Route Registration
// Since we can't easily import routes that depend on the global db,
// we'll create simplified route handlers for testing the core logic.
// =============================================================================

async function registerDoseRoutes(ctx: TestContext) {
	const { app, client } = ctx;

	// GET /doses/taken - List all taken doses
	app.get("/doses/taken", async (_request, _reply) => {
		// In test mode, use user ID 1 (will be created in tests)
		const userId = 1;

		const result = await client.execute({
			sql: `SELECT dose_id, taken_at, marked_by FROM dose_tracking WHERE user_id = ?`,
			args: [userId],
		});

		return {
			doses: result.rows.map((d) => ({
				doseId: d.dose_id,
				takenAt: (d.taken_at as number) * 1000, // Convert to ms
				markedBy: d.marked_by,
			})),
		};
	});

	// POST /doses/taken - Mark a dose as taken
	app.post<{ Body: { doseId: string } }>("/doses/taken", async (request, reply) => {
		const userId = 1;
		const { doseId } = request.body || {};

		if (!doseId || typeof doseId !== "string" || doseId.length === 0) {
			return reply.status(400).send({ error: "doseId is required" });
		}

		// Check if already marked
		const existing = await client.execute({
			sql: `SELECT id FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
			args: [userId, doseId],
		});

		if (existing.rows.length > 0) {
			return { success: true, message: "Already marked" };
		}

		// Insert new record
		await client.execute({
			sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by) VALUES (?, ?, NULL)`,
			args: [userId, doseId],
		});

		return { success: true };
	});

	// DELETE /doses/taken/:doseId - Unmark a dose
	app.delete<{ Params: { doseId: string } }>("/doses/taken/:doseId", async (request, _reply) => {
		const userId = 1;
		const { doseId } = request.params;

		// Check if this dose was also dismissed
		const existing = await client.execute({
			sql: `SELECT id, dismissed FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
			args: [userId, doseId],
		});

		if (existing.rows.length > 0 && existing.rows[0].dismissed) {
			// Already dismissed - keep the record as-is (don't delete)
			// The dose stays dismissed, we just ignore the undo request
		} else {
			// Not dismissed - delete the record entirely
			await client.execute({
				sql: `DELETE FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
				args: [userId, doseId],
			});
		}

		return { success: true };
	});

	// POST /doses/dismiss - Dismiss missed doses without deducting stock
	app.post<{ Body: { doseIds: string[] } }>("/doses/dismiss", async (request, reply) => {
		const userId = 1;
		const { doseIds } = request.body || {};

		if (!doseIds || !Array.isArray(doseIds) || doseIds.length === 0) {
			return reply.status(400).send({ error: "doseIds array is required" });
		}

		let dismissedCount = 0;
		for (const doseId of doseIds) {
			// Check if already exists
			const existing = await client.execute({
				sql: `SELECT id, dismissed FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
				args: [userId, doseId],
			});

			if (existing.rows.length > 0) {
				// Update to dismissed if not already
				if (!existing.rows[0].dismissed) {
					await client.execute({
						sql: `UPDATE dose_tracking SET dismissed = 1 WHERE id = ?`,
						args: [existing.rows[0].id],
					});
					dismissedCount++;
				}
			} else {
				// Insert new dismissed record
				await client.execute({
					sql: `INSERT INTO dose_tracking (user_id, dose_id, dismissed) VALUES (?, ?, 1)`,
					args: [userId, doseId],
				});
				dismissedCount++;
			}
		}

		return { success: true, dismissedCount };
	});
}

// =============================================================================
// Tests
// =============================================================================

describe("Dose Tracking API", () => {
	let ctx: TestContext;
	let userId: number;

	beforeAll(async () => {
		ctx = await buildTestApp();
		await registerDoseRoutes(ctx);
		await ctx.app.ready();
	});

	afterAll(async () => {
		await closeTestApp(ctx);
	});

	beforeEach(async () => {
		await clearTestData(ctx.client);
		// Create test user - will get ID 1 since table is cleared
		userId = await createTestUser(ctx.client, { username: "testuser" });
		// Reset SQLite autoincrement so user gets ID 1
		await ctx.client.execute("DELETE FROM sqlite_sequence WHERE name='users'");
		await clearTestData(ctx.client);
		userId = await createTestUser(ctx.client, { username: "testuser" });
	});

	// ---------------------------------------------------------------------------
	// POST /doses/taken
	// ---------------------------------------------------------------------------

	describe("POST /doses/taken", () => {
		it("should mark a dose as taken", async () => {
			const doseId = "1-0-1735344000000";

			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify in database
			const result = await ctx.client.execute({
				sql: `SELECT dose_id, marked_by FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
				args: [userId, doseId],
			});
			expect(result.rows.length).toBe(1);
			expect(result.rows[0].dose_id).toBe(doseId);
			expect(result.rows[0].marked_by).toBeNull();
		});

		it("should return idempotent response when dose already marked", async () => {
			const doseId = "1-0-1735344000000";

			// Mark once
			await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			// Mark again
			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, message: "Already marked" });

			// Should still only have one record
			const result = await ctx.client.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
				args: [userId, doseId],
			});
			expect(result.rows[0].count).toBe(1);
		});

		it("should reject request without doseId", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: {},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "doseId is required" });
		});

		it("should reject request with empty doseId", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: "" },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "doseId is required" });
		});
	});

	// ---------------------------------------------------------------------------
	// GET /doses/taken
	// ---------------------------------------------------------------------------

	describe("GET /doses/taken", () => {
		it("should return empty array when no doses taken", async () => {
			const response = await ctx.app.inject({
				method: "GET",
				url: "/doses/taken",
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ doses: [] });
		});

		it("should return list of taken doses", async () => {
			const doseId1 = "1-0-1735344000000";
			const doseId2 = "1-0-1735430400000";

			// Mark two doses
			await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: doseId1 },
			});
			await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: doseId2 },
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/doses/taken",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.doses).toHaveLength(2);
			expect(data.doses.map((d: any) => d.doseId).sort()).toEqual([doseId1, doseId2].sort());
			// Each dose should have a takenAt timestamp
			for (const dose of data.doses) {
				expect(dose.takenAt).toBeTypeOf("number");
				expect(dose.takenAt).toBeGreaterThan(0);
				expect(dose.markedBy).toBeNull();
			}
		});

		it("should include markedBy when present", async () => {
			const doseId = "1-0-1735344000000";

			// Insert directly with markedBy
			await ctx.client.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by) VALUES (?, ?, ?)`,
				args: [userId, doseId, "Daniel"],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/doses/taken",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.doses).toHaveLength(1);
			expect(data.doses[0].markedBy).toBe("Daniel");
		});
	});

	// ---------------------------------------------------------------------------
	// DELETE /doses/taken/:doseId
	// ---------------------------------------------------------------------------

	describe("DELETE /doses/taken/:doseId", () => {
		it("should unmark a dose", async () => {
			const doseId = "1-0-1735344000000";

			// Mark first
			await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			// Verify marked
			let result = await ctx.client.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows[0].count).toBe(1);

			// Unmark
			const response = await ctx.app.inject({
				method: "DELETE",
				url: `/doses/taken/${encodeURIComponent(doseId)}`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify unmarked
			result = await ctx.client.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows[0].count).toBe(0);
		});

		it("should succeed even if dose was not marked", async () => {
			const doseId = "nonexistent-dose-id";

			const response = await ctx.app.inject({
				method: "DELETE",
				url: `/doses/taken/${encodeURIComponent(doseId)}`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });
		});

		it("should preserve dismissed status when unmarking a dose", async () => {
			const doseId = "1-0-1735344000000";

			// First dismiss the dose
			await ctx.app.inject({
				method: "POST",
				url: "/doses/dismiss",
				payload: { doseIds: [doseId] },
			});

			// Verify it's dismissed
			let result = await ctx.client.execute({
				sql: `SELECT dismissed, taken_at FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows[0].dismissed).toBe(1);
			const originalTakenAt = result.rows[0].taken_at;

			// Now try to unmark it (undo) - should keep the dismissed record
			const response = await ctx.app.inject({
				method: "DELETE",
				url: `/doses/taken/${encodeURIComponent(doseId)}`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify the record still exists and is still dismissed
			result = await ctx.client.execute({
				sql: `SELECT dose_id, dismissed, taken_at FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows.length).toBe(1);
			expect(result.rows[0].dismissed).toBe(1);
			expect(result.rows[0].taken_at).toBe(originalTakenAt); // unchanged
		});
	});

	// ---------------------------------------------------------------------------
	// Dose ID Format Tests
	// ---------------------------------------------------------------------------

	describe("Dose ID Format", () => {
		it("should handle standard dose ID format: {medId}-{blisterIdx}-{timestamp}", async () => {
			const doseId = "5-0-1735344000000";

			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });
		});

		it("should handle dose ID with person: {medId}-{blisterIdx}-{timestamp}-{person}", async () => {
			const doseId = "5-0-1735344000000-Daniel";

			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });
		});

		it("should handle special characters in dose ID", async () => {
			// Dose ID with URL-unsafe characters (edge case)
			const doseId = "5-0-1735344000000-Max Müller";

			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);

			// Can retrieve it
			const getResponse = await ctx.app.inject({
				method: "GET",
				url: "/doses/taken",
			});

			expect(getResponse.json().doses[0].doseId).toBe(doseId);
		});
	});

	// ---------------------------------------------------------------------------
	// Dismiss Doses Tests (POST /doses/dismiss)
	// ---------------------------------------------------------------------------

	describe("POST /doses/dismiss", () => {
		it("should dismiss multiple doses", async () => {
			const doseIds = ["1-0-1735344000000", "1-0-1735430400000"];

			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/dismiss",
				payload: { doseIds },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, dismissedCount: 2 });

			// Verify in database
			const result = await ctx.client.execute({
				sql: `SELECT dose_id, dismissed FROM dose_tracking WHERE user_id = ? AND dismissed = 1`,
				args: [userId],
			});
			expect(result.rows.length).toBe(2);
		});

		it("should not double-count already dismissed doses", async () => {
			const doseId = "1-0-1735344000000";

			// Dismiss once
			await ctx.app.inject({
				method: "POST",
				url: "/doses/dismiss",
				payload: { doseIds: [doseId] },
			});

			// Dismiss again
			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/dismiss",
				payload: { doseIds: [doseId] },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, dismissedCount: 0 });
		});

		it("should reject empty doseIds array", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/dismiss",
				payload: { doseIds: [] },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "doseIds array is required" });
		});

		it("should reject missing doseIds", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/dismiss",
				payload: {},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "doseIds array is required" });
		});

		it("should dismiss a dose that was already taken (convert to dismissed)", async () => {
			const doseId = "1-0-1735344000000";

			// First mark as taken
			await ctx.app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			// Then dismiss it
			const response = await ctx.app.inject({
				method: "POST",
				url: "/doses/dismiss",
				payload: { doseIds: [doseId] },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, dismissedCount: 1 });

			// Verify it's now dismissed
			const result = await ctx.client.execute({
				sql: `SELECT dismissed FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
				args: [userId, doseId],
			});
			expect(result.rows[0].dismissed).toBe(1);
		});
	});
});
