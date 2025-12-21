-- Add taken_by column for family member tracking
ALTER TABLE medications ADD COLUMN taken_by TEXT;
