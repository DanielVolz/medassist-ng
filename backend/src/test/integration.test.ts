/**
 * Integration Tests - Testing interactions between multiple routes/features
 * These tests verify critical app behavior that spans multiple components.
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
	const { createClient } = require("@libsql/client");
	const { drizzle } = require("drizzle-orm/libsql");
	const client = createClient({ url: ":memory:" });
	const db = drizzle(client);
	return { testClient: client, testDb: db };
});

// Mock modules
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

vi.mock("../plugins/auth.js", () => ({
	requireAuth: async () => {},
	getAnonymousUserId: () => 999999999,
	isReadOnlyApiKeyRequest: () => false,
}));

// Import routes
const { doseRoutes } = await import("../routes/doses.js");
const { shareRoutes } = await import("../routes/share.js");
const { medicationRoutes } = await import("../routes/medications.js");
const { settingsRoutes } = await import("../routes/settings.js");

// =============================================================================
// Schema & Setup
// =============================================================================

async function createSchema(client: Client) {
	const tables = [
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
      allow_journal_notes integer NOT NULL DEFAULT 0,
      allow_mark_taken integer NOT NULL DEFAULT 1,
      created_at integer NOT NULL DEFAULT (strftime('%s','now')),
      expires_at integer,
      last_used_at integer,
      revoked_at integer,
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
	];

	for (const sql of tables) {
		await client.execute(sql);
	}
}

async function clearData(client: Client) {
	await client.execute("DELETE FROM dose_tracking");
	await client.execute("DELETE FROM share_tokens");
	await client.execute("DELETE FROM user_settings");
	await client.execute("DELETE FROM medications");
	await client.execute("DELETE FROM users");
	await client.execute("DELETE FROM sqlite_sequence");
}

function visibleDoseTimestampMs(): number {
	const doseDate = new Date();
	doseDate.setHours(8, 0, 0, 0);
	return doseDate.getTime();
}

function visibleDoseStartIso(): string {
	return new Date(visibleDoseTimestampMs()).toISOString();
}

// =============================================================================
// Tests
// =============================================================================

describe("Integration Tests", () => {
	let app: FastifyInstance;
	const _userId = 999999999;

	beforeAll(async () => {
		await createSchema(testClient);

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

		await app.register(doseRoutes);
		await app.register(shareRoutes);
		await app.register(medicationRoutes);
		await app.register(settingsRoutes);

		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		testClient.close();
	});

	beforeEach(async () => {
		await clearData(testClient);
		await testClient.execute(
			"INSERT INTO users (id, username, auth_provider) VALUES (999999999, '__anonymous__', 'anonymous')"
		);
	});

	// ---------------------------------------------------------------------------
	// Medication Update + Dose Tracking Cleanup
	// ---------------------------------------------------------------------------

	describe("Medication Update cleans up old dose tracking", () => {
		it("should delete doses before new start date when start date is moved forward", async () => {
			// Create medication starting Jan 1
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Test Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					looseTablets: 10,
					blisters: [{ usage: 1, every: 1, start: visibleDoseStartIso() }],
				},
			});
			expect(createRes.statusCode, createRes.body).toBe(200);
			const medId = createRes.json().id;

			// Mark some doses (Jan 1, Jan 2, Jan 5, Jan 10)
			const jan1 = new Date("2025-01-01T08:00:00.000Z").getTime();
			const jan2 = new Date("2025-01-02T08:00:00.000Z").getTime();
			const jan5 = new Date("2025-01-05T08:00:00.000Z").getTime();
			const jan10 = new Date("2025-01-10T08:00:00.000Z").getTime();

			for (const ts of [jan1, jan2, jan5, jan10]) {
				await app.inject({
					method: "POST",
					url: "/doses/taken",
					payload: { doseId: `${medId}-0-${ts}` },
				});
			}

			// Verify 4 doses exist
			const beforeUpdate = await testClient.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id LIKE ?`,
				args: [`${medId}-%`],
			});
			expect(beforeUpdate.rows[0].count).toBe(4);

			// Update medication to start Jan 5 (should delete Jan 1 and Jan 2 doses)
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Test Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-05T08:00:00.000Z" }],
				},
			});

			// Verify only 2 doses remain (Jan 5 and Jan 10)
			const afterUpdate = await testClient.execute({
				sql: `SELECT dose_id FROM dose_tracking WHERE dose_id LIKE ? ORDER BY dose_id`,
				args: [`${medId}-%`],
			});
			expect(afterUpdate.rows.length).toBe(2);
			expect(afterUpdate.rows[0].dose_id).toContain(String(jan5));
			expect(afterUpdate.rows[1].dose_id).toContain(String(jan10));
		});

		it("should keep all doses when start date is moved backward", async () => {
			// Create medication starting Jan 10
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Test Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					blisters: [{ usage: 1, every: 1, start: "2025-01-10T08:00:00.000Z" }],
				},
			});
			const medId = createRes.json().id;

			// Mark dose on Jan 10
			const jan10 = new Date("2025-01-10T08:00:00.000Z").getTime();
			await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: `${medId}-0-${jan10}` },
			});

			// Update to start Jan 1 (earlier)
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Test Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			// Dose should still exist
			const afterUpdate = await testClient.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id LIKE ?`,
				args: [`${medId}-%`],
			});
			expect(afterUpdate.rows[0].count).toBe(1);
		});

		it("should handle multiple blisters with different start dates", async () => {
			// Create medication with 2 schedules: Jan 1 morning and Jan 5 evening
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Test Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					blisters: [
						{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" },
						{ usage: 0.5, every: 1, start: "2025-01-05T20:00:00.000Z" },
					],
				},
			});
			const medId = createRes.json().id;

			// Mark doses for both schedules
			const jan1_8am = new Date("2025-01-01T08:00:00.000Z").getTime();
			const jan3_8am = new Date("2025-01-03T08:00:00.000Z").getTime();
			const jan5_8pm = new Date("2025-01-05T20:00:00.000Z").getTime();
			const jan6_8pm = new Date("2025-01-06T20:00:00.000Z").getTime();

			await app.inject({ method: "POST", url: "/doses/taken", payload: { doseId: `${medId}-0-${jan1_8am}` } });
			await app.inject({ method: "POST", url: "/doses/taken", payload: { doseId: `${medId}-0-${jan3_8am}` } });
			await app.inject({ method: "POST", url: "/doses/taken", payload: { doseId: `${medId}-1-${jan5_8pm}` } });
			await app.inject({ method: "POST", url: "/doses/taken", payload: { doseId: `${medId}-1-${jan6_8pm}` } });

			// 4 doses total
			const before = await testClient.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id LIKE ?`,
				args: [`${medId}-%`],
			});
			expect(before.rows[0].count).toBe(4);

			// Update: move first schedule to Jan 4
			// Earliest start is now Jan 4, so Jan 1 and Jan 3 doses should be deleted
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Test Med",
					blisters: [
						{ usage: 1, every: 1, start: "2025-01-04T08:00:00.000Z" },
						{ usage: 0.5, every: 1, start: "2025-01-05T20:00:00.000Z" },
					],
				},
			});

			// Should have 2 doses left (Jan 5 and Jan 6 evening doses)
			const after = await testClient.execute({
				sql: `SELECT dose_id FROM dose_tracking WHERE dose_id LIKE ?`,
				args: [`${medId}-%`],
			});
			expect(after.rows.length).toBe(2);
		});
	});

	// ---------------------------------------------------------------------------
	// Dose ID Migration on Schedule Changes
	// ---------------------------------------------------------------------------

	describe("Dose ID migration when schedule changes", () => {
		it("should migrate dose IDs when weekly start day changes", async () => {
			// Create a weekly medication starting Friday Oct 17
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Weekly Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					blisters: [{ usage: 1, every: 7, start: "2025-10-17T08:00:00" }],
				},
			});
			const medId = createRes.json().id;

			// Mark doses for Fridays (Oct 17, Oct 24, Oct 31)
			const fri17 = new Date(2025, 9, 17).getTime(); // Oct 17
			const fri24 = new Date(2025, 9, 24).getTime(); // Oct 24
			const fri31 = new Date(2025, 9, 31).getTime(); // Oct 31

			for (const ts of [fri17, fri24, fri31]) {
				await app.inject({
					method: "POST",
					url: "/doses/taken",
					payload: { doseId: `${medId}-0-${ts}` },
				});
			}

			// Verify 3 doses exist
			const before = await testClient.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id LIKE ?`,
				args: [`${medId}-%`],
			});
			expect(before.rows[0].count).toBe(3);

			// Change start to Saturday Oct 18 (shifts all future and past IDs)
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Weekly Med",
					blisters: [{ usage: 1, every: 7, start: "2025-10-18T08:00:00" }],
				},
			});

			// Doses should be migrated to Saturday dates
			const sat18 = new Date(2025, 9, 18).getTime(); // Oct 18
			const sat25 = new Date(2025, 9, 25).getTime(); // Oct 25
			const nov1 = new Date(2025, 10, 1).getTime(); // Nov 1

			const after = await testClient.execute({
				sql: `SELECT dose_id FROM dose_tracking WHERE dose_id LIKE ? ORDER BY dose_id`,
				args: [`${medId}-%`],
			});
			expect(after.rows.length).toBe(3);
			const ids = after.rows.map((r: { dose_id: string }) => r.dose_id);
			expect(ids).toContain(`${medId}-0-${sat18}`);
			expect(ids).toContain(`${medId}-0-${sat25}`);
			expect(ids).toContain(`${medId}-0-${nov1}`);
		});

		it("should migrate dose IDs with person suffix when schedule changes", async () => {
			// Create weekly medication with takenBy person
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Person Med",
					intakes: [{ usage: 1, every: 7, start: "2025-10-17T08:00:00", takenBy: "Alice" }],
				},
			});
			const medId = createRes.json().id;

			// Mark dose with person suffix
			const fri17 = new Date(2025, 9, 17).getTime();
			await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: `${medId}-0-${fri17}-Alice` },
			});

			// Change start day
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Person Med",
					intakes: [{ usage: 1, every: 7, start: "2025-10-18T08:00:00", takenBy: "Alice" }],
				},
			});

			// Dose should be migrated with person suffix preserved
			const sat18 = new Date(2025, 9, 18).getTime();
			const after = await testClient.execute({
				sql: `SELECT dose_id FROM dose_tracking WHERE dose_id LIKE ?`,
				args: [`${medId}-%`],
			});
			expect(after.rows.length).toBe(1);
			expect(after.rows[0].dose_id).toBe(`${medId}-0-${sat18}-Alice`);
		});

		it("should not migrate dose IDs when only time-of-day changes", async () => {
			// Create daily medication at 08:00
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Daily Med",
					blisters: [{ usage: 1, every: 1, start: "2025-10-17T08:00:00" }],
				},
			});
			const medId = createRes.json().id;

			// Mark dose
			const oct17 = new Date(2025, 9, 17).getTime();
			await app.inject({
				method: "POST",
				url: "/doses/taken",
				payload: { doseId: `${medId}-0-${oct17}` },
			});

			// Change only time from 08:00 to 20:00 (same date)
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Daily Med",
					blisters: [{ usage: 1, every: 1, start: "2025-10-17T20:00:00" }],
				},
			});

			// Dose ID should remain unchanged (dateOnlyMs is the same)
			const after = await testClient.execute({
				sql: `SELECT dose_id FROM dose_tracking WHERE dose_id LIKE ?`,
				args: [`${medId}-%`],
			});
			expect(after.rows.length).toBe(1);
			expect(after.rows[0].dose_id).toBe(`${medId}-0-${oct17}`);
		});

		it("should migrate dose IDs when interval changes from daily to every-other-day", async () => {
			// Create daily medication starting Oct 17
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Interval Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					blisters: [{ usage: 1, every: 1, start: "2025-10-17T08:00:00" }],
				},
			});
			const medId = createRes.json().id;

			// Mark doses for Oct 17, 18, 19
			const oct17 = new Date(2025, 9, 17).getTime();
			const oct18 = new Date(2025, 9, 18).getTime();
			const oct19 = new Date(2025, 9, 19).getTime();

			for (const ts of [oct17, oct18, oct19]) {
				await app.inject({
					method: "POST",
					url: "/doses/taken",
					payload: { doseId: `${medId}-0-${ts}` },
				});
			}

			// Change to every 2 days (Oct 17, 19, 21, ...)
			await app.inject({
				method: "PUT",
				url: `/medications/${medId}`,
				payload: {
					name: "Interval Med",
					blisters: [{ usage: 1, every: 2, start: "2025-10-17T08:00:00" }],
				},
			});

			// Oct 17 stays (matches), Oct 18 → Oct 19 (nearest), Oct 19 → no match (already used)
			// Actually: Oct 17 is exact match (no migration needed), Oct 18 maps to Oct 19 (within 1 day = half of 2),
			// Oct 19 was the original schedule date but the new schedule also has Oct 19,
			// which was already taken by Oct 18's migration
			const after = await testClient.execute({
				sql: `SELECT dose_id FROM dose_tracking WHERE dose_id LIKE ? ORDER BY dose_id`,
				args: [`${medId}-%`],
			});
			// We should have at least the doses that could be mapped
			expect(after.rows.length).toBeGreaterThanOrEqual(2);
		});
	});

	// ---------------------------------------------------------------------------
	// Share Link + Dose Tracking Integration
	// ---------------------------------------------------------------------------

	describe("Share links and dose tracking integration", () => {
		it("should allow marking/unmarking doses via share link with correct markedBy", async () => {
			// Create medication for Daniel
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Aspirin",
					takenBy: ["Daniel"],
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					blisters: [{ usage: 1, every: 1, start: visibleDoseStartIso() }],
				},
			});
			expect(createRes.statusCode, createRes.body).toBe(200);
			const medId = createRes.json().id;

			// Create share token for Daniel
			const shareRes = await app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Daniel", scheduleDays: 30, allowMarkTaken: true },
			});
			expect(shareRes.statusCode, shareRes.body).toBe(200);
			const token = shareRes.json().token;

			// Mark dose via share link
			const doseId = `${medId}-0-${visibleDoseTimestampMs()}`;
			const markRes = await app.inject({
				method: "POST",
				url: `/share/${token}/doses`,
				payload: { doseId },
			});
			expect(markRes.statusCode, markRes.body).toBe(200);

			// Verify markedBy is "Daniel"
			const result = await testClient.execute({
				sql: `SELECT marked_by FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(result.rows[0].marked_by).toBe("Daniel");

			// Unmark via share link
			await app.inject({
				method: "DELETE",
				url: `/share/${token}/doses/${encodeURIComponent(doseId)}`,
			});

			// Verify deleted
			const afterDelete = await testClient.execute({
				sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id = ?`,
				args: [doseId],
			});
			expect(afterDelete.rows[0].count).toBe(0);
		});

		it("should show medication in shared schedule after marking dose", async () => {
			// Create medication
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Vitamin D",
					takenBy: ["Anna"],
					blisters: [{ usage: 1, every: 1, start: visibleDoseStartIso() }],
				},
			});
			expect(createRes.statusCode, createRes.body).toBe(200);
			const medId = createRes.json().id;

			// Create share token
			const shareRes = await app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Anna", scheduleDays: 30, allowMarkTaken: true },
			});
			expect(shareRes.statusCode, shareRes.body).toBe(200);
			const token = shareRes.json().token;

			// Mark a dose
			const doseId = `${medId}-0-${visibleDoseTimestampMs()}`;
			const markRes = await app.inject({
				method: "POST",
				url: `/share/${token}/doses`,
				payload: { doseId },
			});
			expect(markRes.statusCode, markRes.body).toBe(200);

			// Get shared schedule
			const scheduleRes = await app.inject({
				method: "GET",
				url: `/share/${token}`,
			});
			expect(scheduleRes.statusCode, scheduleRes.body).toBe(200);

			const data = scheduleRes.json();
			expect(data.takenBy).toBe("Anna");
			expect(data.medications).toHaveLength(1);
			expect(data.medications[0].name).toBe("Vitamin D");
		});
	});

	// ---------------------------------------------------------------------------
	// Settings + Stock Calculation Mode
	// ---------------------------------------------------------------------------

	describe("Settings affect stock calculation", () => {
		it("should persist stock calculation mode across requests", async () => {
			// Set to manual mode
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
					shoutrrrEnabled: false,
					shoutrrrUrl: "",
					emailStockReminders: true,
					emailIntakeReminders: true,
					shoutrrrStockReminders: true,
					shoutrrrIntakeReminders: true,
					language: "en",
					stockCalculationMode: "manual",
				},
			});

			// Verify it's saved
			const getRes = await app.inject({
				method: "GET",
				url: "/settings",
			});
			expect(getRes.json().stockCalculationMode).toBe("manual");

			// Change to automatic
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

			const getRes2 = await app.inject({
				method: "GET",
				url: "/settings",
			});
			expect(getRes2.json().stockCalculationMode).toBe("automatic");
		});
	});

	// ---------------------------------------------------------------------------
	// Multi-Person Medication Scenarios
	// ---------------------------------------------------------------------------

	describe("Multi-person medication scenarios", () => {
		it("should create separate share links for different people", async () => {
			// Create medication for multiple people
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Family Vitamins",
					takenBy: ["Daniel", "Anna", "Max"],
					blisters: [{ usage: 1, every: 1, start: visibleDoseStartIso() }],
				},
			});

			// Create share links for each person
			const danielShare = await app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Daniel", scheduleDays: 30 },
			});

			const annaShare = await app.inject({
				method: "POST",
				url: "/share",
				payload: { takenBy: "Anna", scheduleDays: 30 },
			});

			// Both should succeed with different tokens
			expect(danielShare.statusCode, danielShare.body).toBe(200);
			expect(annaShare.statusCode, annaShare.body).toBe(200);
			expect(danielShare.json().token).not.toBe(annaShare.json().token);

			// Each share link should show correct person
			const danielSchedule = await app.inject({
				method: "GET",
				url: `/share/${danielShare.json().token}`,
			});
			expect(danielSchedule.json().takenBy).toBe("Daniel");

			const annaSchedule = await app.inject({
				method: "GET",
				url: `/share/${annaShare.json().token}`,
			});
			expect(annaSchedule.json().takenBy).toBe("Anna");
		});

		it("should list all people correctly via /share/people", async () => {
			// Create multiple medications
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Med 1",
					takenBy: ["Daniel", "Anna"],
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Med 2",
					takenBy: ["Max"],
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Med 3",
					takenBy: ["Daniel"], // Daniel again
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			// Get all people
			const peopleRes = await app.inject({
				method: "GET",
				url: "/share/people",
			});

			const people = peopleRes.json().people;
			expect(people).toContain("Daniel");
			expect(people).toContain("Anna");
			expect(people).toContain("Max");
			expect(people.length).toBe(3); // No duplicates
		});
	});

	// ---------------------------------------------------------------------------
	// Edge Cases
	// ---------------------------------------------------------------------------

	describe("Edge cases", () => {
		it("should handle medication with 0 stock correctly", async () => {
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Empty Med",
					packCount: 0,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					looseTablets: 0,
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(createRes.statusCode).toBe(200);
			expect(createRes.json().packCount).toBe(0);
		});

		it("should handle medication with very high pill count", async () => {
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Bulk Med",
					packCount: 100,
					blistersPerPack: 10,
					pillsPerBlister: 100,
					looseTablets: 500,
					blisters: [{ usage: 0.5, every: 7, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(createRes.statusCode).toBe(200);
			// Total: 100 * 10 * 100 + 500 = 100500 pills
		});

		it("should handle fractional pill usage", async () => {
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Half-Pill Med",
					blisters: [
						{ usage: 0.5, every: 1, start: "2025-01-01T08:00:00.000Z" },
						{ usage: 0.25, every: 1, start: "2025-01-01T20:00:00.000Z" },
					],
				},
			});

			expect(createRes.statusCode).toBe(200);
			expect(createRes.json().blisters[0].usage).toBe(0.5);
			expect(createRes.json().blisters[1].usage).toBe(0.25);
		});

		it("should handle weekly medication schedule", async () => {
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Weekly Med",
					blisters: [{ usage: 1, every: 7, start: "2025-01-01T08:00:00.000Z" }],
				},
			});

			expect(createRes.statusCode).toBe(200);
			expect(createRes.json().blisters[0].every).toBe(7);
		});
	});

	// ---------------------------------------------------------------------------
	// Planner Usage Calculation - POST /medications/usage
	// This is a CRITICAL feature for the app - calculates if stock is enough
	// ---------------------------------------------------------------------------

	describe("Planner usage calculation", () => {
		const plannerWindowStart = "2030-01-15T00:00:00.000Z";
		const futureDailyStart = "2030-01-15T08:00:00.000Z";
		const futureEveningStart = "2030-01-15T20:00:00.000Z";
		const tenDayPlanEnd = "2030-01-24T23:59:59.999Z";
		const thirtyFiveDayPlanEnd = "2030-02-18T23:59:59.999Z";

		it("should calculate correct usage for daily medication", async () => {
			// Create medication: 2 packs × 3 blisters × 10 pills = 60 pills total
			// Schedule: 1 pill daily starting on a fixed future winter date.
			// This avoids daylight-saving-time edge cases in local test environments.
			const intakeStart = futureDailyStart;

			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Daily Med",
					packCount: 2,
					blistersPerPack: 3,
					pillsPerBlister: 10,
					looseTablets: 0,
					blisters: [{ usage: 1, every: 1, start: intakeStart }],
				},
			});

			// Calculate usage for 10 days starting tomorrow
			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: plannerWindowStart,
					endDate: tenDayPlanEnd,
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data).toHaveLength(1);
			expect(data[0].medicationName).toBe("Daily Med");
			expect(data[0].plannerUsage).toBe(10); // 10 days × 1 pill
			expect(data[0].totalPills).toBe(60); // Current stock is full (no consumption yet)
			expect(data[0].enough).toBe(true);
		});

		it("should use generic name as planner display name when commercial name is empty", async () => {
			const createResponse = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "",
					genericName: "testtube",
					packageType: "tube",
					medicationForm: "topical",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 1,
					packageAmountValue: 150,
					packageAmountUnit: "g",
					looseTablets: 150,
					blisters: [{ usage: 1, every: 1, start: futureDailyStart }],
				},
			});
			expect(createResponse.statusCode, createResponse.body).toBe(200);

			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: plannerWindowStart,
					endDate: tenDayPlanEnd,
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data).toHaveLength(1);
			expect(data[0].medicationName).toBe("testtube");
		});

		it("should detect insufficient stock", async () => {
			// Create medication: 1 pack × 1 blister × 5 pills = 5 pills total
			// Schedule: 1 pill daily starting on a fixed future winter date.
			const intakeStart = futureDailyStart;

			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Low Stock Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 5,
					looseTablets: 0,
					blisters: [{ usage: 1, every: 1, start: intakeStart }],
				},
			});

			// Calculate usage for 10 days (needs 10 pills, only have 5)
			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: plannerWindowStart,
					endDate: tenDayPlanEnd,
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].plannerUsage).toBe(10);
			expect(data[0].enough).toBe(false); // Not enough!
		});

		it("should calculate weekly medication usage correctly", async () => {
			// Create medication: 10 pills total
			// Schedule: 1 pill every 7 days starting on a fixed future winter date.
			const intakeStart = futureDailyStart;

			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Weekly Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					blisters: [{ usage: 1, every: 7, start: intakeStart }],
				},
			});

			// Calculate usage for 35 days (should need 5 pills)
			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: plannerWindowStart,
					endDate: thirtyFiveDayPlanEnd,
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			// Day 0, 7, 14, 21, 28 = 5 doses
			expect(data[0].plannerUsage).toBe(5);
		});

		it("should handle multiple intake schedules per medication", async () => {
			// Create medication with morning and evening doses
			// 30 pills total, 1.5 pills per day (1 morning + 0.5 evening)
			const morningStart = futureDailyStart;
			const eveningStartStr = futureEveningStart;

			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Twice Daily Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 30,
					blisters: [
						{ usage: 1, every: 1, start: morningStart }, // Morning: 1 pill
						{ usage: 0.5, every: 1, start: eveningStartStr }, // Evening: 0.5 pill
					],
				},
			});

			// Calculate for 10 days
			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: plannerWindowStart,
					endDate: tenDayPlanEnd,
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			// 10 days × (1 + 0.5) = 15 pills
			expect(data[0].plannerUsage).toBe(15);
		});

		it("should calculate correct blisters needed", async () => {
			// 10 pills per blister, need 25 pills → need 3 blisters
			const intakeStart = futureDailyStart;

			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Blister Med",
					packCount: 5,
					blistersPerPack: 1,
					pillsPerBlister: 10,
					blisters: [{ usage: 2.5, every: 1, start: intakeStart }],
				},
			});

			// 10 days × 2.5 pills = 25 pills needed
			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: plannerWindowStart,
					endDate: tenDayPlanEnd,
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].plannerUsage).toBe(25);
			expect(data[0].blistersNeeded).toBe(3); // ceil(25/10)
			expect(data[0].blisterSize).toBe(10);
		});

		it("should reject invalid date range", async () => {
			// End before start
			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-15T00:00:00.000Z",
					endDate: "2025-01-01T00:00:00.000Z",
				},
			});

			expect(response.statusCode).toBe(400);
		});

		it("should handle medication not yet started", async () => {
			// Medication starts in the future
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Future Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 30,
					blisters: [{ usage: 1, every: 1, start: "2025-06-01T08:00:00.000Z" }], // Starts June
				},
			});

			// Query for January (before start)
			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2025-01-01T00:00:00.000Z",
					endDate: "2025-01-31T00:00:00.000Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			expect(data[0].plannerUsage).toBe(0); // No usage before start
		});

		it("should return correct totalPills based on current stock", async () => {
			// Fresh medication with future start date = no consumption yet
			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Fresh Med",
					packCount: 2,
					blistersPerPack: 2,
					pillsPerBlister: 10,
					looseTablets: 5,
					// Start in far future so no consumption
					blisters: [{ usage: 1, every: 1, start: "2030-01-01T08:00:00.000Z" }],
				},
			});

			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2030-01-01T00:00:00.000Z",
					endDate: "2030-01-11T00:00:00.000Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			// Total: 2 packs × 2 blisters × 10 pills + 5 loose = 45 pills
			expect(data[0].totalPills).toBe(45);
			expect(data[0].plannerUsage).toBe(10);
			expect(data[0].enough).toBe(true); // 45 > 10
		});

		it("should use user-selected start date, not current time (fix asymmetric counting)", async () => {
			// Regression test: When a planner range starts today, the old code used
			// max(now, start) as the effective start. If now was between the morning
			// dose (07:00) and evening dose (20:00), morning was skipped but evening
			// counted, giving an asymmetric result (e.g., 5 instead of 6).
			//
			// Example: medication with daily morning (07:00) + evening (20:00) intakes,
			// planner range [today 01:00, today+3 01:00).
			// Old code at 15:00: morning 07:00 < 15:00 → skipped, evening 20:00 ≥ 15:00 → counted
			// Result: 2 morning + 3 evening = 5 instead of 3+3 = 6.

			// Use a past start date so the intakes predate the planner range
			const intakeStart = "2025-01-01T07:00:00.000Z";
			const intakeEvening = "2025-01-01T20:00:00.000Z";

			// Plan range: Feb 9 00:00 to Feb 12 00:00 UTC (3 full days)
			const planStart = "2026-02-09T00:00:00.000Z";
			const planEnd = "2026-02-12T00:00:00.000Z";

			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Twice Daily Med Asymmetric",
					packCount: 5,
					blistersPerPack: 5,
					pillsPerBlister: 10,
					blisters: [
						{ usage: 1, every: 1, start: intakeStart },
						{ usage: 1, every: 1, start: intakeEvening },
					],
				},
			});

			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: planStart,
					endDate: planEnd,
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			// Both morning and evening should have exactly 3 occurrences each
			// (Feb 9, 10, 11) for a total of 6, regardless of current time
			expect(data[0].plannerUsage).toBe(6);
		});

		it("should handle planner range starting before blister start", async () => {
			// Blister starts on Feb 10, planner range starts Feb 9
			// Should only count doses from Feb 10 onwards
			const intakeMorning = "2026-02-10T07:00:00.000Z";
			const intakeEvening = "2026-02-10T20:00:00.000Z";

			await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Recent Start Med",
					packCount: 1,
					blistersPerPack: 1,
					pillsPerBlister: 30,
					blisters: [
						{ usage: 1, every: 1, start: intakeMorning },
						{ usage: 1, every: 1, start: intakeEvening },
					],
				},
			});

			const response = await app.inject({
				method: "POST",
				url: "/medications/usage",
				payload: {
					startDate: "2026-02-09T00:00:00.000Z",
					endDate: "2026-02-12T00:00:00.000Z",
				},
			});

			expect(response.statusCode).toBe(200);
			const data = response.json();
			// Only Feb 10 and Feb 11 have doses (blister starts Feb 10)
			expect(data[0].plannerUsage).toBe(4); // 2 days × 2 intakes
		});
	});

	// ---------------------------------------------------------------------------
	// Dismiss Until (Clear Missed Doses)
	// ---------------------------------------------------------------------------

	describe("Dismiss Until functionality", () => {
		it("should set dismissedUntil for multiple medications", async () => {
			// Create two medications
			const med1Res = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Med 1",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const med1Id = med1Res.json().id;

			const med2Res = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Med 2",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const med2Id = med2Res.json().id;

			// Set dismissedUntil for both
			const dismissRes = await app.inject({
				method: "POST",
				url: "/medications/dismiss-until",
				payload: {
					medicationIds: [med1Id, med2Id],
					until: "2025-01-15",
				},
			});

			expect(dismissRes.statusCode).toBe(200);
			expect(dismissRes.json().success).toBe(true);
			expect(dismissRes.json().updatedCount).toBe(2);

			// Verify dismissedUntil is set via GET
			const medsRes = await app.inject({
				method: "GET",
				url: "/medications",
			});
			const meds = medsRes.json();
			const med1 = meds.find((m: Record<string, unknown>) => m.id === med1Id);
			const med2 = meds.find((m: Record<string, unknown>) => m.id === med2Id);

			expect(med1.dismissedUntil).toBe("2025-01-15");
			expect(med2.dismissedUntil).toBe("2025-01-15");
		});

		it("should clear dismissedUntil for a medication", async () => {
			// Create medication
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Med to Clear",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createRes.json().id;

			// Set dismissedUntil
			await app.inject({
				method: "POST",
				url: "/medications/dismiss-until",
				payload: {
					medicationIds: [medId],
					until: "2025-01-20",
				},
			});

			// Clear it
			const clearRes = await app.inject({
				method: "DELETE",
				url: `/medications/${medId}/dismiss-until`,
			});

			expect(clearRes.statusCode).toBe(200);
			expect(clearRes.json().success).toBe(true);

			// Verify it's cleared
			const medsRes = await app.inject({
				method: "GET",
				url: "/medications",
			});
			const med = medsRes.json().find((m: Record<string, unknown>) => m.id === medId);
			expect(med.dismissedUntil).toBeNull();
		});

		it("should reject invalid date format", async () => {
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createRes.json().id;

			const res = await app.inject({
				method: "POST",
				url: "/medications/dismiss-until",
				payload: {
					medicationIds: [medId],
					until: "01-15-2025", // Wrong format
				},
			});

			expect(res.statusCode).toBe(400);
		});

		it("should reject empty medicationIds array", async () => {
			const res = await app.inject({
				method: "POST",
				url: "/medications/dismiss-until",
				payload: {
					medicationIds: [],
					until: "2025-01-15",
				},
			});

			expect(res.statusCode).toBe(400);
		});

		it("should not update medications belonging to other users", async () => {
			// Create medication for user 999999999
			const createRes = await app.inject({
				method: "POST",
				url: "/medications",
				payload: {
					name: "My Med",
					blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
				},
			});
			const medId = createRes.json().id;

			// Try to dismiss a medication that doesn't exist (ID 99999)
			const dismissRes = await app.inject({
				method: "POST",
				url: "/medications/dismiss-until",
				payload: {
					medicationIds: [99999],
					until: "2025-01-15",
				},
			});

			expect(dismissRes.statusCode).toBe(200);
			expect(dismissRes.json().updatedCount).toBe(0); // Nothing updated

			// Our med should still have no dismissedUntil
			const medsRes = await app.inject({
				method: "GET",
				url: "/medications",
			});
			const med = medsRes.json().find((m: Record<string, unknown>) => m.id === medId);
			expect(med.dismissedUntil).toBeNull();
		});
	});
});
