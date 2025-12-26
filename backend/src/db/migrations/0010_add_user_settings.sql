-- Add user_id to medications (for existing databases)
-- First, add the column as nullable
ALTER TABLE medications ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Create user_settings table for per-user notification settings
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
