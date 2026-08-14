import { existsSync, statSync } from "node:fs";
import { type Client, createClient, type Transaction } from "@libsql/client";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import { parseBoolEnv } from "../utils/env-parsing.js";
import { log } from "../utils/logger.js";
import { ensureDefaultUser, runAlterMigrations, runDrizzleMigrations } from "./migration-utils.js";
// Import utilities from focused DB modules (side-effect-free)
import { ensureDataDirectory, getDbPaths } from "./path-utils.js";
import { repairOrphanedDoseIds, repairTrailingHyphenDoseIds } from "./repair-utils.js";

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

log.debug(`[DB] Data directory: ${dataDir}`);
log.debug(`[DB] Database path: ${dbPath}`);
log.debug(`[DB] Database URL: ${url}`);

// Ensure data directory exists and is writable
const dirResult = ensureDataDirectory(dataDir);
if (!dirResult.success) {
	log.error(`[DB] ERROR: Cannot access data directory: ${dirResult.error}`);
	log.error(`[DB] Please ensure the volume mount has correct permissions.`);
	log.error(`[DB] Try running on host: sudo chown -R 1000:1000 ${dataDir}`);
	process.exit(1);
} else {
	log.debug(`[DB] Data directory is writable`);

	// Log directory stats
	const stats = statSync(dataDir);
	log.debug(`[DB] Directory permissions: ${stats.mode.toString(8)}`);
	log.debug(`[DB] Directory UID: ${stats.uid}, GID: ${stats.gid}`);
	log.debug(`[DB] Write test successful`);
}

let client: Client;
try {
	client = createClient({ url });
	log.debug(`[DB] Database client created successfully`);
} catch (err: unknown) {
	log.error(`[DB] ERROR: Failed to create database client: ${(err as Error).message}`);
	log.error(`[DB] Database path: ${dbPath}`);
	process.exit(1);
}

export const db = drizzle(client);

let immediateWriteTail = Promise.resolve();

function reserveImmediateWriteTurn(): Promise<() => void> {
	const previousTurn = immediateWriteTail;
	let releaseTurn: () => void = () => undefined;
	immediateWriteTail = new Promise<void>((resolve) => {
		releaseTurn = resolve;
	});

	return previousTurn.then(() => releaseTurn);
}

/**
 * Run a callback in a process-local FIFO BEGIN IMMEDIATE transaction.
 *
 * libSQL opens another file connection for each overlapping transaction call, so the queue must cover
 * acquisition through commit/rollback. External-process contention is attempted once and propagates
 * SQLITE_BUSY; retrying BEGIN while another writer commits can itself destabilize that commit.
 */
export async function withImmediateWriteTransaction<T>(
	operation: (transactionDb: typeof db) => Promise<T>
): Promise<T> {
	const releaseTurn = await reserveImmediateWriteTurn();
	let transaction: Transaction | undefined;

	try {
		transaction = await client.transaction("write");
		const transactionDb = drizzle(transaction as unknown as Client);
		const result = await operation(transactionDb);
		await transaction.commit();
		return result;
	} catch (error) {
		if (transaction && !transaction.closed) {
			await transaction.rollback();
		}
		// The SQLite client can leave a failed BEGIN IMMEDIATE statement active on its
		// reusable connection. Reconnect only when acquisition itself failed so the
		// next FIFO writer is not poisoned, while preserving the original error.
		if (!transaction) {
			try {
				await client.reconnect();
			} catch {
				// The original transaction-acquisition error is the actionable result.
			}
		}
		throw error;
	} finally {
		transaction?.close();
		releaseTurn();
	}
}

// Auto-run migrations (self-healing database)
async function runMigrations() {
	// Run drizzle-kit generated migrations
	log.info(`[DB] Running migrations...`);
	const migrateResult = await runDrizzleMigrations(db);
	if (!migrateResult.success) {
		log.error(`[DB] Migration error: ${migrateResult.error}`);
	}

	// Run ALTER TABLE migrations for backward compatibility
	const alterResult = await runAlterMigrations(client);
	if (alterResult.errors.length > 0) {
		alterResult.errors.forEach((err) => log.error(`[DB] ALTER migration error: ${err}`));
	}
	log.debug(`[DB] Tables verified/created`);

	// Repair dose IDs with trailing hyphens (from frontend takenBy bug)
	const trailingResult = await repairTrailingHyphenDoseIds(client);
	if (trailingResult.repaired > 0) {
		log.info(`[DB] Repaired ${trailingResult.repaired} dose IDs with trailing hyphens`);
	}
	if (trailingResult.errors.length > 0) {
		trailingResult.errors.forEach((err) => log.error(`[DB] Trailing-hyphen repair error: ${err}`));
	}

	// Repair orphaned dose tracking IDs from past schedule changes
	const repairResult = await repairOrphanedDoseIds(client);
	if (repairResult.repaired > 0) {
		log.info(`[DB] Repaired ${repairResult.repaired} orphaned dose tracking IDs`);
	}
	if (repairResult.errors.length > 0) {
		repairResult.errors.forEach((err) => log.error(`[DB] Dose repair error: ${err}`));
	}

	// If auth is disabled, ensure a default user exists (ID=1)
	const authEnabled = parseBoolEnv(process.env.AUTH_ENABLED, false);
	const created = await ensureDefaultUser(client, authEnabled);
	if (created) {
		log.info(`[DB] Created default user for auth-disabled mode`);
	}
}

// Export promise so server can await it before starting
export const migrationsReady = runMigrations();
