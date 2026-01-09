/**
 * Integration Tests - Testing interactions between multiple routes/features
 * These tests verify critical app behavior that spans multiple components.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import sensible from "@fastify/sensible";
import fastifyMultipart from "@fastify/multipart";
import { createClient, Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

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
      pack_count integer NOT NULL DEFAULT 1,
      blisters_per_pack integer NOT NULL DEFAULT 1,
      pills_per_blister integer NOT NULL DEFAULT 1,
      loose_tablets integer NOT NULL DEFAULT 0,
      pill_weight_mg integer,
      usage_json text NOT NULL DEFAULT '[]',
      every_json text NOT NULL DEFAULT '[]',
      start_json text NOT NULL DEFAULT '[]',
      image_url text,
      expiry_date text,
      notes text,
      intake_reminders_enabled integer NOT NULL DEFAULT 0,
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
      shoutrrr_enabled integer NOT NULL DEFAULT 0,
      shoutrrr_url text,
      shoutrrr_stock_reminders integer NOT NULL DEFAULT 1,
      shoutrrr_intake_reminders integer NOT NULL DEFAULT 1,
      reminder_days_before integer NOT NULL DEFAULT 7,
      repeat_daily_reminders integer NOT NULL DEFAULT 0,
      skip_reminders_for_taken_doses integer NOT NULL DEFAULT 0,
      low_stock_days integer NOT NULL DEFAULT 30,
      normal_stock_days integer NOT NULL DEFAULT 90,
      high_stock_days integer NOT NULL DEFAULT 180,
      expiry_warning_days integer NOT NULL DEFAULT 90,
      language text NOT NULL DEFAULT 'en',
      stock_calculation_mode text NOT NULL DEFAULT 'automatic',
      last_auto_email_sent text,
      last_notification_type text,
      last_notification_channel text,
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

// =============================================================================
// Tests
// =============================================================================

describe("Integration Tests", () => {
  let app: FastifyInstance;
  const userId = 999999999;

  beforeAll(async () => {
    await createSchema(testClient);

    app = Fastify({ logger: false });
    await app.register(sensible);
    await app.register(cookie, { secret: "test-cookie-secret" });
    await app.register(jwt, {
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
          blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
        },
      });
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
          blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
        },
      });
      const medId = createRes.json().id;

      // Create share token for Daniel
      const shareRes = await app.inject({
        method: "POST",
        url: "/share",
        payload: { takenBy: "Daniel", scheduleDays: 30 },
      });
      const token = shareRes.json().token;

      // Mark dose via share link
      const doseId = `${medId}-0-${new Date("2025-01-01T08:00:00.000Z").getTime()}`;
      await app.inject({
        method: "POST",
        url: `/share/${token}/doses`,
        payload: { doseId },
      });

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
          blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
        },
      });
      const medId = createRes.json().id;

      // Create share token
      const shareRes = await app.inject({
        method: "POST",
        url: "/share",
        payload: { takenBy: "Anna", scheduleDays: 30 },
      });
      const token = shareRes.json().token;

      // Mark a dose
      const doseId = `${medId}-0-${new Date("2025-01-05T08:00:00.000Z").getTime()}`;
      await app.inject({
        method: "POST",
        url: `/share/${token}/doses`,
        payload: { doseId },
      });

      // Get shared schedule
      const scheduleRes = await app.inject({
        method: "GET",
        url: `/share/${token}`,
      });

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
          blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
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
      expect(danielShare.statusCode).toBe(200);
      expect(annaShare.statusCode).toBe(200);
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
    it("should calculate correct usage for daily medication", async () => {
      // Create medication: 2 packs × 3 blisters × 10 pills = 60 pills total
      // Schedule: 1 pill daily starting Jan 1
      await app.inject({
        method: "POST",
        url: "/medications",
        payload: {
          name: "Daily Med",
          packCount: 2,
          blistersPerPack: 3,
          pillsPerBlister: 10,
          looseTablets: 0,
          blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
        },
      });

      // Calculate usage for Jan 1-10 (10 days = 10 pills needed)
      const response = await app.inject({
        method: "POST",
        url: "/medications/usage",
        payload: {
          startDate: "2025-01-01T00:00:00.000Z",
          endDate: "2025-01-11T00:00:00.000Z", // 10 days
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveLength(1);
      expect(data[0].medicationName).toBe("Daily Med");
      expect(data[0].plannerUsage).toBe(10); // 10 days × 1 pill
      // Note: 'enough' depends on current stock after consumption since start date
      // Since test runs ~364 days after Jan 1, most pills are consumed
    });

    it("should detect insufficient stock", async () => {
      // Create medication: 1 pack × 1 blister × 5 pills = 5 pills total
      // Schedule: 1 pill daily
      await app.inject({
        method: "POST",
        url: "/medications",
        payload: {
          name: "Low Stock Med",
          packCount: 1,
          blistersPerPack: 1,
          pillsPerBlister: 5,
          looseTablets: 0,
          blisters: [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }],
        },
      });

      // Calculate usage for 10 days (needs 10 pills, only have 5 originally)
      const response = await app.inject({
        method: "POST",
        url: "/medications/usage",
        payload: {
          startDate: "2025-01-01T00:00:00.000Z",
          endDate: "2025-01-11T00:00:00.000Z",
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data[0].plannerUsage).toBe(10);
      expect(data[0].enough).toBe(false); // Not enough!
    });

    it("should calculate weekly medication usage correctly", async () => {
      // Create medication: 10 pills total
      // Schedule: 1 pill every 7 days starting Jan 1
      await app.inject({
        method: "POST",
        url: "/medications",
        payload: {
          name: "Weekly Med",
          packCount: 1,
          blistersPerPack: 1,
          pillsPerBlister: 10,
          blisters: [{ usage: 1, every: 7, start: "2025-01-01T08:00:00.000Z" }],
        },
      });

      // Calculate usage for 30 days (should need ~4-5 pills)
      const response = await app.inject({
        method: "POST",
        url: "/medications/usage",
        payload: {
          startDate: "2025-01-01T00:00:00.000Z",
          endDate: "2025-01-31T00:00:00.000Z", // 30 days
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      // Jan 1, 8, 15, 22, 29 = 5 doses
      expect(data[0].plannerUsage).toBe(5);
    });

    it("should handle multiple intake schedules per medication", async () => {
      // Create medication with morning and evening doses
      // 30 pills total, 1.5 pills per day (1 morning + 0.5 evening)
      await app.inject({
        method: "POST",
        url: "/medications",
        payload: {
          name: "Twice Daily Med",
          packCount: 1,
          blistersPerPack: 1,
          pillsPerBlister: 30,
          blisters: [
            { usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" },   // Morning: 1 pill
            { usage: 0.5, every: 1, start: "2025-01-01T20:00:00.000Z" }, // Evening: 0.5 pill
          ],
        },
      });

      // Calculate for 10 days
      const response = await app.inject({
        method: "POST",
        url: "/medications/usage",
        payload: {
          startDate: "2025-01-01T00:00:00.000Z",
          endDate: "2025-01-11T00:00:00.000Z",
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      // 10 days × (1 + 0.5) = 15 pills
      expect(data[0].plannerUsage).toBe(15);
    });

    it("should calculate correct blisters needed", async () => {
      // 10 pills per blister, need 25 pills → need 3 blisters
      await app.inject({
        method: "POST",
        url: "/medications",
        payload: {
          name: "Blister Med",
          packCount: 5,
          blistersPerPack: 1,
          pillsPerBlister: 10,
          blisters: [{ usage: 2.5, every: 1, start: "2025-01-01T08:00:00.000Z" }],
        },
      });

      // 10 days × 2.5 pills = 25 pills needed
      const response = await app.inject({
        method: "POST",
        url: "/medications/usage",
        payload: {
          startDate: "2025-01-01T00:00:00.000Z",
          endDate: "2025-01-11T00:00:00.000Z",
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
  });
});
