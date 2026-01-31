-- Add package type support (blister vs bottle)
ALTER TABLE medications ADD COLUMN package_type TEXT DEFAULT 'blister' NOT NULL;
ALTER TABLE medications ADD COLUMN total_pills INTEGER;
