/**
 * Shared SQL table creation statements for database initialization.
 * Used by client.ts, migrate.ts, and test setup to avoid duplication.
 */

/**
 * Get all SQL table creation statements as an array.
 * Each statement creates a table if it doesn't exist.
 */
export function getTableCreationSQL(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS users (
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
    )`,
    `CREATE TABLE IF NOT EXISTS medications (
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
      skip_reminders_for_taken_doses integer NOT NULL DEFAULT 0,
      repeat_reminders_enabled integer NOT NULL DEFAULT 0,
      reminder_repeat_interval_minutes integer NOT NULL DEFAULT 30,
      max_nagging_reminders integer NOT NULL DEFAULT 5,
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
      expires_at integer,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS dose_tracking (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL,
      dose_id text NOT NULL,
      taken_at integer NOT NULL DEFAULT (strftime('%s','now')),
      marked_by text,
      dismissed integer NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  ];
}
