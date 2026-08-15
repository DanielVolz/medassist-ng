import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenFingerprint } from "../utils/redaction.js";
import { buildTestApp, closeTestApp } from "./setup.js";

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

const { shareTokenRateLimitKey } = await import("../services/share-token-service.js");
const { doseRoutes } = await import("../routes/doses.js");
const { shareRoutes } = await import("../routes/share.js");

async function clearTables() {
	await testClient.execute("DELETE FROM intake_journal");
	await testClient.execute("DELETE FROM as_needed_intake_events");
	await testClient.execute("DELETE FROM dose_tracking");
	await testClient.execute("DELETE FROM share_tokens");
	await testClient.execute("DELETE FROM medications");
	await testClient.execute("DELETE FROM user_settings");
	await testClient.execute("DELETE FROM users");
}

async function insertActiveEffect(medicationId: number, effectMilli: number) {
	const anchor = await testClient.execute({
		sql: "INSERT INTO dose_tracking (user_id, dose_id) VALUES (1, ?) RETURNING id",
		args: [`as-needed:share-${medicationId}`],
	});
	await testClient.execute({
		sql: "INSERT INTO as_needed_intake_events (event_id, user_id, medication_id, dose_tracking_id, idempotency_key_hash, request_fingerprint, occurred_at, recorded_at, quantity_milli, quantity_unit, stock_effect_milli) VALUES ('share-event', 1, ?, ?, 'key', 'fingerprint', 1, 1, ?, 'pills', ?)",
		args: [medicationId, Number(anchor.rows[0].id), effectMilli, effectMilli],
	});
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

function buildFutureDoseId(medicationId: number, person = "Daniel"): string {
	const start = new Date(buildLocalDoseStart());
	start.setDate(start.getDate() + 1);
	return `${medicationId}-0-${start.getTime()}-${person}`;
}

async function insertDoseTracking(options: { doseId: string; markedBy?: string | null; dismissed?: boolean }) {
	await testClient.execute({
		sql: "INSERT INTO dose_tracking (user_id, dose_id, marked_by, dismissed, taken_source) VALUES (1, ?, ?, ?, 'manual')",
		args: [options.doseId, options.markedBy ?? null, options.dismissed ? 1 : 0],
	});
}

describe("share link hardening", () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		const context = await buildTestApp({
			client: testClient,
			fastifyOptions: {
				logger: {
					level: "info",
					stream: {
						write(message: string) {
							logLines.push(message);
						},
					},
				},
			},
		});
		app = context.app;
		await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
		await app.register(doseRoutes);
		await app.register(shareRoutes);
		await app.ready();
	});

	afterAll(async () => {
		await closeTestApp({ app, db: testDb, client: testClient });
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

	it("returns the owner's saved language for public shared schedules", async () => {
		await testClient.execute(
			"INSERT INTO user_settings (user_id, language, share_medication_overview) VALUES (1, 'de', 1)"
		);
		await insertMedication();
		await insertShareToken({ token: "abcdef0123456789" });

		const response = await app.inject({ method: "GET", url: "/share/abcdef0123456789" });
		const overviewResponse = await app.inject({ method: "GET", url: "/share/abcdef0123456789/overview" });

		expect(response.statusCode, response.body).toBe(200);
		expect(response.json()).toMatchObject({ takenBy: "Daniel", language: "de" });
		expect(overviewResponse.statusCode, overviewResponse.body).toBe(200);
		expect(overviewResponse.json()).toMatchObject({ takenBy: "Daniel", language: "de" });
	});

	it("scopes public share schedule and overview data to the selected person", async () => {
		const start = buildLocalDoseStart();
		await testClient.execute({
			sql: `INSERT INTO user_settings (user_id, share_medication_overview, low_stock_days)
			      VALUES (1, 1, 30)`,
		});
		await testClient.execute({
			sql: `INSERT INTO medications (
				user_id, name, taken_by_json, medication_form, package_type,
				pack_count, blisters_per_pack, pills_per_blister, loose_tablets, stock_adjustment,
				usage_json, every_json, start_json, intakes_json, intake_reminders_enabled
			) VALUES (1, 'Family Med', ?, 'tablet', 'blister', 1, 1, 10, 10, 0, '[1,2,3]', '[1,1,1]', ?, ?, 0)`,
			args: [
				JSON.stringify(["Alice", "Bob"]),
				JSON.stringify([start, start, start]),
				JSON.stringify([
					{ usage: 1, every: 1, start, takenBy: "Alice", intakeRemindersEnabled: false },
					{ usage: 2, every: 1, start, takenBy: "Bob", intakeRemindersEnabled: false },
					{ usage: 3, every: 1, start, takenBy: null, intakeRemindersEnabled: false },
				]),
			],
		});
		await insertShareToken({ token: "abcdef0123456789", takenBy: "Alice" });

		const scheduleResponse = await app.inject({ method: "GET", url: "/share/abcdef0123456789" });
		expect(scheduleResponse.statusCode, scheduleResponse.body).toBe(200);
		const schedule = scheduleResponse.json();
		expect(schedule.language).toBe("en");
		expect(JSON.stringify(schedule)).not.toContain("Bob");
		expect(schedule.medications).toHaveLength(1);
		expect(schedule.medications[0].takenBy).toEqual(["Alice"]);
		expect(schedule.medications[0].intakes.map((intake: { takenBy: string | null }) => intake.takenBy)).toEqual([
			"Alice",
			null,
		]);
		expect(schedule.medications[0].blisters.map((blister: { usage: number }) => blister.usage)).toEqual([1, 3]);
		expect(schedule.medicationOverview[0].daysLeft).toBe(2);

		const overviewResponse = await app.inject({ method: "GET", url: "/share/abcdef0123456789/overview" });
		expect(overviewResponse.statusCode, overviewResponse.body).toBe(200);
		const overview = overviewResponse.json();
		expect(overview.language).toBe("en");
		expect(JSON.stringify(overview)).not.toContain("Bob");
		expect(overview.medications[0].daysLeft).toBe(2);
	});

	it("reduces shared overview stock by the aggregate without disclosing the event or anchor", async () => {
		await testClient.execute("INSERT INTO user_settings (user_id, share_medication_overview) VALUES (1, 1)");
		const medicationId = await insertMedication();
		await insertActiveEffect(medicationId, 1500);
		await insertShareToken({ token: "abcdef0123456789" });
		const response = await app.inject({ method: "GET", url: "/share/abcdef0123456789/overview" });
		expect(response.statusCode, response.body).toBe(200);
		expect(response.json().medications[0].currentStock).toBe(8);
		expect(JSON.stringify(response.json())).not.toContain("share-event");
		expect(JSON.stringify(response.json())).not.toContain("as-needed:share");
	});

	it("does not write plaintext share tokens to logs", async () => {
		await insertMedication();
		const token = "feedfacefeedface";

		await app.inject({ method: "GET", url: `/share/${token}` });

		const logs = logLines.join("\n");
		expect(logs).not.toContain(token);
		expect(logs).toContain(`tokenFingerprint=${tokenFingerprint(token)}`);
	});

	it("rejects invalid token format without logging the raw token", async () => {
		const token = "not-a-valid-share-token";

		const response = await app.inject({ method: "GET", url: `/share/${token}` });

		expect(response.statusCode).toBe(404);
		const logs = logLines.join("\n");
		expect(logs).not.toContain(token);
		expect(logs).toContain(`tokenFingerprint=${tokenFingerprint(token)}`);
	});

	it("uses an IP-only public share rate limit key", () => {
		expect(shareTokenRateLimitKey({ ip: "203.0.113.10", params: { token: "aaaaaaaaaaaaaaaa" } })).toBe("203.0.113.10");
		expect(shareTokenRateLimitKey({ ip: "203.0.113.10", params: { token: "bbbbbbbbbbbbbbbb" } })).toBe("203.0.113.10");
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

	it("returns the owner's saved language for expired public shared schedules", async () => {
		await testClient.execute("INSERT INTO user_settings (user_id, language) VALUES (1, 'de')");
		await insertMedication();
		const token = "1212121212121212";
		await insertShareToken({ token, expiresAt: Math.floor(Date.now() / 1000) - 60 });

		const response = await app.inject({ method: "GET", url: `/share/${token}` });
		const overviewResponse = await app.inject({ method: "GET", url: `/share/${token}/overview` });

		expect(response.statusCode, response.body).toBe(410);
		expect(response.json()).toMatchObject({ takenBy: "Daniel", language: "de" });
		expect(overviewResponse.statusCode, overviewResponse.body).toBe(410);
		expect(overviewResponse.json()).toMatchObject({ language: "de" });
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

	it("rejects future shared take and skip mutations", async () => {
		const medId = await insertMedication();
		const token = "5555555555555555";
		const doseId = buildFutureDoseId(medId);
		await insertShareToken({ token, allowMarkTaken: true });

		const markResponse = await app.inject({
			method: "POST",
			url: `/share/${token}/doses`,
			payload: { doseId },
		});
		const skipResponse = await app.inject({
			method: "POST",
			url: `/share/${token}/doses/skip`,
			payload: { doseId },
		});

		expect(markResponse.statusCode).toBe(409);
		expect(markResponse.json()).toMatchObject({ code: "FUTURE_DOSE" });
		expect(skipResponse.statusCode).toBe(409);
		expect(skipResponse.json()).toMatchObject({ code: "FUTURE_DOSE" });
	});

	it("rejects shared changes to doses already marked as taken in the main app", async () => {
		const medId = await insertMedication();
		const token = "6666666666666666";
		const doseId = buildDoseId(medId);
		await insertShareToken({ token, allowMarkTaken: true });
		await insertDoseTracking({ doseId, markedBy: null });

		const markResponse = await app.inject({
			method: "POST",
			url: `/share/${token}/doses`,
			payload: { doseId },
		});
		const skipResponse = await app.inject({
			method: "POST",
			url: `/share/${token}/doses/skip`,
			payload: { doseId },
		});
		const unmarkResponse = await app.inject({
			method: "DELETE",
			url: `/share/${token}/doses/${encodeURIComponent(doseId)}`,
		});

		expect(markResponse.statusCode).toBe(409);
		expect(markResponse.json()).toMatchObject({ code: "MAIN_APP_TAKEN" });
		expect(skipResponse.statusCode).toBe(409);
		expect(skipResponse.json()).toMatchObject({ code: "MAIN_APP_TAKEN" });
		expect(unmarkResponse.statusCode).toBe(409);
		expect(unmarkResponse.json()).toMatchObject({ code: "MAIN_APP_TAKEN" });
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
