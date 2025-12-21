-- Add intake_reminders_enabled column to medications table
ALTER TABLE medications ADD COLUMN intake_reminders_enabled INTEGER NOT NULL DEFAULT 0;
