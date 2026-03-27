/**
 * Compatibility barrel for DB utilities.
 *
 * New code should prefer importing from focused modules:
 * - ./path-utils.js
 * - ./migration-utils.js
 * - ./repair-utils.js
 */

export { ensureDefaultUser, runAlterMigrations, runDrizzleMigrations } from "./migration-utils.js";
export { buildDbUrl, ensureDataDirectory, getDataDir, getDbPaths } from "./path-utils.js";
export { repairOrphanedDoseIds, repairTrailingHyphenDoseIds } from "./repair-utils.js";
