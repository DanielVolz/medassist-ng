import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

const url = "file:./data/medassist-ng.db";

// Ensure data directory exists before creating database
if (url.startsWith("file:")) {
  const dbPath = url.replace("file:", "");
  const dataDir = dirname(dbPath);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`[DB] Created data directory: ${dataDir}`);
  }
}

const client = createClient({ url });

export const db = drizzle(client);

// Auto-run migrations (self-healing database)
async function runMigrations() {
  const migrations = [
    { name: "image_url", sql: "ALTER TABLE medications ADD COLUMN image_url TEXT" },
    { name: "expiry_date", sql: "ALTER TABLE medications ADD COLUMN expiry_date TEXT" },
    { name: "notes", sql: "ALTER TABLE medications ADD COLUMN notes TEXT" },
    { name: "generic_name", sql: "ALTER TABLE medications ADD COLUMN generic_name TEXT" },
    { name: "intake_reminders_enabled", sql: "ALTER TABLE medications ADD COLUMN intake_reminders_enabled INTEGER NOT NULL DEFAULT 0" },
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
}

// Export promise so server can await it before starting
export const migrationsReady = runMigrations();
