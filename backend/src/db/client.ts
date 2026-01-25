import { accessSync, constants, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Client, createClient } from "@libsql/client";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

// Get migrations folder path (relative to this file's location)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

// =============================================================================
// Exported utility functions for testing
// =============================================================================

/** Build the database URL from a path */
export function buildDbUrl(dbPath: string): string {
	return `file:${dbPath}`;
}

/** Get data directory and database path */
export function getDbPaths(cwd: string = process.cwd()): { dataDir: string; dbPath: string; url: string } {
	const dataDir = resolve(cwd, "data");
	const dbPath = resolve(dataDir, "medassist-ng.db");
	const url = buildDbUrl(dbPath);
	return { dataDir, dbPath, url };
}

/** Ensure data directory exists and is writable */
export function ensureDataDirectory(dataDir: string): { success: boolean; error?: string } {
	try {
		if (!existsSync(dataDir)) {
			mkdirSync(dataDir, { recursive: true });
		}

		// Check if directory is writable
		accessSync(dataDir, constants.W_OK);

		// Try to create a test file to verify write access
		const testFile = resolve(dataDir, ".write-test");
		writeFileSync(testFile, "test");

		return { success: true };
	} catch (err: any) {
		return { success: false, error: err.message };
	}
}

/** Run drizzle-kit migrations on the database */
export async function runDrizzleMigrations(
	database: ReturnType<typeof drizzle>
): Promise<{ success: boolean; error?: string; warning?: string }> {
	try {
		await migrate(database, { migrationsFolder });
		return { success: true };
	} catch (err: any) {
		// If the error is "duplicate column", it means the schema is already up-to-date
		// This happens when ALTER migrations in client.ts have already added the columns
		// We consider this a success with a warning, not a failure
		if (err.message?.includes("duplicate column")) {
			return { success: true, warning: `Schema already up-to-date: ${err.message}` };
		}
		return { success: false, error: err.message };
	}
}

/** Run ALTER TABLE migrations for backward compatibility with older databases */
export async function runAlterMigrations(client: Client): Promise<{ success: boolean; errors: string[] }> {
	const errors: string[] = [];

	// These add new columns to existing tables (silently fail if column already exists)
	const alterMigrations = [
		// Added in v1.x - repeat reminders and nagging settings
		`ALTER TABLE user_settings ADD COLUMN skip_reminders_for_taken_doses integer NOT NULL DEFAULT 0`,
		`ALTER TABLE user_settings ADD COLUMN repeat_reminders_enabled integer NOT NULL DEFAULT 0`,
		`ALTER TABLE user_settings ADD COLUMN reminder_repeat_interval_minutes integer NOT NULL DEFAULT 30`,
		`ALTER TABLE user_settings ADD COLUMN max_nagging_reminders integer NOT NULL DEFAULT 5`,
		// Added in v1.2.3 - dismiss missed doses without deducting stock
		`ALTER TABLE dose_tracking ADD COLUMN dismissed integer NOT NULL DEFAULT 0`,
		// Added in v1.3.x - stock calculation mode (automatic/manual)
		`ALTER TABLE user_settings ADD COLUMN stock_calculation_mode text NOT NULL DEFAULT 'automatic'`,
		// Added for stock correction - hidden offset that doesn't affect looseTablets
		`ALTER TABLE medications ADD COLUMN stock_adjustment integer NOT NULL DEFAULT 0`,
		// Added for stock correction - timestamp to ignore consumed doses before correction
		`ALTER TABLE medications ADD COLUMN last_stock_correction_at integer`,
		// Added in v1.5.1 - dismiss past doses until date (robust against timestamp changes)
		`ALTER TABLE medications ADD COLUMN dismissed_until text`,
		// Added for more detailed reminder info display
		`ALTER TABLE user_settings ADD COLUMN last_reminder_med_name text`,
		`ALTER TABLE user_settings ADD COLUMN last_reminder_taken_by text`,
	];

	for (const sql of alterMigrations) {
		try {
			await client.execute(sql);
		} catch (e: any) {
			// Silently ignore "duplicate column" errors - column already exists
			if (!e.message?.includes("duplicate column")) {
				errors.push(e.message);
			}
		}
	}

	// Create tables that might be missing (silently fail if already exists)
	const createTableMigrations = [
		// Added in v1.3.x - refill history tracking
		`CREATE TABLE IF NOT EXISTS refill_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      packs_added INTEGER NOT NULL DEFAULT 0,
      loose_pills_added INTEGER NOT NULL DEFAULT 0,
      refill_date INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )`,
	];

	for (const sql of createTableMigrations) {
		try {
			await client.execute(sql);
		} catch (e: any) {
			// Silently ignore "table already exists" errors
			if (!e.message?.includes("already exists")) {
				errors.push(e.message);
			}
		}
	}

	return { success: errors.length === 0, errors };
}

/** Ensure default user exists for auth-disabled mode */
export async function ensureDefaultUser(client: Client, authEnabled: boolean): Promise<boolean> {
	if (authEnabled) {
		return false; // No default user needed
	}

	try {
		const result = await client.execute("SELECT id FROM users WHERE id = 1");
		if (result.rows.length === 0) {
			await client.execute("INSERT INTO users (id, username, auth_provider) VALUES (1, 'default', 'local')");
			return true; // Created
		}
		return false; // Already exists
	} catch (e: any) {
		console.error(`[DB] Error creating default user:`, e.message);
		return false;
	}
}

// =============================================================================
// Database initialization (runs on import)
// =============================================================================

// Use absolute path to ensure it works in Docker
const { dataDir, dbPath, url } = getDbPaths();

console.log(`[DB] Data directory: ${dataDir}`);
console.log(`[DB] Database path: ${dbPath}`);
console.log(`[DB] Database URL: ${url}`);

// Ensure data directory exists and is writable
const dirResult = ensureDataDirectory(dataDir);
if (!dirResult.success) {
	console.error(`[DB] ERROR: Cannot access data directory: ${dirResult.error}`);
	console.error(`[DB] Please ensure the volume mount has correct permissions.`);
	console.error(`[DB] Try running on host: sudo chown -R 1000:1000 ${dataDir}`);
	process.exit(1);
} else {
	console.log(`[DB] Data directory is writable`);

	// Log directory stats
	const stats = statSync(dataDir);
	console.log(`[DB] Directory permissions: ${stats.mode.toString(8)}`);
	console.log(`[DB] Directory UID: ${stats.uid}, GID: ${stats.gid}`);
	console.log(`[DB] Write test successful`);
}

let client: Client;
try {
	client = createClient({ url });
	console.log(`[DB] Database client created successfully`);
} catch (err: any) {
	console.error(`[DB] ERROR: Failed to create database client: ${err.message}`);
	console.error(`[DB] Database path: ${dbPath}`);
	process.exit(1);
}

export const db = drizzle(client);

// Auto-run migrations (self-healing database)
async function runMigrations() {
	// Run drizzle-kit generated migrations
	console.log(`[DB] Running drizzle migrations from: ${migrationsFolder}`);
	const migrateResult = await runDrizzleMigrations(db);
	if (!migrateResult.success) {
		console.error(`[DB] Migration error:`, migrateResult.error);
	} else if (migrateResult.warning) {
		console.log(`[DB] Migration warning:`, migrateResult.warning);
	} else {
		console.log(`[DB] Drizzle migrations completed`);
	}

	// Run ALTER TABLE migrations for backward compatibility
	const alterResult = await runAlterMigrations(client);
	if (alterResult.errors.length > 0) {
		alterResult.errors.forEach((err) => console.error(`[DB] ALTER migration error:`, err));
	}
	console.log(`[DB] Tables verified/created`);

	// If auth is disabled, ensure a default user exists (ID=1)
	const authEnabled = process.env.AUTH_ENABLED === "true";
	const created = await ensureDefaultUser(client, authEnabled);
	if (created) {
		console.log(`[DB] Created default user for auth-disabled mode`);
	}
}

// Export promise so server can await it before starting
export const migrationsReady = runMigrations();
