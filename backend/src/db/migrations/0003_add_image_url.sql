-- Migration 0003: Add image_url column for medication photos
ALTER TABLE medications ADD COLUMN image_url TEXT;
