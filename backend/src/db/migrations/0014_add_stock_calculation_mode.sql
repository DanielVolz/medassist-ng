-- Add stock calculation mode setting
-- "automatic" = stock decreases based on schedule from start date
-- "manual" = stock only decreases when doses are marked as taken
ALTER TABLE user_settings ADD COLUMN stock_calculation_mode TEXT NOT NULL DEFAULT 'automatic';
