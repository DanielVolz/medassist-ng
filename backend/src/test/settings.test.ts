/**
 * Tests for /settings API endpoints.
 * Tests user settings CRUD operations.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	buildTestApp,
	clearTestData,
	closeTestApp,
	createTestUser,
	setUserSettings,
	type TestContext,
} from "./setup.js";

// =============================================================================
// Route Registration
// =============================================================================

async function registerSettingsRoutes(ctx: TestContext) {
	const { app, client } = ctx;

	// GET /settings - Get user settings
	app.get("/settings", async (_request, _reply) => {
		const userId = 1;

		const result = await client.execute({
			sql: `SELECT * FROM user_settings WHERE user_id = ?`,
			args: [userId],
		});

		if (result.rows.length === 0) {
			// Return defaults
			return {
				emailEnabled: false,
				notificationEmail: "",
				emailStockReminders: true,
				emailIntakeReminders: true,
				shoutrrrEnabled: false,
				shoutrrrUrl: "",
				shoutrrrStockReminders: true,
				shoutrrrIntakeReminders: true,
				reminderDaysBefore: 7,
				repeatDailyReminders: false,
				skipRemindersForTakenDoses: false,
				repeatRemindersEnabled: false,
				reminderRepeatIntervalMinutes: 30,
				maxNaggingReminders: 5,
				lowStockDays: 30,
				normalStockDays: 90,
				highStockDays: 180,
				expiryWarningDays: 90,
				language: "en",
				stockCalculationMode: "automatic",
			};
		}

		const s = result.rows[0];
		return {
			emailEnabled: Boolean(s.email_enabled),
			notificationEmail: s.notification_email || "",
			emailStockReminders: Boolean(s.email_stock_reminders),
			emailIntakeReminders: Boolean(s.email_intake_reminders),
			shoutrrrEnabled: Boolean(s.shoutrrr_enabled),
			shoutrrrUrl: s.shoutrrr_url || "",
			shoutrrrStockReminders: Boolean(s.shoutrrr_stock_reminders),
			shoutrrrIntakeReminders: Boolean(s.shoutrrr_intake_reminders),
			reminderDaysBefore: s.reminder_days_before,
			repeatDailyReminders: Boolean(s.repeat_daily_reminders),
			skipRemindersForTakenDoses: Boolean(s.skip_reminders_for_taken_doses ?? false),
			repeatRemindersEnabled: Boolean(s.repeat_reminders_enabled ?? false),
			reminderRepeatIntervalMinutes: s.reminder_repeat_interval_minutes ?? 30,
			maxNaggingReminders: s.max_nagging_reminders ?? 5,
			lowStockDays: s.low_stock_days,
			normalStockDays: s.normal_stock_days,
			highStockDays: s.high_stock_days,
			expiryWarningDays: s.expiry_warning_days,
			language: s.language,
			stockCalculationMode: s.stock_calculation_mode,
		};
	});

	// PUT /settings - Update user settings
	app.put<{
		Body: {
			emailEnabled?: boolean;
			notificationEmail?: string;
			emailStockReminders?: boolean;
			emailIntakeReminders?: boolean;
			shoutrrrEnabled?: boolean;
			shoutrrrUrl?: string;
			shoutrrrStockReminders?: boolean;
			shoutrrrIntakeReminders?: boolean;
			reminderDaysBefore?: number;
			repeatDailyReminders?: boolean;
			skipRemindersForTakenDoses?: boolean;
			repeatRemindersEnabled?: boolean;
			reminderRepeatIntervalMinutes?: number;
			maxNaggingReminders?: number;
			lowStockDays?: number;
			normalStockDays?: number;
			highStockDays?: number;
			expiryWarningDays?: number;
			language?: string;
			stockCalculationMode?: "automatic" | "manual";
		};
	}>("/settings", async (request, reply) => {
		const userId = 1;
		const body = request.body || {};

		// Validation
		if (body.emailEnabled && !body.notificationEmail) {
			return reply.status(400).send({ error: "Email address required when email is enabled" });
		}
		if (body.notificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.notificationEmail)) {
			return reply.status(400).send({ error: "Invalid email address" });
		}
		if (body.lowStockDays !== undefined && (body.lowStockDays < 1 || body.lowStockDays > 365)) {
			return reply.status(400).send({ error: "lowStockDays must be between 1 and 365" });
		}
		if (body.language && !["en", "de"].includes(body.language)) {
			return reply.status(400).send({ error: "Language must be 'en' or 'de'" });
		}
		if (body.stockCalculationMode && !["automatic", "manual"].includes(body.stockCalculationMode)) {
			return reply.status(400).send({ error: "stockCalculationMode must be 'automatic' or 'manual'" });
		}
		if (
			body.reminderRepeatIntervalMinutes !== undefined &&
			(body.reminderRepeatIntervalMinutes < 5 || body.reminderRepeatIntervalMinutes > 480)
		) {
			return reply.status(400).send({ error: "reminderRepeatIntervalMinutes must be between 5 and 480" });
		}
		if (body.maxNaggingReminders !== undefined && (body.maxNaggingReminders < 1 || body.maxNaggingReminders > 20)) {
			return reply.status(400).send({ error: "maxNaggingReminders must be between 1 and 20" });
		}

		// Check if settings exist
		const existing = await client.execute({
			sql: `SELECT id FROM user_settings WHERE user_id = ?`,
			args: [userId],
		});

		const settingsArgs = [
			body.emailEnabled ? 1 : 0,
			body.notificationEmail || null,
			body.emailStockReminders !== false ? 1 : 0,
			body.emailIntakeReminders !== false ? 1 : 0,
			body.shoutrrrEnabled ? 1 : 0,
			body.shoutrrrUrl || null,
			body.shoutrrrStockReminders !== false ? 1 : 0,
			body.shoutrrrIntakeReminders !== false ? 1 : 0,
			body.reminderDaysBefore ?? 7,
			body.repeatDailyReminders ? 1 : 0,
			body.skipRemindersForTakenDoses ? 1 : 0,
			body.repeatRemindersEnabled ? 1 : 0,
			body.reminderRepeatIntervalMinutes ?? 30,
			body.maxNaggingReminders ?? 5,
			body.lowStockDays ?? 30,
			body.normalStockDays ?? 90,
			body.highStockDays ?? 180,
			body.expiryWarningDays ?? 90,
			body.language || "en",
			body.stockCalculationMode || "automatic",
			1,
		];

		if (existing.rows.length === 0) {
			// Insert new settings
			await client.execute({
				sql: `INSERT INTO user_settings (
          user_id, email_enabled, notification_email,
          email_stock_reminders, email_intake_reminders,
          shoutrrr_enabled, shoutrrr_url,
          shoutrrr_stock_reminders, shoutrrr_intake_reminders,
          reminder_days_before, repeat_daily_reminders, skip_reminders_for_taken_doses,
          repeat_reminders_enabled, reminder_repeat_interval_minutes, max_nagging_reminders,
	          low_stock_days, normal_stock_days, high_stock_days,
	          expiry_warning_days, language, stock_calculation_mode, share_stock_status
	        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [userId, ...settingsArgs],
			});
		} else {
			// Update existing settings
			await client.execute({
				sql: `UPDATE user_settings SET
          email_enabled = ?,
          notification_email = ?,
          email_stock_reminders = ?,
          email_intake_reminders = ?,
          shoutrrr_enabled = ?,
          shoutrrr_url = ?,
          shoutrrr_stock_reminders = ?,
          shoutrrr_intake_reminders = ?,
          reminder_days_before = ?,
          repeat_daily_reminders = ?,
          skip_reminders_for_taken_doses = ?,
          repeat_reminders_enabled = ?,
          reminder_repeat_interval_minutes = ?,
          max_nagging_reminders = ?,
          low_stock_days = ?,
          normal_stock_days = ?,
          high_stock_days = ?,
          expiry_warning_days = ?,
          language = ?,
	          stock_calculation_mode = ?,
	          share_stock_status = ?,
	          updated_at = strftime('%s','now')
	        WHERE user_id = ?`,
				args: [...settingsArgs, userId],
			});
		}

		return { success: true };
	});
}

// =============================================================================
// Tests
// =============================================================================

describe("Settings API", () => {
	let ctx: TestContext;
	let userId: number;

	beforeAll(async () => {
		ctx = await buildTestApp();
		await registerSettingsRoutes(ctx);
		await ctx.app.ready();
	});

	afterAll(async () => {
		await closeTestApp(ctx);
	});

	beforeEach(async () => {
		await clearTestData(ctx.client);
		await ctx.client.execute("DELETE FROM sqlite_sequence WHERE name='users'");
		userId = await createTestUser(ctx.client, { username: "testuser" });
	});

	// ---------------------------------------------------------------------------
	// GET /settings
	// ---------------------------------------------------------------------------

	describe("GET /settings", () => {
		it("should return default settings for new user", async () => {
			const response = await ctx.app.inject({
				method: "GET",
				url: "/settings",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.emailEnabled).toBe(false);
			expect(data.lowStockDays).toBe(30);
			expect(data.normalStockDays).toBe(90);
			expect(data.highStockDays).toBe(180);
			expect(data.language).toBe("en");
			expect(data.stockCalculationMode).toBe("automatic");
		});

		it("should return saved settings", async () => {
			// Create settings first
			await setUserSettings(ctx.client, {
				userId,
				stockCalculationMode: "manual",
				lowStockDays: 14,
			});

			const response = await ctx.app.inject({
				method: "GET",
				url: "/settings",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.stockCalculationMode).toBe("manual");
			expect(data.lowStockDays).toBe(14);
		});
	});

	// ---------------------------------------------------------------------------
	// PUT /settings
	// ---------------------------------------------------------------------------

	describe("PUT /settings", () => {
		it("should create settings for new user", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					language: "de",
					lowStockDays: 14,
					stockCalculationMode: "manual",
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify
			const result = await ctx.client.execute({
				sql: `SELECT language, low_stock_days, stock_calculation_mode FROM user_settings WHERE user_id = ?`,
				args: [userId],
			});
			expect(result.rows[0].language).toBe("de");
			expect(result.rows[0].low_stock_days).toBe(14);
			expect(result.rows[0].stock_calculation_mode).toBe("manual");
		});

		it("should update existing settings", async () => {
			// Create initial settings
			await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: { language: "en" },
			});

			// Update
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: { language: "de" },
			});

			expect(response.statusCode).toBe(200);

			// Verify
			const result = await ctx.client.execute({
				sql: `SELECT language FROM user_settings WHERE user_id = ?`,
				args: [userId],
			});
			expect(result.rows[0].language).toBe("de");
		});

		it("should enable email notifications", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					emailEnabled: true,
					notificationEmail: "test@example.com",
					emailStockReminders: true,
					emailIntakeReminders: false,
				},
			});

			expect(response.statusCode).toBe(200);

			// Verify
			const result = await ctx.client.execute({
				sql: `SELECT email_enabled, notification_email, email_stock_reminders, email_intake_reminders 
              FROM user_settings WHERE user_id = ?`,
				args: [userId],
			});
			expect(result.rows[0].email_enabled).toBe(1);
			expect(result.rows[0].notification_email).toBe("test@example.com");
			expect(result.rows[0].email_stock_reminders).toBe(1);
			expect(result.rows[0].email_intake_reminders).toBe(0);
		});

		it("should reject email enabled without email address", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					emailEnabled: true,
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("Email address required when email is enabled");
		});

		it("should reject invalid email address", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					notificationEmail: "not-an-email",
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("Invalid email address");
		});

		it("should reject invalid lowStockDays", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					lowStockDays: 0,
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("lowStockDays must be between 1 and 365");
		});

		it("should reject invalid language", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					language: "fr",
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("Language must be 'en' or 'de'");
		});

		it("should reject invalid stockCalculationMode", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					stockCalculationMode: "invalid",
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("stockCalculationMode must be 'automatic' or 'manual'");
		});

		it("should enable shoutrrr notifications", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					shoutrrrEnabled: true,
					shoutrrrUrl: "ntfy://ntfy.sh/mytopic",
					shoutrrrStockReminders: true,
					shoutrrrIntakeReminders: true,
				},
			});

			expect(response.statusCode).toBe(200);

			// Verify
			const result = await ctx.client.execute({
				sql: `SELECT shoutrrr_enabled, shoutrrr_url FROM user_settings WHERE user_id = ?`,
				args: [userId],
			});
			expect(result.rows[0].shoutrrr_enabled).toBe(1);
			expect(result.rows[0].shoutrrr_url).toBe("ntfy://ntfy.sh/mytopic");
		});

		it("should update threshold settings", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					lowStockDays: 14,
					normalStockDays: 60,
					highStockDays: 120,
					expiryWarningDays: 30,
				},
			});

			expect(response.statusCode).toBe(200);

			// Verify
			const result = await ctx.client.execute({
				sql: `SELECT low_stock_days, normal_stock_days, high_stock_days, expiry_warning_days 
              FROM user_settings WHERE user_id = ?`,
				args: [userId],
			});
			expect(result.rows[0].low_stock_days).toBe(14);
			expect(result.rows[0].normal_stock_days).toBe(60);
			expect(result.rows[0].high_stock_days).toBe(120);
			expect(result.rows[0].expiry_warning_days).toBe(30);
		});
	});

	// ---------------------------------------------------------------------------
	// Stock Calculation Mode
	// ---------------------------------------------------------------------------

	describe("Stock Calculation Mode", () => {
		it("should switch to manual mode", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					stockCalculationMode: "manual",
				},
			});

			expect(response.statusCode).toBe(200);

			const getResponse = await ctx.app.inject({
				method: "GET",
				url: "/settings",
			});

			expect(getResponse.json().stockCalculationMode).toBe("manual");
		});

		it("should switch back to automatic mode", async () => {
			// Set to manual first
			await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: { stockCalculationMode: "manual" },
			});

			// Switch back
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: { stockCalculationMode: "automatic" },
			});

			expect(response.statusCode).toBe(200);

			const getResponse = await ctx.app.inject({
				method: "GET",
				url: "/settings",
			});

			expect(getResponse.json().stockCalculationMode).toBe("automatic");
		});
	});

	// ---------------------------------------------------------------------------
	// Share Stock Status
	// ---------------------------------------------------------------------------
	// Repeat Reminders & Skip Reminders Settings
	// ---------------------------------------------------------------------------

	describe("Repeat Reminders Settings", () => {
		it("should enable repeat reminders with interval", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					repeatRemindersEnabled: true,
					reminderRepeatIntervalMinutes: 10,
				},
			});

			expect(response.statusCode).toBe(200);

			const getResponse = await ctx.app.inject({
				method: "GET",
				url: "/settings",
			});

			const settings = getResponse.json();
			expect(settings.repeatRemindersEnabled).toBe(true);
			expect(settings.reminderRepeatIntervalMinutes).toBe(10);
		});

		it("should validate repeat interval range", async () => {
			let response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					repeatRemindersEnabled: true,
					reminderRepeatIntervalMinutes: 2,
				},
			});
			expect(response.statusCode).toBe(400);

			response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					repeatRemindersEnabled: true,
					reminderRepeatIntervalMinutes: 500,
				},
			});
			expect(response.statusCode).toBe(400);
		});

		it("should validate max nagging reminders range", async () => {
			let response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					maxNaggingReminders: 0,
				},
			});
			expect(response.statusCode).toBe(400);

			response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					maxNaggingReminders: 25,
				},
			});
			expect(response.statusCode).toBe(400);

			// Valid values should work
			response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					maxNaggingReminders: 10,
				},
			});
			expect(response.statusCode).toBe(200);

			const getResponse = await ctx.app.inject({
				method: "GET",
				url: "/settings",
			});

			const settings = getResponse.json();
			expect(settings.maxNaggingReminders).toBe(10);
		});
	});

	describe("Skip Reminders for Taken Doses", () => {
		it("should enable and disable skip reminders setting", async () => {
			let response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					skipRemindersForTakenDoses: true,
				},
			});
			expect(response.statusCode).toBe(200);

			response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					skipRemindersForTakenDoses: false,
				},
			});
			expect(response.statusCode).toBe(200);
		});

		it("should work with repeat reminders enabled", async () => {
			const response = await ctx.app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					repeatRemindersEnabled: true,
					reminderRepeatIntervalMinutes: 5,
					skipRemindersForTakenDoses: true,
				},
			});
			expect(response.statusCode).toBe(200);

			const getResponse = await ctx.app.inject({
				method: "GET",
				url: "/settings",
			});

			const settings = getResponse.json();
			expect(settings.repeatRemindersEnabled).toBe(true);
			expect(settings.reminderRepeatIntervalMinutes).toBe(5);
			expect(settings.skipRemindersForTakenDoses).toBe(true);
		});
	});
});
