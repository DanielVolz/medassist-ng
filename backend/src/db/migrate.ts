import { createClient } from "@libsql/client";
import dotenv from "dotenv";

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
      auth_provider text NOT NULL DEFAULT 'local',
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
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `;

  // Execute each statement separately
  const statements = sql.split(';').filter(s => s.trim().length > 0);
  
  for (const stmt of statements) {
    console.log("Executing:", stmt.trim().substring(0, 50) + "...");
    await client.execute(stmt);
  }

  console.log("Database setup complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
