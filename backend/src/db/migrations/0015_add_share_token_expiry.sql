-- Add expiration date to share tokens (default 1 year from creation)
-- NULL means no expiration (for backwards compatibility with existing tokens)
ALTER TABLE share_tokens ADD COLUMN expires_at INTEGER;
