import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

const url = "file:./data/medassist-ng.db";

async function main() {
  console.log("Starting database setup...");
  console.log("Database URL:", url);
  
  const client = createClient({ url });
  
  // Create tables - fresh schema without roles, with per-user settings
  const sql = `
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
    );

    CREATE TABLE IF NOT EXISTS medications (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL,
      name text NOT NULL,
      generic_name text,
      taken_by text,
      taken_by_json text NOT NULL DEFAULT '[]',
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
    );

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
      language text NOT NULL DEFAULT 'en',
      stock_calculation_mode text NOT NULL DEFAULT 'automatic',
      last_auto_email_sent text,
      last_notification_type text,
      last_notification_channel text,
      updated_at integer NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL,
      token_id text NOT NULL UNIQUE,
      expires_at integer NOT NULL,
      rotated_at integer,
      revoked integer NOT NULL DEFAULT 0,
      created_at integer NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS share_tokens (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL,
      token text NOT NULL UNIQUE,
      taken_by text NOT NULL,
      schedule_days integer NOT NULL DEFAULT 30,
      created_at integer NOT NULL DEFAULT (strftime('%s','now')),
      expires_at integer,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dose_tracking (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL,
      dose_id text NOT NULL,
      taken_at integer NOT NULL DEFAULT (strftime('%s','now')),
      marked_by text,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `;

  // Execute each statement separately
  const statements = sql.split(';').filter(s => s.trim().length > 0);
  
  for (const stmt of statements) {
    console.log("Executing:", stmt.trim().substring(0, 50) + "...");
    await client.execute(stmt);
  }

  console.log("Base tables created. Running migrations for existing databases...");
  
  // Run incremental migrations for existing databases
  // These ALTER TABLE statements are safe to run multiple times (they'll fail silently if column exists)
  const migrations = [
    // 0003: Add image_url to medications
    { name: "0003_add_image_url", sql: "ALTER TABLE medications ADD COLUMN image_url text" },
    // 0004: Add expiry_date to medications
    { name: "0004_add_expiry_date", sql: "ALTER TABLE medications ADD COLUMN expiry_date text" },
    // 0005: Add notes to medications
    { name: "0005_add_notes", sql: "ALTER TABLE medications ADD COLUMN notes text" },
    // 0006: Add generic_name to medications
    { name: "0006_add_generic_name", sql: "ALTER TABLE medications ADD COLUMN generic_name text" },
    // 0007: Add intake_reminders_enabled to medications
    { name: "0007_add_intake_reminders", sql: "ALTER TABLE medications ADD COLUMN intake_reminders_enabled integer NOT NULL DEFAULT 0" },
    // 0008: Add pill_weight_mg to medications
    { name: "0008_add_pill_weight", sql: "ALTER TABLE medications ADD COLUMN pill_weight_mg integer" },
    // 0009: Add taken_by to medications
    { name: "0009_add_taken_by", sql: "ALTER TABLE medications ADD COLUMN taken_by text" },
    // 0012: Add avatar_url to users
    { name: "0012_add_user_avatar", sql: "ALTER TABLE users ADD COLUMN avatar_url text" },
    // 0013: Add oidc_subject to users
    { name: "0013_add_oidc_subject", sql: "ALTER TABLE users ADD COLUMN oidc_subject text" },
    // 0014: Add stock_calculation_mode to user_settings
    { name: "0014_add_stock_calculation_mode", sql: "ALTER TABLE user_settings ADD COLUMN stock_calculation_mode text NOT NULL DEFAULT 'automatic'" },
    // 0015: Add expires_at to share_tokens
    { name: "0015_add_share_token_expiry", sql: "ALTER TABLE share_tokens ADD COLUMN expires_at integer" },
    // 0016: Add taken_by_json to medications
    { name: "0016_taken_by_json_array", sql: "ALTER TABLE medications ADD COLUMN taken_by_json text NOT NULL DEFAULT '[]'" },
  ];

  for (const migration of migrations) {
    try {
      await client.execute(migration.sql);
      console.log(`Migration ${migration.name}: applied`);
    } catch (err: unknown) {
      // Ignore "duplicate column" errors - means migration was already applied
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes("duplicate column") || errorMessage.includes("already exists")) {
        console.log(`Migration ${migration.name}: already applied (skipped)`);
      } else {
        console.error(`Migration ${migration.name}: failed - ${errorMessage}`);
      }
    }
  }

  console.log("Database setup complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
