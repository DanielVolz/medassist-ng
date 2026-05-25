import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { migrate } from "drizzle-orm/libsql/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlterMigrations } from "../db/migration-utils.js";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";
import { tokenFingerprint } from "../utils/redaction.js";

const { testClient, testDb, logLines, mockedEnv } = vi.hoisted(() => {
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);

	return {
		testClient: client,
		testDb: db,
		logLines: [] as string[],
		mockedEnv: {
			AUTH_ENABLED: false,
			REGISTRATION_ENABLED: true,
			FORM_LOGIN_ENABLED: true,
			OIDC_ENABLED: false,
			OIDC_PROVIDER_NAME: "SSO",
			NODE_ENV: "test",
			LOG_LEVEL: "info",
			SENSITIVE_LOGGING_ENABLED: false,
			PORT: 3000,
			CORS_ORIGINS: "*",
			JWT_SECRET: "test-jwt-secret",
			REFRESH_SECRET: "test-refresh-secret",
			COOKIE_SECRET: "test-cookie-secret",
			ACCESS_TOKEN_TTL_MINUTES: 15,
			REFRESH_TOKEN_TTL_DAYS: 7,
			SHARE_TOKEN_TTL_DAYS: 90,
			OPENAPI_DOCS_ENABLED: false,
		},
	};
});

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));
vi.mock("../plugins/auth.js", () => ({
	requireAuth: async () => {},
	getAnonymousUserId: () => 1,
}));

const { doseRoutes } = await import("../routes/doses.js");
const { shareRoutes } = await import("../routes/share.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

async function clearTables() {
	await testClient.execute("DELETE FROM intake_journal");
	await testClient.execute("DELETE FROM dose_tracking");
	await testClient.execute("DELETE FROM share_tokens");
	await testClient.execute("DELETE FROM medications");
	await testClient.execute("DELETE FROM user_settings");
	await testClient.execute("DELETE FROM users");
}

async function createOwner() {
	await testClient.execute(
		"INSERT INTO users (id, username, auth_provider, is_active) VALUES (1, 'owner', 'local', 1)"
	);
}

async function insertMedication(takenBy = "Daniel"): Promise<number> {
	const start = buildLocalDoseStart();
	const result = await testClient.execute({
		sql: `INSERT INTO medications (
			user_id, name, taken_by_json, medication_form, package_type,
			pack_count, blisters_per_pack, pills_per_blister, loose_tablets, stock_adjustment,
			usage_json, every_json, start_json, intakes_json, intake_reminders_enabled
		) VALUES (1, 'Shared Med', ?, 'tablet', 'blister', 1, 1, 10, 10, 0, '[1]', '[1]', ?, ?, 0)
		RETURNING id`,
		args: [
			JSON.stringify([takenBy]),
			JSON.stringify([start]),
			JSON.stringify([{ usage: 1, every: 1, start, takenBy, intakeRemindersEnabled: false }]),
		],
	});

	return Number(result.rows[0].id);
}

async function insertShareToken(options: {
	token: string;
	takenBy?: string;
	expiresAt?: number | null;
	revokedAt?: number | null;
	allowMarkTaken?: boolean;
}) {
	await testClient.execute({
		sql: `INSERT INTO share_tokens (
			user_id, token, taken_by, schedule_days, expires_at, revoked_at, allow_mark_taken
		) VALUES (1, ?, ?, 30, ?, ?, ?)`,
		args: [
			options.token,
			options.takenBy ?? "Daniel",
			options.expiresAt ?? null,
			options.revokedAt ?? null,
			options.allowMarkTaken === false ? 0 : 1,
		],
	});
}

function buildLocalDoseStart(): string {
	const start = new Date();
	start.setHours(8, 0, 0, 0);
	const year = start.getFullYear();
	const month = String(start.getMonth() + 1).padStart(2, "0");
	const day = String(start.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}T08:00:00.000`;
}

function buildDoseId(medicationId: number, person = "Daniel"): string {
	return `${medicationId}-0-${new Date(buildLocalDoseStart()).getTime()}-${person}`;
}

describe("share link hardening", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		await migrate(testDb, { migrationsFolder });
		await runAlterMigrations(testClient);
		app = Fastify({
			logger: {
				level: "info",
				stream: {
					write(message: string) {
						logLines.push(message);
					},
				},
			},
			ajv: documentationSchemaAjv,
		});
		await app.register(sensible);
		await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
		await app.register(doseRoutes);
		await app.register(shareRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		testClient.close();
	});

	beforeEach(async () => {
		logLines.length = 0;
		await clearTables();
		await createOwner();
	});

	it("creates new expiring share tokens with 64 hex characters", async () => {
		await insertMedication();

		const response = await app.inject({
			method: "POST",
			url: "/share",
			payload: { takenBy: "Daniel", scheduleDays: 30 },
		});

		expect(response.statusCode, response.body).toBe(200);
		const body = response.json();
		expect(body.token).toMatch(/^[a-f0-9]{64}$/);
		expect(body.expiresAt).toBeTypeOf("string");
		expect(body.allowMarkTaken).toBe(false);
	});

	it("accepts existing 16-hex legacy tokens for reads", async () => {
		await insertMedication();
		await insertShareToken({ token: "abcdef0123456789" });

		const response = await app.inject({ method: "GET", url: "/share/abcdef0123456789" });

		expect(response.statusCode, response.body).toBe(200);
		expect(response.json()).toMatchObject({ takenBy: "Daniel", allowMarkTaken: true });
	});

	it("does not write plaintext share tokens to logs", async () => {
		await insertMedication();
		const token = "feedfacefeedface";

		await app.inject({ method: "GET", url: `/share/${token}` });

		const logs = logLines.join("\n");
		expect(logs).not.toContain(token);
		expect(logs).toContain(`tokenFingerprint=${tokenFingerprint(token)}`);
	});

	it("rejects expired tokens for read and write", async () => {
		const medId = await insertMedication();
		const token = "1111111111111111";
		await insertShareToken({ token, expiresAt: Math.floor(Date.now() / 1000) - 60 });

		const readResponse = await app.inject({ method: "GET", url: `/share/${token}` });
		const writeResponse = await app.inject({
			method: "POST",
			url: `/share/${token}/doses`,
			payload: { doseId: buildDoseId(medId) },
		});

		expect(readResponse.statusCode).toBe(410);
		expect(writeResponse.statusCode).not.toBe(200);
	});

	it("rejects revoked tokens for read and write", async () => {
		const medId = await insertMedication();
		const token = "2222222222222222";
		await insertShareToken({ token, revokedAt: Math.floor(Date.now() / 1000) });

		const readResponse = await app.inject({ method: "GET", url: `/share/${token}` });
		const writeResponse = await app.inject({
			method: "POST",
			url: `/share/${token}/doses`,
			payload: { doseId: buildDoseId(medId) },
		});

		expect(readResponse.statusCode).toBe(404);
		expect(writeResponse.statusCode).not.toBe(200);
	});

	it("permits read but rejects dose mutations when allowMarkTaken is false", async () => {
		const medId = await insertMedication();
		const token = "3333333333333333";
		const doseId = buildDoseId(medId);
		await insertShareToken({ token, allowMarkTaken: false });

		const readResponse = await app.inject({ method: "GET", url: `/share/${token}` });
		const markResponse = await app.inject({
			method: "POST",
			url: `/share/${token}/doses`,
			payload: { doseId },
		});
		const unmarkResponse = await app.inject({
			method: "DELETE",
			url: `/share/${token}/doses/${encodeURIComponent(doseId)}`,
		});

		expect(readResponse.statusCode, readResponse.body).toBe(200);
		expect(markResponse.statusCode).toBe(403);
		expect(unmarkResponse.statusCode).toBe(403);
	});

	it("rate limits public share dose mutations per IP and token", async () => {
		const medId = await insertMedication();
		const token = "4444444444444444";
		const doseId = buildDoseId(medId);
		await insertShareToken({ token, allowMarkTaken: true });

		let response = await app.inject({
			method: "POST",
			url: `/share/${token}/doses`,
			payload: { doseId },
		});
		for (let i = 0; i < 20; i++) {
			response = await app.inject({
				method: "POST",
				url: `/share/${token}/doses`,
				payload: { doseId },
			});
		}

		expect(response.statusCode, response.body).toBe(429);
		expect(response.json()).toMatchObject({ error: "rate_limited" });
	});
});
