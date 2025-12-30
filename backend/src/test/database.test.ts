import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

// Import the exported utility functions from client.ts
import {
  buildDbUrl,
  getDbPaths,
  ensureDataDirectory,
  getTableCreationSQL,
  runTableMigrations,
  ensureDefaultUser,
} from "../db/client.js";

// Import the exported utility functions from migrate.ts
import {
  getMigrationSQL,
  splitSQLStatements,
  executeMigration,
  getStatementPreview,
} from "../db/migrate.js";

describe("Migration Script Utilities", () => {
  describe("getMigrationSQL", () => {
    it("should return a non-empty SQL string", () => {
      const sql = getMigrationSQL();
      expect(typeof sql).toBe("string");
      expect(sql.length).toBeGreaterThan(100);
    });

    it("should contain all table definitions", () => {
      const sql = getMigrationSQL();
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS users");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS medications");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS user_settings");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS refresh_tokens");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS share_tokens");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS dose_tracking");
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

    it("should split migration SQL into 6 statements", () => {
      const sql = getMigrationSQL();
      const statements = splitSQLStatements(sql);
      expect(statements).toHaveLength(6);
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
      expect(preview).toBe("A".repeat(50) + "...");
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

  describe("executeMigration", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(() => {
      client = createClient({ url: ":memory:" });
    });

    it("should execute all migrations successfully", async () => {
      const result = await executeMigration(client);
      expect(result.success).toBe(true);
      expect(result.executed).toBe(6);
      expect(result.errors).toHaveLength(0);
    });

    it("should create all tables", async () => {
      await executeMigration(client);
      
      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      
      const tableNames = tables.rows.map(r => r.name);
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("medications");
      expect(tableNames).toContain("user_settings");
      expect(tableNames).toContain("refresh_tokens");
      expect(tableNames).toContain("share_tokens");
      expect(tableNames).toContain("dose_tracking");
    });

    it("should be idempotent", async () => {
      await executeMigration(client);
      const result = await executeMigration(client);
      expect(result.success).toBe(true);
      expect(result.executed).toBe(6);
    });

    it("should allow inserting data after migration", async () => {
      await executeMigration(client);
      
      await client.execute("INSERT INTO users (username) VALUES ('testuser')");
      const result = await client.execute("SELECT * FROM users");
      expect(result.rows).toHaveLength(1);
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

  describe("getTableCreationSQL", () => {
    it("should return array of SQL statements", () => {
      const statements = getTableCreationSQL();
      expect(Array.isArray(statements)).toBe(true);
      expect(statements.length).toBe(6);
    });

    it("should include users table", () => {
      const statements = getTableCreationSQL();
      const usersSQL = statements.find(s => s.includes("CREATE TABLE IF NOT EXISTS users"));
      expect(usersSQL).toBeDefined();
      expect(usersSQL).toContain("username text NOT NULL UNIQUE");
      expect(usersSQL).toContain("password_hash text");
      expect(usersSQL).toContain("auth_provider text NOT NULL DEFAULT 'local'");
    });

    it("should include medications table", () => {
      const statements = getTableCreationSQL();
      const medsSQL = statements.find(s => s.includes("CREATE TABLE IF NOT EXISTS medications"));
      expect(medsSQL).toBeDefined();
      expect(medsSQL).toContain("user_id integer NOT NULL");
      expect(medsSQL).toContain("taken_by_json text NOT NULL DEFAULT '[]'");
      expect(medsSQL).toContain("FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE");
    });

    it("should include user_settings table", () => {
      const statements = getTableCreationSQL();
      const settingsSQL = statements.find(s => s.includes("CREATE TABLE IF NOT EXISTS user_settings"));
      expect(settingsSQL).toBeDefined();
      expect(settingsSQL).toContain("email_enabled integer NOT NULL DEFAULT 0");
      expect(settingsSQL).toContain("language text NOT NULL DEFAULT 'en'");
    });

    it("should include refresh_tokens table", () => {
      const statements = getTableCreationSQL();
      const tokensSQL = statements.find(s => s.includes("CREATE TABLE IF NOT EXISTS refresh_tokens"));
      expect(tokensSQL).toBeDefined();
      expect(tokensSQL).toContain("token_id text NOT NULL UNIQUE");
    });

    it("should include share_tokens table", () => {
      const statements = getTableCreationSQL();
      const shareSQL = statements.find(s => s.includes("CREATE TABLE IF NOT EXISTS share_tokens"));
      expect(shareSQL).toBeDefined();
      expect(shareSQL).toContain("taken_by text NOT NULL");
    });

    it("should include dose_tracking table", () => {
      const statements = getTableCreationSQL();
      const doseSQL = statements.find(s => s.includes("CREATE TABLE IF NOT EXISTS dose_tracking"));
      expect(doseSQL).toBeDefined();
      expect(doseSQL).toContain("dose_id text NOT NULL");
      expect(doseSQL).toContain("marked_by text");
    });
  });

  describe("runTableMigrations", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(() => {
      client = createClient({ url: ":memory:" });
    });

    it("should create all tables successfully", async () => {
      const result = await runTableMigrations(client);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should be idempotent (run twice without errors)", async () => {
      await runTableMigrations(client);
      const result = await runTableMigrations(client);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should create all 6 tables", async () => {
      await runTableMigrations(client);
      
      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      
      const tableNames = tables.rows.map(r => r.name);
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("medications");
      expect(tableNames).toContain("user_settings");
      expect(tableNames).toContain("refresh_tokens");
      expect(tableNames).toContain("share_tokens");
      expect(tableNames).toContain("dose_tracking");
    });
  });

  describe("ensureDefaultUser", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(async () => {
      client = createClient({ url: ":memory:" });
      await runTableMigrations(client);
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

  describe("Table Schema Creation", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(async () => {
      client = createClient({ url: ":memory:" });
    });

    it("should create users table", async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
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
        )
      `);

      // Verify table exists
      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
      );
      expect(tables.rows).toHaveLength(1);
    });

    it("should create medications table with foreign key", async () => {
      // First create users table
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local'
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS medications (
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
        )
      `);

      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='medications'"
      );
      expect(tables.rows).toHaveLength(1);
    });

    it("should create user_settings table", async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local'
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS user_settings (
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
        )
      `);

      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='user_settings'"
      );
      expect(tables.rows).toHaveLength(1);
    });

    it("should create refresh_tokens table", async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local'
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id integer PRIMARY KEY AUTOINCREMENT,
          user_id integer NOT NULL,
          token_id text NOT NULL UNIQUE,
          expires_at integer NOT NULL,
          rotated_at integer,
          revoked integer NOT NULL DEFAULT 0,
          created_at integer NOT NULL DEFAULT (strftime('%s','now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='refresh_tokens'"
      );
      expect(tables.rows).toHaveLength(1);
    });

    it("should create share_tokens table", async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local'
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS share_tokens (
          id integer PRIMARY KEY AUTOINCREMENT,
          user_id integer NOT NULL,
          token text NOT NULL UNIQUE,
          taken_by text NOT NULL,
          schedule_days integer NOT NULL DEFAULT 30,
          created_at integer NOT NULL DEFAULT (strftime('%s','now')),
          expires_at integer,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='share_tokens'"
      );
      expect(tables.rows).toHaveLength(1);
    });

    it("should create dose_tracking table", async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local'
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS dose_tracking (
          id integer PRIMARY KEY AUTOINCREMENT,
          user_id integer NOT NULL,
          dose_id text NOT NULL,
          taken_at integer NOT NULL DEFAULT (strftime('%s','now')),
          marked_by text,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dose_tracking'"
      );
      expect(tables.rows).toHaveLength(1);
    });

    it("should enforce unique constraint on username", async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local'
        )
      `);

      await client.execute("INSERT INTO users (username) VALUES ('testuser')");
      
      await expect(
        client.execute("INSERT INTO users (username) VALUES ('testuser')")
      ).rejects.toThrow();
    });

    it("should enforce unique constraint on refresh token_id", async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local'
        )
      `);
      await client.execute("INSERT INTO users (username) VALUES ('testuser')");

      await client.execute(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id integer PRIMARY KEY AUTOINCREMENT,
          user_id integer NOT NULL,
          token_id text NOT NULL UNIQUE,
          expires_at integer NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      await client.execute(
        "INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES (1, 'token123', 1735689600)"
      );
      
      await expect(
        client.execute(
          "INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES (1, 'token123', 1735689600)"
        )
      ).rejects.toThrow();
    });
  });

  describe("Default Values", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(async () => {
      client = createClient({ url: ":memory:" });
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local',
          is_active integer NOT NULL DEFAULT 1,
          created_at integer NOT NULL DEFAULT (strftime('%s','now'))
        )
      `);
    });

    it("should use default values for auth_provider", async () => {
      await client.execute("INSERT INTO users (username) VALUES ('testuser')");
      
      const result = await client.execute("SELECT auth_provider FROM users WHERE username = 'testuser'");
      expect(result.rows[0].auth_provider).toBe("local");
    });

    it("should use default values for is_active", async () => {
      await client.execute("INSERT INTO users (username) VALUES ('testuser')");
      
      const result = await client.execute("SELECT is_active FROM users WHERE username = 'testuser'");
      expect(result.rows[0].is_active).toBe(1);
    });

    it("should generate created_at timestamp", async () => {
      await client.execute("INSERT INTO users (username) VALUES ('testuser')");
      
      const result = await client.execute("SELECT created_at FROM users WHERE username = 'testuser'");
      expect(typeof result.rows[0].created_at).toBe("number");
      // Should be a reasonable Unix timestamp (after year 2020)
      expect(Number(result.rows[0].created_at)).toBeGreaterThan(1577836800);
    });
  });

  describe("User Settings Defaults", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(async () => {
      client = createClient({ url: ":memory:" });
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local'
        )
      `);
      await client.execute("INSERT INTO users (username) VALUES ('testuser')");

      await client.execute(`
        CREATE TABLE IF NOT EXISTS user_settings (
          id integer PRIMARY KEY AUTOINCREMENT,
          user_id integer NOT NULL UNIQUE,
          email_enabled integer NOT NULL DEFAULT 0,
          shoutrrr_enabled integer NOT NULL DEFAULT 0,
          reminder_days_before integer NOT NULL DEFAULT 7,
          repeat_daily_reminders integer NOT NULL DEFAULT 0,
          low_stock_days integer NOT NULL DEFAULT 30,
          normal_stock_days integer NOT NULL DEFAULT 90,
          high_stock_days integer NOT NULL DEFAULT 180,
          expiry_warning_days integer NOT NULL DEFAULT 90,
          language text NOT NULL DEFAULT 'en',
          stock_calculation_mode text NOT NULL DEFAULT 'automatic',
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
    });

    it("should use default notification settings", async () => {
      await client.execute("INSERT INTO user_settings (user_id) VALUES (1)");
      
      const result = await client.execute("SELECT * FROM user_settings WHERE user_id = 1");
      expect(result.rows[0].email_enabled).toBe(0);
      expect(result.rows[0].shoutrrr_enabled).toBe(0);
    });

    it("should use default stock threshold settings", async () => {
      await client.execute("INSERT INTO user_settings (user_id) VALUES (1)");
      
      const result = await client.execute("SELECT * FROM user_settings WHERE user_id = 1");
      expect(result.rows[0].low_stock_days).toBe(30);
      expect(result.rows[0].normal_stock_days).toBe(90);
      expect(result.rows[0].high_stock_days).toBe(180);
      expect(result.rows[0].expiry_warning_days).toBe(90);
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
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local'
        )
      `);
      await client.execute("INSERT INTO users (username) VALUES ('testuser')");

      await client.execute(`
        CREATE TABLE IF NOT EXISTS medications (
          id integer PRIMARY KEY AUTOINCREMENT,
          user_id integer NOT NULL,
          name text NOT NULL,
          taken_by_json text NOT NULL DEFAULT '[]',
          pack_count integer NOT NULL DEFAULT 1,
          blisters_per_pack integer NOT NULL DEFAULT 1,
          pills_per_blister integer NOT NULL DEFAULT 1,
          loose_tablets integer NOT NULL DEFAULT 0,
          usage_json text NOT NULL DEFAULT '[]',
          every_json text NOT NULL DEFAULT '[]',
          start_json text NOT NULL DEFAULT '[]',
          intake_reminders_enabled integer NOT NULL DEFAULT 0,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
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

    it("should default intake_reminders_enabled to false (0)", async () => {
      await client.execute("INSERT INTO medications (user_id, name) VALUES (1, 'Test Med')");
      
      const result = await client.execute("SELECT intake_reminders_enabled FROM medications WHERE name = 'Test Med'");
      expect(result.rows[0].intake_reminders_enabled).toBe(0);
    });
  });

  describe("Foreign Key Constraints", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(async () => {
      client = createClient({ url: ":memory:" });
      // Enable foreign keys
      await client.execute("PRAGMA foreign_keys = ON");
      
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS medications (
          id integer PRIMARY KEY AUTOINCREMENT,
          user_id integer NOT NULL,
          name text NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
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

  describe("Default User Creation (Auth Disabled)", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(async () => {
      client = createClient({ url: ":memory:" });
      await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id integer PRIMARY KEY AUTOINCREMENT,
          username text NOT NULL UNIQUE,
          auth_provider text NOT NULL DEFAULT 'local'
        )
      `);
    });

    it("should be able to create a default user with ID 1", async () => {
      // This mimics the auth-disabled mode behavior
      const result = await client.execute("SELECT id FROM users WHERE id = 1");
      
      if (result.rows.length === 0) {
        await client.execute(
          "INSERT INTO users (id, username, auth_provider) VALUES (1, 'default', 'local')"
        );
      }
      
      const user = await client.execute("SELECT * FROM users WHERE id = 1");
      expect(user.rows).toHaveLength(1);
      expect(user.rows[0].username).toBe("default");
      expect(user.rows[0].auth_provider).toBe("local");
    });

    it("should not duplicate default user if already exists", async () => {
      await client.execute(
        "INSERT INTO users (id, username, auth_provider) VALUES (1, 'default', 'local')"
      );
      
      // Check if exists before insert (mimics runtime behavior)
      const result = await client.execute("SELECT id FROM users WHERE id = 1");
      
      if (result.rows.length === 0) {
        await client.execute(
          "INSERT INTO users (id, username, auth_provider) VALUES (1, 'default', 'local')"
        );
      }
      
      // Should still have only one user
      const users = await client.execute("SELECT * FROM users");
      expect(users.rows).toHaveLength(1);
    });
  });
});
