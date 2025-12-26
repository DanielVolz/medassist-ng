-- Dose tracking table for syncing taken doses between users and share links
CREATE TABLE IF NOT EXISTS dose_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dose_id TEXT NOT NULL,
  taken_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  marked_by TEXT
);

-- Index for fast lookups by user and dose
CREATE INDEX IF NOT EXISTS idx_dose_tracking_user_dose ON dose_tracking(user_id, dose_id);
