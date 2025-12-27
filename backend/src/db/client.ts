import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { existsSync, mkdirSync, accessSync, constants, statSync, writeFileSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

// Use absolute path to ensure it works in Docker
const dataDir = resolve(process.cwd(), "data");
const dbPath = resolve(dataDir, "medassist-ng.db");
const url = `file:${dbPath}`;

console.log(`[DB] Data directory: ${dataDir}`);
console.log(`[DB] Database path: ${dbPath}`);
console.log(`[DB] Database URL: ${url}`);

// Ensure data directory exists and is writable
try {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`[DB] Created data directory: ${dataDir}`);
  } else {
    console.log(`[DB] Data directory exists: ${dataDir}`);
  }
  
  // Check if directory is writable
  accessSync(dataDir, constants.W_OK);
  console.log(`[DB] Data directory is writable`);
  
  // Log directory stats
  const stats = statSync(dataDir);
  console.log(`[DB] Directory permissions: ${stats.mode.toString(8)}`);
  console.log(`[DB] Directory UID: ${stats.uid}, GID: ${stats.gid}`);
  
  // Try to create a test file to verify write access
  const testFile = resolve(dataDir, ".write-test");
  writeFileSync(testFile, "test");
  console.log(`[DB] Write test successful`);
  
} catch (err: any) {
  console.error(`[DB] ERROR: Cannot access data directory: ${err.message}`);
  console.error(`[DB] Please ensure the volume mount has correct permissions.`);
  console.error(`[DB] Try running on host: sudo chown -R 1000:1000 ${dataDir}`);
  process.exit(1);
}

let client;
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
  // First, ensure all tables exist (for fresh databases)
  const tableCreations = [
    `CREATE TABLE IF NOT EXISTS users (
      id integer PRIMARY KEY AUTOINCREMENT,
      username text NOT NULL UNIQUE,
      password_hash text,
      email text,
      auth_provider text NOT NULL DEFAULT 'local',
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
      taken_by text,
      count integer NOT NULL DEFAULT 0,
      strips integer NOT NULL DEFAULT 0,
      pack_count integer NOT NULL DEFAULT 1,
      strips_per_pack integer NOT NULL DEFAULT 1,
      tabs_per_strip integer NOT NULL DEFAULT 1,
      loose_tablets integer NOT NULL DEFAULT 0,
      pill_weight_mg integer,
      usage_json text NOT NULL DEFAULT '[]',
      every_json text NOT NULL DEFAULT '[]',
      start_json text NOT NULL DEFAULT '[]',
      strip_size integer NOT NULL DEFAULT 1,
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
    try {
      await client.execute(sql);
    } catch (e: any) {
      console.error(`[DB] Table creation error:`, e.message);
    }
  }
  console.log(`[DB] Tables verified/created`);

  // Then run column migrations for existing databases
  const migrations = [
    { name: "image_url", sql: "ALTER TABLE medications ADD COLUMN image_url TEXT" },
    { name: "expiry_date", sql: "ALTER TABLE medications ADD COLUMN expiry_date TEXT" },
    { name: "notes", sql: "ALTER TABLE medications ADD COLUMN notes TEXT" },
    { name: "generic_name", sql: "ALTER TABLE medications ADD COLUMN generic_name TEXT" },
    { name: "intake_reminders_enabled", sql: "ALTER TABLE medications ADD COLUMN intake_reminders_enabled INTEGER NOT NULL DEFAULT 0" },
    { name: "users_email", sql: "ALTER TABLE users ADD COLUMN email TEXT" },
    { name: "user_settings_expiry_warning_days", sql: "ALTER TABLE user_settings ADD COLUMN expiry_warning_days INTEGER NOT NULL DEFAULT 90" },
  ];

  for (const migration of migrations) {
    try {
      await client.execute(migration.sql);
      console.log(`[DB] Migration applied: ${migration.name}`);
    } catch (e: any) {
      // Ignore "duplicate column" errors - column already exists
      if (!e.message?.includes("duplicate column")) {
        console.error(`[DB] Migration error (${migration.name}):`, e.message);
      }
    }
  }

  // If auth is disabled, ensure a default user exists (ID=1)
  const authEnabled = process.env.AUTH_ENABLED === "true";
  if (!authEnabled) {
    try {
      // Check if default user exists
      const result = await client.execute("SELECT id FROM users WHERE id = 1");
      if (result.rows.length === 0) {
        await client.execute(
          "INSERT INTO users (id, username, auth_provider) VALUES (1, 'default', 'local')"
        );
        console.log(`[DB] Created default user for auth-disabled mode`);
      }
    } catch (e: any) {
      console.error(`[DB] Error creating default user:`, e.message);
    }
  }
}

// Export promise so server can await it before starting
export const migrationsReady = runMigrations();
