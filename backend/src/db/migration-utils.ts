import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "@libsql/client";
import type { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

/** Run drizzle-kit migrations on the database */
export async function runDrizzleMigrations(
	database: ReturnType<typeof drizzle>
): Promise<{ success: boolean; error?: string; warning?: string }> {
	try {
		await migrate(database, { migrationsFolder });
		return { success: true };
	} catch (err: unknown) {
		const msg = (err as Error).message ?? "";
		if (msg.includes("duplicate column") || msg.includes("already exists")) {
			return { success: true };
		}
		return { success: false, error: msg };
	}
}

/** Run ALTER TABLE migrations for backward compatibility with older databases */
export async function runAlterMigrations(client: Client): Promise<{ success: boolean; errors: string[] }> {
	const errors: string[] = [];

	const alterMigrations = [
		`ALTER TABLE user_settings ADD COLUMN skip_reminders_for_taken_doses integer NOT NULL DEFAULT 0`,
		`ALTER TABLE user_settings ADD COLUMN repeat_reminders_enabled integer NOT NULL DEFAULT 0`,
		`ALTER TABLE user_settings ADD COLUMN reminder_repeat_interval_minutes integer NOT NULL DEFAULT 30`,
		`ALTER TABLE user_settings ADD COLUMN max_nagging_reminders integer NOT NULL DEFAULT 5`,
		`ALTER TABLE user_settings ADD COLUMN timezone text NOT NULL DEFAULT ''`,
		`ALTER TABLE dose_tracking ADD COLUMN dismissed integer NOT NULL DEFAULT 0`,
		`ALTER TABLE dose_tracking ADD COLUMN taken_source text NOT NULL DEFAULT 'manual'`,
		`ALTER TABLE user_settings ADD COLUMN stock_calculation_mode text NOT NULL DEFAULT 'automatic'`,
		`ALTER TABLE medications ADD COLUMN stock_adjustment integer NOT NULL DEFAULT 0`,
		`ALTER TABLE medications ADD COLUMN last_stock_correction_at integer`,
		`ALTER TABLE medications ADD COLUMN dismissed_until text`,
		`ALTER TABLE medications ADD COLUMN is_obsolete integer NOT NULL DEFAULT 0`,
		`ALTER TABLE medications ADD COLUMN obsolete_at integer`,
		`ALTER TABLE medications ADD COLUMN medication_start_date text NOT NULL DEFAULT ''`,
		`ALTER TABLE medications ADD COLUMN medication_form text NOT NULL DEFAULT 'tablet'`,
		`ALTER TABLE medications ADD COLUMN pill_form text`,
		`ALTER TABLE medications ADD COLUMN lifecycle_category text NOT NULL DEFAULT 'refill_when_empty'`,
		`ALTER TABLE medications ADD COLUMN medication_end_date text`,
		`ALTER TABLE medications ADD COLUMN auto_mark_obsolete_after_end_date integer NOT NULL DEFAULT 1`,
		`ALTER TABLE medications ADD COLUMN package_amount_value integer NOT NULL DEFAULT 0`,
		`ALTER TABLE medications ADD COLUMN package_amount_unit text NOT NULL DEFAULT 'ml'`,
		`ALTER TABLE user_settings ADD COLUMN last_reminder_med_name text`,
		`ALTER TABLE user_settings ADD COLUMN last_reminder_taken_by text`,
		`ALTER TABLE medications ADD COLUMN package_type text NOT NULL DEFAULT 'blister'`,
		`ALTER TABLE medications ADD COLUMN total_pills integer`,
		`ALTER TABLE medications ADD COLUMN dose_unit text DEFAULT 'mg'`,
		`ALTER TABLE medications ADD COLUMN intakes_json text NOT NULL DEFAULT '[]'`,
		`ALTER TABLE user_settings ADD COLUMN last_stock_reminder_sent text`,
		`ALTER TABLE user_settings ADD COLUMN last_stock_reminder_channel text`,
		`ALTER TABLE user_settings ADD COLUMN last_stock_reminder_med_names text`,
		// Keep the removed legacy setting column for backward compatibility with older SQLite files.
		`ALTER TABLE user_settings ADD COLUMN share_stock_status integer NOT NULL DEFAULT 1`,
		`ALTER TABLE user_settings ADD COLUMN share_medication_overview integer NOT NULL DEFAULT 0`,
		`ALTER TABLE user_settings ADD COLUMN upcoming_today_only integer NOT NULL DEFAULT 0`,
		`ALTER TABLE user_settings ADD COLUMN share_schedule_today_only integer NOT NULL DEFAULT 0`,
		`ALTER TABLE user_settings ADD COLUMN swap_dashboard_main_sections integer NOT NULL DEFAULT 0`,
		`ALTER TABLE medications ADD COLUMN prescription_enabled integer NOT NULL DEFAULT 0`,
		`ALTER TABLE medications ADD COLUMN prescription_authorized_refills integer`,
		`ALTER TABLE medications ADD COLUMN prescription_remaining_refills integer`,
		`ALTER TABLE medications ADD COLUMN prescription_low_refill_threshold integer NOT NULL DEFAULT 1`,
		`ALTER TABLE medications ADD COLUMN prescription_expiry_date text`,
		`ALTER TABLE user_settings ADD COLUMN email_prescription_reminders integer NOT NULL DEFAULT 1`,
		`ALTER TABLE user_settings ADD COLUMN shoutrrr_prescription_reminders integer NOT NULL DEFAULT 1`,
		`ALTER TABLE user_settings ADD COLUMN last_prescription_reminder_sent text`,
		`ALTER TABLE user_settings ADD COLUMN last_prescription_reminder_channel text`,
		`ALTER TABLE user_settings ADD COLUMN last_prescription_reminder_med_names text`,
		`ALTER TABLE refill_history ADD COLUMN used_prescription integer NOT NULL DEFAULT 0`,
		`ALTER TABLE notification_action_groups ADD COLUMN ntfy_original_message_id text NOT NULL DEFAULT ''`,
	];

	for (const sql of alterMigrations) {
		try {
			await client.execute(sql);
		} catch (e: unknown) {
			if (!(e as Error).message?.includes("duplicate column")) {
				errors.push((e as Error).message);
			}
		}
	}

	const createTableMigrations = [
		`CREATE TABLE IF NOT EXISTS refill_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      packs_added INTEGER NOT NULL DEFAULT 0,
      loose_pills_added INTEGER NOT NULL DEFAULT 0,
      refill_date INTEGER NOT NULL DEFAULT (strftime('%s','now'))
	    )`,
		`CREATE TABLE IF NOT EXISTS notification_action_groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			group_key TEXT NOT NULL UNIQUE,
			sequence_id TEXT NOT NULL,
			ntfy_original_message_id TEXT NOT NULL DEFAULT '',
			dose_ids_json TEXT NOT NULL,
			title TEXT NOT NULL,
			message TEXT NOT NULL,
			language TEXT NOT NULL DEFAULT 'en',
			scheduled_for INTEGER,
			expires_at INTEGER NOT NULL,
			resolved_action TEXT,
			resolved_at INTEGER,
			created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
			updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
		)`,
		`CREATE TABLE IF NOT EXISTS notification_action_tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			group_id INTEGER NOT NULL REFERENCES notification_action_groups(id) ON DELETE CASCADE,
			token_hash TEXT NOT NULL UNIQUE,
			kind TEXT NOT NULL,
			used_at INTEGER,
			created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
		)`,
		`CREATE TABLE IF NOT EXISTS api_keys (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			key_hash TEXT NOT NULL UNIQUE,
			token_prefix TEXT NOT NULL DEFAULT '',
			scope TEXT NOT NULL DEFAULT 'write',
			is_active INTEGER NOT NULL DEFAULT 1,
			last_used_at INTEGER,
			expires_at INTEGER,
			created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
			updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
		)`,
	];

	for (const sql of createTableMigrations) {
		try {
			await client.execute(sql);
		} catch (e: unknown) {
			if (!(e as Error).message?.includes("already exists")) {
				errors.push((e as Error).message);
			}
		}
	}

	const createIndexMigrations = [
		`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique ON users(lower(username))`,
		`CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_unique ON api_keys(key_hash)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS notification_action_groups_group_key_unique ON notification_action_groups(group_key)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS notification_action_tokens_token_hash_unique ON notification_action_tokens(token_hash)`,
		`CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys(user_id)`,
	];

	for (const sql of createIndexMigrations) {
		try {
			await client.execute(sql);
		} catch (e: unknown) {
			if (!(e as Error).message?.includes("already exists")) {
				errors.push((e as Error).message);
			}
		}
	}

	return { success: errors.length === 0, errors };
}

/** Ensure default user exists for auth-disabled mode */
export async function ensureDefaultUser(client: Client, authEnabled: boolean): Promise<boolean> {
	if (authEnabled) {
		return false;
	}

	try {
		const result = await client.execute("SELECT id FROM users WHERE id = 1");
		if (result.rows.length === 0) {
			await client.execute("INSERT INTO users (id, username, auth_provider) VALUES (1, 'default', 'local')");
			return true;
		}
		return false;
	} catch (e: unknown) {
		console.error(`[DB] Error creating default user:`, (e as Error).message);
		return false;
	}
}
