/**
 * Tests for /export and /import API endpoints.
 * Tests export/import functionality with schema-independent format.
 */

import { randomBytes } from "node:crypto";
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
// Route Registration (simplified test routes)
// =============================================================================

async function registerExportRoutes(ctx: TestContext) {
	const { app, client } = ctx;
	const userId = 1; // Test user ID

	// Helper to parse blisters from DB
	function parseBlisters(row: any): Array<{ usage: number; every: number; start: string; remind: boolean }> {
		const usage = JSON.parse(row.usage_json || "[]") as number[];
		const every = JSON.parse(row.every_json || "[]") as number[];
		const start = JSON.parse(row.start_json || "[]") as string[];
		const len = Math.min(usage.length, every.length, start.length);
		return Array.from({ length: len }, (_, i) => ({
			usage: usage[i],
			every: every[i],
			start: start[i],
			remind: Boolean(row.intake_reminders_enabled),
		}));
	}

	// GET /export
	app.get<{ Querystring: { includeSensitive?: string } }>("/export", async (request, _reply) => {
		const includeSensitive = request.query.includeSensitive === "true";

		// Load medications
		const medsResult = await client.execute({
			sql: `SELECT * FROM medications WHERE user_id = ? ORDER BY id`,
			args: [userId],
		});

		const medIdToExportId = new Map<number, string>();
		const medications = medsResult.rows.map((m, i) => {
			const exportId = `med-${i + 1}`;
			medIdToExportId.set(m.id as number, exportId);
			return {
				_exportId: exportId,
				name: m.name,
				genericName: m.generic_name,
				takenBy: JSON.parse((m.taken_by_json as string) || "[]"),
				inventory: {
					packCount: m.pack_count ?? 1,
					blistersPerPack: m.blisters_per_pack ?? 1,
					pillsPerBlister: m.pills_per_blister ?? 1,
					looseTablets: m.loose_tablets ?? 0,
				},
				pillWeightMg: m.pill_weight_mg,
				schedules: parseBlisters(m),
				expiryDate: m.expiry_date,
				notes: m.notes,
				intakeRemindersEnabled: Boolean(m.intake_reminders_enabled),
				image: null, // Skip images in test
			};
		});

		// Load dose tracking
		const dosesResult = await client.execute({
			sql: `SELECT * FROM dose_tracking WHERE user_id = ?`,
			args: [userId],
		});

		const doseHistory = dosesResult.rows
			.map((d) => {
				const parts = (d.dose_id as string).split("-");
				if (parts.length < 3) return null;
				const medId = parseInt(parts[0], 10);
				const exportId = medIdToExportId.get(medId);
				if (!exportId) return null;
				return {
					medicationRef: exportId,
					scheduleIndex: parseInt(parts[1], 10),
					scheduledTime: new Date(parseInt(parts[2], 10)).toISOString(),
					takenAt: d.taken_at ? new Date((d.taken_at as number) * 1000).toISOString() : new Date().toISOString(),
					markedBy: d.marked_by,
				};
			})
			.filter(Boolean);

		// Load settings
		const settingsResult = await client.execute({
			sql: `SELECT * FROM user_settings WHERE user_id = ?`,
			args: [userId],
		});

		let settings;
		if (settingsResult.rows.length > 0) {
			const s = settingsResult.rows[0];
			settings = {
				emailEnabled: Boolean(s.email_enabled),
				notificationEmail: s.notification_email,
				emailStockReminders: Boolean(s.email_stock_reminders ?? 1),
				emailIntakeReminders: Boolean(s.email_intake_reminders ?? 1),
				shoutrrrEnabled: includeSensitive ? Boolean(s.shoutrrr_enabled) : undefined,
				shoutrrrUrl: includeSensitive ? s.shoutrrr_url : undefined,
				shoutrrrStockReminders: Boolean(s.shoutrrr_stock_reminders ?? 1),
				shoutrrrIntakeReminders: Boolean(s.shoutrrr_intake_reminders ?? 1),
				reminderDaysBefore: s.reminder_days_before ?? 7,
				repeatDailyReminders: Boolean(s.repeat_daily_reminders),
				skipRemindersForTakenDoses: Boolean(s.skip_reminders_for_taken_doses),
				repeatRemindersEnabled: Boolean(s.repeat_reminders_enabled),
				reminderRepeatIntervalMinutes: s.reminder_repeat_interval_minutes ?? 30,
				maxNaggingReminders: s.max_nagging_reminders ?? 5,
				lowStockDays: s.low_stock_days ?? 30,
				normalStockDays: s.normal_stock_days ?? 90,
				highStockDays: s.high_stock_days ?? 180,
				language: s.language ?? "en",
				stockCalculationMode: s.stock_calculation_mode ?? "automatic",
			};
		}

		// Load share links
		const sharesResult = await client.execute({
			sql: `SELECT * FROM share_tokens WHERE user_id = ?`,
			args: [userId],
		});

		const shareLinks = sharesResult.rows.map((s) => ({
			takenBy: s.taken_by,
			scheduleDays: s.schedule_days ?? 30,
			expiresAt: s.expires_at ? new Date((s.expires_at as number) * 1000).toISOString() : null,
			regenerateToken: true,
		}));

		return {
			version: "1.0",
			exportedAt: new Date().toISOString(),
			includeSensitiveData: includeSensitive,
			medications,
			doseHistory,
			settings,
			shareLinks,
		};
	});

	// POST /import
	app.post<{ Body: any }>("/import", async (request, reply) => {
		const importData = request.body as any;

		// Basic validation
		if (!importData.version) {
			return reply.status(400).send({ error: "Invalid import data format" });
		}

		// Delete existing data
		await client.execute({ sql: `DELETE FROM dose_tracking WHERE user_id = ?`, args: [userId] });
		await client.execute({ sql: `DELETE FROM share_tokens WHERE user_id = ?`, args: [userId] });
		await client.execute({ sql: `DELETE FROM medications WHERE user_id = ?`, args: [userId] });
		await client.execute({ sql: `DELETE FROM user_settings WHERE user_id = ?`, args: [userId] });

		// Import medications
		const exportIdToNewId = new Map<string, number>();
		for (const med of importData.medications || []) {
			const usageJson = JSON.stringify((med.schedules || []).map((s: any) => s.usage));
			const everyJson = JSON.stringify((med.schedules || []).map((s: any) => s.every));
			const startJson = JSON.stringify((med.schedules || []).map((s: any) => s.start));
			const takenByJson = JSON.stringify(med.takenBy || []);

			const result = await client.execute({
				sql: `INSERT INTO medications (
          user_id, name, generic_name, taken_by_json,
          pack_count, blisters_per_pack, pills_per_blister, loose_tablets,
          pill_weight_mg, expiry_date, notes, intake_reminders_enabled,
          usage_json, every_json, start_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
				args: [
					userId,
					med.name,
					med.genericName || null,
					takenByJson,
					med.inventory?.packCount ?? 1,
					med.inventory?.blistersPerPack ?? 1,
					med.inventory?.pillsPerBlister ?? 1,
					med.inventory?.looseTablets ?? 0,
					med.pillWeightMg ?? null,
					med.expiryDate || null,
					med.notes || null,
					med.intakeRemindersEnabled ? 1 : 0,
					usageJson,
					everyJson,
					startJson,
				],
			});

			exportIdToNewId.set(med._exportId, result.rows[0].id as number);
		}

		// Import dose history
		for (const dose of importData.doseHistory || []) {
			const newMedId = exportIdToNewId.get(dose.medicationRef);
			if (!newMedId) continue;

			const timestampMs = new Date(dose.scheduledTime).getTime();
			const doseId = `${newMedId}-${dose.scheduleIndex}-${timestampMs}`;

			await client.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, marked_by) VALUES (?, ?, ?, ?)`,
				args: [userId, doseId, Math.floor(new Date(dose.takenAt).getTime() / 1000), dose.markedBy || null],
			});
		}

		// Import settings
		if (importData.settings) {
			const s = importData.settings;
			await client.execute({
				sql: `INSERT INTO user_settings (
          user_id, email_enabled, notification_email,
          email_stock_reminders, email_intake_reminders,
          shoutrrr_enabled, shoutrrr_url,
          shoutrrr_stock_reminders, shoutrrr_intake_reminders,
          reminder_days_before, repeat_daily_reminders,
          skip_reminders_for_taken_doses, repeat_reminders_enabled,
          reminder_repeat_interval_minutes, max_nagging_reminders,
          low_stock_days, normal_stock_days, high_stock_days,
          language, stock_calculation_mode
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					userId,
					s.emailEnabled ? 1 : 0,
					s.notificationEmail || null,
					s.emailStockReminders ?? 1,
					s.emailIntakeReminders ?? 1,
					s.shoutrrrEnabled ? 1 : 0,
					s.shoutrrrUrl || null,
					s.shoutrrrStockReminders ?? 1,
					s.shoutrrrIntakeReminders ?? 1,
					s.reminderDaysBefore ?? 7,
					s.repeatDailyReminders ? 1 : 0,
					s.skipRemindersForTakenDoses ? 1 : 0,
					s.repeatRemindersEnabled ? 1 : 0,
					s.reminderRepeatIntervalMinutes ?? 30,
					s.maxNaggingReminders ?? 5,
					s.lowStockDays ?? 30,
					s.normalStockDays ?? 90,
					s.highStockDays ?? 180,
					s.language ?? "en",
					s.stockCalculationMode ?? "automatic",
				],
			});
		}

		// Import share links
		for (const share of importData.shareLinks || []) {
			const token = randomBytes(8).toString("hex");
			await client.execute({
				sql: `INSERT INTO share_tokens (user_id, token, taken_by, schedule_days, expires_at) VALUES (?, ?, ?, ?, ?)`,
				args: [
					userId,
					token,
					share.takenBy,
					share.scheduleDays ?? 30,
					share.expiresAt ? Math.floor(new Date(share.expiresAt).getTime() / 1000) : null,
				],
			});
		}

		return {
			success: true,
			imported: {
				medications: (importData.medications || []).length,
				doseHistory: (importData.doseHistory || []).length,
				settings: importData.settings ? 1 : 0,
				shareLinks: (importData.shareLinks || []).length,
			},
		};
	});
}

// =============================================================================
// Tests
// =============================================================================

describe("Export/Import API", () => {
	let ctx: TestContext;
	let userId: number;

	beforeAll(async () => {
		ctx = await buildTestApp();
		await registerExportRoutes(ctx);
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
	// GET /export
	// ---------------------------------------------------------------------------

	describe("GET /export", () => {
		it("should export empty data for new user", async () => {
			const response = await ctx.app.inject({
				method: "GET",
				url: "/export",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.version).toBe("1.0");
			expect(data.exportedAt).toBeDefined();
			expect(data.medications).toEqual([]);
			expect(data.doseHistory).toEqual([]);
			expect(data.shareLinks).toEqual([]);
		});

		it("should export medications with correct format", async () => {
			const startDate = "2025-01-15T08:00:00.000Z";
			await createTestMedication(ctx.client, {
				userId,
				name: "Aspirin",
				genericName: "Acetylsalicylic acid",
				takenBy: ["Daniel", "Maria"],
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				looseTablets: 5,
				pillWeightMg: 500,
				expiryDate: "2027-06-30",
				notes: "Take with food",
				intakeRemindersEnabled: true,
				blisters: [
					{ usage: 1, every: 1, start: startDate },
					{ usage: 0.5, every: 7, start: startDate },
				],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/export",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.medications).toHaveLength(1);

			const med = data.medications[0];
			expect(med._exportId).toBe("med-1");
			expect(med.name).toBe("Aspirin");
			expect(med.genericName).toBe("Acetylsalicylic acid");
			expect(med.takenBy).toEqual(["Daniel", "Maria"]);
			expect(med.inventory).toEqual({
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				looseTablets: 5,
			});
			expect(med.pillWeightMg).toBe(500);
			expect(med.expiryDate).toBe("2027-06-30");
			expect(med.notes).toBe("Take with food");
			expect(med.intakeRemindersEnabled).toBe(true);
			expect(med.schedules).toHaveLength(2);
			expect(med.schedules[0]).toEqual({
				usage: 1,
				every: 1,
				start: startDate,
				remind: true,
			});
		});

		it("should export settings", async () => {
			// Create settings
			await ctx.client.execute({
				sql: `INSERT INTO user_settings (
          user_id, email_enabled, notification_email, language, low_stock_days
        ) VALUES (?, 1, 'test@example.com', 'de', 14)`,
				args: [userId],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/export",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.settings).toBeDefined();
			expect(data.settings.emailEnabled).toBe(true);
			expect(data.settings.notificationEmail).toBe("test@example.com");
			expect(data.settings.language).toBe("de");
			expect(data.settings.lowStockDays).toBe(14);
		});

		it("should exclude sensitive data by default", async () => {
			await ctx.client.execute({
				sql: `INSERT INTO user_settings (
          user_id, shoutrrr_enabled, shoutrrr_url
        ) VALUES (?, 1, 'ntfy://user:pass@ntfy.sh/topic')`,
				args: [userId],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/export",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.includeSensitiveData).toBe(false);
			expect(data.settings.shoutrrrEnabled).toBeUndefined();
			expect(data.settings.shoutrrrUrl).toBeUndefined();
		});

		it("should include sensitive data when requested", async () => {
			await ctx.client.execute({
				sql: `INSERT INTO user_settings (
          user_id, shoutrrr_enabled, shoutrrr_url
        ) VALUES (?, 1, 'ntfy://user:pass@ntfy.sh/topic')`,
				args: [userId],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/export?includeSensitive=true",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.includeSensitiveData).toBe(true);
			expect(data.settings.shoutrrrEnabled).toBe(true);
			expect(data.settings.shoutrrrUrl).toBe("ntfy://user:pass@ntfy.sh/topic");
		});

		it("should export dose history with medication references", async () => {
			const medId = await createTestMedication(ctx.client, {
				userId,
				name: "Test Med",
			});

			// Create dose tracking entry
			const timestampMs = Date.now();
			const doseId = `${medId}-0-${timestampMs}`;
			await ctx.client.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at) VALUES (?, ?, ?)`,
				args: [userId, doseId, Math.floor(Date.now() / 1000)],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/export",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.doseHistory).toHaveLength(1);
			expect(data.doseHistory[0].medicationRef).toBe("med-1");
			expect(data.doseHistory[0].scheduleIndex).toBe(0);
			expect(data.doseHistory[0].scheduledTime).toBeDefined();
			expect(data.doseHistory[0].takenAt).toBeDefined();
		});

		it("should export share links", async () => {
			await ctx.client.execute({
				sql: `INSERT INTO share_tokens (user_id, token, taken_by, schedule_days) VALUES (?, ?, ?, ?)`,
				args: [userId, "abc123", "Daniel", 30],
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/export",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.shareLinks).toHaveLength(1);
			expect(data.shareLinks[0].takenBy).toBe("Daniel");
			expect(data.shareLinks[0].scheduleDays).toBe(30);
			expect(data.shareLinks[0].regenerateToken).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// POST /import
	// ---------------------------------------------------------------------------

	describe("POST /import", () => {
		it("should import medications", async () => {
			const importData = {
				version: "1.0",
				exportedAt: new Date().toISOString(),
				medications: [
					{
						_exportId: "med-1",
						name: "Imported Med",
						genericName: "Generic",
						takenBy: ["Alice"],
						inventory: {
							packCount: 2,
							blistersPerPack: 3,
							pillsPerBlister: 10,
							looseTablets: 5,
						},
						pillWeightMg: 250,
						schedules: [{ usage: 1, every: 1, start: "2025-01-15T08:00:00.000Z", remind: true }],
						expiryDate: "2027-12-31",
						notes: "Test notes",
						intakeRemindersEnabled: true,
					},
				],
				doseHistory: [],
				shareLinks: [],
			};

			const response = await ctx.app.inject({
				method: "POST",
				url: "/import",
				payload: importData,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().success).toBe(true);
			expect(response.json().imported.medications).toBe(1);

			// Verify in database
			const result = await ctx.client.execute({
				sql: `SELECT * FROM medications WHERE user_id = ?`,
				args: [userId],
			});
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].name).toBe("Imported Med");
			expect(result.rows[0].generic_name).toBe("Generic");
			expect(result.rows[0].pack_count).toBe(2);
			expect(result.rows[0].blisters_per_pack).toBe(3);
			expect(result.rows[0].pills_per_blister).toBe(10);
			expect(result.rows[0].loose_tablets).toBe(5);
		});

		it("should replace existing data on import", async () => {
			// Create existing medication
			await createTestMedication(ctx.client, {
				userId,
				name: "Existing Med",
			});

			const importData = {
				version: "1.0",
				exportedAt: new Date().toISOString(),
				medications: [
					{
						_exportId: "med-1",
						name: "New Med",
						schedules: [{ usage: 1, every: 1, start: "2025-01-15T08:00:00.000Z" }],
					},
				],
				doseHistory: [],
				shareLinks: [],
			};

			await ctx.app.inject({
				method: "POST",
				url: "/import",
				payload: importData,
			});

			// Verify old med deleted, new one exists
			const result = await ctx.client.execute({
				sql: `SELECT * FROM medications WHERE user_id = ?`,
				args: [userId],
			});
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].name).toBe("New Med");
		});

		it("should import dose history with remapped IDs", async () => {
			const importData = {
				version: "1.0",
				exportedAt: new Date().toISOString(),
				medications: [
					{
						_exportId: "med-1",
						name: "Med 1",
						schedules: [{ usage: 1, every: 1, start: "2025-01-15T08:00:00.000Z" }],
					},
				],
				doseHistory: [
					{
						medicationRef: "med-1",
						scheduleIndex: 0,
						scheduledTime: "2025-01-15T08:00:00.000Z",
						takenAt: "2025-01-15T08:15:00.000Z",
						markedBy: null,
					},
				],
				shareLinks: [],
			};

			await ctx.app.inject({
				method: "POST",
				url: "/import",
				payload: importData,
			});

			// Verify dose tracking
			const doses = await ctx.client.execute({
				sql: `SELECT * FROM dose_tracking WHERE user_id = ?`,
				args: [userId],
			});
			expect(doses.rows).toHaveLength(1);
			// Dose ID should contain the NEW medication ID
			const doseId = doses.rows[0].dose_id as string;
			expect(doseId).toMatch(/^\d+-0-\d+$/);
		});

		it("should import settings", async () => {
			const importData = {
				version: "1.0",
				exportedAt: new Date().toISOString(),
				medications: [],
				doseHistory: [],
				settings: {
					emailEnabled: true,
					notificationEmail: "imported@example.com",
					language: "de",
					lowStockDays: 14,
					normalStockDays: 60,
					highStockDays: 120,
				},
				shareLinks: [],
			};

			await ctx.app.inject({
				method: "POST",
				url: "/import",
				payload: importData,
			});

			// Verify settings
			const settings = await ctx.client.execute({
				sql: `SELECT * FROM user_settings WHERE user_id = ?`,
				args: [userId],
			});
			expect(settings.rows).toHaveLength(1);
			expect(settings.rows[0].email_enabled).toBe(1);
			expect(settings.rows[0].notification_email).toBe("imported@example.com");
			expect(settings.rows[0].language).toBe("de");
			expect(settings.rows[0].low_stock_days).toBe(14);
		});

		it("should import share links with new tokens", async () => {
			const importData = {
				version: "1.0",
				exportedAt: new Date().toISOString(),
				medications: [],
				doseHistory: [],
				shareLinks: [
					{
						takenBy: "Daniel",
						scheduleDays: 60,
						regenerateToken: true,
					},
				],
			};

			await ctx.app.inject({
				method: "POST",
				url: "/import",
				payload: importData,
			});

			// Verify share token
			const shares = await ctx.client.execute({
				sql: `SELECT * FROM share_tokens WHERE user_id = ?`,
				args: [userId],
			});
			expect(shares.rows).toHaveLength(1);
			expect(shares.rows[0].taken_by).toBe("Daniel");
			expect(shares.rows[0].schedule_days).toBe(60);
			expect(shares.rows[0].token).toBeDefined();
			expect((shares.rows[0].token as string).length).toBe(16); // 8 bytes = 16 hex chars
		});

		it("should reject invalid import data", async () => {
			const response = await ctx.app.inject({
				method: "POST",
				url: "/import",
				payload: { invalid: "data" },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("Invalid import data format");
		});
	});

	// ---------------------------------------------------------------------------
	// Export/Import Roundtrip Tests
	// ---------------------------------------------------------------------------

	describe("Export/Import Roundtrip", () => {
		it("should preserve all data through export/import cycle", async () => {
			// Setup: Create medications, doses, settings, shares
			const startDate = "2025-01-15T08:00:00.000Z";
			const medId = await createTestMedication(ctx.client, {
				userId,
				name: "Roundtrip Med",
				genericName: "Generic Name",
				takenBy: ["Daniel", "Maria"],
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				looseTablets: 5,
				pillWeightMg: 500,
				expiryDate: "2027-06-30",
				notes: "Test notes",
				intakeRemindersEnabled: true,
				blisters: [
					{ usage: 1, every: 1, start: startDate },
					{ usage: 0.5, every: 7, start: startDate },
				],
			});

			// Create dose
			const timestampMs = new Date(startDate).getTime();
			const doseId = `${medId}-0-${timestampMs}`;
			await ctx.client.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, marked_by) VALUES (?, ?, ?, ?)`,
				args: [userId, doseId, Math.floor(Date.now() / 1000), "Daniel"],
			});

			// Create settings
			await ctx.client.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, notification_email, language, low_stock_days) VALUES (?, 1, 'test@example.com', 'de', 14)`,
				args: [userId],
			});

			// Create share
			await ctx.client.execute({
				sql: `INSERT INTO share_tokens (user_id, token, taken_by, schedule_days) VALUES (?, ?, ?, ?)`,
				args: [userId, "original123", "Daniel", 60],
			});

			// Export
			const exportResponse = await ctx.app.inject({
				method: "GET",
				url: "/export",
			});
			expect(exportResponse.statusCode).toBe(200);
			const exportData = exportResponse.json();

			// Import (this replaces all data)
			const importResponse = await ctx.app.inject({
				method: "POST",
				url: "/import",
				payload: exportData,
			});
			expect(importResponse.statusCode).toBe(200);

			// Export again and compare
			const reExportResponse = await ctx.app.inject({
				method: "GET",
				url: "/export",
			});
			const reExportData = reExportResponse.json();

			// Compare (excluding timestamps and IDs that change)
			expect(reExportData.medications).toHaveLength(1);
			expect(reExportData.medications[0].name).toBe("Roundtrip Med");
			expect(reExportData.medications[0].genericName).toBe("Generic Name");
			expect(reExportData.medications[0].takenBy).toEqual(["Daniel", "Maria"]);
			expect(reExportData.medications[0].inventory).toEqual({
				packCount: 2,
				blistersPerPack: 3,
				pillsPerBlister: 10,
				looseTablets: 5,
			});
			expect(reExportData.medications[0].schedules).toHaveLength(2);

			expect(reExportData.doseHistory).toHaveLength(1);
			expect(reExportData.doseHistory[0].markedBy).toBe("Daniel");

			expect(reExportData.settings.emailEnabled).toBe(true);
			expect(reExportData.settings.notificationEmail).toBe("test@example.com");
			expect(reExportData.settings.language).toBe("de");

			expect(reExportData.shareLinks).toHaveLength(1);
			expect(reExportData.shareLinks[0].takenBy).toBe("Daniel");
		});

		it("should handle import with different schema (backward compatibility)", async () => {
			// Simulate import from older version without some fields
			const importData = {
				version: "1.0",
				exportedAt: new Date().toISOString(),
				medications: [
					{
						_exportId: "med-1",
						name: "Legacy Med",
						// Missing: genericName, takenBy, pillWeightMg, etc.
						inventory: {
							packCount: 1,
							blistersPerPack: 1,
							pillsPerBlister: 10,
							looseTablets: 0,
						},
						schedules: [{ usage: 1, every: 1, start: "2025-01-15T08:00:00.000Z" }],
					},
				],
				doseHistory: [],
				// Missing: settings, shareLinks
			};

			const response = await ctx.app.inject({
				method: "POST",
				url: "/import",
				payload: importData,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().success).toBe(true);

			// Verify defaults were applied
			const result = await ctx.client.execute({
				sql: `SELECT * FROM medications WHERE user_id = ?`,
				args: [userId],
			});
			expect(result.rows[0].name).toBe("Legacy Med");
			expect(result.rows[0].generic_name).toBeNull();
			expect(result.rows[0].taken_by_json).toBe("[]");
		});
	});
});
