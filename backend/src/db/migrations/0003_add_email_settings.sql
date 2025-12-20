-- Add email notification settings to settings table
ALTER TABLE settings ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN notification_email TEXT;
ALTER TABLE settings ADD COLUMN reminder_days_before INTEGER NOT NULL DEFAULT 7;
