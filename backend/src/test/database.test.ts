import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Import the exported utility functions from client.ts
import {
	buildDbUrl,
	ensureDataDirectory,
	ensureDefaultUser,
	getDbPaths,
	runAlterMigrations,
	runDrizzleMigrations,
} from "../db/client.js";

// Import the exported utility functions from migrate.ts
import { executeMigration, getStatementPreview, splitSQLStatements } from "../db/migrate.js";

// Get migrations folder path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

describe("Migration Script Utilities", () => {
	describe("executeMigration", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(() => {
			client = createClient({ url: ":memory:" });
		});

		it("should execute all migrations successfully", async () => {
			const result = await executeMigration(client);
			expect(result.success).toBe(true);
			expect(result.executed).toBeGreaterThan(0);
			expect(result.errors).toHaveLength(0);
		});

		it("should create all tables", async () => {
			await executeMigration(client);

			const tables = await client.execute(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name"
			);

			const tableNames = tables.rows.map((r) => r.name);
			expect(tableNames).toContain("users");
			expect(tableNames).toContain("medications");
			expect(tableNames).toContain("user_settings");
			expect(tableNames).toContain("refresh_tokens");
			expect(tableNames).toContain("share_tokens");
			expect(tableNames).toContain("dose_tracking");
			expect(tableNames).toContain("refill_history");
		});

		it("should be idempotent", async () => {
			await executeMigration(client);
			const result = await executeMigration(client);
			expect(result.success).toBe(true);
		});

		it("should allow inserting data after migration", async () => {
			await executeMigration(client);

			await client.execute("INSERT INTO users (username) VALUES ('testuser')");
			const result = await client.execute("SELECT * FROM users");
			expect(result.rows).toHaveLength(1);
		});
	});

	describe("splitSQLStatements", () => {
		it("should split SQL by semicolons", () => {
			const sql = "SELECT 1; SELECT 2; SELECT 3;";
			const statements = splitSQLStatements(sql);
			expect(statements).toHaveLength(3);
		});

		it("should filter out empty statements", () => {
			const sql = "SELECT 1;; ; SELECT 2;";
			const statements = splitSQLStatements(sql);
			expect(statements).toHaveLength(2);
		});

		it("should handle statements without trailing semicolon", () => {
			const sql = "SELECT 1; SELECT 2";
			const statements = splitSQLStatements(sql);
			expect(statements).toHaveLength(2);
		});

		it("should preserve whitespace within statements", () => {
			const sql = "CREATE TABLE test (\n  id INTEGER\n);";
			const statements = splitSQLStatements(sql);
			expect(statements[0]).toContain("\n");
		});
	});

	describe("getStatementPreview", () => {
		it("should return full string if shorter than maxLength", () => {
			const preview = getStatementPreview("SELECT 1", 50);
			expect(preview).toBe("SELECT 1");
		});

		it("should truncate and add ellipsis if longer than maxLength", () => {
			const preview = getStatementPreview("SELECT * FROM very_long_table_name WHERE condition = true", 20);
			expect(preview).toBe("SELECT * FROM very_l...");
			expect(preview.length).toBe(23); // 20 + "..."
		});

		it("should use default maxLength of 50", () => {
			const longStmt = "A".repeat(100);
			const preview = getStatementPreview(longStmt);
			expect(preview).toBe(`${"A".repeat(50)}...`);
		});

		it("should trim whitespace", () => {
			const preview = getStatementPreview("  SELECT 1  ", 50);
			expect(preview).toBe("SELECT 1");
		});

		it("should handle CREATE TABLE statements", () => {
			const stmt = "CREATE TABLE IF NOT EXISTS users (id integer PRIMARY KEY)";
			const preview = getStatementPreview(stmt, 30);
			expect(preview).toBe("CREATE TABLE IF NOT EXISTS use...");
		});
	});
});

describe("Database Client Utilities", () => {
	describe("buildDbUrl", () => {
		it("should build a file:// URL from path", () => {
			const url = buildDbUrl("/path/to/db.sqlite");
			expect(url).toBe("file:/path/to/db.sqlite");
		});

		it("should handle relative paths", () => {
			const url = buildDbUrl("./data/test.db");
			expect(url).toBe("file:./data/test.db");
		});
	});

	describe("getDbPaths", () => {
		it("should return correct paths based on cwd", () => {
			const paths = getDbPaths("/app");
			expect(paths.dataDir).toBe("/app/data");
			expect(paths.dbPath).toBe("/app/data/medassist-ng.db");
			expect(paths.url).toBe("file:/app/data/medassist-ng.db");
		});

		it("should use process.cwd() by default", () => {
			const paths = getDbPaths();
			expect(paths.dataDir).toContain("data");
			expect(paths.dbPath).toContain("medassist-ng.db");
		});
	});

	describe("ensureDataDirectory", () => {
		const testDir = resolve(tmpdir(), `test-data-dir-${Date.now()}`);

		afterEach(() => {
			try {
				if (existsSync(testDir)) {
					rmSync(testDir, { recursive: true, force: true });
				}
			} catch {
				// ignore cleanup errors
			}
		});

		it("should create directory if it does not exist", () => {
			const result = ensureDataDirectory(testDir);
			expect(result.success).toBe(true);
			expect(existsSync(testDir)).toBe(true);
		});

		it("should succeed if directory already exists", () => {
			mkdirSync(testDir, { recursive: true });
			const result = ensureDataDirectory(testDir);
			expect(result.success).toBe(true);
		});

		it("should create .write-test file", () => {
			const result = ensureDataDirectory(testDir);
			expect(result.success).toBe(true);
			expect(existsSync(resolve(testDir, ".write-test"))).toBe(true);
		});

		it("should return error for invalid path", () => {
			// Try to create in a path that can't exist
			const result = ensureDataDirectory("/nonexistent/root/path/that/cannot/exist");
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("runDrizzleMigrations", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(() => {
			client = createClient({ url: ":memory:" });
		});

		it("should create all tables successfully", async () => {
			const db = drizzle(client);
			const result = await runDrizzleMigrations(db);
			expect(result.success).toBe(true);
		});

		it("should be idempotent (run twice without errors)", async () => {
			const db = drizzle(client);
			await runDrizzleMigrations(db);
			const result = await runDrizzleMigrations(db);
			expect(result.success).toBe(true);
		});

		it("should create all 7 tables", async () => {
			const db = drizzle(client);
			await runDrizzleMigrations(db);

			const tables = await client.execute(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name"
			);

			const tableNames = tables.rows.map((r) => r.name);
			expect(tableNames).toContain("users");
			expect(tableNames).toContain("medications");
			expect(tableNames).toContain("user_settings");
			expect(tableNames).toContain("refresh_tokens");
			expect(tableNames).toContain("share_tokens");
			expect(tableNames).toContain("dose_tracking");
			expect(tableNames).toContain("refill_history");
		});
	});

	describe("runAlterMigrations", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(async () => {
			client = createClient({ url: ":memory:" });
			const db = drizzle(client);
			await migrate(db, { migrationsFolder });
		});

		it("should run without errors on a fresh database", async () => {
			const result = await runAlterMigrations(client);
			expect(result.success).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("should be idempotent", async () => {
			await runAlterMigrations(client);
			const result = await runAlterMigrations(client);
			expect(result.success).toBe(true);
		});
	});

	describe("ensureDefaultUser", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(async () => {
			client = createClient({ url: ":memory:" });
			const db = drizzle(client);
			await migrate(db, { migrationsFolder });
		});

		it("should create default user when auth is disabled", async () => {
			const created = await ensureDefaultUser(client, false);
			expect(created).toBe(true);

			const result = await client.execute("SELECT * FROM users WHERE id = 1");
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].username).toBe("default");
			expect(result.rows[0].auth_provider).toBe("local");
		});

		it("should not create user when auth is enabled", async () => {
			const created = await ensureDefaultUser(client, true);
			expect(created).toBe(false);

			const result = await client.execute("SELECT * FROM users WHERE id = 1");
			expect(result.rows).toHaveLength(0);
		});

		it("should not duplicate user if already exists", async () => {
			// First call creates the user
			await ensureDefaultUser(client, false);

			// Second call should not create again
			const created = await ensureDefaultUser(client, false);
			expect(created).toBe(false);

			// Should still have only one user
			const result = await client.execute("SELECT * FROM users");
			expect(result.rows).toHaveLength(1);
		});
	});
});

describe("Database Client", () => {
	describe("In-Memory Database Creation", () => {
		it("should create an in-memory SQLite client", () => {
			const client = createClient({ url: ":memory:" });
			expect(client).toBeDefined();
		});

		it("should create a drizzle instance from client", () => {
			const client = createClient({ url: ":memory:" });
			const db = drizzle(client);
			expect(db).toBeDefined();
		});

		it("should execute SQL statements", async () => {
			const client = createClient({ url: ":memory:" });

			// Create a simple test table
			await client.execute(`
        CREATE TABLE IF NOT EXISTS test_table (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL
        )
      `);

			// Insert a row
			await client.execute("INSERT INTO test_table (name) VALUES ('test')");

			// Query the row
			const result = await client.execute("SELECT * FROM test_table");
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].name).toBe("test");
		});
	});

	describe("Table Schema via Drizzle Migrations", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(async () => {
			client = createClient({ url: ":memory:" });
			const db = drizzle(client);
			await migrate(db, { migrationsFolder });
		});

		it("should have users table with correct columns", async () => {
			const columns = await client.execute("PRAGMA table_info(users)");
			const columnNames = columns.rows.map((r) => r.name);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("username");
			expect(columnNames).toContain("password_hash");
			expect(columnNames).toContain("auth_provider");
		});

		it("should have medications table with correct columns", async () => {
			const columns = await client.execute("PRAGMA table_info(medications)");
			const columnNames = columns.rows.map((r) => r.name);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("user_id");
			expect(columnNames).toContain("name");
			expect(columnNames).toContain("taken_by_json");
			expect(columnNames).toContain("pack_count");
			expect(columnNames).toContain("usage_json");
		});

		it("should have user_settings table with correct columns", async () => {
			const columns = await client.execute("PRAGMA table_info(user_settings)");
			const columnNames = columns.rows.map((r) => r.name);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("user_id");
			expect(columnNames).toContain("email_enabled");
			expect(columnNames).toContain("language");
			expect(columnNames).toContain("stock_calculation_mode");
		});

		it("should have refresh_tokens table", async () => {
			const columns = await client.execute("PRAGMA table_info(refresh_tokens)");
			const columnNames = columns.rows.map((r) => r.name);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("user_id");
			expect(columnNames).toContain("token_id");
		});

		it("should have share_tokens table", async () => {
			const columns = await client.execute("PRAGMA table_info(share_tokens)");
			const columnNames = columns.rows.map((r) => r.name);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("token");
			expect(columnNames).toContain("taken_by");
		});

		it("should have dose_tracking table", async () => {
			const columns = await client.execute("PRAGMA table_info(dose_tracking)");
			const columnNames = columns.rows.map((r) => r.name);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("dose_id");
			expect(columnNames).toContain("marked_by");
		});

		it("should have refill_history table", async () => {
			const columns = await client.execute("PRAGMA table_info(refill_history)");
			const columnNames = columns.rows.map((r) => r.name);

			expect(columnNames).toContain("id");
			expect(columnNames).toContain("medication_id");
			expect(columnNames).toContain("packs_added");
			expect(columnNames).toContain("loose_pills_added");
		});
	});

	describe("Default Values", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(async () => {
			client = createClient({ url: ":memory:" });
			const db = drizzle(client);
			await migrate(db, { migrationsFolder });
		});

		it("should use default values for auth_provider", async () => {
			await client.execute("INSERT INTO users (username) VALUES ('testuser')");

			const result = await client.execute("SELECT auth_provider FROM users WHERE username = 'testuser'");
			expect(result.rows[0].auth_provider).toBe("local");
		});

		it("should use default values for is_active", async () => {
			await client.execute("INSERT INTO users (username) VALUES ('testuser')");

			const result = await client.execute("SELECT is_active FROM users WHERE username = 'testuser'");
			// SQLite stores booleans as integers
			expect(result.rows[0].is_active).toBeTruthy();
		});
	});

	describe("User Settings Defaults", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(async () => {
			client = createClient({ url: ":memory:" });
			const db = drizzle(client);
			await migrate(db, { migrationsFolder });
			await client.execute("INSERT INTO users (username) VALUES ('testuser')");
		});

		it("should use default notification settings", async () => {
			await client.execute("INSERT INTO user_settings (user_id) VALUES (1)");

			const result = await client.execute("SELECT * FROM user_settings WHERE user_id = 1");
			// SQLite stores booleans as integers (false = 0)
			expect(result.rows[0].email_enabled).toBeFalsy();
			expect(result.rows[0].shoutrrr_enabled).toBeFalsy();
		});

		it("should use default stock threshold settings", async () => {
			await client.execute("INSERT INTO user_settings (user_id) VALUES (1)");

			const result = await client.execute("SELECT * FROM user_settings WHERE user_id = 1");
			expect(result.rows[0].low_stock_days).toBe(30);
			expect(result.rows[0].normal_stock_days).toBe(90);
			expect(result.rows[0].high_stock_days).toBe(180);
		});

		it("should use default language (en)", async () => {
			await client.execute("INSERT INTO user_settings (user_id) VALUES (1)");

			const result = await client.execute("SELECT language FROM user_settings WHERE user_id = 1");
			expect(result.rows[0].language).toBe("en");
		});

		it("should use default stock_calculation_mode (automatic)", async () => {
			await client.execute("INSERT INTO user_settings (user_id) VALUES (1)");

			const result = await client.execute("SELECT stock_calculation_mode FROM user_settings WHERE user_id = 1");
			expect(result.rows[0].stock_calculation_mode).toBe("automatic");
		});

		it("should use default reminder_days_before (7)", async () => {
			await client.execute("INSERT INTO user_settings (user_id) VALUES (1)");

			const result = await client.execute("SELECT reminder_days_before FROM user_settings WHERE user_id = 1");
			expect(result.rows[0].reminder_days_before).toBe(7);
		});
	});

	describe("Medication Defaults", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(async () => {
			client = createClient({ url: ":memory:" });
			const db = drizzle(client);
			await migrate(db, { migrationsFolder });
			await client.execute("INSERT INTO users (username) VALUES ('testuser')");
		});

		it("should use default inventory values", async () => {
			await client.execute("INSERT INTO medications (user_id, name) VALUES (1, 'Test Med')");

			const result = await client.execute("SELECT * FROM medications WHERE name = 'Test Med'");
			expect(result.rows[0].pack_count).toBe(1);
			expect(result.rows[0].blisters_per_pack).toBe(1);
			expect(result.rows[0].pills_per_blister).toBe(1);
			expect(result.rows[0].loose_tablets).toBe(0);
		});

		it("should use default JSON arrays for schedules", async () => {
			await client.execute("INSERT INTO medications (user_id, name) VALUES (1, 'Test Med')");

			const result = await client.execute("SELECT * FROM medications WHERE name = 'Test Med'");
			expect(result.rows[0].taken_by_json).toBe("[]");
			expect(result.rows[0].usage_json).toBe("[]");
			expect(result.rows[0].every_json).toBe("[]");
			expect(result.rows[0].start_json).toBe("[]");
		});

		it("should default intake_reminders_enabled to false", async () => {
			await client.execute("INSERT INTO medications (user_id, name) VALUES (1, 'Test Med')");

			const result = await client.execute("SELECT intake_reminders_enabled FROM medications WHERE name = 'Test Med'");
			expect(result.rows[0].intake_reminders_enabled).toBeFalsy();
		});
	});

	describe("Foreign Key Constraints", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(async () => {
			client = createClient({ url: ":memory:" });
			// Enable foreign keys
			await client.execute("PRAGMA foreign_keys = ON");
			const db = drizzle(client);
			await migrate(db, { migrationsFolder });
		});

		it("should cascade delete medications when user is deleted", async () => {
			await client.execute("INSERT INTO users (username) VALUES ('testuser')");
			await client.execute("INSERT INTO medications (user_id, name) VALUES (1, 'Med1')");
			await client.execute("INSERT INTO medications (user_id, name) VALUES (1, 'Med2')");

			// Verify medications exist
			let meds = await client.execute("SELECT * FROM medications");
			expect(meds.rows).toHaveLength(2);

			// Delete user
			await client.execute("DELETE FROM users WHERE id = 1");

			// Medications should be deleted too
			meds = await client.execute("SELECT * FROM medications");
			expect(meds.rows).toHaveLength(0);
		});
	});

	describe("Unique Constraints", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(async () => {
			client = createClient({ url: ":memory:" });
			const db = drizzle(client);
			await migrate(db, { migrationsFolder });
		});

		it("should enforce unique constraint on username", async () => {
			await client.execute("INSERT INTO users (username) VALUES ('testuser')");

			await expect(client.execute("INSERT INTO users (username) VALUES ('testuser')")).rejects.toThrow();
		});

		it("should enforce unique constraint on refresh token_id", async () => {
			await client.execute("INSERT INTO users (username) VALUES ('testuser')");
			await client.execute(
				"INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES (1, 'token123', 1735689600)"
			);

			await expect(
				client.execute("INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES (1, 'token123', 1735689600)")
			).rejects.toThrow();
		});
	});

	describe("Default User Creation (Auth Disabled)", () => {
		let client: ReturnType<typeof createClient>;

		beforeEach(async () => {
			client = createClient({ url: ":memory:" });
			const db = drizzle(client);
			await migrate(db, { migrationsFolder });
		});

		it("should be able to create a default user with ID 1", async () => {
			// This mimics the auth-disabled mode behavior
			const result = await client.execute("SELECT id FROM users WHERE id = 1");

			if (result.rows.length === 0) {
				await client.execute("INSERT INTO users (id, username, auth_provider) VALUES (1, 'default', 'local')");
			}

			const user = await client.execute("SELECT * FROM users WHERE id = 1");
			expect(user.rows).toHaveLength(1);
			expect(user.rows[0].username).toBe("default");
			expect(user.rows[0].auth_provider).toBe("local");
		});

		it("should not duplicate default user if already exists", async () => {
			await client.execute("INSERT INTO users (id, username, auth_provider) VALUES (1, 'default', 'local')");

			// Check if exists before insert (mimics runtime behavior)
			const result = await client.execute("SELECT id FROM users WHERE id = 1");

			if (result.rows.length === 0) {
				await client.execute("INSERT INTO users (id, username, auth_provider) VALUES (1, 'default', 'local')");
			}

			// Should still have only one user
			const users = await client.execute("SELECT * FROM users");
			expect(users.rows).toHaveLength(1);
		});
	});
});
