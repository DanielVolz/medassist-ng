/**
 * Test setup and utilities for MedAssist backend API tests.
 * Uses in-memory SQLite for isolation between test files.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach } from "vitest";
import { jwtPlugin } from "../plugins/jwt.js";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";

// Get migrations folder path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

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
	const app = Fastify({ logger: false, ajv: documentationSchemaAjv });

	await app.register(sensible);
	await app.register(cookie, { secret: "test-cookie-secret" });
	await app.register(jwtPlugin, {
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
 * Create test database schema using drizzle-kit migrations
 */
async function runTestMigrations(client: Client): Promise<void> {
	const db = drizzle(client);
	await migrate(db, { migrationsFolder });
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
export async function createTestUser(client: Client, options: CreateUserOptions = {}): Promise<number> {
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
	expiryDate?: string | null;
	notes?: string | null;
	intakeRemindersEnabled?: boolean;
	/** Array of { usage, every, start } for each blister schedule */
	blisters?: Array<{ usage: number; every: number; start: string }>;
}

/**
 * Create a test medication and return the ID
 */
export async function createTestMedication(client: Client, options: CreateMedicationOptions): Promise<number> {
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
		expiryDate = null,
		notes = null,
		intakeRemindersEnabled = false,
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
      pill_weight_mg, usage_json, every_json, start_json, expiry_date, notes, intake_reminders_enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
			expiryDate,
			notes,
			intakeRemindersEnabled ? 1 : 0,
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
export async function createTestShareToken(client: Client, options: CreateShareTokenOptions): Promise<string> {
	const { userId, takenBy, token = `test_token_${Date.now()}`, scheduleDays = 30, expiresAt = null } = options;

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
export async function createTestDoseTracking(client: Client, options: CreateDoseTrackingOptions): Promise<void> {
	const { userId, doseId, markedBy = null, takenAt = Math.floor(Date.now() / 1000) } = options;

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
	shareStockStatus?: boolean;
	shareMedicationOverview?: boolean;
}

/**
 * Create or update user settings
 */
export async function setUserSettings(client: Client, options: UpdateUserSettingsOptions): Promise<void> {
	const {
		userId,
		stockCalculationMode = "automatic",
		lowStockDays = 30,
		shareStockStatus,
		shareMedicationOverview,
	} = options;

	// Check if settings exist
	const existing = await client.execute({
		sql: `SELECT id FROM user_settings WHERE user_id = ?`,
		args: [userId],
	});

	if (existing.rows.length > 0) {
		const updateArgs = [stockCalculationMode, lowStockDays] as Array<string | number>;
		let updateSql = "UPDATE user_settings SET stock_calculation_mode = ?, low_stock_days = ?";

		if (shareStockStatus !== undefined) {
			updateSql += ", share_stock_status = ?";
			updateArgs.push(shareStockStatus ? 1 : 0);
		}

		if (shareMedicationOverview !== undefined) {
			updateSql += ", share_medication_overview = ?";
			updateArgs.push(shareMedicationOverview ? 1 : 0);
		}

		updateSql += " WHERE user_id = ?";
		updateArgs.push(userId);

		await client.execute({
			sql: updateSql,
			args: updateArgs,
		});
	} else {
		const insertColumns = ["user_id", "stock_calculation_mode", "low_stock_days"];
		const insertPlaceholders = ["?", "?", "?"];
		const insertArgs = [userId, stockCalculationMode, lowStockDays] as Array<string | number>;

		if (shareStockStatus !== undefined) {
			insertColumns.push("share_stock_status");
			insertPlaceholders.push("?");
			insertArgs.push(shareStockStatus ? 1 : 0);
		}

		if (shareMedicationOverview !== undefined) {
			insertColumns.push("share_medication_overview");
			insertPlaceholders.push("?");
			insertArgs.push(shareMedicationOverview ? 1 : 0);
		}

		await client.execute({
			sql: `INSERT INTO user_settings (${insertColumns.join(", ")}) VALUES (${insertPlaceholders.join(", ")})`,
			args: insertArgs,
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
	await client.execute("DELETE FROM refill_history");
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
process.env.DOTENV_PATH = "/tmp/medassist-nonexistent.env";
process.env.AUTH_ENABLED = "false";
process.env.OIDC_ENABLED = "false";
process.env.NODE_ENV = "test";

afterEach(() => {
	process.env.DOTENV_PATH = "/tmp/medassist-nonexistent.env";
	process.env.AUTH_ENABLED = "false";
	process.env.OIDC_ENABLED = "false";
});
