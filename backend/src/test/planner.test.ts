import type { Client } from "@libsql/client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Create test database and mocks before anything else (hoisted)
const {
	testClient,
	testDb,
	mockSendMail,
	mockSendShoutrrr,
	mockUpdateReminderSentTime,
	mockUpdateUserReminderSentTime,
} = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);
	return {
		testClient: client,
		testDb: db,
		mockSendMail: vi.fn(),
		mockSendShoutrrr: vi.fn(),
		mockUpdateReminderSentTime: vi.fn(),
		mockUpdateUserReminderSentTime: vi.fn(),
	};
});

// Mock nodemailer
vi.mock("nodemailer", () => ({
	default: {
		createTransport: vi.fn(() => ({
			sendMail: mockSendMail,
		})),
	},
}));

// Mock the db module
vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

// Mock env to disable auth
vi.mock("../plugins/env.js", () => ({
	env: {
		AUTH_ENABLED: false,
		JWT_SECRET: "test-secret-key-for-testing",
		JWT_REFRESH_SECRET: "test-refresh-secret-key",
	},
}));

// Mock auth plugin
vi.mock("../plugins/auth.js", () => ({
	requireAuth: async () => {},
	getAnonymousUserId: () => 999999999,
}));

// Mock reminder-scheduler
vi.mock("../services/reminder-scheduler.js", () => ({
	updateReminderSentTime: mockUpdateReminderSentTime,
	updateUserReminderSentTime: mockUpdateUserReminderSentTime,
}));

// Mock sendShoutrrrNotification from settings
vi.mock("../routes/settings.js", async (importOriginal) => {
	const original = (await importOriginal()) as Record<string, unknown>;
	return {
		...original,
		sendShoutrrrNotification: mockSendShoutrrr,
	};
});

import { plannerRoutes } from "../routes/planner.js";

// =============================================================================
// Test Setup
// =============================================================================

async function createSchema(client: Client) {
	const tableCreations = [
		`CREATE TABLE IF NOT EXISTS users (
      id integer PRIMARY KEY AUTOINCREMENT,
      username text NOT NULL UNIQUE,
      password_hash text,
      auth_provider text NOT NULL DEFAULT 'local',
      is_active integer NOT NULL DEFAULT 1,
      created_at integer NOT NULL DEFAULT (strftime('%s','now')),
      updated_at integer NOT NULL DEFAULT (strftime('%s','now'))
    )`,
		`CREATE TABLE IF NOT EXISTS medications (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL,
      name text NOT NULL,
      generic_name text,
      taken_by_json text NOT NULL DEFAULT '[]',
		medication_form text NOT NULL DEFAULT 'tablet',
		pill_form text,
		lifecycle_category text NOT NULL DEFAULT 'refill_when_empty',
      package_type text NOT NULL DEFAULT 'blister',
		package_amount_value integer NOT NULL DEFAULT 0,
		package_amount_unit text NOT NULL DEFAULT 'ml',
      pack_count integer NOT NULL DEFAULT 1,
      blisters_per_pack integer NOT NULL DEFAULT 1,
      pills_per_blister integer NOT NULL DEFAULT 1,
      total_pills integer,
      loose_tablets integer NOT NULL DEFAULT 0,
      stock_adjustment integer NOT NULL DEFAULT 0,
      last_stock_correction_at integer,
      pill_weight_mg integer,
      dose_unit text DEFAULT 'mg',
      usage_json text NOT NULL DEFAULT '[]',
      every_json text NOT NULL DEFAULT '[]',
      start_json text NOT NULL DEFAULT '[]',
      intakes_json text NOT NULL DEFAULT '[]',
      image_url text,
      expiry_date text,
      notes text,
      intake_reminders_enabled integer NOT NULL DEFAULT 0,
      medication_start_date text NOT NULL DEFAULT '',
	medication_end_date text,
	auto_mark_obsolete_after_end_date integer NOT NULL DEFAULT 1,
      is_obsolete integer NOT NULL DEFAULT 0,
      obsolete_at integer,
      prescription_enabled integer NOT NULL DEFAULT 0,
      prescription_authorized_refills integer,
      prescription_remaining_refills integer,
      prescription_low_refill_threshold integer NOT NULL DEFAULT 1,
      prescription_expiry_date text,
      dismissed_until text,
      updated_at integer NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
		`CREATE TABLE IF NOT EXISTS user_settings (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL UNIQUE,
      email_enabled integer NOT NULL DEFAULT 0,
      notification_email text,
      email_stock_reminders integer NOT NULL DEFAULT 1,
      email_intake_reminders integer NOT NULL DEFAULT 1,
		email_prescription_reminders integer NOT NULL DEFAULT 1,
      shoutrrr_enabled integer NOT NULL DEFAULT 0,
      shoutrrr_url text,
      shoutrrr_stock_reminders integer NOT NULL DEFAULT 1,
      shoutrrr_intake_reminders integer NOT NULL DEFAULT 1,
		shoutrrr_prescription_reminders integer NOT NULL DEFAULT 1,
      reminder_days_before integer NOT NULL DEFAULT 7,
      repeat_daily_reminders integer NOT NULL DEFAULT 0,
      skip_reminders_for_taken_doses integer NOT NULL DEFAULT 0,
      repeat_reminders_enabled integer NOT NULL DEFAULT 0,
      reminder_repeat_interval_minutes integer NOT NULL DEFAULT 30,
      max_nagging_reminders integer NOT NULL DEFAULT 5,
      low_stock_days integer NOT NULL DEFAULT 30,
      normal_stock_days integer NOT NULL DEFAULT 90,
      high_stock_days integer NOT NULL DEFAULT 180,
      expiry_warning_days integer NOT NULL DEFAULT 90,
      language text NOT NULL DEFAULT 'en',
      stock_calculation_mode text NOT NULL DEFAULT 'automatic',
      share_stock_status integer NOT NULL DEFAULT 1,
	upcoming_today_only integer NOT NULL DEFAULT 0,
	share_schedule_today_only integer NOT NULL DEFAULT 0,
	swap_dashboard_main_sections integer NOT NULL DEFAULT 0,
      last_auto_email_sent text,
      last_notification_type text,
      last_notification_channel text,
      last_reminder_med_name text,
      last_reminder_taken_by text,
      last_stock_reminder_sent text,
      last_stock_reminder_channel text,
      last_stock_reminder_med_names text,
			last_prescription_reminder_sent text,
			last_prescription_reminder_channel text,
			last_prescription_reminder_med_names text,
      updated_at integer NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
	];

	for (const sql of tableCreations) {
		await client.execute(sql);
	}
}

async function clearData(client: Client) {
	await client.execute("DELETE FROM medications");
	await client.execute("DELETE FROM user_settings");
	await client.execute("DELETE FROM users");
	await client.execute("DELETE FROM sqlite_sequence");
}

describe("Planner Routes", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		await createSchema(testClient);
	});

	beforeEach(async () => {
		await clearData(testClient);

		// Create anonymous user
		await testClient.execute(
			"INSERT INTO users (id, username, auth_provider) VALUES (999999999, '__anonymous__', 'anonymous')"
		);

		// Insert test medications so active-medication filters pass
		await testClient.execute({
			sql: `INSERT INTO medications (id, user_id, name, taken_by_json, usage_json, every_json, start_json)
			       VALUES (1, 999999999, 'Aspirin', '["Daniel"]', '[1]', '[1]', '["2025-01-01T08:00:00.000Z"]')`,
			args: [],
		});
		await testClient.execute({
			sql: `INSERT INTO medications (id, user_id, name, taken_by_json, usage_json, every_json, start_json)
			       VALUES (2, 999999999, 'Ibuprofen', '["Daniel"]', '[1]', '[1]', '["2025-01-01T08:00:00.000Z"]')`,
			args: [],
		});

		app = Fastify({ logger: false });
		await app.register(plannerRoutes);
		await app.ready();

		vi.clearAllMocks();
		mockSendMail.mockReset();
		mockSendShoutrrr.mockReset();
	});

	afterAll(async () => {
		await app?.close();
		testClient.close();
	});

	describe("POST /planner/send-email", () => {
		it("should reject request with missing rows", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/planner/send-email",
				payload: {
					email: "test@example.com",
					from: "2025-01-01",
					until: "2025-01-31",
					rows: [],
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "Missing planner data" });
		});

		it("should return error when no notification channels configured", async () => {
			// User settings exist but email/shoutrrr disabled
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 0, 0, 'en')`,
				args: [999999999],
			});

			const response = await app.inject({
				method: "POST",
				url: "/planner/send-email",
				payload: {
					email: "test@example.com",
					from: "2025-01-01",
					until: "2025-01-31",
					rows: [
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 30,
							plannerUsage: 10,
							blisterSize: 10,
							blistersNeeded: 1,
							fullBlisters: 3,
							loosePills: 0,
							enough: true,
						},
					],
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "No notification channels configured" });
		});

		it("should send email successfully when SMTP is configured", async () => {
			// Set SMTP env vars
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			// Enable email in user settings
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
				args: [999999999],
			});

			mockSendMail.mockResolvedValueOnce({ messageId: "123" });

			const response = await app.inject({
				method: "POST",
				url: "/planner/send-email",
				payload: {
					email: "test@example.com",
					from: "2025-01-01",
					until: "2025-01-31",
					language: "en",
					rows: [
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 30,
							plannerUsage: 10,
							blisterSize: 10,
							blistersNeeded: 1,
							fullBlisters: 3,
							loosePills: 0,
							enough: true,
						},
					],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, message: "Notification sent via email" });
			expect(mockSendMail).toHaveBeenCalledTimes(1);

			// Cleanup
			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should handle email with out of stock medications", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
				args: [999999999],
			});

			mockSendMail.mockResolvedValueOnce({ messageId: "123" });

			const response = await app.inject({
				method: "POST",
				url: "/planner/send-email",
				payload: {
					email: "test@example.com",
					from: "2025-01-01",
					until: "2025-01-31",
					rows: [
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 5,
							plannerUsage: 30,
							blisterSize: 10,
							blistersNeeded: 3,
							fullBlisters: 0,
							loosePills: 5,
							enough: false,
						},
						{
							medicationId: 2,
							medicationName: "Ibuprofen",
							totalPills: 100,
							plannerUsage: 10,
							blisterSize: 10,
							blistersNeeded: 1,
							fullBlisters: 10,
							loosePills: 0,
							enough: true,
						},
					],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(mockSendMail).toHaveBeenCalledTimes(1);

			// Check that HTML contains out of stock warning
			const mailCall = mockSendMail.mock.calls[0][0];
			expect(mailCall.html).toContain("Empty");
			expect(mailCall.html).toContain("1 medication");

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should handle SMTP error gracefully", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
				args: [999999999],
			});

			mockSendMail.mockRejectedValueOnce(new Error("Connection refused"));

			const response = await app.inject({
				method: "POST",
				url: "/planner/send-email",
				payload: {
					email: "test@example.com",
					from: "2025-01-01",
					until: "2025-01-31",
					rows: [
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 30,
							plannerUsage: 10,
							blisterSize: 10,
							blistersNeeded: 1,
							fullBlisters: 3,
							loosePills: 0,
							enough: true,
						},
					],
				},
			});

			expect(response.statusCode).toBe(500);
			expect(response.json().error).toContain("Email:");
			expect(response.json().error).toContain("Connection refused");

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should use German locale when language is de", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			// User settings with German language
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'de')`,
				args: [999999999],
			});

			mockSendMail.mockResolvedValueOnce({ messageId: "123" });

			const response = await app.inject({
				method: "POST",
				url: "/planner/send-email",
				payload: {
					email: "test@example.com",
					from: "2025-01-15",
					until: "2025-02-15",
					language: "de",
					rows: [
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 30,
							plannerUsage: 10,
							blisterSize: 10,
							blistersNeeded: 1,
							fullBlisters: 3,
							loosePills: 0,
							enough: true,
						},
					],
				},
			});

			expect(response.statusCode).toBe(200);

			// German date format should be used
			const mailCall = mockSendMail.mock.calls[0][0];
			expect(mailCall.subject).toContain("Bestandsübersicht");

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should send push notification when shoutrrr is enabled", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
				args: [999999999],
			});

			mockSendShoutrrr.mockResolvedValueOnce({ success: true });

			const response = await app.inject({
				method: "POST",
				url: "/planner/send-email",
				payload: {
					email: "test@example.com",
					from: "2025-01-01",
					until: "2025-01-31",
					rows: [
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 30,
							plannerUsage: 10,
							blisterSize: 10,
							blistersNeeded: 1,
							fullBlisters: 3,
							loosePills: 0,
							enough: true,
						},
					],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, message: "Notification sent via push" });
			expect(mockSendShoutrrr).toHaveBeenCalledTimes(1);

			// Verify push message contains medication info
			const [_url, title, message] = mockSendShoutrrr.mock.calls[0];
			expect(title).toContain("Supply Overview");
			expect(message).toContain("Aspirin");
		});

		it("should send both email and push when both enabled", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 1, 1, 'ntfy://localhost/test', 'en')`,
				args: [999999999],
			});

			mockSendMail.mockResolvedValueOnce({ messageId: "123" });
			mockSendShoutrrr.mockResolvedValueOnce({ success: true });

			const response = await app.inject({
				method: "POST",
				url: "/planner/send-email",
				payload: {
					email: "test@example.com",
					from: "2025-01-01",
					until: "2025-01-31",
					rows: [
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 5,
							plannerUsage: 30,
							blisterSize: 10,
							blistersNeeded: 3,
							fullBlisters: 0,
							loosePills: 5,
							enough: false,
						},
					],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, message: "Notification sent via email and push" });
			expect(mockSendMail).toHaveBeenCalledTimes(1);
			expect(mockSendShoutrrr).toHaveBeenCalledTimes(1);

			// Verify push message contains out of stock info
			const [_url, _title, message] = mockSendShoutrrr.mock.calls[0];
			expect(message).toContain("Aspirin");
			expect(message).toContain("Empty");

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should send push with German translations", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'de')`,
				args: [999999999],
			});

			mockSendShoutrrr.mockResolvedValueOnce({ success: true });

			const response = await app.inject({
				method: "POST",
				url: "/planner/send-email",
				payload: {
					email: "test@example.com",
					from: "2025-01-01",
					until: "2025-01-31",
					rows: [
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 5,
							plannerUsage: 30,
							blisterSize: 10,
							blistersNeeded: 3,
							fullBlisters: 0,
							loosePills: 5,
							enough: false,
						},
					],
				},
			});

			expect(response.statusCode).toBe(200);

			// Check German translations in push
			const [_url, title] = mockSendShoutrrr.mock.calls[0];
			expect(title).toContain("Bestandsübersicht");
		});

		it("should handle push error gracefully", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
				args: [999999999],
			});

			mockSendShoutrrr.mockResolvedValueOnce({ success: false, error: "Connection failed" });

			const response = await app.inject({
				method: "POST",
				url: "/planner/send-email",
				payload: {
					email: "test@example.com",
					from: "2025-01-01",
					until: "2025-01-31",
					rows: [
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 30,
							plannerUsage: 10,
							blisterSize: 10,
							blistersNeeded: 1,
							fullBlisters: 3,
							loosePills: 0,
							enough: true,
						},
					],
				},
			});

			expect(response.statusCode).toBe(500);
			expect(response.json().error).toContain("Push:");
			expect(response.json().error).toContain("Connection failed");
		});
	});

	describe("POST /reminder/send-email", () => {
		it("should reject request with missing lowStock data", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [],
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "Missing low stock data" });
		});

		it("should reject request with no lowStock array", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "Missing low stock data" });
		});

		it("should return error when no notification channels configured", async () => {
			// User settings exist but email/shoutrrr disabled
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 0, 0, 'en')`,
				args: [999999999],
			});

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [{ name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" }],
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "No notification channels configured" });
		});

		it("should send email reminder when email is enabled", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			// Enable email in user settings
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
				args: [999999999],
			});

			mockSendMail.mockResolvedValueOnce({ messageId: "123" });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [{ name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" }],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, message: "Reminder sent via email" });
			expect(mockSendMail).toHaveBeenCalledTimes(1);

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should handle empty medications (medsLeft <= 0)", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
				args: [999999999],
			});

			mockSendMail.mockResolvedValueOnce({ messageId: "123" });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [
						{ name: "Aspirin", medsLeft: 0, daysLeft: 0, depletionDate: null },
						{ name: "Ibuprofen", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" },
					],
				},
			});

			expect(response.statusCode).toBe(200);

			// Check email contains empty warning
			const mailCall = mockSendMail.mock.calls[0][0];
			expect(mailCall.subject).toContain("Empty");
			expect(mailCall.html).toContain("empty");

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should handle mixed empty and low stock medications", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
				args: [999999999],
			});

			mockSendMail.mockResolvedValueOnce({ messageId: "123" });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [
						{ name: "Aspirin", medsLeft: 0, daysLeft: 0, depletionDate: null },
						{ name: "Ibuprofen", medsLeft: 10, daysLeft: 5, depletionDate: "2025-01-05" },
					],
				},
			});

			expect(response.statusCode).toBe(200);

			const mailCall = mockSendMail.mock.calls[0][0];
			expect(mailCall.subject).toContain("Empty");
			expect(mailCall.subject).toContain("Critical");

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should handle email error gracefully", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
				args: [999999999],
			});

			mockSendMail.mockRejectedValueOnce(new Error("SMTP error"));

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [{ name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" }],
				},
			});

			expect(response.statusCode).toBe(500);
			expect(response.json().error).toContain("Email:");

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should send push notification when shoutrrr is enabled", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
				args: [999999999],
			});

			mockSendShoutrrr.mockResolvedValueOnce({ success: true });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [{ name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" }],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, message: "Reminder sent via push" });
			expect(mockSendShoutrrr).toHaveBeenCalledTimes(1);
		});

		it("should send both email and push when both enabled", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 1, 1, 'ntfy://localhost/test', 'en')`,
				args: [999999999],
			});

			mockSendMail.mockResolvedValueOnce({ messageId: "123" });
			mockSendShoutrrr.mockResolvedValueOnce({ success: true });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [{ name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" }],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, message: "Reminder sent via email and push" });
			expect(mockSendMail).toHaveBeenCalledTimes(1);
			expect(mockSendShoutrrr).toHaveBeenCalledTimes(1);

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should handle push notification error gracefully", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
				args: [999999999],
			});

			mockSendShoutrrr.mockResolvedValueOnce({ success: false, error: "Connection failed" });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [{ name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" }],
				},
			});

			expect(response.statusCode).toBe(500);
			expect(response.json().error).toContain("Push:");
		});

		it("should handle push with empty meds using German translations", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'de')`,
				args: [999999999],
			});

			mockSendShoutrrr.mockResolvedValueOnce({ success: true });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [{ name: "Aspirin", medsLeft: 0, daysLeft: 0, depletionDate: null }],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(mockSendShoutrrr).toHaveBeenCalledTimes(1);

			// Check German translations are used
			const [title, _message] = mockSendShoutrrr.mock.calls[0].slice(1);
			expect(title).toContain("Leer");
		});

		it("should handle push exception gracefully", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
				args: [999999999],
			});

			mockSendShoutrrr.mockRejectedValueOnce(new Error("Network error"));

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [{ name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" }],
				},
			});

			expect(response.statusCode).toBe(500);
			expect(response.json().error).toContain("Push:");
			expect(response.json().error).toContain("Network error");
		});

		it("should differentiate critical and low stock in push notification", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
				args: [999999999],
			});

			mockSendShoutrrr.mockResolvedValueOnce({ success: true });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [
						{ name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03", isCritical: true },
						{ name: "Ibuprofen", medsLeft: 49, daysLeft: 24, depletionDate: "2025-01-24", isCritical: false },
					],
				},
			});

			expect(response.statusCode).toBe(200);

			const [_url, title, message] = mockSendShoutrrr.mock.calls[0];
			// Title should contain both Critical and Low labels
			expect(title).toContain("Critical");
			expect(title).toContain("Low");
			// Message should have separate sections
			expect(message).toContain("Running critically low");
			expect(message).toContain("Aspirin");
			expect(message).toContain("Running low");
			expect(message).toContain("Ibuprofen");
		});

		it("should differentiate critical and low stock in email", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
				args: [999999999],
			});

			mockSendMail.mockResolvedValueOnce({ messageId: "123" });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [
						{ name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03", isCritical: true },
						{ name: "Ibuprofen", medsLeft: 49, daysLeft: 24, depletionDate: "2025-01-24", isCritical: false },
					],
				},
			});

			expect(response.statusCode).toBe(200);

			const mailCall = mockSendMail.mock.calls[0][0];
			// Subject should contain both Critical and Low
			expect(mailCall.subject).toContain("Critical");
			expect(mailCall.subject).toContain("Low");
			// HTML should have separate alert boxes
			expect(mailCall.html).toContain("critically low");
			expect(mailCall.html).toContain("running low");

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should label all meds as critical when isCritical not provided", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
				args: [999999999],
			});

			mockSendShoutrrr.mockResolvedValueOnce({ success: true });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-email",
				payload: {
					email: "test@example.com",
					lowStock: [{ name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" }],
				},
			});

			expect(response.statusCode).toBe(200);

			const [_url, title, message] = mockSendShoutrrr.mock.calls[0];
			// Should be treated as critical (backwards compat)
			expect(title).toContain("Critical");
			expect(title).not.toContain("Low");
			expect(message).toContain("Running critically low");
		});
	});

	describe("POST /reminder/send-prescription", () => {
		it("should reject request with missing prescription data", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-prescription",
				payload: {
					email: "test@example.com",
					prescriptionLow: [],
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "Missing prescription reminder data" });
		});

		it("should return error when no notification channels configured", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 0, 0, 'en')`,
				args: [999999999],
			});

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-prescription",
				payload: {
					email: "test@example.com",
					prescriptionLow: [{ name: "Aspirin", remainingRefills: 0, threshold: 1, expiryDate: "2026-01-01" }],
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "No notification channels configured" });
		});

		it("should send prescription email reminder when email is enabled", async () => {
			process.env.SMTP_HOST = "smtp.test.com";
			process.env.SMTP_USER = "user@test.com";
			process.env.SMTP_PASS = "password";

			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
				args: [999999999],
			});

			mockSendMail.mockResolvedValueOnce({ messageId: "123" });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-prescription",
				payload: {
					email: "test@example.com",
					prescriptionLow: [
						{ name: "Aspirin", remainingRefills: 0, threshold: 1, expiryDate: "2026-01-01" },
						{ name: "Ibuprofen", remainingRefills: 1, threshold: 2, expiryDate: null },
					],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, message: "Prescription reminder sent via email" });
			expect(mockSendMail).toHaveBeenCalledTimes(1);
			expect(mockUpdateReminderSentTime).toHaveBeenCalledWith("prescription", "email");
			expect(mockUpdateUserReminderSentTime).toHaveBeenCalledWith(
				999999999,
				"prescription",
				"email",
				"Aspirin, Ibuprofen"
			);

			delete process.env.SMTP_HOST;
			delete process.env.SMTP_USER;
			delete process.env.SMTP_PASS;
		});

		it("should send prescription push reminder when shoutrrr is enabled", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
				args: [999999999],
			});

			mockSendShoutrrr.mockResolvedValueOnce({ success: true });

			const response = await app.inject({
				method: "POST",
				url: "/reminder/send-prescription",
				payload: {
					email: "test@example.com",
					prescriptionLow: [{ name: "Aspirin", remainingRefills: 1, threshold: 2, expiryDate: "2026-01-01" }],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, message: "Prescription reminder sent via push" });
			expect(mockSendShoutrrr).toHaveBeenCalledTimes(1);
			const [_url, title, message] = mockSendShoutrrr.mock.calls[0];
			expect(title).toContain("Renew Now");
			expect(message).toContain("Aspirin");
			expect(mockUpdateReminderSentTime).toHaveBeenCalledWith("prescription", "push");
			expect(mockUpdateUserReminderSentTime).toHaveBeenCalledWith(999999999, "prescription", "push", "Aspirin");
		});
	});
});
