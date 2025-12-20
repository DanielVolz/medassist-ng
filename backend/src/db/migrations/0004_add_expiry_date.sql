-- Migration 0004: Add expiry_date column for medication expiration tracking
ALTER TABLE medications ADD COLUMN expiry_date TEXT;
