import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

const url = process.env.DATABASE_URL || "file:./data/medassist.db";

async function main() {
  console.log("Starting database setup...");
  console.log("Database URL:", url);
  
  const client = createClient({ url });
  
  // Create tables directly
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id integer PRIMARY KEY AUTOINCREMENT,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      created_at integer NOT NULL DEFAULT (strftime('%s','now')),
      updated_at integer NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS medications (
      id integer PRIMARY KEY AUTOINCREMENT,
      name text NOT NULL UNIQUE,
      count integer NOT NULL DEFAULT 0,
      strips integer NOT NULL DEFAULT 0,
      pack_count integer NOT NULL DEFAULT 1,
      strips_per_pack integer NOT NULL DEFAULT 1,
      tabs_per_strip integer NOT NULL DEFAULT 1,
      loose_tablets integer NOT NULL DEFAULT 0,
      usage_json text NOT NULL DEFAULT '[]',
      every_json text NOT NULL DEFAULT '[]',
      start_json text NOT NULL DEFAULT '[]',
      strip_size integer NOT NULL DEFAULT 1,
      image_url text,
      updated_at integer NOT NULL DEFAULT (strftime('%s','now'))
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

    CREATE TABLE IF NOT EXISTS settings (
      id integer PRIMARY KEY AUTOINCREMENT,
      smtp_host text,
      smtp_port integer,
      smtp_user text,
      smtp_pass_encrypted text,
      smtp_from text,
      smtp_secure integer NOT NULL DEFAULT 0,
      emails_per_day integer NOT NULL DEFAULT 3,
      email_enabled integer NOT NULL DEFAULT 0,
      notification_email text,
      reminder_days_before integer NOT NULL DEFAULT 7,
      updated_at integer NOT NULL DEFAULT (strftime('%s','now'))
    );
  `;

  // Execute each statement separately
  const statements = sql.split(';').filter(s => s.trim().length > 0);
  
  for (const stmt of statements) {
    console.log("Executing:", stmt.trim().substring(0, 50) + "...");
    await client.execute(stmt);
  }

  // Run migrations for existing databases
  console.log("Running migrations for existing databases...");
  
  const migrations = [
    { column: "image_url", sql: "ALTER TABLE medications ADD COLUMN image_url TEXT" },
    { column: "expiry_date", sql: "ALTER TABLE medications ADD COLUMN expiry_date TEXT" },
    { column: "notes", sql: "ALTER TABLE medications ADD COLUMN notes TEXT" },
    { column: "generic_name", sql: "ALTER TABLE medications ADD COLUMN generic_name TEXT" },
    { column: "intake_reminders_enabled", sql: "ALTER TABLE medications ADD COLUMN intake_reminders_enabled INTEGER NOT NULL DEFAULT 0" },
    { column: "pill_weight_mg", sql: "ALTER TABLE medications ADD COLUMN pill_weight_mg INTEGER" },
    { column: "taken_by", sql: "ALTER TABLE medications ADD COLUMN taken_by TEXT" },
  ];
  
  for (const migration of migrations) {
    try {
      await client.execute(migration.sql);
      console.log(`Added ${migration.column} column`);
    } catch (e: any) {
      if (e.message?.includes("duplicate column") || e.message?.includes("already exists")) {
        console.log(`${migration.column} column already exists, skipping`);
      } else {
        throw e;
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
