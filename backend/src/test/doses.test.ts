import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import { migrate } from "drizzle-orm/libsql/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAlterMigrations } from "../db/db-utils.js";
import { jwtPlugin } from "../plugins/jwt.js";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";

const { testClient, testDb, mockedEnv } = vi.hoisted(() => {
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
	};
});

vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

const { doseRoutes } = await import("../routes/doses.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

async function clearTables() {
	await testClient.execute("DELETE FROM dose_tracking");
	await testClient.execute("DELETE FROM share_tokens");
	await testClient.execute("DELETE FROM api_keys");
	await testClient.execute("DELETE FROM refresh_tokens");
	await testClient.execute("DELETE FROM medications");
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

async function insertMedication(options: {
	id: number;
	userId: number;
	takenBy?: string[];
	packCount?: number;
	looseTablets?: number;
	start?: string;
}) {
	const intakeStart = options.start ?? "2025-01-01T08:00:00.000Z";
	await testClient.execute({
		sql: `INSERT INTO medications (
			id, user_id, name, taken_by_json, medication_form, package_type,
			pack_count, blisters_per_pack, pills_per_blister, loose_tablets, stock_adjustment,
			usage_json, every_json, start_json, intakes_json, intake_reminders_enabled
		) VALUES (?, ?, 'Test Medication', ?, 'tablet', 'blister', ?, 1, 10, ?, 0, '[1]', '[1]', ?, '[]', 0)`,
		args: [
			options.id,
			options.userId,
			JSON.stringify(options.takenBy ?? []),
			options.packCount ?? 1,
			options.looseTablets ?? 0,
			intakeStart,
			"[]",
		],
	});
}

async function insertUserSettings(userId: number, stockCalculationMode: "automatic" | "manual" = "automatic") {
	await testClient.execute({
		sql: "INSERT INTO user_settings (user_id, stock_calculation_mode) VALUES (?, ?)",
		args: [userId, stockCalculationMode],
	});
}

async function _insertShareToken(userId: number, token: string, takenBy: string) {
	await testClient.execute({
		sql: "INSERT INTO share_tokens (user_id, token, taken_by, schedule_days) VALUES (?, ?, ?, 30)",
		args: [userId, token, takenBy],
	});
}

async function buildSessionCookie(app: FastifyInstance, userId: number, username: string) {
	const token = await app.jwt.sign({ sub: userId, username });
	return `access_token=${token}`;
}

async function insertDose(options: {
	userId: number;
	doseId: string;
	markedBy?: string | null;
	dismissed?: boolean;
	takenAt?: number | null;
	takenSource?: "manual" | "automatic";
}) {
	await testClient.execute({
		sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by, dismissed, taken_at, taken_source)
		      VALUES (?, ?, ?, ?, ?, ?)`,
		args: [
			options.userId,
			options.doseId,
			options.markedBy ?? null,
			options.dismissed ? 1 : 0,
			options.takenAt === undefined ? Math.floor(Date.now() / 1000) : (options.takenAt ?? 0),
			options.takenSource ?? "manual",
		],
	});
}

describe("Dose Tracking API", () => {
	let app: FastifyInstance;
	let userId: number;
	let cookieHeader: string;

	beforeAll(async () => {
		await migrate(testDb, { migrationsFolder });
		await runAlterMigrations(testClient);

		app = Fastify({ logger: false, ajv: documentationSchemaAjv });
		await app.register(cookie, { secret: "test-cookie-secret" });
		await app.register(jwtPlugin, {
			secret: "test-jwt-secret",
			cookie: { cookieName: "access_token", signed: false },
		});
		await app.register(doseRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		testClient.close();
	});

	beforeEach(async () => {
		await clearTables();
		userId = await createUser("dose-test-user");
		cookieHeader = await buildSessionCookie(app, userId, "dose-test-user");
	});

	describe("POST /doses/taken", () => {
		it("marks a dose as taken", async () => {
			const doseId = "1-0-1735344000000";

			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			const result = await testClient.execute({
				sql: "SELECT dose_id, marked_by, taken_source FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
				args: [userId, doseId],
			});
			expect(result.rows).toEqual([
				expect.objectContaining({ dose_id: doseId, marked_by: null, taken_source: "manual" }),
			]);
		});

		it("returns an idempotent response when the dose is already marked", async () => {
			const doseId = "1-0-1735344000000";
			await insertDose({ userId, doseId });

			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, message: "Already marked" });

			const countResult = await testClient.execute({
				sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
				args: [userId, doseId],
			});
			expect(Number(countResult.rows[0].count)).toBe(1);
		});

		it("rejects requests without a doseId", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
				payload: {},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "Required" });
		});

		it("accepts dose IDs with a person suffix and special characters", async () => {
			const doseId = "5-0-1735344000000-Max Müller";

			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);

			const getResponse = await app.inject({
				method: "GET",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
			});

			expect(getResponse.statusCode).toBe(200);
			expect(getResponse.json().doses[0].doseId).toBe(doseId);
		});

		it("rejects taking a dose when the medication is out of stock", async () => {
			await insertMedication({ id: 5, userId, packCount: 0, looseTablets: 0 });
			await insertUserSettings(userId, "automatic");

			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
				payload: { doseId: "5-0-1735344000000" },
			});

			expect(response.statusCode).toBe(409);
			expect(response.json()).toEqual({ error: "Medication is out of stock", code: "OUT_OF_STOCK" });
		});

		it("allows taking a historical dose when stock existed at that occurrence", async () => {
			await insertMedication({
				id: 6,
				userId,
				packCount: 1,
				looseTablets: 0,
				start: "2025-01-01T08:00:00.000Z",
			});
			await insertUserSettings(userId, "automatic");

			const historicalDoseId = "6-0-1736064000000";
			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
				payload: { doseId: historicalDoseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });
		});
	});

	describe("GET /doses/taken", () => {
		it("returns an empty array when no doses were taken", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ doses: [] });
		});

		it("returns only the authenticated user's taken doses with metadata", async () => {
			const otherUserId = await createUser("dose-other-user");
			await insertDose({
				userId,
				doseId: "1-0-1735344000000",
				markedBy: "Daniel",
				takenSource: "automatic",
			});
			await insertDose({ userId, doseId: "1-0-1735430400000" });
			await insertDose({ userId: otherUserId, doseId: "9-0-1735516800000" });

			const response = await app.inject({
				method: "GET",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.doses).toHaveLength(2);
			expect(data.doses.map((dose: { doseId: string }) => dose.doseId).sort()).toEqual([
				"1-0-1735344000000",
				"1-0-1735430400000",
			]);
			expect(data.doses).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ markedBy: "Daniel", takenSource: "automatic" }),
					expect.objectContaining({ markedBy: null, takenSource: "manual" }),
				])
			);
		});
	});

	describe("DELETE /doses/taken/:doseId", () => {
		it("unmarks an existing dose", async () => {
			const doseId = "1-0-1735344000000";
			await insertDose({ userId, doseId });

			const response = await app.inject({
				method: "DELETE",
				url: `/doses/taken/${encodeURIComponent(doseId)}`,
				headers: { cookie: cookieHeader },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			const countResult = await testClient.execute({
				sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
				args: [userId, doseId],
			});
			expect(Number(countResult.rows[0].count)).toBe(0);
		});

		it("keeps the record when the dose is dismissed", async () => {
			const doseId = "1-0-1735344000000";
			await insertDose({ userId, doseId, dismissed: true });

			const response = await app.inject({
				method: "DELETE",
				url: `/doses/taken/${encodeURIComponent(doseId)}`,
				headers: { cookie: cookieHeader },
			});

			expect(response.statusCode).toBe(200);

			const result = await testClient.execute({
				sql: "SELECT dose_id, dismissed FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
				args: [userId, doseId],
			});
			expect(result.rows).toEqual([expect.objectContaining({ dose_id: doseId, dismissed: 1 })]);
		});

		it("still succeeds when the dose does not exist", async () => {
			const response = await app.inject({
				method: "DELETE",
				url: "/doses/taken/nonexistent-dose-id",
				headers: { cookie: cookieHeader },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });
		});
	});

	describe("POST /doses/dismiss", () => {
		it("dismisses multiple doses", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/doses/dismiss",
				headers: { cookie: cookieHeader },
				payload: { doseIds: ["1-0-1735344000000", "1-0-1735430400000"] },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, dismissedCount: 2 });

			const result = await testClient.execute({
				sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ? AND dismissed = 1",
				args: [userId],
			});
			expect(Number(result.rows[0].count)).toBe(2);
		});

		it("does not double-count already dismissed doses", async () => {
			const doseId = "1-0-1735344000000";
			await insertDose({ userId, doseId, dismissed: true });

			const response = await app.inject({
				method: "POST",
				url: "/doses/dismiss",
				headers: { cookie: cookieHeader },
				payload: { doseIds: [doseId] },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, dismissedCount: 0 });
		});

		it("converts a taken dose into a dismissed one", async () => {
			const doseId = "1-0-1735344000000";
			await insertDose({ userId, doseId, dismissed: false });

			const response = await app.inject({
				method: "POST",
				url: "/doses/dismiss",
				headers: { cookie: cookieHeader },
				payload: { doseIds: [doseId] },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, dismissedCount: 1 });

			const result = await testClient.execute({
				sql: "SELECT dismissed FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
				args: [userId, doseId],
			});
			expect(result.rows).toEqual([expect.objectContaining({ dismissed: 1 })]);
		});

		it("rejects missing or empty doseIds", async () => {
			const emptyResponse = await app.inject({
				method: "POST",
				url: "/doses/dismiss",
				headers: { cookie: cookieHeader },
				payload: { doseIds: [] },
			});

			expect(emptyResponse.statusCode).toBe(400);
			expect(emptyResponse.json()).toEqual({ error: "At least one doseId is required" });

			const missingResponse = await app.inject({
				method: "POST",
				url: "/doses/dismiss",
				headers: { cookie: cookieHeader },
				payload: {},
			});

			expect(missingResponse.statusCode).toBe(400);
			expect(missingResponse.json()).toEqual({ error: "Required" });
		});
	});

	describe("DELETE /doses/dismiss", () => {
		it("clears dismissed-only records and removes the dismissed flag from taken doses", async () => {
			await insertDose({ userId, doseId: "1-0-1735344000000", dismissed: true, takenAt: null });
			await insertDose({ userId, doseId: "1-0-1735430400000", dismissed: true, markedBy: "Daniel" });

			const response = await app.inject({
				method: "DELETE",
				url: "/doses/dismiss",
				headers: { cookie: cookieHeader },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true, clearedCount: 2 });

			const rows = await testClient.execute({
				sql: "SELECT dose_id, dismissed, marked_by FROM dose_tracking WHERE user_id = ? ORDER BY dose_id ASC",
				args: [userId],
			});
			expect(rows.rows).toEqual([
				expect.objectContaining({ dose_id: "1-0-1735430400000", dismissed: 0, marked_by: "Daniel" }),
			]);
		});
	});
});
