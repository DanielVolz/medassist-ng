import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Get the data directory path.
 *
 * Resolution order:
 * 1. DATA_DIR env var (set by docker-compose for containers)
 * 2. Monorepo detection: if ../docker-compose.yml exists, we're in backend/
 *    subdirectory -> use ../data (project root's data folder)
 * 3. Fallback: resolve(cwd, "data") (running from project root or standalone)
 */
export function getDataDir(cwd: string = process.cwd()): string {
	if (process.env.DATA_DIR) return resolve(process.env.DATA_DIR);

	if (existsSync(resolve(cwd, "..", "docker-compose.yml"))) {
		return resolve(cwd, "..", "data");
	}

	return resolve(cwd, "data");
}

/** Build the database URL from a path */
export function buildDbUrl(dbPath: string): string {
	return `file:${dbPath}`;
}

/** Get data directory and database path */
export function getDbPaths(cwd: string = process.cwd()): { dataDir: string; dbPath: string; url: string } {
	const dataDir = getDataDir(cwd);
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

		accessSync(dataDir, constants.W_OK);
		return { success: true };
	} catch (err: unknown) {
		return { success: false, error: (err as Error).message };
	}
}
