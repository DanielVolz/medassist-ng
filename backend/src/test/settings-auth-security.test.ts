import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import sensible from "@fastify/sensible";
import { migrate } from "drizzle-orm/libsql/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlterMigrations } from "../db/db-utils.js";

const { testClient, testDb, mockedEnv, nodemailerSendMail } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);

	return {
		testClient: client,
		testDb: db,
		mockedEnv: {
			AUTH_ENABLED: true,
			REGISTRATION_ENABLED: true,
			FORM_LOGIN_ENABLED: true,
			OIDC_ENABLED: false,
			OIDC_PROVIDER_NAME: "SSO",
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			PORT: 3000,
			CORS_ORIGINS: "*",
			JWT_SECRET: "test-jwt-secret",
			REFRESH_SECRET: "test-refresh-secret",
			COOKIE_SECRET: "test-cookie-secret",
			ACCESS_TOKEN_TTL_MINUTES: 15,
			REFRESH_TOKEN_TTL_DAYS: 7,
			OPENAPI_DOCS_ENABLED: false,
		},
		nodemailerSendMail: vi.fn(),
	};
});

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

vi.mock("nodemailer", () => ({
	default: {
		createTransport: () => ({
			sendMail: nodemailerSendMail,
		}),
	},
}));

const { settingsRoutes } = await import("../routes/settings.js");
const { apiKeyRoutes } = await import("../routes/api-keys.js");
const { hashApiKeyToken } = await import("../plugins/auth.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

async function clearTables() {
	await testClient.execute("DELETE FROM api_keys");
	await testClient.execute("DELETE FROM refresh_tokens");
	await testClient.execute("DELETE FROM user_settings");
	await testClient.execute("DELETE FROM users");
}

async function createUser(username: string) {
	const result = await testClient.execute({
		sql: "INSERT INTO users (username, auth_provider, is_active) VALUES (?, 'local', 1) RETURNING id",
		args: [username],
	});

	return Number(result.rows[0].id);
}

function buildSessionCookie(app: FastifyInstance, userId: number, username: string) {
	const token = app.jwt.sign({ sub: userId, username });
	return `access_token=${token}`;
}

async function insertApiKey(options: {
	userId: number;
	token: string;
	scope?: "read" | "write";
	isActive?: boolean;
	expiresAt?: Date | null;
}) {
	const expiresAtValue = options.expiresAt ? Math.floor(options.expiresAt.getTime() / 1000) : null;

	const result = await testClient.execute({
		sql: `INSERT INTO api_keys (user_id, name, key_hash, token_prefix, scope, is_active, expires_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		args: [
			options.userId,
			"Seeded Key",
			hashApiKeyToken(options.token),
			`${options.token.slice(0, 12)}...`,
			options.scope ?? "write",
			options.isActive === false ? 0 : 1,
			expiresAtValue,
		],
	});

	return Number(result.rows[0].id);
}

describe("Settings and API key security contracts", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		await migrate(testDb, { migrationsFolder });
		await runAlterMigrations(testClient);

		app = Fastify({ logger: false });
		await app.register(sensible);
		await app.register(cookie, { secret: "test-cookie-secret" });
		await app.register(jwt, {
			secret: "test-jwt-secret",
			cookie: { cookieName: "access_token", signed: false },
		});
		await app.register(settingsRoutes);
		await app.register(apiKeyRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		testClient.close();
	});

	beforeEach(async () => {
		vi.clearAllMocks();
		await clearTables();
		delete process.env.SMTP_HOST;
		delete process.env.SMTP_USER;
		delete process.env.SMTP_TOKEN;
		delete process.env.SMTP_PASS;
		delete process.env.SMTP_FROM;
		delete process.env.SMTP_PORT;
		delete process.env.SMTP_SECURE;
	});

	it("rejects GET /settings without authentication when auth is enabled", async () => {
		const response = await app.inject({ method: "GET", url: "/settings" });

		expect(response.statusCode).toBe(401);
		expect(response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
	});

	it("returns settings defaults for an authenticated session cookie", async () => {
		const userId = await createUser("settings-session-user");
		const response = await app.inject({
			method: "GET",
			url: "/settings",
			headers: { cookie: buildSessionCookie(app, userId, "settings-session-user") },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual(
			expect.objectContaining({
				emailEnabled: false,
				language: "en",
				stockCalculationMode: "automatic",
			})
		);
	});

	it("allows GET /settings with a read-only API key", async () => {
		const userId = await createUser("settings-read-user");
		process.env.SMTP_HOST = "smtp.example.com";
		process.env.SMTP_PORT = "2525";

		const apiToken = "ma_read_only_valid_token_123456789";
		await insertApiKey({ userId, token: apiToken, scope: "read" });

		const response = await app.inject({
			method: "GET",
			url: "/settings",
			headers: { authorization: `Bearer ${apiToken}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual(
			expect.objectContaining({
				smtpHost: "smtp.example.com",
				smtpPort: 2525,
			})
		);
	});

	it("rejects PUT /settings with a read-only API key", async () => {
		const userId = await createUser("settings-read-mutation-user");
		const apiToken = "ma_read_only_mutation_token_123456789";
		await insertApiKey({ userId, token: apiToken, scope: "read" });

		const response = await app.inject({
			method: "PUT",
			url: "/settings",
			headers: { authorization: `Bearer ${apiToken}` },
			payload: {
				emailEnabled: false,
				notificationEmail: "",
				reminderDaysBefore: 7,
				repeatDailyReminders: false,
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
				shareStockStatus: true,
				upcomingTodayOnly: false,
				shareScheduleTodayOnly: false,
				swapDashboardMainSections: false,
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({ code: "API_KEY_SCOPE_FORBIDDEN" });
	});

	it("rejects invalid API key bearer tokens for GET /settings", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/settings",
			headers: { authorization: "Bearer definitely-not-a-medassist-key" },
		});

		expect(response.statusCode).toBe(401);
		expect(response.json()).toMatchObject({ code: "INVALID_API_KEY" });
	});

	it("rejects expired API keys for GET /settings", async () => {
		const userId = await createUser("settings-expired-key-user");
		const apiToken = "ma_expired_token_for_settings_123456789";
		await insertApiKey({
			userId,
			token: apiToken,
			scope: "read",
			expiresAt: new Date(Date.now() - 60_000),
		});

		const response = await app.inject({
			method: "GET",
			url: "/settings",
			headers: { authorization: `Bearer ${apiToken}` },
		});

		expect(response.statusCode).toBe(401);
		expect(response.json()).toMatchObject({ code: "API_KEY_EXPIRED" });
	});

	it("rotates API keys and does not leak raw tokens from the list endpoint", async () => {
		const userId = await createUser("api-key-session-user");
		const cookieHeader = buildSessionCookie(app, userId, "api-key-session-user");

		const firstCreate = await app.inject({
			method: "POST",
			url: "/auth/api-keys",
			headers: { cookie: cookieHeader },
			payload: { name: "Primary key", scope: "write", expiresInDays: 30 },
		});

		expect(firstCreate.statusCode).toBe(201);
		const firstBody = firstCreate.json();
		expect(firstBody.token).toMatch(/^ma_/);

		const secondCreate = await app.inject({
			method: "POST",
			url: "/auth/api-keys",
			headers: { cookie: cookieHeader },
			payload: { name: "Rotated key", scope: "write", expiresInDays: 30 },
		});

		expect(secondCreate.statusCode).toBe(201);
		const secondBody = secondCreate.json();

		const listResponse = await app.inject({
			method: "GET",
			url: "/auth/api-keys",
			headers: { cookie: cookieHeader },
		});

		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.body).not.toContain(firstBody.token);
		expect(listResponse.body).not.toContain(secondBody.token);
		expect(listResponse.body).not.toContain("keyHash");
		expect(listResponse.json().keys).toHaveLength(2);

		const dbState = await testClient.execute({
			sql: "SELECT name, is_active FROM api_keys WHERE user_id = ? ORDER BY id ASC",
			args: [userId],
		});
		expect(dbState.rows).toEqual([
			expect.objectContaining({ name: "Primary key", is_active: 0 }),
			expect.objectContaining({ name: "Rotated key", is_active: 1 }),
		]);
	});

	it("rejects API key rotation when authenticated with a read-only API key", async () => {
		const userId = await createUser("api-key-readonly-rotate-user");
		const readOnlyToken = "ma_readonly_rotation_denied_123456789";
		await insertApiKey({ userId, token: readOnlyToken, scope: "read" });

		const response = await app.inject({
			method: "POST",
			url: "/auth/api-keys",
			headers: { authorization: `Bearer ${readOnlyToken}` },
			payload: { name: "Blocked rotation", scope: "write", expiresInDays: 30 },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({ code: "API_KEY_SCOPE_FORBIDDEN" });
	});

	it("returns 404 when deleting an API key owned by a different user", async () => {
		const ownerUserId = await createUser("api-key-owner");
		const otherUserId = await createUser("api-key-other-user");
		const otherCookieHeader = buildSessionCookie(app, otherUserId, "api-key-other-user");

		const keyId = await insertApiKey({
			userId: ownerUserId,
			token: "ma_write_owner_token_123456789",
			scope: "write",
		});

		const response = await app.inject({
			method: "DELETE",
			url: `/auth/api-keys/${keyId}`,
			headers: { cookie: otherCookieHeader },
		});

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({ code: "API_KEY_NOT_FOUND" });
	});

	it("maps SMTP recipient rejection to HTTP 400 instead of a generic 500", async () => {
		const userId = await createUser("settings-email-recipient-user");
		process.env.SMTP_HOST = "smtp.example.com";
		process.env.SMTP_USER = "mailer@example.com";
		process.env.SMTP_PASS = "secret";
		nodemailerSendMail.mockResolvedValue({
			accepted: [],
			rejected: ["missing@example.com"],
			response: "550 5.1.1 recipient address rejected",
		});

		const response = await app.inject({
			method: "POST",
			url: "/settings/test-email",
			headers: { cookie: buildSessionCookie(app, userId, "settings-email-recipient-user") },
			payload: { email: "missing@example.com" },
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ code: "EMAIL_RECIPIENT_REJECTED" });
	});

	it("maps missing SMTP acceptance to HTTP 502 for test email", async () => {
		const userId = await createUser("settings-email-unconfirmed-user");
		process.env.SMTP_HOST = "smtp.example.com";
		process.env.SMTP_USER = "mailer@example.com";
		process.env.SMTP_PASS = "secret";
		nodemailerSendMail.mockResolvedValue({
			accepted: [],
			rejected: [],
			response: "250 queued without explicit acceptance",
		});

		const response = await app.inject({
			method: "POST",
			url: "/settings/test-email",
			headers: { cookie: buildSessionCookie(app, userId, "settings-email-unconfirmed-user") },
			payload: { email: "person@example.com" },
		});

		expect(response.statusCode).toBe(502);
		expect(response.json()).toMatchObject({ code: "SMTP_DELIVERY_UNCONFIRMED" });
	});
});
