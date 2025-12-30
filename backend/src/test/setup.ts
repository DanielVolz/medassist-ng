/**
 * Test setup and utilities for MedAssist backend API tests.
 * Uses in-memory SQLite for isolation between test files.
 */
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import sensible from "@fastify/sensible";
import fastifyMultipart from "@fastify/multipart";
import { createClient, Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, afterAll, beforeEach } from "vitest";

// Type for our test database
export type TestDb = ReturnType<typeof drizzle>;

// =============================================================================
// Test App Builder
// =============================================================================
export interface TestContext {
  app: FastifyInstance;
  db: TestDb;
  client: Client;
}

/**
 * Build a test Fastify app with in-memory SQLite.
 * Each test file gets its own isolated database.
 */
export async function buildTestApp(): Promise<TestContext> {
  // Create in-memory SQLite database
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);

  // Run schema creation
  await runTestMigrations(client);

  // Create Fastify app with minimal plugins
  const app = Fastify({ logger: false });

  await app.register(sensible);
  await app.register(cookie, { secret: "test-cookie-secret" });
  await app.register(jwt, {
    secret: "test-jwt-secret",
    cookie: { cookieName: "access_token", signed: false },
  });
  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // Decorate config (matches index.ts structure)
  app.decorate("config", {
    accessSecret: "test-jwt-secret",
    refreshSecret: "test-refresh-secret",
    accessTtl: 15,
    refreshTtl: 7,
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/" },
    refreshCookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/" },
  });

  return { app, db, client };
}

/**
 * Create test database schema
 */
async function runTestMigrations(client: Client): Promise<void> {
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
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL,
      token_id text NOT NULL UNIQUE,
      expires_at integer NOT NULL,
      rotated_at integer,
      revoked integer NOT NULL DEFAULT 0,
      created_at integer NOT NULL DEFAULT (strftime('%s','now')),
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

  for (const sql of tableCreations) {
    await client.execute(sql);
  }
}

// =============================================================================
// Factory Helpers
// =============================================================================

export interface CreateUserOptions {
  username?: string;
  authProvider?: string;
}

/**
 * Create a test user and return the ID
 */
export async function createTestUser(
  client: Client,
  options: CreateUserOptions = {}
): Promise<number> {
  const { username = `user_${Date.now()}`, authProvider = "local" } = options;

  const result = await client.execute({
    sql: `INSERT INTO users (username, auth_provider) VALUES (?, ?) RETURNING id`,
    args: [username, authProvider],
  });

  return result.rows[0].id as number;
}

export interface CreateMedicationOptions {
  userId: number;
  name?: string;
  genericName?: string;
  takenBy?: string[];
  packCount?: number;
  blistersPerPack?: number;
  pillsPerBlister?: number;
  looseTablets?: number;
  pillWeightMg?: number;
  /** Array of { usage, every, start } for each blister schedule */
  blisters?: Array<{ usage: number; every: number; start: string }>;
}

/**
 * Create a test medication and return the ID
 */
export async function createTestMedication(
  client: Client,
  options: CreateMedicationOptions
): Promise<number> {
  const {
    userId,
    name = "Test Medication",
    genericName = null,
    takenBy = [],
    packCount = 1,
    blistersPerPack = 1,
    pillsPerBlister = 10,
    looseTablets = 0,
    pillWeightMg = null,
    blisters = [{ usage: 1, every: 1, start: new Date().toISOString() }],
  } = options;

  // Extract arrays from blisters
  const usageJson = JSON.stringify(blisters.map((b) => b.usage));
  const everyJson = JSON.stringify(blisters.map((b) => b.every));
  const startJson = JSON.stringify(blisters.map((b) => b.start));
  const takenByJson = JSON.stringify(takenBy);

  const result = await client.execute({
    sql: `INSERT INTO medications (
      user_id, name, generic_name, taken_by_json,
      pack_count, blisters_per_pack, pills_per_blister, loose_tablets,
      pill_weight_mg, usage_json, every_json, start_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [
      userId,
      name,
      genericName,
      takenByJson,
      packCount,
      blistersPerPack,
      pillsPerBlister,
      looseTablets,
      pillWeightMg,
      usageJson,
      everyJson,
      startJson,
    ],
  });

  return result.rows[0].id as number;
}

export interface CreateShareTokenOptions {
  userId: number;
  takenBy: string;
  token?: string;
  scheduleDays?: number;
  expiresAt?: number | null;
}

/**
 * Create a test share token and return the token string
 */
export async function createTestShareToken(
  client: Client,
  options: CreateShareTokenOptions
): Promise<string> {
  const {
    userId,
    takenBy,
    token = `test_token_${Date.now()}`,
    scheduleDays = 30,
    expiresAt = null,
  } = options;

  await client.execute({
    sql: `INSERT INTO share_tokens (user_id, token, taken_by, schedule_days, expires_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [userId, token, takenBy, scheduleDays, expiresAt],
  });

  return token;
}

export interface CreateDoseTrackingOptions {
  userId: number;
  doseId: string;
  markedBy?: string | null;
  takenAt?: number;
}

/**
 * Create a dose tracking record
 */
export async function createTestDoseTracking(
  client: Client,
  options: CreateDoseTrackingOptions
): Promise<void> {
  const {
    userId,
    doseId,
    markedBy = null,
    takenAt = Math.floor(Date.now() / 1000),
  } = options;

  await client.execute({
    sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by, taken_at)
          VALUES (?, ?, ?, ?)`,
    args: [userId, doseId, markedBy, takenAt],
  });
}

export interface UpdateUserSettingsOptions {
  userId: number;
  stockCalculationMode?: "automatic" | "manual";
  lowStockDays?: number;
}

/**
 * Create or update user settings
 */
export async function setUserSettings(
  client: Client,
  options: UpdateUserSettingsOptions
): Promise<void> {
  const { userId, stockCalculationMode = "automatic", lowStockDays = 30 } = options;

  // Check if settings exist
  const existing = await client.execute({
    sql: `SELECT id FROM user_settings WHERE user_id = ?`,
    args: [userId],
  });

  if (existing.rows.length > 0) {
    await client.execute({
      sql: `UPDATE user_settings SET stock_calculation_mode = ?, low_stock_days = ? WHERE user_id = ?`,
      args: [stockCalculationMode, lowStockDays, userId],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO user_settings (user_id, stock_calculation_mode, low_stock_days) VALUES (?, ?, ?)`,
      args: [userId, stockCalculationMode, lowStockDays],
    });
  }
}

// =============================================================================
// Test Cleanup
// =============================================================================

/**
 * Close test app and database connections
 */
export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  ctx.client.close();
}

/**
 * Clear all data from test database (between tests)
 */
export async function clearTestData(client: Client): Promise<void> {
  // Order matters due to foreign keys
  await client.execute("DELETE FROM dose_tracking");
  await client.execute("DELETE FROM share_tokens");
  await client.execute("DELETE FROM refresh_tokens");
  await client.execute("DELETE FROM user_settings");
  await client.execute("DELETE FROM medications");
  await client.execute("DELETE FROM users");
}

// =============================================================================
// Vitest Global Setup
// =============================================================================

// Set test environment
process.env.AUTH_ENABLED = "false";
process.env.NODE_ENV = "test";
