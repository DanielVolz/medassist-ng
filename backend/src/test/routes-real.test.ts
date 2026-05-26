import { existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlterMigrations } from "../db/db-utils.js";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";

const { testClient, testDb, testDbPath, mockedEnv, nodemailerSendMail, fetchMock } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const { tmpdir } = require("node:os");
	const { join } = require("node:path");
	const dbPath = join(tmpdir(), `medassist-routes-real-${process.pid}-${Date.now()}.db`);
	const client = createClient({ url: `file:${dbPath}` });
	const db = drizzle(client);
	const env = {
		AUTH_ENABLED: false,
		OIDC_ENABLED: false,
		OIDC_PROVIDER_NAME: "SSO",
		NODE_ENV: "test",
		PUBLIC_APP_URL: "https://app.example.com",
		CORS_ORIGINS: "https://app.example.com",
	};
	return {
		testClient: client,
		testDb: db,
		testDbPath: dbPath,
		mockedEnv: env,
		nodemailerSendMail: vi.fn(),
		fetchMock: vi.fn(),
	};
});

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

vi.mock("../plugins/auth.js", () => ({
	requireAuth: async () => {},
	getAnonymousUserId: async () => 1,
	isReadOnlyApiKeyRequest: () => false,
}));

vi.mock("nodemailer", () => ({
	default: {
		createTransport: () => ({
			sendMail: nodemailerSendMail,
		}),
	},
}));

const { settingsRoutes, sendShoutrrrNotification, loadUserSettings, getAllUserSettings } = await import(
	"../routes/settings.js"
);
const { exportRoutes } = await import("../routes/export.js");
const { reportRoutes } = await import("../routes/report.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

async function clearTables() {
	await testClient.execute("DELETE FROM refill_history");
	await testClient.execute("DELETE FROM dose_tracking");
	await testClient.execute("DELETE FROM share_tokens");
	await testClient.execute("DELETE FROM user_settings");
	await testClient.execute("DELETE FROM medications");
	await testClient.execute("DELETE FROM users");
}

async function seedAnonymousUser() {
	await testClient.execute({
		sql: "INSERT INTO users (id, username, auth_provider, is_active) VALUES (?, ?, ?, 1)",
		args: [1, "anon", "anonymous"],
	});
}

async function seedMedication(name = "Aspirin") {
	const result = await testClient.execute({
		sql: `INSERT INTO medications (
      user_id, name, generic_name, taken_by_json, package_type,
      pack_count, blisters_per_pack, pills_per_blister, loose_tablets,
      usage_json, every_json, start_json, intakes_json,
      stock_adjustment, intake_reminders_enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		args: [
			1,
			name,
			"Acetylsalicylic acid",
			JSON.stringify(["Daniel"]),
			"blister",
			2,
			2,
			10,
			3,
			JSON.stringify([1]),
			JSON.stringify([1]),
			JSON.stringify(["2026-01-01T08:00:00.000Z"]),
			JSON.stringify([
				{ usage: 1, every: 1, start: "2026-01-01T08:00:00.000Z", takenBy: "Daniel", intakeRemindersEnabled: true },
			]),
			0,
			1,
		],
	});
	return result.rows[0].id as number;
}

describe("Real route coverage: settings/export/report", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		await migrate(testDb, { migrationsFolder });
		await runAlterMigrations(testClient);
		app = Fastify({ logger: false, ajv: documentationSchemaAjv });
		await app.register(settingsRoutes);
		await app.register(exportRoutes);
		await app.register(reportRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		testClient.close();
		if (existsSync(testDbPath)) {
			unlinkSync(testDbPath);
		}
	});

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.stubGlobal("fetch", fetchMock);
		await clearTables();
		await seedAnonymousUser();
		delete process.env.SMTP_HOST;
		delete process.env.SMTP_USER;
		delete process.env.SMTP_TOKEN;
		delete process.env.SMTP_PASS;
		delete process.env.SMTP_FROM;
		delete process.env.SMTP_PORT;
		delete process.env.SMTP_SECURE;
	});

	it("GET /settings creates defaults for anonymous user", async () => {
		const response = await app.inject({ method: "GET", url: "/settings" });
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.language).toBe("en");
		expect(body.upcomingTodayOnly).toBe(false);
		expect(body.shareScheduleTodayOnly).toBe(false);
	});

	it("GET /settings returns a non-empty serialized payload with SMTP fields", async () => {
		process.env.SMTP_HOST = "smtp.example.com";
		process.env.SMTP_PORT = "2525";
		process.env.SMTP_USER = "mailer@example.com";
		process.env.SMTP_FROM = "MedAssist <mailer@example.com>";
		process.env.SMTP_PASS = "secret";

		await app.inject({
			method: "PUT",
			url: "/settings",
			payload: {
				emailEnabled: true,
				notificationEmail: "person@example.com",
				reminderDaysBefore: 5,
				repeatDailyReminders: true,
				lowStockDays: 14,
				normalStockDays: 45,
				highStockDays: 90,
				shoutrrrEnabled: false,
				shoutrrrUrl: "",
				emailStockReminders: true,
				emailIntakeReminders: true,
				emailPrescriptionReminders: true,
				shoutrrrStockReminders: true,
				shoutrrrIntakeReminders: true,
				shoutrrrPrescriptionReminders: true,
				skipRemindersForTakenDoses: false,
				repeatRemindersEnabled: true,
				reminderRepeatIntervalMinutes: 20,
				maxNaggingReminders: 4,
				language: "en",
				stockCalculationMode: "manual",
				upcomingTodayOnly: true,
				shareScheduleTodayOnly: true,
				swapDashboardMainSections: true,
			},
		});

		const response = await app.inject({ method: "GET", url: "/settings" });

		expect(response.statusCode).toBe(200);
		expect(response.body).not.toBe("{}");

		const body = response.json();
		expect(body).toEqual(
			expect.objectContaining({
				emailEnabled: true,
				notificationEmail: "person@example.com",
				reminderDaysBefore: 5,
				repeatDailyReminders: true,
				repeatRemindersEnabled: true,
				reminderRepeatIntervalMinutes: 20,
				maxNaggingReminders: 4,
				stockCalculationMode: "manual",
				upcomingTodayOnly: true,
				shareScheduleTodayOnly: true,
				swapDashboardMainSections: true,
				smtpHost: "smtp.example.com",
				smtpPort: 2525,
				smtpUser: "mailer@example.com",
				smtpFrom: "MedAssist <mailer@example.com>",
				hasSmtpPassword: true,
			})
		);
	});

	it("PUT /settings disables repeatDailyReminders when no stock reminder channel exists", async () => {
		const response = await app.inject({
			method: "PUT",
			url: "/settings",
			payload: {
				emailEnabled: false,
				notificationEmail: "",
				reminderDaysBefore: 7,
				repeatDailyReminders: true,
				lowStockDays: 30,
				normalStockDays: 90,
				highStockDays: 180,
				shoutrrrEnabled: false,
				shoutrrrUrl: "",
				emailStockReminders: true,
				emailIntakeReminders: true,
				emailPrescriptionReminders: true,
				shoutrrrStockReminders: true,
				shoutrrrIntakeReminders: true,
				shoutrrrPrescriptionReminders: true,
				skipRemindersForTakenDoses: false,
				repeatRemindersEnabled: false,
				reminderRepeatIntervalMinutes: 30,
				maxNaggingReminders: 5,
				language: "en",
				stockCalculationMode: "automatic",
				upcomingTodayOnly: false,
				shareScheduleTodayOnly: false,
				swapDashboardMainSections: false,
			},
		});

		expect(response.statusCode).toBe(200);

		const stored = await testClient.execute({
			sql: "SELECT repeat_daily_reminders FROM user_settings WHERE user_id = 1",
		});
		expect(stored.rows[0].repeat_daily_reminders).toBe(0);
	});

	it("PUT /settings/language validates supported language", async () => {
		const response = await app.inject({
			method: "PUT",
			url: "/settings/language",
			payload: { language: "fr" },
		});
		expect(response.statusCode).toBe(400);
		expect(response.json().error).toMatch(/Invalid language|Bad Request/);
	});

	it("PUT /settings/language creates and updates the stored language", async () => {
		let response = await app.inject({
			method: "PUT",
			url: "/settings/language",
			payload: { language: "de" },
		});

		expect(response.statusCode).toBe(200);

		response = await app.inject({
			method: "PUT",
			url: "/settings/language",
			payload: { language: "en" },
		});

		expect(response.statusCode).toBe(200);

		const stored = await testClient.execute({
			sql: "SELECT language FROM user_settings WHERE user_id = 1",
		});
		expect(stored.rows[0].language).toBe("en");
	});

	it("POST /settings/test-email fails when SMTP is not configured", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/settings/test-email",
			payload: { email: "person@example.com" },
		});
		expect(response.statusCode).toBe(400);
		expect(response.json().error).toBe("SMTP not configured");
	});

	it("POST /settings/test-email sends email when SMTP is configured", async () => {
		process.env.SMTP_HOST = "smtp.example.com";
		process.env.SMTP_USER = "mailer@example.com";
		process.env.SMTP_TOKEN = "secret";
		nodemailerSendMail.mockResolvedValue({
			accepted: ["person@example.com"],
			rejected: [],
			response: "250 2.0.0 OK",
			messageId: "test-message-id",
		});

		const response = await app.inject({
			method: "POST",
			url: "/settings/test-email",
			payload: { email: "person@example.com" },
		});

		expect(response.statusCode).toBe(200);
		expect(nodemailerSendMail).toHaveBeenCalledTimes(1);
	});

	it("POST /settings/test-email maps generic transport failures to HTTP 500", async () => {
		process.env.SMTP_HOST = "smtp.example.com";
		process.env.SMTP_USER = "mailer@example.com";
		process.env.SMTP_PASS = "secret";
		nodemailerSendMail.mockRejectedValue(new Error("socket hang up"));

		const response = await app.inject({
			method: "POST",
			url: "/settings/test-email",
			payload: { email: "person@example.com" },
		});

		expect(response.statusCode).toBe(500);
		expect(response.json()).toMatchObject({ code: "TEST_EMAIL_FAILED" });
	});

	it("POST /settings/test-shoutrrr validates URL presence", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/settings/test-shoutrrr",
			payload: { url: "" },
		});
		expect(response.statusCode).toBe(400);
	});

	it("POST /settings/test-shoutrrr returns 500 when notification delivery fails", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/settings/test-shoutrrr",
			payload: { url: "ftp://invalid.example.com/topic" },
		});

		expect(response.statusCode).toBe(500);
		expect(response.json().error).toMatch(/Only HTTP\/HTTPS protocols are allowed|Unsupported URL format/);
	});

	it("POST /settings/test-shoutrrr returns 200 for a valid ntfy target", async () => {
		fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: "ntfy-test-message-id" }) });

		const response = await app.inject({
			method: "POST",
			url: "/settings/test-shoutrrr",
			payload: { url: "ntfy://ntfy.sh/medassist" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ success: true, message: "Test notification sent successfully" });
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [, requestInit] = fetchMock.mock.calls[0] ?? [];
		const headers = (requestInit?.headers ?? {}) as Record<string, string>;
		expect(headers["X-Sequence-ID"]).toEqual(expect.stringMatching(/^medassist-/));
		expect(JSON.parse(headers.Actions ?? "[]")).toEqual([
			{
				action: "http",
				label: "Take",
				url: expect.stringMatching(/^https:\/\/app\.example\.com\/api\/notification-actions\//),
				method: "POST",
				clear: true,
			},
			{
				action: "http",
				label: "Skip",
				url: expect.stringMatching(/^https:\/\/app\.example\.com\/api\/notification-actions\//),
				method: "POST",
				clear: true,
			},
			{
				action: "view",
				label: "View",
				url: "https://app.example.com/dashboard",
				clear: false,
			},
		]);

		const groups = await testClient.execute("SELECT COUNT(*) AS count FROM notification_action_groups");
		expect(Number(groups.rows[0].count)).toBe(1);

		const storedGroup = await testClient.execute(
			"SELECT ntfy_original_message_id FROM notification_action_groups LIMIT 1"
		);
		expect(storedGroup.rows).toEqual([expect.objectContaining({ ntfy_original_message_id: "ntfy-test-message-id" })]);

		const tokens = await testClient.execute("SELECT COUNT(*) AS count FROM notification_action_tokens");
		expect(Number(tokens.rows[0].count)).toBe(3);
	});

	it("sendShoutrrrNotification blocks localhost/private targets", async () => {
		const result = await sendShoutrrrNotification("http://127.0.0.1/hook", "test", "message");
		expect(result.success).toBe(false);
		expect(result.error).toContain("not allowed");
	});

	it("sendShoutrrrNotification blocks IPv6 localhost/private targets before fetch", async () => {
		for (const url of ["http://[::1]/hook", "http://[fd00::1]/hook", "http://[fe80::1]/hook"]) {
			const result = await sendShoutrrrNotification(url, "test", "message");
			expect(result.success).toBe(false);
			expect(result.error).toContain("not allowed");
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("sendShoutrrrNotification handles ntfy auth and safe URL reconstruction", async () => {
		fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: "ntfy-message-id" }) });

		const result = await sendShoutrrrNotification("ntfy://user:pass@ntfy.sh/mytopic", "Title ä", "Message");

		expect(result.success).toBe(true);
		expect(result.providerMessageId).toBe("ntfy-message-id");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://ntfy.sh/mytopic",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: expect.stringMatching(/^Basic /),
				}),
				method: "POST",
				redirect: "error",
			})
		);
	});

	it("sendShoutrrrNotification uses JSON payload for webhook URLs", async () => {
		fetchMock.mockResolvedValue({ ok: true });
		const result = await sendShoutrrrNotification("https://hooks.slack.com/services/a/b/c", "Title", "Body");
		expect(result.success).toBe(true);
		const call = fetchMock.mock.calls[0];
		expect(call[1].headers["Content-Type"]).toBe("application/json");
		expect(JSON.parse(call[1].body)).toMatchObject({ title: "Title", message: "Body" });
	});

	it("sendShoutrrrNotification returns HTTP response errors for ntfy-style endpoints", async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve("rate limited") });

		const result = await sendShoutrrrNotification("https://ntfy.sh/medassist", "Title", "Body");

		expect(result).toEqual({ success: false, error: "HTTP 429: rate limited" });
	});

	it("sendShoutrrrNotification rejects invalid Discord webhook identifiers", async () => {
		const result = await sendShoutrrrNotification("discord://bad-token@not-a-number", "Title", "Body");

		expect(result).toEqual({ success: false, error: "Invalid Discord webhook ID" });
	});

	it("sendShoutrrrNotification validates Pushover URL credentials", async () => {
		const result = await sendShoutrrrNotification("pushover://missing-token", "Title", "Body");

		expect(result).toEqual({ success: false, error: "Invalid Pushover URL format" });
	});

	it("sendShoutrrrNotification requires Telegram chats and validates tokens", async () => {
		let result = await sendShoutrrrNotification("telegram://123:abc@telegram", "Title", "Body");
		expect(result).toEqual({ success: false, error: "Telegram URL requires chats parameter" });

		result = await sendShoutrrrNotification("telegram://invalid@telegram?chats=123", "Title", "Body");
		expect(result).toEqual({ success: false, error: "Invalid Telegram token format" });
	});

	it("sendShoutrrrNotification converts Gotify URLs and supports disabletls", async () => {
		fetchMock.mockResolvedValue({ ok: true });

		const result = await sendShoutrrrNotification(
			"gotify://push.example.com/basepath/token123?disabletls=yes&priority=8",
			"Title",
			"Body"
		);

		expect(result).toEqual({ success: true });
		const [targetUrl, requestInit] = fetchMock.mock.calls[0];
		expect(targetUrl).toBe("http://push.example.com/basepath/message?token=token123");
		expect(requestInit.body).toBe("Body\n\n(priority=8)");
		expect(requestInit.headers).toMatchObject({ Tags: "pill" });
	});

	it("loadUserSettings creates defaults for users without settings", async () => {
		const settings = await loadUserSettings(1);

		expect(settings).toEqual(
			expect.objectContaining({
				userId: 1,
				emailEnabled: false,
				emailPrescriptionReminders: true,
				shoutrrrPrescriptionReminders: true,
				stockCalculationMode: "automatic",
			})
		);
	});

	it("loadUserSettings maps persisted settings", async () => {
		await testClient.execute({
			sql: `INSERT INTO user_settings (
				user_id, email_enabled, notification_email, email_stock_reminders, email_intake_reminders,
				email_prescription_reminders, shoutrrr_enabled, shoutrrr_url, shoutrrr_stock_reminders,
				shoutrrr_intake_reminders, shoutrrr_prescription_reminders, reminder_days_before,
				repeat_daily_reminders, low_stock_days, normal_stock_days, high_stock_days, language,
				stock_calculation_mode, share_stock_status, skip_reminders_for_taken_doses,
				repeat_reminders_enabled, reminder_repeat_interval_minutes, max_nagging_reminders,
				upcoming_today_only, share_schedule_today_only, swap_dashboard_main_sections
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				1,
				1,
				"person@example.com",
				1,
				1,
				1,
				0,
				null,
				1,
				1,
				1,
				4,
				0,
				12,
				30,
				90,
				"de",
				"manual",
				1,
				0,
				0,
				30,
				5,
				0,
				0,
				0,
			],
		});

		const settings = await loadUserSettings(1);

		expect(settings).toEqual(
			expect.objectContaining({
				notificationEmail: "person@example.com",
				skipRemindersForTakenDoses: false,
				repeatRemindersEnabled: false,
				reminderRepeatIntervalMinutes: 30,
				maxNaggingReminders: 5,
				stockCalculationMode: "manual",
				upcomingTodayOnly: false,
				shareScheduleTodayOnly: false,
				swapDashboardMainSections: false,
			})
		);
	});

	it("getAllUserSettings returns mapped entries for each persisted user", async () => {
		await testClient.execute({
			sql: "INSERT INTO users (id, username, auth_provider, is_active) VALUES (?, ?, ?, 1)",
			args: [2, "second-user", "local"],
		});
		await testClient.execute({
			sql: `INSERT INTO user_settings (
				user_id, email_enabled, notification_email, email_stock_reminders, email_intake_reminders,
				email_prescription_reminders, shoutrrr_enabled, shoutrrr_url, shoutrrr_stock_reminders,
				shoutrrr_intake_reminders, shoutrrr_prescription_reminders, reminder_days_before,
				repeat_daily_reminders, low_stock_days, normal_stock_days, high_stock_days, language,
				stock_calculation_mode, share_stock_status, upcoming_today_only, share_schedule_today_only,
				swap_dashboard_main_sections
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [1, 0, null, 1, 1, 1, 1, "ntfy://ntfy.sh/topic", 1, 1, 1, 7, 1, 30, 60, 120, "en", "manual", 1, 1, 0, 1],
		});
		await testClient.execute({
			sql: `INSERT INTO user_settings (
				user_id, email_enabled, notification_email, email_stock_reminders, email_intake_reminders,
				email_prescription_reminders, shoutrrr_enabled, shoutrrr_url, shoutrrr_stock_reminders,
				shoutrrr_intake_reminders, shoutrrr_prescription_reminders, reminder_days_before,
				repeat_daily_reminders, low_stock_days, normal_stock_days, high_stock_days, language,
				stock_calculation_mode, share_stock_status, upcoming_today_only, share_schedule_today_only,
				swap_dashboard_main_sections
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [2, 1, "second@example.com", 0, 1, 1, 0, null, 1, 1, 1, 10, 0, 20, 50, 100, "de", "automatic", 1, 0, 0, 0],
		});

		const allSettings = await getAllUserSettings();

		expect(allSettings).toHaveLength(2);
		expect(allSettings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ userId: 1, stockCalculationMode: "manual", upcomingTodayOnly: true }),
				expect.objectContaining({
					userId: 2,
					emailPrescriptionReminders: true,
					shoutrrrPrescriptionReminders: true,
					stockCalculationMode: "automatic",
				}),
			])
		);
	});

	it("POST /medications/report-data returns 403 for meds not owned by user", async () => {
		await seedMedication("Owned Med");
		const response = await app.inject({
			method: "POST",
			url: "/medications/report-data",
			payload: { medicationIds: [9999] },
		});
		expect(response.statusCode).toBe(403);
	});

	it("POST /medications/report-data aggregates doses and refills", async () => {
		const medId = await seedMedication("Report Med");
		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?)",
			args: [1, `${medId}-0-1700000000000-Daniel`, 1700000000, 0],
		});
		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?)",
			args: [1, `${medId}-0-1700000600000-Daniel`, 1700000600, 1],
		});
		await testClient.execute({
			sql: "INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date) VALUES (?, ?, ?, ?, ?, ?)",
			args: [medId, 1, 1, 2, 1, 1700001200],
		});

		const response = await app.inject({
			method: "POST",
			url: "/medications/report-data",
			payload: { medicationIds: [medId] },
		});
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body[medId].dosesTaken).toBe(1);
		expect(body[medId].dosesSkipped).toBe(1);
		expect(body[medId].refills).toHaveLength(1);
		expect(body[medId].refills[0]).toMatchObject({
			packsAdded: 1,
			loosePillsAdded: 2,
			usedPrescription: true,
		});
	});

	it("POST /medications/report-data filters dose counts by takenBy suffix when requested", async () => {
		const medId = await seedMedication("Report Filter Med");
		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?)",
			args: [1, `${medId}-0-1700000000000-Alice`, 1700000000, 0],
		});
		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?)",
			args: [1, `${medId}-0-1700000600000-alice`, 1700000600, 1],
		});
		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?)",
			args: [1, `${medId}-0-1700001200000-Bob`, 1700001200, 0],
		});

		const response = await app.inject({
			method: "POST",
			url: "/medications/report-data",
			payload: { medicationIds: [medId], takenByFilter: ["Alice"] },
		});
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body[medId].dosesTaken).toBe(1);
		expect(body[medId].dosesSkipped).toBe(1);
	});

	it("POST /medications/report-data preserves hyphenated takenBy suffixes when filtering", async () => {
		const medId = await seedMedication("Report Hyphenated Filter Med");
		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?)",
			args: [1, `${medId}-0-1700000000000-Mary-Jane`, 1700000000, 0],
		});
		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?)",
			args: [1, `${medId}-0-1700000600000-Jane`, 1700000600, 0],
		});

		const response = await app.inject({
			method: "POST",
			url: "/medications/report-data",
			payload: { medicationIds: [medId], takenByFilter: ["Mary-Jane"] },
		});
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body[medId].dosesTaken).toBe(1);
	});

	it("POST /medications/report-data filters doses by scheduled doseId timestamp and refills by the same date window", async () => {
		const medId = await seedMedication("Report Date Range Med");
		const windowStart = "2026-01-10T00:00:00.000Z";
		const windowEnd = "2026-01-20T00:00:00.000Z";

		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?)",
			args: [
				1,
				`${medId}-0-${Date.parse("2026-01-05T09:00:00.000Z")}-Daniel`,
				Math.floor(Date.parse("2026-01-12T09:00:00.000Z") / 1000),
				0,
			],
		});
		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?)",
			args: [
				1,
				`${medId}-0-${Date.parse("2026-01-15T09:00:00.000Z")}-Daniel`,
				Math.floor(Date.parse("2026-01-25T09:00:00.000Z") / 1000),
				0,
			],
		});
		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, ?)",
			args: [
				1,
				`${medId}-0-${Date.parse("2026-01-18T09:00:00.000Z")}-Daniel`,
				Math.floor(Date.parse("2026-01-18T09:30:00.000Z") / 1000),
				1,
			],
		});

		await testClient.execute({
			sql: "INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date) VALUES (?, ?, ?, ?, ?, ?)",
			args: [medId, 1, 1, 0, 0, Math.floor(Date.parse("2026-01-12T08:00:00.000Z") / 1000)],
		});
		await testClient.execute({
			sql: "INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date) VALUES (?, ?, ?, ?, ?, ?)",
			args: [medId, 1, 9, 0, 1, Math.floor(Date.parse("2026-01-22T08:00:00.000Z") / 1000)],
		});

		const response = await app.inject({
			method: "POST",
			url: "/medications/report-data",
			payload: { medicationIds: [medId], startDate: windowStart, endDate: windowEnd },
		});
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body[medId]).toMatchObject({
			dosesTaken: 1,
			dosesSkipped: 1,
		});
		expect(body[medId].refills).toHaveLength(1);
		expect(body[medId].refills[0]).toMatchObject({
			packsAdded: 1,
			usedPrescription: false,
		});
	});

	it("GET /export includes medications, settings, doseHistory and refillHistory", async () => {
		const medId = await seedMedication("Export Med");
		await testClient.execute({
			sql: "INSERT INTO dose_tracking (user_id, dose_id, taken_at, marked_by) VALUES (?, ?, ?, ?)",
			args: [1, `${medId}-0-1700000000000-Daniel`, 1700000000, "Daniel"],
		});
		await testClient.execute({
			sql: "INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date) VALUES (?, ?, ?, ?, ?, ?)",
			args: [medId, 1, 1, 3, 0, 1700000000],
		});
		await testClient.execute({
			sql: "INSERT INTO user_settings (user_id, email_enabled, notification_email, share_stock_status, language) VALUES (?, ?, ?, ?, ?)",
			args: [1, 1, "x@example.com", 1, "de"],
		});
		await testClient.execute({
			sql: "INSERT INTO share_tokens (user_id, token, taken_by, schedule_days) VALUES (?, ?, ?, ?)",
			args: [1, "abc123", "Daniel", 30],
		});

		const response = await app.inject({
			method: "GET",
			url: "/export?includeSensitive=true&includeImages=false",
		});
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.medications).toHaveLength(1);
		expect(body.doseHistory).toHaveLength(1);
		expect(body.refillHistory).toHaveLength(1);
		expect(body.refillHistory[0].quantityAdded).toBe(23);
		expect(body.settings.language).toBe("de");
		expect(body.settings.shareStockStatus).toBeUndefined();
		expect(body.shareLinks).toHaveLength(1);
	});

	it("POST /import validates payload and imports minimal valid structure", async () => {
		const invalid = await app.inject({
			method: "POST",
			url: "/import",
			payload: { foo: "bar" },
		});
		expect(invalid.statusCode).toBe(400);

		const validImport = {
			version: "1.1",
			exportedAt: new Date().toISOString(),
			includeSensitiveData: false,
			medications: [
				{
					_exportId: "med-1",
					name: "Imported Med",
					genericName: null,
					takenBy: ["Daniel"],
					inventory: {
						packCount: 1,
						blistersPerPack: 1,
						pillsPerBlister: 10,
						totalPills: null,
						looseTablets: 0,
						stockAdjustment: 0,
						packageType: "blister",
					},
					pillWeightMg: null,
					doseUnit: "mg",
					schedules: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00.000Z", remind: false, takenBy: "Daniel" }],
					medicationStartDate: "",
					expiryDate: null,
					notes: null,
					intakeRemindersEnabled: false,
					isObsolete: false,
					obsoleteAt: null,
					prescriptionEnabled: false,
					prescriptionAuthorizedRefills: null,
					prescriptionRemainingRefills: null,
					prescriptionLowRefillThreshold: 1,
					prescriptionExpiryDate: null,
					dismissedUntil: null,
					image: null,
					lastStockCorrectionAt: null,
				},
			],
			doseHistory: [],
			refillHistory: [
				{
					medicationRef: "med-1",
					packsAdded: 0,
					quantityAdded: 4,
					usedPrescription: false,
					refillDate: "2026-01-02T08:00:00.000Z",
				},
			],
			settings: {
				emailEnabled: false,
				notificationEmail: null,
				emailStockReminders: true,
				emailIntakeReminders: true,
				emailPrescriptionReminders: true,
				shoutrrrEnabled: false,
				shoutrrrUrl: null,
				shoutrrrStockReminders: true,
				shoutrrrIntakeReminders: true,
				shoutrrrPrescriptionReminders: true,
				reminderDaysBefore: 7,
				repeatDailyReminders: false,
				skipRemindersForTakenDoses: false,
				repeatRemindersEnabled: false,
				reminderRepeatIntervalMinutes: 30,
				maxNaggingReminders: 5,
				lowStockDays: 30,
				normalStockDays: 90,
				highStockDays: 180,
				expiryWarningDays: 30,
				language: "en",
				stockCalculationMode: "automatic",
				shareStockStatus: true,
			},
			shareLinks: [],
		};

		const valid = await app.inject({
			method: "POST",
			url: "/import",
			payload: validImport,
		});
		expect(valid.statusCode).toBe(200);
		expect(valid.json().imported.medications).toBe(1);
		expect(valid.json().imported.refillHistory).toBe(1);

		const rows = await testClient.execute({
			sql: "SELECT name FROM medications WHERE user_id = 1",
		});
		expect(rows.rows[0].name).toBe("Imported Med");

		const refillRows = await testClient.execute({
			sql: "SELECT packs_added, loose_pills_added FROM refill_history WHERE user_id = 1",
		});
		expect(refillRows.rows).toHaveLength(1);
		expect(refillRows.rows[0].packs_added).toBe(0);
		expect(refillRows.rows[0].loose_pills_added).toBe(4);

		const importedSettings = await testClient.execute({
			sql: "SELECT share_medication_overview, share_stock_status FROM user_settings WHERE user_id = 1",
		});
		expect(importedSettings.rows[0].share_medication_overview).toBe(0);
		expect(importedSettings.rows[0].share_stock_status).toBe(1);
	});
});
