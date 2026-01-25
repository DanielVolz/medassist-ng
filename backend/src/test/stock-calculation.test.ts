/**
 * Tests for stock calculation modes (automatic vs manual).
 * Tests the /medications/usage endpoint with different settings.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	buildTestApp,
	clearTestData,
	closeTestApp,
	createTestDoseTracking,
	createTestMedication,
	createTestUser,
	setUserSettings,
	type TestContext,
} from "./setup.js";

// =============================================================================
// Route Registration
// =============================================================================

async function registerUsageRoutes(ctx: TestContext) {
	const { app, client } = ctx;

	// POST /medications/usage - Calculate medication usage for a date range
	app.post<{ Body: { startDate: string; endDate: string } }>("/medications/usage", async (request, reply) => {
		const userId = 1;
		const { startDate, endDate } = request.body || {};

		if (!startDate || !endDate) {
			return reply.status(400).send({ error: "startDate and endDate are required" });
		}

		const start = new Date(startDate);
		const end = new Date(endDate);

		// Get user settings
		const settingsResult = await client.execute({
			sql: `SELECT stock_calculation_mode FROM user_settings WHERE user_id = ?`,
			args: [userId],
		});
		const stockMode =
			settingsResult.rows.length > 0 ? (settingsResult.rows[0].stock_calculation_mode as string) : "automatic";

		// Get all medications
		const medsResult = await client.execute({
			sql: `SELECT * FROM medications WHERE user_id = ?`,
			args: [userId],
		});

		const results = [];

		for (const med of medsResult.rows) {
			const totalPills =
				(med.pack_count as number) * (med.blisters_per_pack as number) * (med.pills_per_blister as number) +
				(med.loose_tablets as number);

			const blisterSize = med.pills_per_blister as number;

			// Calculate usage based on schedule
			const usageArr: number[] = JSON.parse((med.usage_json as string) || "[]");
			const everyArr: number[] = JSON.parse((med.every_json as string) || "[]");
			const startArr: string[] = JSON.parse((med.start_json as string) || "[]");

			let plannerUsage = 0;

			if (stockMode === "automatic") {
				// Automatic: Calculate from schedule
				for (let i = 0; i < usageArr.length; i++) {
					const usage = usageArr[i] || 0;
					const every = everyArr[i] || 1;
					const scheduleStart = new Date(startArr[i] || start);

					// Count doses from scheduleStart to end within the range
					const current = new Date(scheduleStart);
					while (current <= end) {
						if (current >= start) {
							plannerUsage += usage;
						}
						current.setDate(current.getDate() + every);
					}
				}
			} else {
				// Manual: Count only tracked doses in the date range
				const dosesResult = await client.execute({
					sql: `SELECT dose_id FROM dose_tracking 
                  WHERE user_id = ? 
                  AND taken_at >= ? 
                  AND taken_at <= ?`,
					args: [userId, Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000)],
				});

				// Filter to doses for this medication
				const medIdStr = `${med.id}-`;
				for (const dose of dosesResult.rows) {
					const doseId = dose.dose_id as string;
					if (doseId.startsWith(medIdStr)) {
						// Parse usage from the schedule based on blister index
						const parts = doseId.split("-");
						if (parts.length >= 3) {
							const blisterIdx = parseInt(parts[1], 10);
							plannerUsage += usageArr[blisterIdx] || 1;
						}
					}
				}
			}

			// Calculate how many blisters/pills needed
			const blistersNeeded = Math.ceil(plannerUsage / blisterSize);
			const fullBlisters = Math.floor(plannerUsage / blisterSize);
			const loosePills = plannerUsage % blisterSize;

			results.push({
				medicationId: med.id,
				medicationName: med.name,
				totalPills,
				plannerUsage,
				blisterSize,
				blistersNeeded,
				fullBlisters,
				loosePills,
				enough: totalPills >= plannerUsage,
			});
		}

		return results;
	});

	// GET /medications - List medications (for checking stock)
	app.get("/medications", async (_request, _reply) => {
		const userId = 1;

		const result = await client.execute({
			sql: `SELECT * FROM medications WHERE user_id = ?`,
			args: [userId],
		});

		return result.rows.map((m) => ({
			id: m.id,
			name: m.name,
			packCount: m.pack_count,
			blistersPerPack: m.blisters_per_pack,
			pillsPerBlister: m.pills_per_blister,
			looseTablets: m.loose_tablets,
			totalPills:
				(m.pack_count as number) * (m.blisters_per_pack as number) * (m.pills_per_blister as number) +
				(m.loose_tablets as number),
		}));
	});
}

// =============================================================================
// Tests
// =============================================================================

describe("Stock Calculation API", () => {
	let ctx: TestContext;
	let userId: number;

	beforeAll(async () => {
		ctx = await buildTestApp();
		await registerUsageRoutes(ctx);
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
	// Automatic Mode Tests
	// ---------------------------------------------------------------------------

	describe("Automatic mode", () => {
		beforeEach(async () => {
			await setUserSettings(ctx.client, {
				userId,
				stockCalculationMode: "automatic",
			});
		});

		it("should calculate usage from schedule", async () => {
			// Medication: 1 pill daily starting Jan 1
			const start = new Date("2025-01-01T00:00:00.000Z");
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				blisters: [{ usage: 1, every: 1, start: start.toISOString() }],
			});

			// Calculate usage for 10 days (Jan 1-10)
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data).toHaveLength(1);

			const med = data[0];
			expect(med.medicationName).toBe("Aspirin");
			expect(med.totalPills).toBe(30);
			expect(med.plannerUsage).toBe(10); // 10 days, 1 pill/day
			expect(med.enough).toBe(true);
		});

		it("should handle every-other-day schedules", async () => {
			const start = new Date("2025-01-01T00:00:00.000Z");
			await createTestMedication(ctx.client, {
				userId,
				name: "Med B",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 20,
				blisters: [{ usage: 2, every: 2, start: start.toISOString() }], // 2 pills every 2 days
			});

			// 10 days: Jan 1, 3, 5, 7, 9 = 5 doses × 2 pills = 10 pills
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].plannerUsage).toBe(10);
		});

		it("should handle multiple blisters (schedules)", async () => {
			const start = new Date("2025-01-01T00:00:00.000Z");
			await createTestMedication(ctx.client, {
				userId,
				name: "Multi Schedule",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 50,
				blisters: [
					{ usage: 1, every: 1, start: start.toISOString() }, // Morning: 1/day
					{ usage: 1, every: 1, start: start.toISOString() }, // Evening: 1/day
				],
			});

			// 10 days: 2 schedules × 10 days × 1 pill = 20 pills
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].plannerUsage).toBe(20);
		});

		it("should return enough=false when stock insufficient", async () => {
			const start = new Date("2025-01-01T00:00:00.000Z");
			await createTestMedication(ctx.client, {
				userId,
				name: "Low Stock Med",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 5, // Only 5 pills
				blisters: [{ usage: 1, every: 1, start: start.toISOString() }],
			});

			// Need 10 pills but only have 5
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].totalPills).toBe(5);
			expect(data[0].plannerUsage).toBe(10);
			expect(data[0].enough).toBe(false);
		});

		it("should calculate blister counts correctly", async () => {
			const start = new Date("2025-01-01T00:00:00.000Z");
			await createTestMedication(ctx.client, {
				userId,
				name: "Blister Test",
				packCount: 2,
				blistersPerPack: 2,
				pillsPerBlister: 10, // 4 blisters × 10 = 40 pills
				blisters: [{ usage: 1, every: 1, start: start.toISOString() }],
			});

			// 25 days = 25 pills needed = 2 full blisters + 5 loose
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-25T23:59:59.999Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].plannerUsage).toBe(25);
			expect(data[0].blisterSize).toBe(10);
			expect(data[0].blistersNeeded).toBe(3); // ceil(25/10)
			expect(data[0].fullBlisters).toBe(2); // floor(25/10)
			expect(data[0].loosePills).toBe(5); // 25 % 10
		});
	});

	// ---------------------------------------------------------------------------
	// Manual Mode Tests
	// ---------------------------------------------------------------------------

	describe("Manual mode", () => {
		beforeEach(async () => {
			await setUserSettings(ctx.client, {
				userId,
				stockCalculationMode: "manual",
			});
		});

		it("should count only tracked doses", async () => {
			const start = new Date("2025-01-01T00:00:00.000Z");
			const medId = await createTestMedication(ctx.client, {
				userId,
				name: "Manual Med",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				blisters: [{ usage: 1, every: 1, start: start.toISOString() }],
			});

			// In automatic mode this would count 10 doses
			// In manual mode, only count tracked doses
			// Track only 3 doses
			const jan2 = Math.floor(new Date("2025-01-02T08:00:00.000Z").getTime() / 1000);
			const jan5 = Math.floor(new Date("2025-01-05T08:00:00.000Z").getTime() / 1000);
			const jan8 = Math.floor(new Date("2025-01-08T08:00:00.000Z").getTime() / 1000);

			await createTestDoseTracking(ctx.client, {
				userId,
				doseId: `${medId}-0-${jan2 * 1000}`,
				takenAt: jan2,
			});
			await createTestDoseTracking(ctx.client, {
				userId,
				doseId: `${medId}-0-${jan5 * 1000}`,
				takenAt: jan5,
			});
			await createTestDoseTracking(ctx.client, {
				userId,
				doseId: `${medId}-0-${jan8 * 1000}`,
				takenAt: jan8,
			});

			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].plannerUsage).toBe(3); // Only 3 tracked doses
		});

		it("should return 0 usage when no doses tracked", async () => {
			const start = new Date("2025-01-01T00:00:00.000Z");
			await createTestMedication(ctx.client, {
				userId,
				name: "Untracked Med",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				blisters: [{ usage: 1, every: 1, start: start.toISOString() }],
			});

			// No dose tracking records
			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].plannerUsage).toBe(0);
			expect(data[0].enough).toBe(true);
		});

		it("should only count doses within date range", async () => {
			const start = new Date("2025-01-01T00:00:00.000Z");
			const medId = await createTestMedication(ctx.client, {
				userId,
				name: "Range Test",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				blisters: [{ usage: 1, every: 1, start: start.toISOString() }],
			});

			// Dose before range (Dec 31)
			const dec31 = Math.floor(new Date("2024-12-31T08:00:00.000Z").getTime() / 1000);
			await createTestDoseTracking(ctx.client, {
				userId,
				doseId: `${medId}-0-${dec31 * 1000}`,
				takenAt: dec31,
			});

			// Dose in range (Jan 5)
			const jan5 = Math.floor(new Date("2025-01-05T08:00:00.000Z").getTime() / 1000);
			await createTestDoseTracking(ctx.client, {
				userId,
				doseId: `${medId}-0-${jan5 * 1000}`,
				takenAt: jan5,
			});

			// Dose after range (Jan 15)
			const jan15 = Math.floor(new Date("2025-01-15T08:00:00.000Z").getTime() / 1000);
			await createTestDoseTracking(ctx.client, {
				userId,
				doseId: `${medId}-0-${jan15 * 1000}`,
				takenAt: jan15,
			});

			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].plannerUsage).toBe(1); // Only Jan 5 is in range
		});

		it("should handle multi-pill doses correctly", async () => {
			const start = new Date("2025-01-01T00:00:00.000Z");
			const medId = await createTestMedication(ctx.client, {
				userId,
				name: "Multi-Pill",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				blisters: [{ usage: 2, every: 1, start: start.toISOString() }], // 2 pills per dose
			});

			const jan2 = Math.floor(new Date("2025-01-02T08:00:00.000Z").getTime() / 1000);
			await createTestDoseTracking(ctx.client, {
				userId,
				doseId: `${medId}-0-${jan2 * 1000}`, // Blister index 0 has usage=2
				takenAt: jan2,
			});

			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].plannerUsage).toBe(2); // 1 dose × 2 pills
		});
	});

	// ---------------------------------------------------------------------------
	// Mode Comparison Tests
	// ---------------------------------------------------------------------------

	describe("Automatic vs Manual mode comparison", () => {
		it("should show different results for same medication", async () => {
			const start = new Date("2025-01-01T00:00:00.000Z");
			const medId = await createTestMedication(ctx.client, {
				userId,
				name: "Comparison Med",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				blisters: [{ usage: 1, every: 1, start: start.toISOString() }],
			});

			// Track only 5 of the 10 scheduled doses
			for (let day = 1; day <= 5; day++) {
				const date = new Date(`2025-01-0${day}T08:00:00.000Z`);
				const ts = Math.floor(date.getTime() / 1000);
				await createTestDoseTracking(ctx.client, {
					userId,
					doseId: `${medId}-0-${ts * 1000}`,
					takenAt: ts,
				});
			}

			// Test automatic mode
			await setUserSettings(ctx.client, {
				userId,
				stockCalculationMode: "automatic",
			});

			const autoResponse = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(autoResponse.statusCode).toBe(200);
			const autoData = autoResponse.json();
			expect(autoData[0].plannerUsage).toBe(10); // Schedule says 10 doses

			// Test manual mode
			await setUserSettings(ctx.client, {
				userId,
				stockCalculationMode: "manual",
			});

			const manualResponse = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(manualResponse.statusCode).toBe(200);
			const manualData = manualResponse.json();
			expect(manualData[0].plannerUsage).toBe(5); // Only 5 actually tracked
		});
	});

	// ---------------------------------------------------------------------------
	// Multiple Medications Tests
	// ---------------------------------------------------------------------------

	describe("Multiple medications", () => {
		it("should calculate usage for all medications", async () => {
			const start = new Date("2025-01-01T00:00:00.000Z");

			await createTestMedication(ctx.client, {
				userId,
				name: "Med A",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 20,
				blisters: [{ usage: 1, every: 1, start: start.toISOString() }],
			});

			await createTestMedication(ctx.client, {
				userId,
				name: "Med B",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 20,
				blisters: [{ usage: 2, every: 2, start: start.toISOString() }],
			});

			await setUserSettings(ctx.client, {
				userId,
				stockCalculationMode: "automatic",
			});

			const response = await ctx.app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-10T23:59:59.999Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data).toHaveLength(2);

			const medA = data.find((d: any) => d.medicationName === "Med A");
			const medB = data.find((d: any) => d.medicationName === "Med B");

			expect(medA.plannerUsage).toBe(10); // 10 days × 1 pill
			expect(medB.plannerUsage).toBe(10); // 5 doses × 2 pills
		});
	});
});
