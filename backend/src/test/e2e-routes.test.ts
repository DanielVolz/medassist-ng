/**
 * E2E Tests using the real routes against in-memory SQLite.
 * These tests import the actual route handlers for real coverage.
 */

import cookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import type { Client } from "@libsql/client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jwtPlugin } from "../plugins/jwt.js";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";

// Use vi.hoisted to create the db BEFORE mocks are set up
const { testClient, testDb } = vi.hoisted(() => {
	// Dynamic import inside hoisted block
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);
	return { testClient: client, testDb: db };
});

// Mock modules using the hoisted db
vi.mock("../db/client.js", () => ({
	db: testDb,
	migrationsReady: Promise.resolve(),
}));

vi.mock("../plugins/env.js", () => ({
	env: {
		AUTH_ENABLED: false,
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		PORT: 3000,
		CORS_ORIGINS: "*",
		JWT_SECRET: "test-secret",
		REFRESH_SECRET: "test-refresh-secret",
		COOKIE_SECRET: "test-cookie-secret",
		ACCESS_TOKEN_TTL_MINUTES: 15,
		REFRESH_TOKEN_TTL_DAYS: 7,
	},
}));

// Mock auth plugin
vi.mock("../plugins/auth.js", () => ({
	requireAuth: async () => {},
	getAnonymousUserId: () => 999999999,
}));

// Now import routes AFTER mocking
const { doseRoutes } = await import("../routes/doses.js");
const { shareRoutes } = await import("../routes/share.js");
const { medicationRoutes } = await import("../routes/medications.js");
const { settingsRoutes } = await import("../routes/settings.js");
const { healthRoutes } = await import("../routes/health.js");
const { refillRoutes } = await import("../routes/refills.js");
const { reportRoutes } = await import("../routes/report.js");
const { exportRoutes } = await import("../routes/export.js");

// =============================================================================
// Test Setup
// =============================================================================

async function createSchema(client: Client) {
	const tableCreations = [
		`CREATE TABLE IF NOT EXISTS users (
      id integer PRIMARY KEY AUTOINCREMENT,
      username text NOT NULL UNIQUE,
      password_hash text,
      avatar_url text,
      auth_provider text NOT NULL DEFAULT 'local',
      oidc_subject text,
      is_active integer NOT NULL DEFAULT 1,
      last_login_at integer,
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
		timezone text NOT NULL DEFAULT '',
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
	share_medication_overview integer NOT NULL DEFAULT 0,
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
		`CREATE TABLE IF NOT EXISTS share_tokens (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL,
      token text NOT NULL UNIQUE,
      taken_by text NOT NULL,
      schedule_days integer NOT NULL DEFAULT 30,
      created_at integer NOT NULL DEFAULT (strftime('%s','now')),
      expires_at integer,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
		`CREATE TABLE IF NOT EXISTS dose_tracking (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL,
      dose_id text NOT NULL,
      taken_at integer NOT NULL DEFAULT (strftime('%s','now')),
      marked_by text,
		taken_source text NOT NULL DEFAULT 'manual',
      dismissed integer NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
		`CREATE TABLE IF NOT EXISTS refill_history (
      id integer PRIMARY KEY AUTOINCREMENT,
      medication_id integer NOT NULL,
      user_id integer NOT NULL,
      packs_added integer NOT NULL DEFAULT 0,
      loose_pills_added integer NOT NULL DEFAULT 0,
		used_prescription integer NOT NULL DEFAULT 0,
      refill_date integer NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
	];

	for (const sql of tableCreations) {
		await client.execute(sql);
	}
}

async function clearData(client: Client) {
	await client.execute("DELETE FROM refill_history");
	await client.execute("DELETE FROM dose_tracking");
	await client.execute("DELETE FROM share_tokens");
	await client.execute("DELETE FROM user_settings");
	await client.execute("DELETE FROM medications");
	await client.execute("DELETE FROM users");
	await client.execute("DELETE FROM sqlite_sequence");
}

async function _createUser(client: Client, username: string): Promise<number> {
	const result = await client.execute({
		sql: `INSERT INTO users (username, auth_provider) VALUES (?, 'local') RETURNING id`,
		args: [username],
	});
	return result.rows[0].id as number;
}

async function createMedication(client: Client, userId: number, name: string, takenBy: string[]): Promise<number> {
	const result = await client.execute({
		sql: `INSERT INTO medications (user_id, name, taken_by_json, usage_json, every_json, start_json)
          VALUES (?, ?, ?, '[1]', '[1]', '["2025-01-01T08:00:00.000Z"]') RETURNING id`,
		args: [userId, name, JSON.stringify(takenBy)],
	});
	return result.rows[0].id as number;
}

async function createShareToken(client: Client, userId: number, takenBy: string, token: string): Promise<void> {
	await client.execute({
		sql: `INSERT INTO share_tokens (user_id, token, taken_by, schedule_days) VALUES (?, ?, ?, 30)`,
		args: [userId, token, takenBy],
	});
}

// =============================================================================
// E2E Tests with Real Routes
// =============================================================================

describe("E2E Tests with Real Routes", () => {
	let app: FastifyInstance;
	let userId: number;

	beforeAll(async () => {
		// Create schema
		await createSchema(testClient);

		// Build app with real routes
		app = Fastify({ logger: false, ajv: documentationSchemaAjv });

		await app.register(sensible);
		await app.register(cookie, { secret: "test-cookie-secret" });
		await app.register(jwtPlugin, {
			secret: "test-jwt-secret",
			cookie: { cookieName: "access_token", signed: false },
		});
		await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });

		app.decorate("config", {
			accessSecret: "test-jwt-secret",
			refreshSecret: "test-refresh-secret",
			accessTtl: 15,
			refreshTtl: 7,
			cookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/" },
			refreshCookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/" },
		});

		// Register REAL routes
		await app.register(doseRoutes);
		await app.register(shareRoutes);
		await app.register(medicationRoutes);
		await app.register(settingsRoutes);
		await app.register(healthRoutes);
		await app.register(refillRoutes);
		await app.register(reportRoutes);
		await app.register(exportRoutes);

		await app.ready();
	});

	// ---------------------------------------------------------------------------
	// Report Routes
	// ---------------------------------------------------------------------------

	describe("Real /medications/report-data route", () => {
		it("should return 400 for invalid payload", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications/report-data",
				payload: { medicationIds: [] },
			});

			expect(response.statusCode).toBe(400);
		});

		it("should return 403 when requested medication is not owned by user", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications/report-data",
				payload: { medicationIds: [999999] },
			});

			expect(response.statusCode).toBe(403);
			expect(response.json().error).toBe("Access denied to medication");
		});

		it("should aggregate taken/skipped doses and refill history", async () => {
			const medId = await createMedication(testClient, userId, "Report Med", ["Daniel"]);

			// One taken dose and one skipped dose for the same medication
			await testClient.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed)
				      VALUES (?, ?, ?, 0)`,
				args: [userId, `${medId}-0-1735344000000`, 1735344000],
			});
			await testClient.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed)
				      VALUES (?, ?, ?, 1)`,
				args: [userId, `${medId}-0-1735430400000-Daniel`, 1735430400],
			});

			await testClient.execute({
				sql: `INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date)
				      VALUES (?, ?, ?, ?, ?, ?)`,
				args: [medId, userId, 2, 5, 1, 1735516800],
			});

			const response = await app.inject({
				method: "POST",
				url: "/medications/report-data",
				payload: { medicationIds: [medId] },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[medId].dosesTaken).toBe(1);
			expect(data[medId].dosesSkipped).toBe(1);
			expect(data[medId].firstDoseAt).toBe(new Date(1735344000 * 1000).toISOString());
			expect(data[medId].lastDoseAt).toBe(new Date(1735344000 * 1000).toISOString());
			expect(data[medId].refills).toHaveLength(1);
			expect(data[medId].refills[0]).toMatchObject({
				packsAdded: 2,
				loosePillsAdded: 5,
				quantityAdded: 7,
				usedPrescription: true,
			});
		});

		it("should not include refill history entries from another user for the same medication", async () => {
			const medId = await createMedication(testClient, userId, "Report Isolation Med", ["Daniel"]);
			const otherUserId = await _createUser(testClient, "report-isolation-other-user");

			await testClient.execute({
				sql: `INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date)
				      VALUES (?, ?, ?, ?, ?, ?)`,
				args: [medId, userId, 1, 0, 0, 1735603200],
			});
			await testClient.execute({
				sql: `INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date)
				      VALUES (?, ?, ?, ?, ?, ?)`,
				args: [medId, otherUserId, 9, 99, 1, 1735689600],
			});

			const response = await app.inject({
				method: "POST",
				url: "/medications/report-data",
				payload: { medicationIds: [medId] },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[medId].refills).toHaveLength(1);
			expect(data[medId].refills[0]).toMatchObject({
				packsAdded: 1,
				loosePillsAdded: 0,
				quantityAdded: 1,
				usedPrescription: false,
			});
		});
	});

	afterAll(async () => {
		await app.close();
		testClient.close();
	});

	beforeEach(async () => {
		await clearData(testClient);
		// Create anonymous user with fixed ID for auth-disabled mode
		await testClient.execute(
			"INSERT INTO users (id, username, auth_provider) VALUES (999999999, '__anonymous__', 'anonymous')"
		);
		userId = 999999999;
	});

	// ---------------------------------------------------------------------------
	// Real Dose Routes Tests
	// ---------------------------------------------------------------------------

	describe("Real /doses/taken routes", () => {
		it("should mark a dose using real route", async () => {
			const doseId = "1-0-1735344000000";

			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify in database
			const result = await testClient.execute({
				sql: `SELECT dose_id FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
				args: [userId, doseId],
			});
			expect(result.rows.length).toBe(1);
		});

		it("should get taken doses using real route", async () => {
			// Insert dose directly
			await testClient.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id) VALUES (?, ?)`,
				args: [userId, "1-0-1735344000000"],
			});

			const response = await app.inject({
				method: "GET",
				url: "/doses/taken",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.doses).toHaveLength(1);
			expect(data.doses[0].doseId).toBe("1-0-1735344000000");
		});

		it("should delete dose using real route", async () => {
			const doseId = "1-0-1735344000000";

			// Insert first
			await testClient.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id) VALUES (?, ?)`,
				args: [userId, doseId],
			});

			const response = await app.inject({
				method: "DELETE",
				url: `/doses/taken/${encodeURIComponent(doseId)}`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify deleted
			const result = await testClient.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows[0].count).toBe(0);
		});
	});

	// ---------------------------------------------------------------------------
	// Real Share Routes Tests
	// ---------------------------------------------------------------------------

	describe("Real /share routes", () => {
		it("should create share token using real route", async () => {
			// Create medication with takenBy
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);

			const response = await app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Daniel", scheduleDays: 30 },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.token).toBeDefined();
			expect(data.shareUrl).toContain("/share/");
		});

		it("should get shared schedule using real route", async () => {
			// Create medication
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);

			// Create share token
			const token = "test_share_token_123";
			await createShareToken(testClient, userId, "Daniel", token);

			const response = await app.inject({
				method: "GET",
				url: `/share/${token}`,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.takenBy).toBe("Daniel");
			expect(data.medications).toHaveLength(1);
			expect(data.medications[0].name).toBe("Aspirin");
		});

		it("should mark dose via share link using real route", async () => {
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);

			const token = "test_share_token_456";
			await createShareToken(testClient, userId, "Daniel", token);

			const doseId = "1-0-1735344000000";
			const response = await app.inject({
				method: "POST",
				url: `/share/${token}/doses`,
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify markedBy is set
			const result = await testClient.execute({
				sql: `SELECT marked_by FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows[0].marked_by).toBe("Daniel");
		});

		it("should return 404 for invalid share token", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/share/invalid_token",
			});

			expect(response.statusCode).toBe(404);
		});

		it("should return shared medication overview for a valid token", async () => {
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);
			await testClient.execute({
				sql: `INSERT INTO medications (
					user_id, name, taken_by_json, package_type, pack_count, blisters_per_pack, pills_per_blister,
					package_amount_value, package_amount_unit, total_pills, loose_tablets, medication_form,
					usage_json, every_json, start_json
				) VALUES (?, ?, ?, 'tube', 2, 1, 1, 40, 'g', 80, 80, 'topical', '[1]', '[1]', '["2025-01-01T08:00:00.000Z"]')`,
				args: [userId, "Hydrogel", JSON.stringify(["Daniel"])],
			});
			const token = "abcdef0123456789";
			await createShareToken(testClient, userId, "Daniel", token);

			const response = await app.inject({
				method: "GET",
				url: `/share/${token}/overview`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.headers["cache-control"]).toBe("no-store");

			const data = response.json();
			expect(data.takenBy).toBe("Daniel");
			expect(data.sharedBy).toBe("__anonymous__");
			expect(Array.isArray(data.medications)).toBe(true);
			expect(data.medications).toHaveLength(2);
			expect(data.medications[0].name).toBe("Aspirin");
			expect(data.medications[0].currentStock).toBeTypeOf("number");
			const hydrogel = data.medications.find((med: { name: string }) => med.name === "Hydrogel");
			expect(hydrogel).toMatchObject({
				packageType: "tube",
				packCount: 2,
				packageAmountValue: 40,
				packageAmountUnit: "g",
				totalPills: 80,
			});
		});

		it("should return 404 for unknown overview token", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/share/abcdef0123456789/overview",
			});

			expect(response.statusCode).toBe(404);
			expect(response.json()).toEqual({ error: "not_found" });
		});

		it("should return 410 for expired overview token", async () => {
			const token = "fedcba9876543210";
			await testClient.execute({
				sql: "INSERT INTO share_tokens (user_id, token, taken_by, schedule_days, expires_at) VALUES (?, ?, ?, 30, ?)",
				args: [userId, token, "Daniel", Math.floor(Date.now() / 1000) - 60],
			});

			const response = await app.inject({
				method: "GET",
				url: `/share/${token}/overview`,
			});

			expect(response.statusCode).toBe(410);
			const data = response.json();
			expect(data.error).toBe("expired");
			expect(data.expiredAt).toBeTypeOf("string");
		});

		it("should always show stock fields in overview regardless of share_stock_status setting", async () => {
			await createMedication(testClient, userId, "Ibuprofen", ["Daniel"]);
			const token = "0123456789abcdef";
			await createShareToken(testClient, userId, "Daniel", token);

			await testClient.execute({
				sql: "INSERT INTO user_settings (user_id, share_stock_status, low_stock_days) VALUES (?, 0, 30)",
				args: [userId],
			});

			const response = await app.inject({
				method: "GET",
				url: `/share/${token}/overview`,
			});

			expect(response.statusCode).toBe(200);
			const [medication] = response.json().medications;
			expect(medication.currentStock).toBeTypeOf("number");
			expect(medication.capacity).toBeTypeOf("number");
		});
	});

	// ---------------------------------------------------------------------------
	// Real Medication Routes Tests
	// ---------------------------------------------------------------------------

	describe("Real /medications routes", () => {
		const validMedication = {
			name: "Aspirin",
			genericName: "Acetylsalicylic acid",
			takenBy: ["Daniel"],
			packCount: 2,
			blistersPerPack: 3,
			pillsPerBlister: 10,
			looseTablets: 5,
			pillWeightMg: 500,
			expiryDate: "2026-12-31",
			notes: "Take with food",
			intakeRemindersEnabled: true,
			blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
		};

		it("should create medication using real route", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: validMedication,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.id).toBeDefined();
			expect(data.name).toBe("Aspirin");
			expect(data.genericName).toBe("Acetylsalicylic acid");
			expect(data.takenBy).toEqual(["Daniel"]);
			expect(data.packCount).toBe(2);
			expect(data.blistersPerPack).toBe(3);
			expect(data.pillsPerBlister).toBe(10);
			expect(data.looseTablets).toBe(5);
			expect(data.pillWeightMg).toBe(500);
			expect(data.blisters).toHaveLength(1);
		});

		it("should list medications using real route", async () => {
			// Create medication first
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: validMedication,
			});

			const response = await app.inject({
				method: "GET",
				url: "/medications",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data).toHaveLength(1);
			expect(data[0].name).toBe("Aspirin");
		});

		it("should update medication using real route", async () => {
			// Create medication first
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: validMedication,
			});
			const medId = createResponse.json().id;

			// Update it
			const updatedMed = {
				...validMedication,
				name: "Aspirin Extra",
				looseTablets: 10,
			};

			const response = await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: updatedMed,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.name).toBe("Aspirin Extra");
			expect(data.looseTablets).toBe(10);
		});

		it("should delete medication using real route", async () => {
			// Create medication first
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: validMedication,
			});
			const medId = createResponse.json().id;

			// Delete it
			const response = await app.inject({
				method: "DELETE",
				url: `/medications/${medId}`,
			});

			expect(response.statusCode).toBe(204);

			// Verify deleted
			const listResponse = await app.inject({
				method: "GET",
				url: "/medications",
			});
			expect(listResponse.json()).toHaveLength(0);
		});

		it("should return 400 for invalid medication data", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: { name: "" }, // Invalid - empty name and no blisters
			});

			expect(response.statusCode).toBe(400);
		});

		it("should return 404 for non-existent medication", async () => {
			const response = await app.inject({
				method: "PUT",
				url: "/medications/99999",
				payload: validMedication,
			});

			expect(response.statusCode).toBe(404);
		});

		it("should create medication with multiple intake schedules", async () => {
			const multiBlisterMed = {
				...validMedication,
				blisters: [
					{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" },
					{ usage: 0.5, every: 1, start: "2025-01-01T20:00:00.000Z" },
				],
			};

			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: multiBlisterMed,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.blisters).toHaveLength(2);
			expect(data.blisters[0].usage).toBe(1);
			expect(data.blisters[1].usage).toBe(0.5);
		});
	});

	// ---------------------------------------------------------------------------
	// Real Settings Routes Tests
	// ---------------------------------------------------------------------------

	describe("Real /settings routes", () => {
		it("should get default settings using real route", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/settings",
			});

			if (response.statusCode !== 200) {
				console.error("GET /settings error:", response.body);
			}
			expect(response.statusCode).toBe(200);
			const data = response.json();
			// Check default values
			expect(data.emailEnabled).toBe(false);
			expect(data.lowStockDays).toBe(30);
			expect(data.normalStockDays).toBe(90);
			expect(data.highStockDays).toBe(180);
			expect(data.language).toBe("en");
			expect(data.stockCalculationMode).toBe("automatic");
		});

		it("should update settings using real route", async () => {
			const newSettings = {
				emailEnabled: true,
				notificationEmail: "test@example.com",
				reminderDaysBefore: 14,
				repeatDailyReminders: false,
				lowStockDays: 14,
				normalStockDays: 60,
				highStockDays: 120,
				shoutrrrEnabled: false,
				shoutrrrUrl: "",
				emailStockReminders: true,
				emailIntakeReminders: true,
				shoutrrrStockReminders: true,
				shoutrrrIntakeReminders: true,
				language: "de",
				stockCalculationMode: "manual",
			};

			const response = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: newSettings,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify settings were saved
			const getResponse = await app.inject({
				method: "GET",
				url: "/settings",
			});

			const data = getResponse.json();
			expect(data.emailEnabled).toBe(true);
			expect(data.notificationEmail).toBe("test@example.com");
			expect(data.lowStockDays).toBe(14);
			expect(data.language).toBe("de");
			expect(data.stockCalculationMode).toBe("manual");
		});

		it("should update existing settings using real route", async () => {
			// First update
			await app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					emailEnabled: true,
					notificationEmail: "first@example.com",
					reminderDaysBefore: 7,
					repeatDailyReminders: false,
					lowStockDays: 30,
					normalStockDays: 90,
					highStockDays: 180,
					shoutrrrEnabled: false,
					shoutrrrUrl: "",
					emailStockReminders: true,
					emailIntakeReminders: true,
					shoutrrrStockReminders: true,
					shoutrrrIntakeReminders: true,
					language: "en",
					stockCalculationMode: "automatic",
				},
			});

			// Second update
			const response = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					emailEnabled: false,
					notificationEmail: "second@example.com",
					reminderDaysBefore: 14,
					repeatDailyReminders: true,
					lowStockDays: 20,
					normalStockDays: 60,
					highStockDays: 120,
					shoutrrrEnabled: true,
					shoutrrrUrl: "ntfy://localhost/alerts",
					emailStockReminders: false,
					emailIntakeReminders: false,
					shoutrrrStockReminders: true,
					shoutrrrIntakeReminders: true,
					language: "de",
					stockCalculationMode: "manual",
				},
			});

			expect(response.statusCode).toBe(200);

			// Verify updated
			const getResponse = await app.inject({
				method: "GET",
				url: "/settings",
			});

			const data = getResponse.json();
			expect(data.emailEnabled).toBe(false);
			expect(data.notificationEmail).toBe("second@example.com");
			expect(data.shoutrrrEnabled).toBe(true);
			expect(data.shoutrrrUrl).toBe("ntfy://localhost/alerts");
			expect(data.stockCalculationMode).toBe("manual");
		});

		it("should disable repeatDailyReminders when no stock reminders configured", async () => {
			const response = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					emailEnabled: false, // No email
					notificationEmail: "",
					reminderDaysBefore: 7,
					repeatDailyReminders: true, // User tries to enable
					lowStockDays: 30,
					normalStockDays: 90,
					highStockDays: 180,
					shoutrrrEnabled: false, // No shoutrrr
					shoutrrrUrl: "",
					emailStockReminders: true,
					emailIntakeReminders: true,
					shoutrrrStockReminders: true,
					shoutrrrIntakeReminders: true,
					language: "en",
					stockCalculationMode: "automatic",
				},
			});

			expect(response.statusCode).toBe(200);

			// Verify repeatDailyReminders is false
			const getResponse = await app.inject({
				method: "GET",
				url: "/settings",
			});

			const data = getResponse.json();
			expect(data.repeatDailyReminders).toBe(false);
		});

		it("should reject invalid language in lightweight language endpoint", async () => {
			const response = await app.inject({
				method: "PUT",
				url: "/settings/language",
				payload: { language: "fr" },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toMatch(/Invalid language|Bad Request/);
		});

		it("should create and update language via lightweight language endpoint", async () => {
			let response = await app.inject({
				method: "PUT",
				url: "/settings/language",
				payload: { language: "de" },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			response = await app.inject({
				method: "PUT",
				url: "/settings/language",
				payload: { language: "en" },
			});

			expect(response.statusCode).toBe(200);

			const getResponse = await app.inject({ method: "GET", url: "/settings" });
			expect(getResponse.json().language).toBe("en");
		});
	});

	// ---------------------------------------------------------------------------
	// Health Route Tests
	// ---------------------------------------------------------------------------

	describe("Real /health route", () => {
		it("should return health status", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/health",
			});

			expect(response.statusCode).toBe(200);
			const json = response.json();
			expect(json.status).toBe("ok");
			expect(typeof json.smtpConfigured).toBe("boolean");
		});
	});

	// ---------------------------------------------------------------------------
	// Additional Share Routes Tests (edge cases)
	// ---------------------------------------------------------------------------

	describe("Real /share routes - edge cases", () => {
		it("should get list of people with medications", async () => {
			// Create medications for different people
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);
			await createMedication(testClient, userId, "Ibuprofen", ["Anna"]);
			await createMedication(testClient, userId, "Paracetamol", ["Daniel", "Anna"]);

			const response = await app.inject({
				method: "GET",
				url: "/share/people",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.people).toContain("Daniel");
			expect(data.people).toContain("Anna");
			expect(data.people).toHaveLength(2);
		});

		it("should return error when creating share for person with no meds", async () => {
			// Create medication for a different person
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);

			const response = await app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Unknown", scheduleDays: 30 },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().code).toBe("NO_MEDICATIONS");
		});

		it("should unmark dose via share link", async () => {
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);

			const token = "test_delete_dose_token";
			await createShareToken(testClient, userId, "Daniel", token);

			// First mark the dose
			const doseId = "1-0-1735344000000";
			await testClient.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by) VALUES (?, ?, ?)`,
				args: [userId, doseId, "Daniel"],
			});

			// Now unmark via share link
			const response = await app.inject({
				method: "DELETE",
				url: `/share/${token}/doses/${encodeURIComponent(doseId)}`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify deleted
			const result = await testClient.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows[0].count).toBe(0);
		});

		it("should return 410 for expired share token", async () => {
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);

			// Create expired token
			const token = "expired_token_123";
			const expiredAt = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
			await testClient.execute({
				sql: `INSERT INTO share_tokens (user_id, token, taken_by, schedule_days, expires_at) VALUES (?, ?, ?, 30, ?)`,
				args: [userId, token, "Daniel", expiredAt],
			});

			const response = await app.inject({
				method: "GET",
				url: `/share/${token}`,
			});

			expect(response.statusCode).toBe(410);
			expect(response.json().code).toBe("EXPIRED");
		});

		it("should return already marked message for duplicate dose", async () => {
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);

			const token = "test_duplicate_token";
			await createShareToken(testClient, userId, "Daniel", token);

			const doseId = "1-0-1735344000000";

			// Mark the dose first time
			await app.inject({
				method: "POST",
				url: `/share/${token}/doses`,
				payload: { doseId },
			});

			// Try to mark again
			const response = await app.inject({
				method: "POST",
				url: `/share/${token}/doses`,
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().message).toBe("Already marked");
		});
	});

	// ---------------------------------------------------------------------------
	// Additional Dose Routes Tests (edge cases)
	// ---------------------------------------------------------------------------

	describe("Real /doses/taken routes - edge cases", () => {
		it("should return already marked message for duplicate dose", async () => {
			const doseId = "1-0-1735344000000";

			// Mark first time
			await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			// Mark second time
			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().message).toBe("Already marked");
		});

		it("should handle doses with person name in doseId", async () => {
			const doseId = "1-0-1735344000000-Daniel";

			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ success: true });

			// Verify in database
			const result = await testClient.execute({
				sql: `SELECT dose_id FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows.length).toBe(1);
		});
	});

	// ---------------------------------------------------------------------------
	// Additional Medication Routes Tests (edge cases)
	// ---------------------------------------------------------------------------

	describe("Real /medications routes - edge cases", () => {
		const _validMedication = {
			name: "Aspirin",
			blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
		};

		it("should return 404 when deleting non-existent medication", async () => {
			const response = await app.inject({
				method: "DELETE",
				url: "/medications/99999",
			});

			expect(response.statusCode).toBe(404);
		});

		it("should handle medication with all optional fields", async () => {
			const fullMedication = {
				name: "Complete Med",
				genericName: "Generic Complete",
				takenBy: ["Person1", "Person2"],
				packCount: 5,
				blistersPerPack: 4,
				pillsPerBlister: 20,
				looseTablets: 10,
				pillWeightMg: 250,
				expiryDate: "2026-06-30",
				notes: "Some important notes about this medication",
				intakeRemindersEnabled: true,
				blisters: [
					{ usage: 2, every: 1, start: "2025-01-01T08:00:00.000Z" },
					{ usage: 1, every: 1, start: "2025-01-01T20:00:00.000Z" },
				],
			};

			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: fullMedication,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.genericName).toBe("Generic Complete");
			expect(data.takenBy).toEqual(["Person1", "Person2"]);
			expect(data.packCount).toBe(5);
			expect(data.blistersPerPack).toBe(4);
			expect(data.pillsPerBlister).toBe(20);
			expect(data.looseTablets).toBe(10);
			expect(data.pillWeightMg).toBe(250);
			expect(data.expiryDate).toBe("2026-06-30");
			expect(data.notes).toBe("Some important notes about this medication");
			expect(data.intakeRemindersEnabled).toBe(true);
			expect(data.blisters).toHaveLength(2);
		});

		it("should update medication with partial fields", async () => {
			// Create medication first
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: { name: "Original Med", blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }] },
			});
			const medId = createResponse.json().id;

			// Update with partial fields
			const response = await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Updated Med",
					genericName: "New Generic",
					notes: "Updated notes",
					blisters: [{ usage: 2, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().name).toBe("Updated Med");
			expect(response.json().genericName).toBe("New Generic");
			expect(response.json().notes).toBe("Updated notes");
		});

		it("should handle string takenBy conversion", async () => {
			// Test with takenBy as array (expected format)
			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Array TakenBy Med",
					takenBy: ["SinglePerson"],
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json().takenBy).toEqual(["SinglePerson"]);
		});
	});

	// ---------------------------------------------------------------------------
	// Test Email/Shoutrrr Validation (settings.ts - uncovered paths)
	// ---------------------------------------------------------------------------

	describe("Real /settings test routes", () => {
		it("should reject test-email when SMTP is not configured", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/settings/test-email",
				payload: { email: "test@example.com" },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("SMTP not configured");
		});

		it("should reject test-shoutrrr without URL", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/settings/test-shoutrrr",
				payload: { url: "" },
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().error).toBe("Notification URL is required");
		});

		it("should reject test-shoutrrr with unsupported URL format", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/settings/test-shoutrrr",
				payload: { url: "ftp://invalid.com/topic" },
			});

			expect(response.statusCode).toBe(500);
			// SSRF protection returns more specific error message
			expect(response.json().error).toContain("HTTP/HTTPS protocols");
		});

		it("should reject test-shoutrrr with localhost URL (SSRF protection)", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/settings/test-shoutrrr",
				payload: { url: "https://localhost/topic" },
			});

			expect(response.statusCode).toBe(500);
			expect(response.json().error).toContain("Localhost URLs are not allowed");
		});

		it("should reject test-shoutrrr with private IP (SSRF protection)", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/settings/test-shoutrrr",
				payload: { url: "https://192.168.1.1/topic" },
			});

			expect(response.statusCode).toBe(500);
			expect(response.json().error).toContain("Private IP addresses are not allowed");
		});

		it("should reject test-shoutrrr with internal hostname (SSRF protection)", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/settings/test-shoutrrr",
				payload: { url: "https://server.internal/topic" },
			});

			expect(response.statusCode).toBe(500);
			expect(response.json().error).toContain("Internal hostnames are not allowed");
		});
	});

	// ---------------------------------------------------------------------------
	// Additional Doses Routes Tests
	// ---------------------------------------------------------------------------

	describe("Real /doses routes - more coverage", () => {
		it("should return 400 when doseId is missing", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: {},
			});

			expect(response.statusCode).toBe(400);
		});

		it("should handle dose marking and get taken doses", async () => {
			const doseId = "99-0-1735344000099";

			// Mark the dose
			const markResponse = await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId },
			});
			expect(markResponse.statusCode).toBe(200);
			expect(markResponse.json()).toEqual({ success: true });

			// The GET returns doses for current user (anonymous in test)
			// Each beforeEach clears data, so we just verify POST works correctly
		});

		it("should handle cleaning old doses for future date range", async () => {
			// Create a medication first
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "CleanTest Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			// Mark some doses
			await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: `${medId}-0-1735344000000` },
			});

			// Update medication with new start date
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "CleanTest Med",
					blisters: [{ usage: 1, every: 1, start: "2025-06-01T08:00:00.000Z" }], // Future start
				},
			});

			// The dose tracking for the old period should be cleaned up
			// This is handled by the medications route internally
		});
	});

	// ---------------------------------------------------------------------------
	// Health Check Tests
	// ---------------------------------------------------------------------------

	describe("Real /health routes", () => {
		it("should return health status", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/health",
			});

			expect(response.statusCode).toBe(200);
			const json = response.json();
			expect(json.status).toBe("ok");
			expect(typeof json.smtpConfigured).toBe("boolean");
		});
	});

	// ---------------------------------------------------------------------------
	// Medication Delete Cascade Tests
	// ---------------------------------------------------------------------------

	describe("Medication deletion with dose tracking", () => {
		it("should handle medication deletion that has tracked doses", async () => {
			// Create medication
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Test Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			// Mark a dose for this medication
			await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: `${medId}-0-1735344000000` },
			});

			// Delete medication - should succeed even with tracked doses
			const deleteResponse = await app.inject({
				method: "DELETE",
				url: `/medications/${medId}`,
			});

			expect(deleteResponse.statusCode).toBe(204);
		});
	});

	// ---------------------------------------------------------------------------
	// Settings Edge Cases
	// ---------------------------------------------------------------------------

	describe("Settings edge cases", () => {
		it("should handle settings with all reminder options enabled", async () => {
			const response = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					emailEnabled: true,
					notificationEmail: "test@example.com",
					reminderDaysBefore: 7,
					repeatDailyReminders: true,
					lowStockDays: 30,
					normalStockDays: 90,
					highStockDays: 180,
					shoutrrrEnabled: true,
					shoutrrrUrl: "ntfy://localhost/test",
					emailStockReminders: true,
					emailIntakeReminders: true,
					shoutrrrStockReminders: true,
					shoutrrrIntakeReminders: true,
					language: "en",
					stockCalculationMode: "automatic",
				},
			});

			expect(response.statusCode).toBe(200);

			// Verify repeatDailyReminders is preserved when notifications are enabled
			const getResponse = await app.inject({
				method: "GET",
				url: "/settings",
			});

			const data = getResponse.json();
			expect(data.repeatDailyReminders).toBe(true);
			expect(data.emailEnabled).toBe(true);
			expect(data.shoutrrrEnabled).toBe(true);
		});

		it("should handle expiry warning days setting", async () => {
			const response = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					emailEnabled: false,
					notificationEmail: "",
					reminderDaysBefore: 14,
					repeatDailyReminders: false,
					lowStockDays: 30,
					normalStockDays: 90,
					highStockDays: 180,
					expiryWarningDays: 60,
					shoutrrrEnabled: false,
					shoutrrrUrl: "",
					emailStockReminders: true,
					emailIntakeReminders: true,
					shoutrrrStockReminders: true,
					shoutrrrIntakeReminders: true,
					language: "en",
					stockCalculationMode: "automatic",
				},
			});

			expect(response.statusCode).toBe(200);
		});
	});

	// ---------------------------------------------------------------------------
	// Share Token Management
	// ---------------------------------------------------------------------------

	describe("Share token management", () => {
		it("should create share token with custom scheduleDays", async () => {
			await createMedication(testClient, userId, "Med1", ["Daniel"]);

			const response = await app.inject({
				method: "POST",
				url: "/share",
				payload: {
					takenBy: "Daniel",
					scheduleDays: 90,
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.token).toBeDefined();
			expect(data.expiresAt).toBeDefined();
		});

		it("should return validation error for invalid scheduleDays", async () => {
			await createMedication(testClient, userId, "Med1", ["Daniel"]);

			const response = await app.inject({
				method: "POST",
				url: "/share",
				payload: {
					takenBy: "Daniel",
					scheduleDays: 500, // Too high, max is 365
				},
			});

			expect(response.statusCode).toBe(400);
		});

		it("should return validation error for missing takenBy", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/share",
				payload: {
					scheduleDays: 30,
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json().code).toBe("VALIDATION_ERROR");
		});

		it("should get people list with multiple persons", async () => {
			await createMedication(testClient, userId, "Med1", ["Daniel"]);
			await createMedication(testClient, userId, "Med2", ["Anna"]);
			await createMedication(testClient, userId, "Med3", ["Daniel", "Anna"]);

			const response = await app.inject({
				method: "GET",
				url: "/share/people",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.people).toContain("Daniel");
			expect(data.people).toContain("Anna");
		});
	});

	// ---------------------------------------------------------------------------
	// Dose validation tests
	// ---------------------------------------------------------------------------

	describe("Dose validation", () => {
		it("should reject invalid doseId format in POST", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: null },
			});

			expect(response.statusCode).toBe(400);
		});

		it("should handle empty string doseId", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: "" },
			});

			expect(response.statusCode).toBe(400);
		});
	});

	// ---------------------------------------------------------------------------
	// Medication validation edge cases
	// ---------------------------------------------------------------------------

	describe("Medication validation edge cases", () => {
		it("should reject medication without blisters", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: { name: "No Blisters Med" },
			});

			expect(response.statusCode).toBe(400);
		});

		it("should reject medication with empty blisters array", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: { name: "Empty Blisters Med", blisters: [] },
			});

			expect(response.statusCode).toBe(400);
		});

		it("should reject medication with invalid blister data", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Invalid Blister Med",
					blisters: [{ usage: -1, every: 0, start: "invalid-date" }],
				},
			});

			expect(response.statusCode).toBe(400);
		});

		it("should handle medication with minimal valid data", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Minimal Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.name).toBe("Minimal Med");
			// Check defaults
			expect(data.packCount).toBe(1);
			expect(data.blistersPerPack).toBe(1);
			expect(data.pillsPerBlister).toBe(1);
			expect(data.looseTablets).toBe(0);
			expect(data.takenBy).toEqual([]);
		});
	});

	// ---------------------------------------------------------------------------
	// Share Token Dose Routes (via share link)
	// ---------------------------------------------------------------------------

	describe("Share token dose routes", () => {
		it("should get taken doses via share link", async () => {
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);
			const token = "get-doses-token";
			await createShareToken(testClient, userId, "Daniel", token);

			// Insert a dose directly
			await testClient.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by) VALUES (?, ?, ?)`,
				args: [userId, "1-0-1735344000000", "Daniel"],
			});

			const response = await app.inject({
				method: "GET",
				url: `/share/${token}/doses`,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.doses).toHaveLength(1);
			expect(data.doses[0].doseId).toBe("1-0-1735344000000");
			expect(data.doses[0].markedBy).toBe("Daniel");
		});

		it("should return 404 for get doses with invalid share token", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/share/invalid-token/doses",
			});

			expect(response.statusCode).toBe(404);
		});

		it("should return 404 for mark dose with invalid share token", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/share/invalid-token/doses",
				payload: { doseId: "1-0-1735344000000" },
			});

			expect(response.statusCode).toBe(404);
		});

		it("should return 404 for unmark dose with invalid share token", async () => {
			const response = await app.inject({
				method: "DELETE",
				url: "/share/invalid-token/doses/1-0-1735344000000",
			});

			expect(response.statusCode).toBe(404);
		});

		it("should return validation error for empty doseId in share route", async () => {
			await createMedication(testClient, userId, "Aspirin", ["Daniel"]);
			const token = "validation-test-token";
			await createShareToken(testClient, userId, "Daniel", token);

			const response = await app.inject({
				method: "POST",
				url: `/share/${token}/doses`,
				payload: { doseId: "" },
			});

			expect(response.statusCode).toBe(400);
		});
	});

	// ---------------------------------------------------------------------------
	// Medication Image Routes
	// ---------------------------------------------------------------------------

	describe("Medication image routes", () => {
		it("should return 400 for invalid medication id in image upload", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications/invalid/image",
			});

			expect(response.statusCode).toBe(400);
		});

		it("should return 404 for image upload to non-existent medication", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications/99999/image",
			});

			expect(response.statusCode).toBe(404);
		});

		it("should return error for image upload without file", async () => {
			// Create medication first
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Image Test Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			const response = await app.inject({
				method: "POST",
				url: `/medications/${medId}/image`,
			});

			// 406 Not Acceptable when no multipart content
			expect([400, 406]).toContain(response.statusCode);
		});

		it("should return 400 for invalid medication id in image delete", async () => {
			const response = await app.inject({
				method: "DELETE",
				url: "/medications/invalid/image",
			});

			expect(response.statusCode).toBe(400);
		});

		it("should return 404 for image delete on non-existent medication", async () => {
			const response = await app.inject({
				method: "DELETE",
				url: "/medications/99999/image",
			});

			expect(response.statusCode).toBe(404);
		});

		it("should handle image delete when no image exists", async () => {
			// Create medication first (without image)
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "No Image Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			const response = await app.inject({
				method: "DELETE",
				url: `/medications/${medId}/image`,
			});

			// Returns 204 No Content
			expect(response.statusCode).toBe(204);
		});
	});

	// ---------------------------------------------------------------------------
	// Real Refill Routes Tests
	// ---------------------------------------------------------------------------

	describe("Real /medications/:id/refill routes", () => {
		it("should add refill to medication stock", async () => {
			// Create medication first
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Refill Test Med",
					packCount: 2,
					blistersPerPack: 3,
					pillsPerBlister: 10,
					looseTablets: 5,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			// Add refill
			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 10 },
			});

			expect(refillResponse.statusCode).toBe(200);
			const data = refillResponse.json();
			expect(data.success).toBe(true);
			expect(data.newStock.packCount).toBe(3); // 2 + 1
			expect(data.newStock.looseTablets).toBe(15); // 5 + 10
		});

		it("should reset automatic stock baseline on refill so pre-refill dose history no longer reduces current stock", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Automatic Refill Baseline",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 14,
					looseTablets: 0,
					blisters: [{ usage: 1, every: 1, start: "2024-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const preRefillDoseDateOnlyMs = new Date("2025-01-05T00:00:00.000Z").getTime();
			const preRefillTakenAtMs = new Date("2025-01-05T10:00:00.000Z").getTime();
			await testClient.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed)
				      VALUES (?, ?, ?, 0)`,
				args: [userId, `${medId}-0-${preRefillDoseDateOnlyMs}`, preRefillTakenAtMs],
			});

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 0 },
			});

			expect(refillResponse.statusCode).toBe(200);
			expect(refillResponse.json().newStock.packCount).toBe(2);

			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const nextWeek = new Date();
			nextWeek.setDate(nextWeek.getDate() + 7);

			const usageResponse = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: tomorrow.toISOString(),
					endDate: nextWeek.toISOString(),
				},
			});

			expect(usageResponse.statusCode).toBe(200);
			const med = usageResponse.json().find((item: Record<string, unknown>) => item.medicationId === medId);
			expect(med).toBeDefined();
			expect(med.totalPills).toBe(28);
			expect(med.currentPills).toBe(28);
		});

		it("should reset manual stock baseline on refill for liquid_container packages before later dose tracking", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, stock_calculation_mode) VALUES (?, 'manual')`,
				args: [userId],
			});

			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Manual Liquid Refill Baseline",
					medicationForm: "liquid",
					packageType: "liquid_container",
					doseUnit: "ml",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 1,
					packageAmountValue: 5,
					packageAmountUnit: "ml",
					totalPills: 5,
					looseTablets: 5,
					blisters: [{ usage: 5, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const preRefillDoseDateOnlyMs = new Date("2025-01-05T00:00:00.000Z").getTime();
			const preRefillTakenAtMs = new Date("2025-01-05T10:00:00.000Z").getTime();
			await testClient.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed)
				      VALUES (?, ?, ?, 0)`,
				args: [userId, `${medId}-0-${preRefillDoseDateOnlyMs}`, preRefillTakenAtMs],
			});

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 0 },
			});

			expect(refillResponse.statusCode).toBe(200);
			const refillData = refillResponse.json();
			expect(refillData.refill.loosePillsAdded).toBe(5);
			expect(refillData.newStock.totalPills).toBe(10);

			const medsResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(medsResponse.statusCode).toBe(200);
			const med = medsResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(med).toBeTruthy();
			expect(med.lastStockCorrectionAt).toBeTruthy();
			expect(med.totalPills).toBe(10);
			expect(med.looseTablets).toBe(10);

			const firstPostRefillDoseId = `${medId}-0-${new Date("2026-01-06T00:00:00.000Z").getTime()}`;
			const firstDoseResponse = await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: firstPostRefillDoseId },
			});
			expect(firstDoseResponse.statusCode).toBe(200);
			expect(firstDoseResponse.json()).toEqual({ success: true });

			const secondPostRefillDoseId = `${medId}-0-${new Date("2026-01-07T00:00:00.000Z").getTime()}`;
			const secondDoseResponse = await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: secondPostRefillDoseId },
			});
			expect(secondDoseResponse.statusCode).toBe(200);
			expect(secondDoseResponse.json()).toEqual({ success: true });
		});

		it("should decrement remaining refills and mark history when using prescription refill", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Prescription Refill Med",
					packCount: 1,
					blistersPerPack: 2,
					pillsPerBlister: 10,
					looseTablets: 0,
					prescriptionEnabled: true,
					prescriptionAuthorizedRefills: 3,
					prescriptionRemainingRefills: 2,
					prescriptionLowRefillThreshold: 1,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 0, usePrescription: true },
			});

			expect(refillResponse.statusCode).toBe(200);
			const refillData = refillResponse.json();
			expect(refillData.prescription.used).toBe(true);
			expect(refillData.prescription.remainingRefills).toBe(1);

			const medsResponse = await app.inject({
				method: "GET",
				url: "/medications",
			});
			expect(medsResponse.statusCode).toBe(200);
			const med = medsResponse.json().find((m: Record<string, unknown>) => m.id === medId);
			expect(med.prescriptionRemainingRefills).toBe(1);

			const historyResponse = await app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});
			expect(historyResponse.statusCode).toBe(200);
			expect(historyResponse.json()[0].usedPrescription).toBe(true);
		});

		it("should reject prescription refill when no remaining prescription refills are available", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Prescription Empty Med",
					packCount: 1,
					blistersPerPack: 2,
					pillsPerBlister: 10,
					looseTablets: 0,
					prescriptionEnabled: true,
					prescriptionAuthorizedRefills: 2,
					prescriptionRemainingRefills: 0,
					prescriptionLowRefillThreshold: 1,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 0, usePrescription: true },
			});

			expect(refillResponse.statusCode).toBe(409);
			expect(refillResponse.json().error).toContain("No remaining prescription refills");
		});

		it("should return 400 when no packs or pills added", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Refill Test Med 2",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			const response = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 0, loosePillsAdded: 0 },
			});

			expect(response.statusCode).toBe(400);
		});

		it("should return 404 for non-existent medication", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications/99999/refill",
				payload: { packsAdded: 1 },
			});

			expect(response.statusCode).toBe(404);
		});

		it("should return 400 for invalid medication id", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications/invalid/refill",
				payload: { packsAdded: 1 },
			});

			expect(response.statusCode).toBe(400);
		});
	});

	describe("Real /medications/:id/refills routes (history)", () => {
		it("should return empty array when no refills", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "No Refill Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			const response = await app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual([]);
		});

		it("should return refill history after adding refills", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "With Refills Med",
					packCount: 1,
					blistersPerPack: 2,
					pillsPerBlister: 10,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			// Add two refills
			await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 0 },
			});
			await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 0, loosePillsAdded: 5 },
			});

			const response = await app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});

			expect(response.statusCode).toBe(200);
			const refills = response.json();
			expect(refills).toHaveLength(2);
			// Check both refills exist (order may vary)
			const hasPackRefill = refills.some((r: Record<string, unknown>) => r.packsAdded === 1 && r.loosePillsAdded === 0);
			const hasLooseRefill = refills.some(
				(r: Record<string, unknown>) => r.packsAdded === 0 && r.loosePillsAdded === 5
			);
			expect(hasPackRefill).toBe(true);
			expect(hasLooseRefill).toBe(true);
		});

		it("should not return refill history entries from another user for the same medication", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Refill Isolation Med",
					packCount: 1,
					blistersPerPack: 2,
					pillsPerBlister: 10,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;
			const otherUserId = await _createUser(testClient, "refill-isolation-other-user");

			await testClient.execute({
				sql: `INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date)
				      VALUES (?, ?, ?, ?, ?, ?)`,
				args: [medId, userId, 2, 3, 0, 1735603200],
			});
			await testClient.execute({
				sql: `INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date)
				      VALUES (?, ?, ?, ?, ?, ?)`,
				args: [medId, otherUserId, 8, 88, 1, 1735689600],
			});

			const response = await app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});

			expect(response.statusCode).toBe(200);
			const refills = response.json();
			expect(refills).toHaveLength(1);
			expect(refills[0]).toMatchObject({
				packsAdded: 2,
				loosePillsAdded: 3,
				usedPrescription: false,
			});
		});

		it("should return 404 for non-existent medication", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/medications/99999/refills",
			});

			expect(response.statusCode).toBe(404);
		});
	});

	// ---------------------------------------------------------------------------
	// Real Stock Correction (PATCH /medications/:id/stock-adjustment) Tests
	// ---------------------------------------------------------------------------

	describe("Real /medications/:id/stock-adjustment routes", () => {
		it("should update stockAdjustment and lastStockCorrectionAt", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Stock Correction Med",
					packCount: 1,
					blistersPerPack: 14,
					pillsPerBlister: 14,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			// Correct stock: set adjustment to -83 (196 base - 83 = 113 pills)
			const response = await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: { stockAdjustment: -83 },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.stockAdjustment).toBe(-83);
			expect(data.lastStockCorrectionAt).toBeTruthy();
			expect(data.updatedAt).toBeTruthy();
		});

		it("should accept packCount set to 0 in stock adjustment patch", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Pack Count Zero Patch Med",
					packageType: "blister",
					packCount: 1,
					blistersPerPack: 2,
					pillsPerBlister: 10,
					looseTablets: 4,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const response = await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: { stockAdjustment: 0, packCount: 0, looseTablets: 0 },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.stockAdjustment).toBe(0);

			const getResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(getResponse.statusCode).toBe(200);
			const med = getResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(med).toBeTruthy();
			expect(med.packCount).toBe(0);
			expect(med.looseTablets).toBe(0);
			expect(med.stockAdjustment).toBe(0);
		});

		it("should persist blister zero reset with packCount 0", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Blister Zero Reset Med",
					packageType: "blister",
					packCount: 2,
					blistersPerPack: 3,
					pillsPerBlister: 10,
					looseTablets: 5,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const response = await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: { stockAdjustment: 0, packCount: 0, looseTablets: 0 },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.stockAdjustment).toBe(0);

			const getResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(getResponse.statusCode).toBe(200);
			const med = getResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(med).toBeTruthy();
			expect(med.packCount).toBe(0);
			expect(med.looseTablets).toBe(0);
			expect(med.stockAdjustment).toBe(0);
		});

		it("should persist bottle zero reset with packCount 0 and zero totals", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Bottle Zero Reset Med",
					packageType: "bottle",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 1,
					totalPills: 100,
					looseTablets: 20,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const response = await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: { stockAdjustment: 0, packCount: 0, looseTablets: 0, totalPills: 0 },
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.stockAdjustment).toBe(0);

			const getResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(getResponse.statusCode).toBe(200);
			const med = getResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(med).toBeTruthy();
			expect(med.packCount).toBe(0);
			expect(med.looseTablets).toBe(0);
			expect(med.totalPills).toBe(0);
			expect(med.stockAdjustment).toBe(0);
		});

		it.each([
			{
				label: "liquid container",
				payload: {
					name: "Liquid Zero Reset Med",
					medicationForm: "liquid",
					packageType: "liquid_container",
					doseUnit: "ml",
					packCount: 1,
					packageAmountValue: 180,
					packageAmountUnit: "ml",
					blistersPerPack: 1,
					pillsPerBlister: 1,
					totalPills: 180,
					looseTablets: 180,
					blisters: [{ usage: 5, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			},
			{
				label: "tube",
				payload: {
					name: "Tube Zero Reset Med",
					medicationForm: "topical",
					packageType: "tube",
					doseUnit: "units",
					packCount: 2,
					packageAmountValue: 40,
					packageAmountUnit: "g",
					blistersPerPack: 1,
					pillsPerBlister: 1,
					totalPills: 80,
					looseTablets: 80,
					blisters: [{ usage: 2, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			},
		])("should persist $label zero reset with zeroed amount-base fields", async ({ payload }) => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload,
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const response = await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: {
					stockAdjustment: 0,
					packCount: 0,
					looseTablets: 0,
					totalPills: 0,
					packageAmountValue: 0,
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.stockAdjustment).toBe(0);

			const getResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(getResponse.statusCode).toBe(200);
			const med = getResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(med).toBeTruthy();
			expect(med.packCount).toBe(0);
			expect(med.looseTablets).toBe(0);
			expect(med.totalPills).toBe(0);
			expect(med.packageAmountValue).toBe(0);
			expect(med.stockAdjustment).toBe(0);
		});

		it("should align liquid amount-base fields for stale stock-adjustment clients before refill", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, stock_calculation_mode) VALUES (?, 'manual')`,
				args: [userId],
			});

			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Liquid Stale Client Stock Correction",
					medicationForm: "liquid",
					packageType: "liquid_container",
					doseUnit: "ml",
					packCount: 7,
					packageAmountValue: 150,
					packageAmountUnit: "ml",
					blistersPerPack: 1,
					pillsPerBlister: 1,
					totalPills: 1050,
					looseTablets: 1050,
					blisters: [{ usage: 5, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const correctionResponse = await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: {
					stockAdjustment: 0,
					packCount: 1,
					totalPills: 150,
				},
			});
			expect(correctionResponse.statusCode).toBe(200);

			const afterCorrectionResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(afterCorrectionResponse.statusCode).toBe(200);
			const correctedMed = afterCorrectionResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(correctedMed).toBeTruthy();
			expect(correctedMed.packCount).toBe(1);
			expect(correctedMed.totalPills).toBe(150);
			expect(correctedMed.looseTablets).toBe(150);
			expect(correctedMed.stockAdjustment).toBe(0);

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 0 },
			});
			expect(refillResponse.statusCode).toBe(200);
			const refillData = refillResponse.json();
			expect(refillData.refill.quantityAdded).toBe(150);
			expect(refillData.newStock.packCount).toBe(2);
			expect(refillData.newStock.looseTablets).toBe(300);
			expect(refillData.newStock.totalPills).toBe(300);

			const historyResponse = await app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});
			expect(historyResponse.statusCode).toBe(200);
			expect(historyResponse.json()[0].quantityAdded).toBe(150);

			const afterRefillResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(afterRefillResponse.statusCode).toBe(200);
			const refilledMed = afterRefillResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(refilledMed).toBeTruthy();
			expect(refilledMed.packCount).toBe(2);
			expect(refilledMed.totalPills).toBe(300);
			expect(refilledMed.looseTablets).toBe(300);
		});

		it("should persist stockAdjustment in GET /medications", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Persist Stock Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 30,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			// Apply stock correction
			await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: { stockAdjustment: -7 },
			});

			// Verify via GET
			const getResponse = await app.inject({
				method: "GET",
				url: "/medications",
			});

			expect(getResponse.statusCode).toBe(200);
			const meds = getResponse.json();
			const med = meds.find((m: Record<string, unknown>) => m.id === medId);
			expect(med).toBeDefined();
			expect(med.stockAdjustment).toBe(-7);
			expect(med.lastStockCorrectionAt).toBeTruthy();
		});

		it("should not reset stockAdjustment when editing medication via PUT", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Keep Adjustment Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 30,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			// Set stock adjustment
			await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: { stockAdjustment: -5 },
			});

			// Edit the medication (change name) - should preserve stockAdjustment
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Renamed Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 30,
					looseTablets: 0,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			// Verify stockAdjustment is preserved
			const getResponse = await app.inject({
				method: "GET",
				url: "/medications",
			});
			const med = getResponse.json().find((m: Record<string, unknown>) => m.id === medId);
			expect(med.name).toBe("Renamed Med");
			expect(med.stockAdjustment).toBe(-5);
		});

		it("should return 400 for non-numeric stockAdjustment", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Bad Adjustment Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			const response = await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: { stockAdjustment: "not-a-number" },
			});

			expect(response.statusCode).toBe(400);
		});

		it("should return 404 for non-existent medication", async () => {
			const response = await app.inject({
				method: "PATCH",
				url: "/medications/99999/stock-adjustment",
				payload: { stockAdjustment: 5 },
			});

			expect(response.statusCode).toBe(404);
		});

		it("should return 400 for invalid medication id", async () => {
			const response = await app.inject({
				method: "PATCH",
				url: "/medications/invalid/stock-adjustment",
				payload: { stockAdjustment: 5 },
			});

			expect(response.statusCode).toBe(400);
		});

		it("should reset stockAdjustment when stock fields change via PUT", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Reset Adj Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 30,
					looseTablets: 0,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			// Set stock adjustment to -10
			await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: { stockAdjustment: -10 },
			});

			// Verify adjustment is set
			let getMeds = await app.inject({ method: "GET", url: "/medications" });
			let med = getMeds.json().find((m: Record<string, unknown>) => m.id === medId);
			expect(med.stockAdjustment).toBe(-10);

			// Edit medication with CHANGED stock fields (packCount 1 → 2)
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Reset Adj Med",
					packCount: 2,
					blistersPerPack: 1,
					pillsPerBlister: 30,
					looseTablets: 0,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			// stockAdjustment should be reset to 0
			getMeds = await app.inject({ method: "GET", url: "/medications" });
			med = getMeds.json().find((m: Record<string, unknown>) => m.id === medId);
			expect(med.stockAdjustment).toBe(0);
			expect(med.lastStockCorrectionAt).toBeTruthy();
		});

		it("should preserve stockAdjustment when only non-stock fields change via PUT", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Preserve Adj Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 30,
					looseTablets: 0,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id;

			// Set stock adjustment
			await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: { stockAdjustment: -5 },
			});

			// Edit only non-stock fields (name, notes)
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Renamed Preserve Med",
					notes: "Updated notes",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 30,
					looseTablets: 0,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			// stockAdjustment should be preserved
			const getMeds = await app.inject({ method: "GET", url: "/medications" });
			const med = getMeds.json().find((m: Record<string, unknown>) => m.id === medId);
			expect(med.name).toBe("Renamed Preserve Med");
			expect(med.stockAdjustment).toBe(-5);
		});

		it("should not count phantom consumption in planner after stock correction", async () => {
			// Create medication: 1 pack × 14 blisters × 14 pills = 196 pills total
			// Schedule: 1 pill daily starting far in the past
			const farPast = new Date("2024-01-01T08:00:00.000Z");

			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Planner Phantom Med",
					packCount: 1,
					blistersPerPack: 14,
					pillsPerBlister: 14,
					looseTablets: 0,
					blisters: [{ usage: 1, every: 1, start: farPast.toISOString() }],
				},
			});
			const medId = createResponse.json().id;

			// Correct stock to 113 pills (196 base - 83 = 113)
			await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: { stockAdjustment: -83 },
			});

			// Query planner immediately - stock should be ~113 (not reduced by phantom dose)
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const nextWeek = new Date();
			nextWeek.setDate(nextWeek.getDate() + 7);

			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: tomorrow.toISOString(),
					endDate: nextWeek.toISOString(),
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			const med = data.find((m: Record<string, unknown>) => m.medicationId === medId);
			expect(med).toBeDefined();
			// Total should be very close to 113 (not 112 or lower from phantom consumption)
			// Allow up to 1 pill of natural consumption (test runs fast, but at most 1 day could pass)
			expect(med.totalPills).toBeGreaterThanOrEqual(112);
			expect(med.totalPills).toBeLessThanOrEqual(113);
		});
	});

	// ---------------------------------------------------------------------------
	// Real Export/Import Routes Tests
	// ---------------------------------------------------------------------------

	describe("Real /export routes", () => {
		it("should export empty data when no medications", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/export",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.version).toBeDefined();
			expect(data.exportedAt).toBeDefined();
			expect(data.medications).toEqual([]);
		});

		it("should export medications with correct structure", async () => {
			// Create a medication
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Export Test Med",
					genericName: "Test Generic",
					packCount: 2,
					blistersPerPack: 3,
					pillsPerBlister: 10,
					looseTablets: 5,
					pillWeightMg: 500,
					notes: "Test notes",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			const response = await app.inject({
				method: "GET",
				url: "/export",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.medications).toHaveLength(1);

			const med = data.medications[0];
			expect(med.name).toBe("Export Test Med");
			expect(med.genericName).toBe("Test Generic");
			expect(med.inventory.packCount).toBe(2);
			expect(med.inventory.blistersPerPack).toBe(3);
			expect(med.inventory.pillsPerBlister).toBe(10);
			expect(med.inventory.looseTablets).toBe(5);
			expect(med.pillWeightMg).toBe(500);
			expect(med.notes).toBe("Test notes");
			expect(med.schedules).toHaveLength(1);
		});

		it("should include settings when user has settings", async () => {
			// Create settings first
			await app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					emailEnabled: true,
					notificationEmail: "test@example.com",
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
					upcomingTodayOnly: false,
					shareScheduleTodayOnly: false,
					swapDashboardMainSections: false,
				},
			});

			const response = await app.inject({
				method: "GET",
				url: "/export",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.settings).toBeDefined();
			expect(data.settings.emailEnabled).toBe(true);
		});

		it("should include sensitive settings when requested", async () => {
			await app.inject({
				method: "PUT",
				url: "/settings",
				payload: {
					emailEnabled: false,
					notificationEmail: "",
					reminderDaysBefore: 7,
					repeatDailyReminders: false,
					lowStockDays: 30,
					normalStockDays: 90,
					highStockDays: 180,
					shoutrrrEnabled: true,
					shoutrrrUrl: "https://example.com/topic",
					emailStockReminders: false,
					emailIntakeReminders: false,
					emailPrescriptionReminders: false,
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

			const response = await app.inject({
				method: "GET",
				url: "/export?includeSensitive=true",
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.settings.shoutrrrEnabled).toBe(true);
			expect(data.settings.shoutrrrUrl).toBe("https://example.com/topic");
		});

		it("should gracefully export malformed date-like DB values", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Date Edge Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createResponse.json().id as number;

			await testClient.execute({
				sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed) VALUES (?, ?, ?, 0)`,
				args: [userId, `${medId}-0-1735344000000`, "not-a-date"],
			});
			await testClient.execute({
				sql: `INSERT INTO refill_history (medication_id, user_id, packs_added, loose_pills_added, used_prescription, refill_date)
				      VALUES (?, ?, ?, ?, ?, ?)`,
				args: [medId, userId, 1, 0, 0, "still-not-a-date"],
			});
			await testClient.execute({
				sql: `INSERT INTO share_tokens (user_id, token, taken_by, schedule_days, expires_at) VALUES (?, ?, ?, ?, ?)`,
				args: [userId, "date-edge-token", "Daniel", 30, "broken-date"],
			});

			const response = await app.inject({ method: "GET", url: "/export" });
			expect(response.statusCode).toBe(200);

			const data = response.json();
			expect(data.doseHistory).toHaveLength(1);
			expect(Number.isNaN(Date.parse(data.doseHistory[0].takenAt))).toBe(false);
			expect(data.refillHistory).toHaveLength(1);
			expect(Number.isNaN(Date.parse(data.refillHistory[0].refillDate))).toBe(false);
			expect(data.shareLinks).toHaveLength(1);
			expect(data.shareLinks[0].expiresAt).toBeNull();
		});
	});

	describe("Real /import routes", () => {
		it("should import medications from export format", async () => {
			const importData = {
				version: "1.0",
				exportedAt: new Date().toISOString(),
				medications: [
					{
						_exportId: "med-1",
						name: "Imported Med",
						genericName: "Imported Generic",
						takenBy: ["Person A"],
						inventory: {
							packCount: 3,
							blistersPerPack: 2,
							pillsPerBlister: 14,
							looseTablets: 7,
						},
						pillWeightMg: 250,
						schedules: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z", remind: true }],
						notes: "Imported notes",
						intakeRemindersEnabled: true,
					},
				],
			};

			const response = await app.inject({
				method: "POST",
				url: "/import",
				payload: importData,
			});

			expect(response.statusCode).toBe(200);
			const result = response.json();
			expect(result.success).toBe(true);
			expect(result.imported.medications).toBe(1);

			// Verify medication was created
			const medsResponse = await app.inject({
				method: "GET",
				url: "/medications",
			});
			const meds = medsResponse.json();
			expect(meds).toHaveLength(1);
			expect(meds[0].name).toBe("Imported Med");
		});

		it("should return 400 for invalid import data", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/import",
				payload: { invalid: "data" },
			});

			expect(response.statusCode).toBe(400);
		});

		it("should replace existing medications on import", async () => {
			// First create a medication
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Existing Med",
					packCount: 5,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			// Verify it exists
			let medsResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(medsResponse.json()).toHaveLength(1);
			expect(medsResponse.json()[0].name).toBe("Existing Med");
			expect(medsResponse.json()[0].packCount).toBe(5);

			// Import will REPLACE all data
			const importData = {
				version: "1.0",
				exportedAt: new Date().toISOString(),
				medications: [
					{
						_exportId: "med-1",
						name: "Imported Med",
						inventory: { packCount: 10, blistersPerPack: 2, pillsPerBlister: 14, looseTablets: 0 },
						schedules: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
					},
				],
			};

			const response = await app.inject({
				method: "POST",
				url: "/import",
				payload: importData,
			});

			expect(response.statusCode).toBe(200);
			const result = response.json();
			expect(result.success).toBe(true);
			expect(result.imported.medications).toBe(1);

			// Verify: old med is gone, new med exists
			medsResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(medsResponse.json()).toHaveLength(1);
			expect(medsResponse.json()[0].name).toBe("Imported Med");
			expect(medsResponse.json()[0].packCount).toBe(10);
		});
	});

	// ---------------------------------------------------------------------------
	// Package Type (blister, bottle, tube, liquid_container) Tests
	// ---------------------------------------------------------------------------

	describe("Package type handling (blister, bottle, tube, liquid_container)", () => {
		const bottleMedication = {
			name: "Vitamin D Drops",
			packageType: "bottle",
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: 120,
			blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
		};

		const blisterMedication = {
			name: "Aspirin Blister",
			packageType: "blister",
			packCount: 2,
			blistersPerPack: 3,
			pillsPerBlister: 10,
			looseTablets: 5,
			blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
		};

		const liquidContainerMedication = {
			name: "Cough Syrup",
			medicationForm: "liquid",
			packageType: "liquid_container",
			doseUnit: "ml",
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: 180,
			blisters: [{ usage: 5, every: 1, start: "2025-01-01T08:00:00.000Z" }],
		};

		const tubeMedication = {
			name: "Topical Cream",
			medicationForm: "topical",
			packageType: "tube",
			doseUnit: "units",
			packCount: 2,
			packageAmountValue: 40,
			packageAmountUnit: "g",
			blistersPerPack: 1,
			pillsPerBlister: 1,
			totalPills: 80,
			looseTablets: 80,
			blisters: [{ usage: 2, every: 1, start: "2025-01-01T08:00:00.000Z" }],
		};

		async function expectRefillInvariants({
			medId,
			refillData,
			visibleStockBeforeRefill,
			expectedQuantityAdded,
			expectedPacksAdded,
			expectedAmountPerPackage,
		}: {
			medId: number;
			refillData: {
				refill: { packsAdded: number; quantityAdded: number; totalPillsAdded: number };
				newStock: { packCount: number; totalPills: number; looseTablets: number };
			};
			visibleStockBeforeRefill: number;
			expectedQuantityAdded: number;
			expectedPacksAdded: number;
			expectedAmountPerPackage?: number;
		}) {
			expect(refillData.refill.packsAdded).toBe(expectedPacksAdded);
			expect(refillData.refill.quantityAdded).toBe(expectedQuantityAdded);
			expect(refillData.refill.totalPillsAdded).toBe(expectedQuantityAdded);
			expect(refillData.newStock.totalPills - visibleStockBeforeRefill).toBe(expectedQuantityAdded);

			const historyResponse = await app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});
			expect(historyResponse.statusCode).toBe(200);
			expect(historyResponse.json()[0]).toMatchObject({
				packsAdded: expectedPacksAdded,
				quantityAdded: expectedQuantityAdded,
				totalPillsAdded: expectedQuantityAdded,
			});

			if (expectedAmountPerPackage) {
				expect(refillData.newStock.packCount).toBe(
					Math.max(1, Math.ceil(refillData.newStock.totalPills / expectedAmountPerPackage))
				);
			}
		}

		it("should create and return bottle type medication", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: bottleMedication,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.packageType).toBe("bottle");
			expect(data.looseTablets).toBe(120);
		});

		it("should return packageType in shared schedule for bottle type", async () => {
			// Create bottle medication with takenBy
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: { ...bottleMedication, takenBy: ["Daniel"] },
			});

			// Create share token
			const shareResponse = await app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Daniel", scheduleDays: 30 },
			});
			expect(shareResponse.statusCode).toBe(200);
			const { token } = shareResponse.json();

			// Get shared schedule
			const scheduleResponse = await app.inject({
				method: "GET",
				url: `/share/${token}`,
			});

			expect(scheduleResponse.statusCode).toBe(200);
			const data = scheduleResponse.json();
			expect(data.medications).toHaveLength(1);
			expect(data.medications[0].packageType).toBe("bottle");
			// Bottle totalPills = looseTablets + stockAdjustment (no blister math)
			expect(data.medications[0].totalPills).toBe(120);
		});

		it("should create and return liquid_container type medication", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: liquidContainerMedication,
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data.packageType).toBe("liquid_container");
			expect(data.medicationForm).toBe("liquid");
			expect(data.doseUnit).toBe("ml");
			expect(data.looseTablets).toBe(180);
		});

		it("should return packageType and ml-based stock semantics in shared schedule for liquid_container", async () => {
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: { ...liquidContainerMedication, takenBy: ["Daniel"] },
			});

			const shareResponse = await app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Daniel", scheduleDays: 30 },
			});
			expect(shareResponse.statusCode).toBe(200);
			const { token } = shareResponse.json();

			const scheduleResponse = await app.inject({
				method: "GET",
				url: `/share/${token}`,
			});

			expect(scheduleResponse.statusCode).toBe(200);
			const data = scheduleResponse.json();
			expect(data.medications).toHaveLength(1);
			expect(data.medications[0].packageType).toBe("liquid_container");
			// Liquid container follows container semantics (stock from looseTablets only).
			expect(data.medications[0].totalPills).toBe(180);
		});

		it("should calculate correct totalPills for shared blister medication", async () => {
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: { ...blisterMedication, takenBy: ["Daniel"] },
			});

			const shareResponse = await app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Daniel", scheduleDays: 30 },
			});
			const { token } = shareResponse.json();

			const scheduleResponse = await app.inject({
				method: "GET",
				url: `/share/${token}`,
			});

			expect(scheduleResponse.statusCode).toBe(200);
			const data = scheduleResponse.json();
			expect(data.medications).toHaveLength(1);
			expect(data.medications[0].packageType).toBe("blister");
			// Blister totalPills = 2 * 3 * 10 + 5 = 65
			expect(data.medications[0].totalPills).toBe(65);
		});

		it("should refill bottle stock from loose tablets without mutating explicit capacity", async () => {
			const bottleWithExplicitCapacity = {
				...bottleMedication,
				totalPills: 100,
				looseTablets: 20,
			};
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: bottleWithExplicitCapacity,
			});
			const medId = createResponse.json().id;

			// Refill bottle: only loosePillsAdded should affect current stock.
			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 0, loosePillsAdded: 50 },
			});

			expect(refillResponse.statusCode).toBe(200);
			const data = refillResponse.json();
			expect(data.refill.totalPillsAdded).toBe(50);
			// Bottle current stock must be based on looseTablets, not configured capacity.
			expect(data.newStock.totalPills).toBe(70);
			expect(data.newStock.looseTablets).toBe(70);

			const medsResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(medsResponse.statusCode).toBe(200);
			const med = medsResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(med).toBeTruthy();
			expect(med.packCount).toBe(0);
			expect(med.looseTablets).toBe(70);
			// Persisted bottle capacity must remain unchanged on later GET /medications.
			expect(med.totalPills).toBe(100);
		});

		it("should use one prescription refill for bottle package refills and ignore pack count", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					...bottleMedication,
					prescriptionEnabled: true,
					prescriptionAuthorizedRefills: 3,
					prescriptionRemainingRefills: 2,
					prescriptionLowRefillThreshold: 1,
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 3, loosePillsAdded: 30, usePrescription: true },
			});

			expect(refillResponse.statusCode).toBe(200);
			const refillData = refillResponse.json();
			expect(refillData.refill.packsAdded).toBe(0);
			expect(refillData.refill.loosePillsAdded).toBe(30);
			expect(refillData.prescription.used).toBe(true);
			expect(refillData.prescription.remainingRefills).toBe(1);
			expect(refillData.newStock.packCount).toBe(0);
			expect(refillData.newStock.looseTablets).toBe(150);

			const historyResponse = await app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});
			expect(historyResponse.statusCode).toBe(200);
			expect(historyResponse.json()[0]).toMatchObject({
				packsAdded: 0,
				loosePillsAdded: 30,
				usedPrescription: true,
			});
		});

		it.each([
			{
				name: "bottle",
				payload: {
					...bottleMedication,
					totalPills: 100,
					looseTablets: 10,
				},
				refillPayload: { packsAdded: 0, loosePillsAdded: 100 },
				expectedVisibleStockBeforeRefill: 4,
				expectedQuantityAdded: 100,
				expectedResponsePacksAdded: 0,
				expectedPackCount: 0,
				expectedLooseTablets: 104,
				expectedTotalPills: 104,
				expectedPersistedTotalPills: 100,
				expectedStockAdjustment: 0,
			},
			{
				name: "blister",
				payload: {
					...blisterMedication,
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					looseTablets: 0,
				},
				refillPayload: { packsAdded: 1, loosePillsAdded: 0 },
				expectedVisibleStockBeforeRefill: 4,
				expectedQuantityAdded: 10,
				expectedResponsePacksAdded: 1,
				expectedPackCount: 2,
				expectedLooseTablets: 0,
				expectedTotalPills: 14,
				expectedPersistedTotalPills: null,
				expectedStockAdjustment: -6,
			},
			{
				name: "liquid_container",
				payload: {
					...liquidContainerMedication,
					packCount: 1,
					packageAmountValue: 100,
					packageAmountUnit: "ml",
					totalPills: 10,
					looseTablets: 10,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
				refillPayload: { packsAdded: 1, loosePillsAdded: 0 },
				expectedVisibleStockBeforeRefill: 4,
				expectedQuantityAdded: 100,
				expectedResponsePacksAdded: 1,
				expectedAmountPerPackage: 100,
				expectedPackCount: 2,
				expectedLooseTablets: 104,
				expectedTotalPills: 104,
				expectedPersistedTotalPills: 104,
				expectedStockAdjustment: 0,
			},
		])("should refill from current visible stock after prior consumption for $name", async ({
			payload,
			refillPayload,
			expectedVisibleStockBeforeRefill,
			expectedQuantityAdded,
			expectedResponsePacksAdded,
			expectedAmountPerPackage,
			expectedPackCount,
			expectedLooseTablets,
			expectedTotalPills,
			expectedPersistedTotalPills,
			expectedStockAdjustment,
		}) => {
			await testClient.execute({
				sql: `INSERT OR REPLACE INTO user_settings (user_id, stock_calculation_mode) VALUES (?, 'manual')`,
				args: [userId],
			});

			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload,
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			for (let day = 1; day <= 6; day += 1) {
				const doseDateOnlyMs = new Date(`2025-01-0${day}T00:00:00.000Z`).getTime();
				const takenAtMs = new Date(`2025-01-0${day}T10:00:00.000Z`).getTime();
				await testClient.execute({
					sql: `INSERT INTO dose_tracking (user_id, dose_id, taken_at, dismissed)
					      VALUES (?, ?, ?, 0)`,
					args: [userId, `${medId}-0-${doseDateOnlyMs}`, takenAtMs],
				});
			}

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: refillPayload,
			});

			expect(refillResponse.statusCode).toBe(200);
			const refillData = refillResponse.json();
			await expectRefillInvariants({
				medId,
				refillData,
				visibleStockBeforeRefill: expectedVisibleStockBeforeRefill,
				expectedQuantityAdded,
				expectedPacksAdded: expectedResponsePacksAdded,
				expectedAmountPerPackage,
			});
			expect(refillData.newStock.packCount).toBe(expectedPackCount);
			expect(refillData.newStock.looseTablets).toBe(expectedLooseTablets);
			expect(refillData.newStock.totalPills).toBe(expectedTotalPills);

			const medsResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(medsResponse.statusCode).toBe(200);
			const med = medsResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(med).toBeTruthy();
			expect(med.packCount).toBe(expectedPackCount);
			expect(med.looseTablets).toBe(expectedLooseTablets);
			expect(med.totalPills).toBe(expectedPersistedTotalPills);
			expect(med.stockAdjustment).toBe(expectedStockAdjustment);
		});

		it("should refill tube stock from the corrected visible baseline", async () => {
			await testClient.execute({
				sql: `INSERT OR REPLACE INTO user_settings (user_id, stock_calculation_mode) VALUES (?, 'manual')`,
				args: [userId],
			});

			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					...tubeMedication,
					packCount: 1,
					packageAmountValue: 80,
					packageAmountUnit: "g",
					totalPills: 10,
					looseTablets: 10,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const correctionResponse = await app.inject({
				method: "PATCH",
				url: `/medications/${medId}/stock-adjustment`,
				payload: {
					stockAdjustment: -6,
					looseTablets: 10,
					totalPills: 10,
					packageAmountValue: 80,
					packCount: 1,
				},
			});
			expect(correctionResponse.statusCode).toBe(200);

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 0 },
			});

			expect(refillResponse.statusCode).toBe(200);
			const refillData = refillResponse.json();
			await expectRefillInvariants({
				medId,
				refillData,
				visibleStockBeforeRefill: 4,
				expectedQuantityAdded: 80,
				expectedPacksAdded: 1,
				expectedAmountPerPackage: 80,
			});
			expect(refillData.newStock.packCount).toBe(2);
			expect(refillData.newStock.looseTablets).toBe(84);
			expect(refillData.newStock.totalPills).toBe(84);

			const medsResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(medsResponse.statusCode).toBe(200);
			const med = medsResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(med).toBeTruthy();
			expect(med.packCount).toBe(2);
			expect(med.looseTablets).toBe(84);
			expect(med.totalPills).toBe(84);
			expect(med.stockAdjustment).toBe(0);
		});

		it("should calculate correct refill totalPillsAdded for blister type", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: blisterMedication,
			});
			const medId = createResponse.json().id;

			// Refill blister: 1 pack = 3 blisters * 10 pills = 30 pills + 5 loose
			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 5 },
			});

			expect(refillResponse.statusCode).toBe(200);
			const data = refillResponse.json();
			expect(data.refill.totalPillsAdded).toBe(35); // 1*30 + 5
			expect(data.newStock.packCount).toBe(3);
			expect(data.newStock.looseTablets).toBe(10);
			expect(data.newStock.totalPills).toBe(100);

			const medsResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(medsResponse.statusCode).toBe(200);
			const med = medsResponse.json().find((item: Record<string, unknown>) => item.id === medId);
			expect(med).toBeTruthy();
			expect(med.packCount).toBe(3);
			expect(med.looseTablets).toBe(10);
		});

		it("should keep liquid_container refill additive and preserve amount baseline", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, stock_calculation_mode) VALUES (?, 'manual')`,
				args: [userId],
			});

			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					...liquidContainerMedication,
					packCount: 1,
					packageAmountValue: 180,
					totalPills: 180,
					looseTablets: 180,
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 0 },
			});

			expect(refillResponse.statusCode).toBe(200);
			const refillData = refillResponse.json();
			await expectRefillInvariants({
				medId,
				refillData,
				visibleStockBeforeRefill: 180,
				expectedQuantityAdded: 180,
				expectedPacksAdded: 1,
				expectedAmountPerPackage: 180,
			});
			expect(refillData.refill.loosePillsAdded).toBe(180);
			expect(refillData.newStock.totalPills).toBe(360);

			const medsResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(medsResponse.statusCode).toBe(200);
			const med = medsResponse.json().find((m: Record<string, unknown>) => m.id === medId);
			expect(med).toBeTruthy();
			expect(med.totalPills).toBe(360);
			expect(med.looseTablets).toBe(360);
		});

		it("should normalize liquid_container packCount to the full visible stock after refill", async () => {
			await testClient.execute({
				sql: `INSERT INTO user_settings (user_id, stock_calculation_mode) VALUES (?, 'manual')`,
				args: [userId],
			});

			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					...liquidContainerMedication,
					packCount: 0,
					packageAmountValue: 150,
					totalPills: 300,
					looseTablets: 300,
				},
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 5, loosePillsAdded: 0 },
			});

			expect(refillResponse.statusCode).toBe(200);
			const refillData = refillResponse.json();
			await expectRefillInvariants({
				medId,
				refillData,
				visibleStockBeforeRefill: 300,
				expectedQuantityAdded: 750,
				expectedPacksAdded: 5,
				expectedAmountPerPackage: 150,
			});
			expect(refillData.newStock.packCount).toBe(7);
			expect(refillData.newStock.totalPills).toBe(1050);

			const medsResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(medsResponse.statusCode).toBe(200);
			const med = medsResponse.json().find((m: Record<string, unknown>) => m.id === medId);
			expect(med).toBeTruthy();
			expect(med.packCount).toBe(7);
			expect(med.totalPills).toBe(1050);
			expect(med.looseTablets).toBe(1050);
		});

		it.each([
			{
				name: "liquid_container",
				payload: {
					...liquidContainerMedication,
					packCount: 1,
					packageAmountValue: 180,
					packageAmountUnit: "ml",
					totalPills: 180,
					looseTablets: 180,
					prescriptionEnabled: true,
					prescriptionAuthorizedRefills: 3,
					prescriptionRemainingRefills: 2,
					prescriptionLowRefillThreshold: 1,
				},
				refillPayload: { packsAdded: 0, loosePillsAdded: 180, usePrescription: true },
				expectedVisibleStockBeforeRefill: 180,
				expectedPacksAdded: 1,
				expectedLooseAdded: 180,
				expectedRemainingRefills: 1,
				expectedTotalPills: 360,
				expectedAmountPerPackage: 180,
			},
			{
				name: "tube",
				payload: {
					...tubeMedication,
					prescriptionEnabled: true,
					prescriptionAuthorizedRefills: 4,
					prescriptionRemainingRefills: 3,
					prescriptionLowRefillThreshold: 1,
				},
				refillPayload: { packsAdded: 0, loosePillsAdded: 80, usePrescription: true },
				expectedVisibleStockBeforeRefill: 80,
				expectedPacksAdded: 2,
				expectedLooseAdded: 80,
				expectedRemainingRefills: 1,
				expectedTotalPills: 160,
				expectedAmountPerPackage: 40,
			},
		])("should derive amount-based refill counts and decrement prescription remaining refills for $name", async ({
			payload,
			refillPayload,
			expectedVisibleStockBeforeRefill,
			expectedPacksAdded,
			expectedLooseAdded,
			expectedRemainingRefills,
			expectedTotalPills,
			expectedAmountPerPackage,
		}) => {
			await testClient.execute({
				sql: `INSERT OR REPLACE INTO user_settings (user_id, stock_calculation_mode) VALUES (?, 'manual')`,
				args: [userId],
			});

			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload,
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: refillPayload,
			});

			expect(refillResponse.statusCode).toBe(200);
			const refillData = refillResponse.json();
			await expectRefillInvariants({
				medId,
				refillData,
				visibleStockBeforeRefill: expectedVisibleStockBeforeRefill,
				expectedQuantityAdded: expectedLooseAdded,
				expectedPacksAdded,
				expectedAmountPerPackage,
			});
			expect(refillData.refill.packsAdded).toBe(expectedPacksAdded);
			expect(refillData.refill.loosePillsAdded).toBe(expectedLooseAdded);
			expect(refillData.refill.quantityAdded).toBe(expectedLooseAdded);
			expect(refillData.refill.totalPillsAdded).toBe(expectedLooseAdded);
			expect(refillData.prescription.used).toBe(true);
			expect(refillData.prescription.remainingRefills).toBe(expectedRemainingRefills);
			expect(refillData.newStock.totalPills).toBe(expectedTotalPills);

			const historyResponse = await app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});
			expect(historyResponse.statusCode).toBe(200);
			expect(historyResponse.json()[0]).toMatchObject({
				packsAdded: expectedPacksAdded,
				loosePillsAdded: expectedLooseAdded,
				quantityAdded: expectedLooseAdded,
				usedPrescription: true,
			});
		});

		it("should keep tube refill additive and preserve amount baseline", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: tubeMedication,
			});
			expect(createResponse.statusCode).toBe(200);
			const medId = createResponse.json().id;

			const refillResponse = await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 1, loosePillsAdded: 0 },
			});

			expect(refillResponse.statusCode).toBe(200);
			const refillData = refillResponse.json();
			await expectRefillInvariants({
				medId,
				refillData,
				visibleStockBeforeRefill: 80,
				expectedQuantityAdded: 40,
				expectedPacksAdded: 1,
				expectedAmountPerPackage: 40,
			});
			expect(refillData.refill.loosePillsAdded).toBe(40);
			expect(refillData.newStock.totalPills).toBe(120);

			const medsResponse = await app.inject({ method: "GET", url: "/medications" });
			expect(medsResponse.statusCode).toBe(200);
			const med = medsResponse.json().find((m: Record<string, unknown>) => m.id === medId);
			expect(med).toBeTruthy();
			expect(med.totalPills).toBe(120);
			expect(med.looseTablets).toBe(120);
		});

		it("should return correct totalPillsAdded in refill history for bottle type", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: bottleMedication,
			});
			const medId = createResponse.json().id;

			// Add refill
			await app.inject({
				method: "POST",
				url: `/medications/${medId}/refill`,
				payload: { packsAdded: 0, loosePillsAdded: 25 },
			});

			// Get refill history
			const historyResponse = await app.inject({
				method: "GET",
				url: `/medications/${medId}/refills`,
			});

			expect(historyResponse.statusCode).toBe(200);
			const refills = historyResponse.json();
			expect(refills).toHaveLength(1);
			// For bottle type, totalPillsAdded = loosePillsAdded only
			expect(refills[0].totalPillsAdded).toBe(25);
		});

		it("should export and import bottle type medication correctly", async () => {
			// Create bottle medication
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: bottleMedication,
			});

			// Export
			const exportResponse = await app.inject({
				method: "GET",
				url: "/export",
			});

			expect(exportResponse.statusCode).toBe(200);
			const exportData = exportResponse.json();
			expect(exportData.medications).toHaveLength(1);
			expect(exportData.medications[0].inventory.packageType).toBe("bottle");
			expect(exportData.medications[0].inventory.looseTablets).toBe(120);

			// Clear and re-import
			await clearData(testClient);
			await testClient.execute(
				"INSERT INTO users (id, username, auth_provider) VALUES (999999999, '__anonymous__', 'anonymous')"
			);

			const importResponse = await app.inject({
				method: "POST",
				url: "/import",
				payload: exportData,
			});

			expect(importResponse.statusCode).toBe(200);
			expect(importResponse.json().success).toBe(true);

			// Verify imported medication has correct packageType
			const medsResponse = await app.inject({
				method: "GET",
				url: "/medications",
			});

			expect(medsResponse.json()).toHaveLength(1);
			const med = medsResponse.json()[0];
			expect(med.name).toBe("Vitamin D Drops");
			expect(med.packageType).toBe("bottle");
			expect(med.looseTablets).toBe(120);
		});

		it("should default to blister when importing without packageType", async () => {
			const importData = {
				version: "1.0",
				exportedAt: new Date().toISOString(),
				medications: [
					{
						_exportId: "med-1",
						name: "Old Export Med",
						inventory: { packCount: 2, blistersPerPack: 3, pillsPerBlister: 10, looseTablets: 0 },
						schedules: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
					},
				],
			};

			const importResponse = await app.inject({
				method: "POST",
				url: "/import",
				payload: importData,
			});

			expect(importResponse.statusCode).toBe(200);

			const medsResponse = await app.inject({
				method: "GET",
				url: "/medications",
			});

			expect(medsResponse.json()).toHaveLength(1);
			expect(medsResponse.json()[0].packageType).toBe("blister");
		});

		it("should reject liquid medication form with non-liquid package type", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					...liquidContainerMedication,
					packageType: "bottle",
				},
			});

			expect(response.statusCode).toBe(400);
		});
	});
});
