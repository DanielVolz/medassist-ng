import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { type Client, createClient } from "@libsql/client";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/libsql";

// Import utilities from db-utils (side-effect-free)
import {
	ensureDataDirectory,
	ensureDefaultUser,
	getDataDir,
	getDbPaths,
	repairOrphanedDoseIds,
	repairTrailingHyphenDoseIds,
	runAlterMigrations,
	runDrizzleMigrations,
} from "./db-utils.js";

// Re-export all utilities so existing imports from client.ts keep working
export {
	buildDbUrl,
	ensureDataDirectory,
	ensureDefaultUser,
	getDataDir,
	getDbPaths,
	repairOrphanedDoseIds,
	repairTrailingHyphenDoseIds,
	runAlterMigrations,
	runDrizzleMigrations,
} from "./db-utils.js";

// Load .env: try cwd first, then parent dir (for local dev running from backend/)
const envPath = process.env.DOTENV_PATH || (existsSync(".env") ? ".env" : "../.env");
dotenv.config({ path: envPath });

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
	console.log(`[DB] Running drizzle migrations...`);
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
