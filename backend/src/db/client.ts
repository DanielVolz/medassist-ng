import { accessSync, constants, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Client, createClient } from "@libsql/client";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { parseIntakesJson, parseLocalDateTime } from "../utils/scheduler-utils.js";

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
		// Added for package type support (blister vs bottle)
		`ALTER TABLE medications ADD COLUMN package_type text NOT NULL DEFAULT 'blister'`,
		`ALTER TABLE medications ADD COLUMN total_pills integer`,
		// Added for dose unit selection (mg, g, mcg, ml, IU, etc.)
		`ALTER TABLE medications ADD COLUMN dose_unit text DEFAULT 'mg'`,
		// Added for intake-level takenBy: unified intakes structure
		`ALTER TABLE medications ADD COLUMN intakes_json text NOT NULL DEFAULT '[]'`,
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
// Startup repair: fix orphaned dose tracking IDs from past schedule changes
// =============================================================================

const MS_PER_DAY = 86_400_000;

/**
 * Repair dose IDs that have a trailing hyphen caused by a frontend bug where
 * `[].toString()` produced an empty string, resulting in IDs like "5-0-1729123200000-"
 * instead of "5-0-1729123200000". This strips trailing hyphens from all dose IDs.
 *
 * This function is idempotent - safe to run on every startup.
 */
export async function repairTrailingHyphenDoseIds(client: Client): Promise<{ repaired: number; errors: string[] }> {
	const errors: string[] = [];
	let repaired = 0;

	try {
		const result = await client.execute(
			"UPDATE dose_tracking SET dose_id = RTRIM(dose_id, '-') WHERE dose_id LIKE '%-'"
		);
		repaired = result.rowsAffected;
	} catch (e: any) {
		errors.push(`Trailing-hyphen repair failed: ${e.message}`);
	}

	return { repaired, errors };
}

/**
 * Repair orphaned dose tracking IDs that no longer match the current intake schedule.
 * This fixes dose IDs that became invalid when a medication's schedule was changed
 * BEFORE the on-edit migration (PR #103) was introduced.
 *
 * For each medication, generates all valid schedule dateOnlyMs values from each intake's
 * start date up to today, then checks all dose_tracking entries. Any dose whose timestamp
 * doesn't match a valid schedule date is remapped to the nearest valid date.
 *
 * This function is idempotent - safe to run on every startup.
 */
export async function repairOrphanedDoseIds(client: Client): Promise<{ repaired: number; errors: string[] }> {
	const errors: string[] = [];
	let repaired = 0;

	try {
		// Get all medications
		const medsResult = await client.execute(
			"SELECT id, intakes_json, usage_json, every_json, start_json, intake_reminders_enabled FROM medications"
		);

		if (medsResult.rows.length === 0) return { repaired, errors };

		// Get all dose tracking entries
		const dosesResult = await client.execute("SELECT id, dose_id FROM dose_tracking");
		if (dosesResult.rows.length === 0) return { repaired, errors };

		// Build a map of medId → dose entries for quick lookup
		const dosesByMed = new Map<number, Array<{ id: number; doseId: string }>>();
		for (const row of dosesResult.rows) {
			const doseId = row.dose_id as string;
			const parts = doseId.split("-");
			if (parts.length < 3) continue;
			const medId = parseInt(parts[0], 10);
			if (Number.isNaN(medId)) continue;
			if (!dosesByMed.has(medId)) dosesByMed.set(medId, []);
			dosesByMed.get(medId)!.push({ id: row.id as number, doseId });
		}

		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

		for (const med of medsResult.rows) {
			const medId = med.id as number;
			const medDoses = dosesByMed.get(medId);
			if (!medDoses || medDoses.length === 0) continue;

			// Parse intakes
			const intakes = parseIntakesJson(
				med.intakes_json as string | null,
				{
					usageJson: (med.usage_json as string) || "[]",
					everyJson: (med.every_json as string) || "[]",
					startJson: (med.start_json as string) || "[]",
				},
				(med.intake_reminders_enabled as number) === 1
			);

			if (intakes.length === 0) continue;

			// For each intake index, build the set of valid dateOnlyMs values
			const validDatesByIntake = new Map<number, Set<number>>();
			for (let idx = 0; idx < intakes.length; idx++) {
				const intake = intakes[idx];
				const start = parseLocalDateTime(intake.start);
				const every = intake.every;
				if (every <= 0 || Number.isNaN(start.getTime())) continue;

				const validDates = new Set<number>();
				for (let d = new Date(start); d <= today; d.setDate(d.getDate() + every)) {
					validDates.add(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
				}
				validDatesByIntake.set(idx, validDates);
			}

			// Check each dose entry
			for (const dose of medDoses) {
				const parts = dose.doseId.split("-");
				if (parts.length < 3) continue;

				const intakeIdx = parseInt(parts[1], 10);
				const dateOnlyMs = parseInt(parts[2], 10);
				if (Number.isNaN(intakeIdx) || Number.isNaN(dateOnlyMs)) continue;

				const validDates = validDatesByIntake.get(intakeIdx);
				if (!validDates) continue; // Unknown intake index - skip

				// Check if this dose's timestamp is valid
				if (validDates.has(dateOnlyMs)) continue; // Already valid - nothing to do

				// Orphaned dose - find the nearest valid schedule date
				const intake = intakes[intakeIdx];
				if (!intake) continue;

				const halfInterval = (intake.every * MS_PER_DAY) / 2;
				let bestMatch: number | null = null;
				let bestDist = Infinity;

				for (const validDate of validDates) {
					const dist = Math.abs(validDate - dateOnlyMs);
					if (dist < bestDist && dist <= halfInterval) {
						bestDist = dist;
						bestMatch = validDate;
					}
				}

				if (bestMatch !== null) {
					// Rebuild dose ID with new timestamp, preserving person suffix
					const personSuffix = parts.length > 3 ? `-${parts.slice(3).join("-")}` : "";
					const newDoseId = `${medId}-${intakeIdx}-${bestMatch}${personSuffix}`;

					try {
						await client.execute({
							sql: "UPDATE dose_tracking SET dose_id = ? WHERE id = ?",
							args: [newDoseId, dose.id],
						});
						repaired++;
					} catch (e: any) {
						errors.push(`Failed to repair dose ${dose.id}: ${e.message}`);
					}
				}
			}
		}
	} catch (e: any) {
		errors.push(`Repair failed: ${e.message}`);
	}

	return { repaired, errors };
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

	// Repair dose IDs with trailing hyphens (from frontend takenBy bug)
	const trailingResult = await repairTrailingHyphenDoseIds(client);
	if (trailingResult.repaired > 0) {
		console.log(`[DB] Repaired ${trailingResult.repaired} dose IDs with trailing hyphens`);
	}
	if (trailingResult.errors.length > 0) {
		trailingResult.errors.forEach((err) => console.error(`[DB] Trailing-hyphen repair error:`, err));
	}

	// Repair orphaned dose tracking IDs from past schedule changes
	const repairResult = await repairOrphanedDoseIds(client);
	if (repairResult.repaired > 0) {
		console.log(`[DB] Repaired ${repairResult.repaired} orphaned dose tracking IDs`);
	}
	if (repairResult.errors.length > 0) {
		repairResult.errors.forEach((err) => console.error(`[DB] Dose repair error:`, err));
	}

	// If auth is disabled, ensure a default user exists (ID=1)
	const authEnabled = process.env.AUTH_ENABLED === "true";
	const created = await ensureDefaultUser(client, authEnabled);
	if (created) {
		console.log(`[DB] Created default user for auth-disabled mode`);
	}
}

// Export promise so server can await it before starting
export const migrationsReady = runMigrations();
