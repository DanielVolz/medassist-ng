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

	return {
		testClient: client,
		testDb: drizzle(client),
		mockedEnv: Object.fromEntries([
			["AUTH_ENABLED", true],
			["REGISTRATION_ENABLED", true],
			["FORM_LOGIN_ENABLED", true],
			["OIDC_ENABLED", false],
			["OIDC_PROVIDER_NAME", "SSO"],
			["NODE_ENV", "test"],
			["LOG_LEVEL", "silent"],
			["PORT", 3000],
			["CORS_ORIGINS", "*"],
			["JWT_SECRET", "test-jwt-secret"],
			["REFRESH_SECRET", "test-refresh-secret"],
			["COOKIE_SECRET", "test-cookie-secret"],
			["ACCESS_TOKEN_TTL_MINUTES", 15],
			["REFRESH_TOKEN_TTL_DAYS", 7],
			["OPENAPI_DOCS_ENABLED", false],
		]),
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
	await testClient.execute("DELETE FROM intake_journal");
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
	const takenBy = options.takenBy ?? [];
	const intakeTakenBy = takenBy[0] ?? null;
	await testClient.execute({
		sql: `INSERT INTO medications (
			id, user_id, name, taken_by_json, medication_form, package_type,
			pack_count, blisters_per_pack, pills_per_blister, loose_tablets, stock_adjustment,
			usage_json, every_json, start_json, intakes_json, intake_reminders_enabled
		) VALUES (?, ?, 'Test Medication', ?, 'tablet', 'blister', ?, 1, 10, ?, 0, '[1]', '[1]', ?, ?, 0)`,
		args: [
			options.id,
			options.userId,
			JSON.stringify(takenBy),
			options.packCount ?? 1,
			options.looseTablets ?? 0,
			intakeStart,
			JSON.stringify([
				{
					usage: 1,
					every: 1,
					start: intakeStart,
					takenBy: intakeTakenBy,
					intakeRemindersEnabled: false,
				},
			]),
		],
	});
}

async function insertUserSettings(userId: number, stockCalculationMode: "automatic" | "manual" = "automatic") {
	await testClient.execute({
		sql: "INSERT INTO user_settings (user_id, stock_calculation_mode) VALUES (?, ?)",
		args: [userId, stockCalculationMode],
	});
}

async function _insertShareToken(
	userId: number,
	token: string,
	takenBy: string,
	allowJournalNotes = false,
	allowMarkTaken = true
) {
	await testClient.execute({
		sql: "INSERT INTO share_tokens (user_id, token, taken_by, schedule_days, allow_journal_notes, allow_mark_taken) VALUES (?, ?, ?, 30, ?, ?)",
		args: [userId, token, takenBy, allowJournalNotes ? 1 : 0, allowMarkTaken ? 1 : 0],
	});
}

function buildLocalDoseStart(hours = 8): string {
	const start = new Date();
	start.setHours(hours, 0, 0, 0);
	const year = start.getFullYear();
	const month = String(start.getMonth() + 1).padStart(2, "0");
	const day = String(start.getDate()).padStart(2, "0");
	const hour = String(start.getHours()).padStart(2, "0");

	return `${year}-${month}-${day}T${hour}:00:00.000`;
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

		it("keeps one row when the same dose is marked twice through the API", async () => {
			const doseId = "1-0-1735344000000";

			const firstResponse = await app.inject({
				method: "POST",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
				payload: { doseId },
			});
			const secondResponse = await app.inject({
				method: "POST",
				url: "/doses/taken",
				headers: { cookie: cookieHeader },
				payload: { doseId },
			});

			expect(firstResponse.statusCode).toBe(200);
			expect(firstResponse.json()).toEqual({ success: true });
			expect(secondResponse.statusCode).toBe(200);
			expect(secondResponse.json()).toEqual({ success: true, message: "Already marked" });

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

	describe("single-dose skip routes", () => {
		it("marks a single owner dose as skipped through the frontend route", async () => {
			const doseId = "1-0-1735344000000";

			const response = await app.inject({
				method: "POST",
				url: "/doses/skip",
				headers: { cookie: cookieHeader },
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			const result = await testClient.execute({
				sql: "SELECT dose_id, marked_by, dismissed FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
				args: [userId, doseId],
			});
			expect(result.rows).toEqual([expect.objectContaining({ dose_id: doseId, marked_by: null, dismissed: 1 })]);
		});

		it("undoes a skipped-only owner dose through the frontend route", async () => {
			const doseId = "1-0-1735344000000";
			await insertDose({ userId, doseId, dismissed: true, takenAt: null });

			const response = await app.inject({
				method: "DELETE",
				url: `/doses/skip/${encodeURIComponent(doseId)}`,
				headers: { cookie: cookieHeader },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			const result = await testClient.execute({
				sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
				args: [userId, doseId],
			});
			expect(Number(result.rows[0].count)).toBe(0);
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

	describe("shared single-dose skip routes", () => {
		it("marks and undoes a visible shared dose as skipped", async () => {
			const start = buildLocalDoseStart();
			await insertMedication({
				id: 6,
				userId,
				takenBy: ["Max"],
				start,
			});
			await _insertShareToken(userId, "aaaaaaaaaaaaaaaa", "Max", false);

			const doseId = `6-0-${new Date(start).getTime()}-Max`;

			const skipResponse = await app.inject({
				method: "POST",
				url: "/share/aaaaaaaaaaaaaaaa/doses/skip",
				payload: { doseId },
			});

			expect(skipResponse.statusCode).toBe(200);
			expect(skipResponse.json()).toEqual({ success: true });

			const skippedRows = await testClient.execute({
				sql: "SELECT dose_id, marked_by, dismissed FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
				args: [userId, doseId],
			});
			expect(skippedRows.rows).toEqual([expect.objectContaining({ dose_id: doseId, marked_by: null, dismissed: 1 })]);

			const undoResponse = await app.inject({
				method: "DELETE",
				url: `/share/aaaaaaaaaaaaaaaa/doses/skip/${encodeURIComponent(doseId)}`,
			});

			expect(undoResponse.statusCode).toBe(200);
			expect(undoResponse.json()).toEqual({ success: true });

			const remainingRows = await testClient.execute({
				sql: "SELECT COUNT(*) AS count FROM dose_tracking WHERE user_id = ? AND dose_id = ?",
				args: [userId, doseId],
			});
			expect(Number(remainingRows.rows[0].count)).toBe(0);
		});
	});

	describe("Shared journal notes", () => {
		it("rejects shared journal access when the share link does not allow notes", async () => {
			const start = buildLocalDoseStart();
			await insertMedication({
				id: 7,
				userId,
				takenBy: ["Max"],
				start,
			});
			await _insertShareToken(userId, "bbbbbbbbbbbbbbbb", "Max", false);

			const doseId = `7-0-${new Date(start).getTime()}-Max`;
			await insertDose({ userId, doseId, markedBy: "Max" });

			const response = await app.inject({
				method: "GET",
				url: `/share/bbbbbbbbbbbbbbbb/journal/event/${encodeURIComponent(doseId)}`,
			});

			expect(response.statusCode).toBe(403);
			expect(response.json()).toEqual({
				error: "Journal notes are not enabled for this share link",
				code: "NOT_ENABLED",
			});
		});

		it("supports shared journal note read and save, but not implicit or explicit delete", async () => {
			const start = buildLocalDoseStart();
			await insertMedication({
				id: 8,
				userId,
				takenBy: ["Max"],
				start,
			});
			await _insertShareToken(userId, "cccccccccccccccc", "Max", true);

			const doseId = `8-0-${new Date(start).getTime()}-Max`;
			await insertDose({ userId, doseId, markedBy: "Max" });

			const initialResponse = await app.inject({
				method: "GET",
				url: `/share/cccccccccccccccc/journal/event/${encodeURIComponent(doseId)}`,
			});

			expect(initialResponse.statusCode).toBe(200);
			expect(initialResponse.json().entry).toEqual(
				expect.objectContaining({
					doseId,
					markedBy: "Max",
					mood: null,
					note: null,
				})
			);

			const initialDosesResponse = await app.inject({
				method: "GET",
				url: "/share/cccccccccccccccc/doses",
			});

			expect(initialDosesResponse.statusCode).toBe(200);
			expect(initialDosesResponse.json().doses).toEqual([
				expect.objectContaining({
					doseId,
					hasJournalNote: false,
				}),
			]);

			const saveResponse = await app.inject({
				method: "PUT",
				url: `/share/cccccccccccccccc/journal/event/${encodeURIComponent(doseId)}`,
				payload: { note: "Shared note from Max", mood: "very_good" },
			});

			expect(saveResponse.statusCode).toBe(200);
			expect(saveResponse.json().entry).toEqual(
				expect.objectContaining({
					doseId,
					mood: "very_good",
					note: "Shared note from Max",
				})
			);

			const savedDosesResponse = await app.inject({
				method: "GET",
				url: "/share/cccccccccccccccc/doses",
			});

			expect(savedDosesResponse.statusCode).toBe(200);
			expect(savedDosesResponse.json().doses).toEqual([
				expect.objectContaining({
					doseId,
					hasJournalNote: true,
				}),
			]);

			const moodOnlySaveResponse = await app.inject({
				method: "PUT",
				url: `/share/cccccccccccccccc/journal/event/${encodeURIComponent(doseId)}`,
				payload: { note: "   ", mood: "bad" },
			});

			expect(moodOnlySaveResponse.statusCode).toBe(200);
			expect(moodOnlySaveResponse.json().entry).toEqual(
				expect.objectContaining({
					doseId,
					mood: "bad",
					note: "",
				})
			);

			const blankSaveResponse = await app.inject({
				method: "PUT",
				url: `/share/cccccccccccccccc/journal/event/${encodeURIComponent(doseId)}`,
				payload: { note: "   " },
			});

			expect(blankSaveResponse.statusCode).toBe(400);
			expect(blankSaveResponse.json()).toEqual({
				error: "Journal note cannot be empty",
				code: "EMPTY_NOTE",
			});

			const deleteResponse = await app.inject({
				method: "DELETE",
				url: `/share/cccccccccccccccc/journal/event/${encodeURIComponent(doseId)}`,
			});

			expect(deleteResponse.statusCode).toBe(403);
			expect(deleteResponse.json()).toEqual({
				error: "Shared links cannot delete journal notes",
				code: "DELETE_NOT_ALLOWED",
			});

			const journalRows = await testClient.execute({
				sql: "SELECT note, mood FROM intake_journal WHERE user_id = ? AND medication_id = ?",
				args: [userId, 8],
			});

			expect(journalRows.rows).toHaveLength(1);
			expect(journalRows.rows[0].note).toBe("");
			expect(journalRows.rows[0].mood).toBe("bad");
		});
	});
});
