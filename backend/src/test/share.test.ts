/**
 * Tests for share link API endpoints.
 * Tests creating share tokens, accessing shared schedules, and marking doses via share links.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	buildTestApp,
	clearTestData,
	closeTestApp,
	createTestMedication,
	createTestShareToken,
	createTestUser,
	setUserSettings,
	type TestContext,
} from "./setup.js";

// =============================================================================
// Route Registration
// =============================================================================

async function registerShareRoutes(ctx: TestContext) {
	const { app, client } = ctx;

	// POST /share - Create a share token
	app.post<{ Body: { takenBy: string; scheduleDays?: number } }>("/share", async (request, reply) => {
		const userId = 1;
		const { takenBy, scheduleDays = 30 } = request.body || {};

		if (!takenBy || typeof takenBy !== "string" || takenBy.length === 0) {
			return reply.status(400).send({ error: "takenBy is required", code: "VALIDATION_ERROR" });
		}

		if (scheduleDays < 1 || scheduleDays > 365) {
			return reply.status(400).send({ error: "scheduleDays must be 1-365", code: "VALIDATION_ERROR" });
		}

		// Check if user has medications for this person
		const meds = await client.execute({
			sql: `SELECT id, taken_by_json FROM medications WHERE user_id = ?`,
			args: [userId],
		});

		const hasMatchingMed = meds.rows.some((m) => {
			const takenByList: string[] = JSON.parse((m.taken_by_json as string) || "[]");
			return takenByList.includes(takenBy);
		});

		if (!hasMatchingMed) {
			return reply.status(400).send({ error: "No medications found for this person", code: "NO_MEDICATIONS" });
		}

		// Generate token
		const token = `share_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
		const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days

		await client.execute({
			sql: `INSERT INTO share_tokens (user_id, token, taken_by, schedule_days, expires_at)
            VALUES (?, ?, ?, ?, ?)`,
			args: [userId, token, takenBy, scheduleDays, expiresAt],
		});

		return {
			token,
			shareUrl: `/share/${token}`,
			expiresAt: new Date(expiresAt * 1000).toISOString(),
		};
	});

	// GET /share/:token - Get shared schedule data
	app.get<{ Params: { token: string } }>("/share/:token", async (request, reply) => {
		const { token } = request.params;

		const shareResult = await client.execute({
			sql: `SELECT st.*, u.username as owner_username 
            FROM share_tokens st 
            JOIN users u ON st.user_id = u.id 
            WHERE st.token = ?`,
			args: [token],
		});

		if (shareResult.rows.length === 0) {
			return reply.status(404).send({ error: "Share link not found", code: "NOT_FOUND" });
		}

		const share = shareResult.rows[0];
		const now = Math.floor(Date.now() / 1000);

		// Check expiry
		if (share.expires_at && (share.expires_at as number) < now) {
			return reply.status(410).send({
				error: "Share link has expired",
				code: "EXPIRED",
				ownerUsername: share.owner_username,
				takenBy: share.taken_by,
				expiredAt: new Date((share.expires_at as number) * 1000).toISOString(),
			});
		}

		// Get medications for this person
		const medsResult = await client.execute({
			sql: `SELECT * FROM medications WHERE user_id = ?`,
			args: [share.user_id],
		});

		const medications = medsResult.rows
			.filter((m) => {
				const takenByList: string[] = JSON.parse((m.taken_by_json as string) || "[]");
				return takenByList.includes(share.taken_by as string);
			})
			.map((m) => {
				const usageArr: number[] = JSON.parse((m.usage_json as string) || "[]");
				const everyArr: number[] = JSON.parse((m.every_json as string) || "[]");
				const startArr: string[] = JSON.parse((m.start_json as string) || "[]");

				return {
					id: m.id,
					name: m.name,
					genericName: m.generic_name,
					pillWeightMg: m.pill_weight_mg,
					imageUrl: m.image_url,
					totalPills:
						(m.pack_count as number) * (m.blisters_per_pack as number) * (m.pills_per_blister as number) +
						(m.loose_tablets as number),
					packCount: m.pack_count,
					blistersPerPack: m.blisters_per_pack,
					looseTablets: m.loose_tablets,
					pillsPerBlister: m.pills_per_blister,
					takenBy: JSON.parse((m.taken_by_json as string) || "[]"),
					blisters: usageArr.map((usage, i) => ({
						usage,
						every: everyArr[i] || 1,
						start: startArr[i] || new Date().toISOString(),
					})),
				};
			});

		// Get settings
		const settingsResult = await client.execute({
			sql: `SELECT low_stock_days FROM user_settings WHERE user_id = ?`,
			args: [share.user_id],
		});

		const lowStockDays = settingsResult.rows.length > 0 ? (settingsResult.rows[0].low_stock_days as number) : 30;

		return {
			takenBy: share.taken_by,
			sharedBy: share.owner_username,
			scheduleDays: share.schedule_days,
			medications,
			stockThresholds: {
				lowStockDays,
			},
		};
	});

	// GET /share/:token/doses - Get taken doses for share link
	app.get<{ Params: { token: string } }>("/share/:token/doses", async (request, reply) => {
		const { token } = request.params;

		const shareResult = await client.execute({
			sql: `SELECT user_id FROM share_tokens WHERE token = ?`,
			args: [token],
		});

		if (shareResult.rows.length === 0) {
			return reply.status(404).send({ error: "Share link not found" });
		}

		const userId = shareResult.rows[0].user_id;

		const dosesResult = await client.execute({
			sql: `SELECT dose_id, taken_at, marked_by FROM dose_tracking WHERE user_id = ?`,
			args: [userId],
		});

		return {
			doses: dosesResult.rows.map((d) => ({
				doseId: d.dose_id,
				takenAt: (d.taken_at as number) * 1000,
				markedBy: d.marked_by,
			})),
		};
	});

	// POST /share/:token/doses - Mark dose via share link
	app.post<{ Params: { token: string }; Body: { doseId: string } }>("/share/:token/doses", async (request, reply) => {
		const { token } = request.params;
		const { doseId } = request.body || {};

		if (!doseId) {
			return reply.status(400).send({ error: "doseId is required" });
		}

		const shareResult = await client.execute({
			sql: `SELECT user_id, taken_by FROM share_tokens WHERE token = ?`,
			args: [token],
		});

		if (shareResult.rows.length === 0) {
			return reply.status(404).send({ error: "Share link not found" });
		}

		const { user_id: userId, taken_by: takenBy } = shareResult.rows[0];

		// Check if already marked
		const existing = await client.execute({
			sql: `SELECT id FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
			args: [userId, doseId],
		});

		if (existing.rows.length > 0) {
			return { success: true, message: "Already marked" };
		}

		// Insert with markedBy = takenBy from share token
		await client.execute({
			sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by) VALUES (?, ?, ?)`,
			args: [userId, doseId, takenBy],
		});

		return { success: true };
	});

	// DELETE /share/:token/doses/:doseId - Unmark dose via share link
	app.delete<{ Params: { token: string; doseId: string } }>("/share/:token/doses/:doseId", async (request, reply) => {
		const { token, doseId } = request.params;

		const shareResult = await client.execute({
			sql: `SELECT user_id FROM share_tokens WHERE token = ?`,
			args: [token],
		});

		if (shareResult.rows.length === 0) {
			return reply.status(404).send({ error: "Share link not found" });
		}

		const userId = shareResult.rows[0].user_id;

		await client.execute({
			sql: `DELETE FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
			args: [userId, doseId],
		});

		return { success: true };
	});

	// GET /share/people - Get unique takenBy values
	app.get("/share/people", async (_request, _reply) => {
		const userId = 1;

		const result = await client.execute({
			sql: `SELECT taken_by_json FROM medications WHERE user_id = ?`,
			args: [userId],
		});

		const peopleSet = new Set<string>();
		for (const row of result.rows) {
			const takenByList: string[] = JSON.parse((row.taken_by_json as string) || "[]");
			takenByList.forEach((p) => peopleSet.add(p));
		}

		return { people: Array.from(peopleSet).sort() };
	});
}

// =============================================================================
// Tests
// =============================================================================

describe("Share Link API", () => {
	let ctx: TestContext;
	let userId: number;

	beforeAll(async () => {
		ctx = await buildTestApp();
		await registerShareRoutes(ctx);
		await ctx.app.ready();
	});

	afterAll(async () => {
		await closeTestApp(ctx);
	});

	beforeEach(async () => {
		await clearTestData(ctx.client);
		// Reset SQLite autoincrement so user gets ID 1
		await ctx.client.execute("DELETE FROM sqlite_sequence WHERE name='users'");
		userId = await createTestUser(ctx.client, { username: "testuser" });
	});

	// ---------------------------------------------------------------------------
	// POST /share - Create share token
	// ---------------------------------------------------------------------------

	describe("POST /share", () => {
		it("should create a share token for a person", async () => {
			// Create medication with takenBy
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				takenBy: ["Daniel"],
			});

			const response = await ctx.app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Daniel", scheduleDays: 30 },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.token).toBeDefined();
			expect(data.token.length).toBeGreaterThan(10);
			expect(data.shareUrl).toBe(`/share/${data.token}`);
			expect(data.expiresAt).toBeDefined();
		});

		it("should reject when no medications for person", async () => {
			// Create medication with different takenBy
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				takenBy: ["Max"],
			});

			const response = await ctx.app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Daniel", scheduleDays: 30 },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({
				error: "No medications found for this person",
				code: "NO_MEDICATIONS",
			});
		});

		it("should reject request without takenBy", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/share",
				payload: { scheduleDays: 30 },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({
				error: "takenBy is required",
				code: "VALIDATION_ERROR",
			});
		});

		it("should use custom scheduleDays", async () => {
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				takenBy: ["Daniel"],
			});

			const response = await ctx.app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Daniel", scheduleDays: 90 },
			});

			expect(response.statusCode).toBe(200);

			// Verify in DB
			const token = response.json().token;
			const result = await ctx.client.execute({
				sql: `SELECT schedule_days FROM share_tokens WHERE token = ?`,
				args: [token],
			});
			expect(result.rows[0].schedule_days).toBe(90);
		});
	});

	// ---------------------------------------------------------------------------
	// GET /share/:token - Access shared schedule
	// ---------------------------------------------------------------------------

	describe("GET /share/:token", () => {
		it("should return shared schedule data", async () => {
			// Create medication
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				genericName: "Acetylsalicylic acid",
				takenBy: ["Daniel"],
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				looseTablets: 5,
				blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
			});

			// Create share token
			const token = await createTestShareToken(ctx.client, {
				userId,
				takenBy: "Daniel",
				scheduleDays: 30,
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: `/share/${token}`,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();

			expect(data.takenBy).toBe("Daniel");
			expect(data.sharedBy).toBe("testuser");
			expect(data.scheduleDays).toBe(30);
			expect(data.medications).toHaveLength(1);

			const med = data.medications[0];
			expect(med.name).toBe("Aspirin");
			expect(med.genericName).toBe("Acetylsalicylic acid");
			expect(med.totalPills).toBe(2 * 3 * 10 + 5); // 65
			expect(med.takenBy).toEqual(["Daniel"]);
			expect(med.blisters).toHaveLength(1);
			expect(med.blisters[0].usage).toBe(1);
			expect(med.blisters[0].every).toBe(1);
		});

		it("should return 404 for invalid token", async () => {
			const response = await ctx.app.inject({
				method: "GET",
				url: "/share/invalid_token_123",
			});

			expect(response.statusCode).toBe(404);
			expect(response.json()).toEqual({
				error: "Share link not found",
				code: "NOT_FOUND",
			});
		});

		it("should return 410 for expired token", async () => {
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				takenBy: ["Daniel"],
			});

			// Create expired token (expired 1 day ago)
			const expiredAt = Math.floor(Date.now() / 1000) - 86400;
			const token = await createTestShareToken(ctx.client, {
				userId,
				takenBy: "Daniel",
				expiresAt: expiredAt,
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: `/share/${token}`,
			});

			expect(response.statusCode).toBe(410);
			const data = response.json();
			expect(data.code).toBe("EXPIRED");
			expect(data.ownerUsername).toBe("testuser");
			expect(data.takenBy).toBe("Daniel");
		});

		it("should filter medications to only those for takenBy person", async () => {
			// Create two medications - one for Daniel, one for Max
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				takenBy: ["Daniel"],
			});
			await createTestMedication(ctx.client, {
				userId,
				name: "Ibuprofen",
				takenBy: ["Max"],
			});

			const token = await createTestShareToken(ctx.client, {
				userId,
				takenBy: "Daniel",
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: `/share/${token}`,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.medications).toHaveLength(1);
			expect(data.medications[0].name).toBe("Aspirin");
		});
	});

	// ---------------------------------------------------------------------------
	// Share Token Dose Tracking
	// ---------------------------------------------------------------------------

	describe("Share link dose tracking", () => {
		it("POST /share/:token/doses should mark dose with markedBy", async () => {
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				takenBy: ["Daniel"],
			});

			const token = await createTestShareToken(ctx.client, {
				userId,
				takenBy: "Daniel",
			});

			const doseId = "1-0-1735344000000";
			const response = await ctx.app.inject({
				method: "POST",
				url: `/share/${token}/doses`,
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify markedBy is set to takenBy from share token
			const result = await ctx.client.execute({
				sql: `SELECT marked_by FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows[0].marked_by).toBe("Daniel");
		});

		it("GET /share/:token/doses should return all doses for owner", async () => {
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				takenBy: ["Daniel"],
			});

			const token = await createTestShareToken(ctx.client, {
				userId,
				takenBy: "Daniel",
			});

			// Create some dose tracking records
			await ctx.client.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by) VALUES (?, ?, ?)`,
				args: [userId, "1-0-1735344000000", null],
			});
			await ctx.client.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by) VALUES (?, ?, ?)`,
				args: [userId, "1-0-1735430400000", "Daniel"],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: `/share/${token}/doses`,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.doses).toHaveLength(2);
		});

		it("DELETE /share/:token/doses/:doseId should unmark dose", async () => {
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				takenBy: ["Daniel"],
			});

			const token = await createTestShareToken(ctx.client, {
				userId,
				takenBy: "Daniel",
			});

			const doseId = "1-0-1735344000000";

			// Mark dose first
			await ctx.app.inject({
				method: "POST",
				url: `/share/${token}/doses`,
				payload: { doseId },
			});

			// Unmark
			const response = await ctx.app.inject({
				method: "DELETE",
				url: `/share/${token}/doses/${encodeURIComponent(doseId)}`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify deleted
			const result = await ctx.client.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows[0].count).toBe(0);
		});
	});

	// ---------------------------------------------------------------------------
	// GET /share/people
	// ---------------------------------------------------------------------------

	describe("GET /share/people", () => {
		it("should return unique takenBy values from all medications", async () => {
			await createTestMedication(ctx.client, {
				userId,
				name: "Med 1",
				takenBy: ["Daniel", "Max"],
			});
			await createTestMedication(ctx.client, {
				userId,
				name: "Med 2",
				takenBy: ["Daniel", "Lisa"],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/share/people",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.people).toEqual(["Daniel", "Lisa", "Max"]); // sorted
		});

		it("should return empty array when no medications", async () => {
			const response = await ctx.app.inject({
				method: "GET",
				url: "/share/people",
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ people: [] });
		});
	});
});
