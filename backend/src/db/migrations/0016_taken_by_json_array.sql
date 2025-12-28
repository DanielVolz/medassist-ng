-- Convert taken_by from single string to JSON array
-- This allows multiple people to share the same medication

-- Add new column for JSON array
ALTER TABLE medications ADD COLUMN taken_by_json TEXT NOT NULL DEFAULT '[]';

-- Migrate existing data: convert single string to JSON array
-- If taken_by is not null/empty, convert to ["value"], otherwise keep as []
UPDATE medications 
SET taken_by_json = CASE 
  WHEN taken_by IS NOT NULL AND taken_by != '' 
  THEN json_array(taken_by) 
  ELSE '[]' 
END;

-- Note: We keep the old taken_by column for backwards compatibility during migration
-- It can be dropped in a future migration once all code uses taken_by_json
