CREATE TABLE IF NOT EXISTS users (
  id integer PRIMARY KEY AUTOINCREMENT,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user',
  created_at integer NOT NULL DEFAULT (strftime('%s','now')),
  updated_at integer NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS medications (
  id integer PRIMARY KEY AUTOINCREMENT,
  name text NOT NULL UNIQUE,
  count integer NOT NULL DEFAULT 0,
  strips integer NOT NULL DEFAULT 0,
  pack_count integer NOT NULL DEFAULT 1,
  strips_per_pack integer NOT NULL DEFAULT 1,
  tabs_per_strip integer NOT NULL DEFAULT 1,
  loose_tablets integer NOT NULL DEFAULT 0,
  usage_json text NOT NULL DEFAULT '[]',
  every_json text NOT NULL DEFAULT '[]',
  start_json text NOT NULL DEFAULT '[]',
  strip_size integer NOT NULL DEFAULT 1,
  updated_at integer NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id integer PRIMARY KEY AUTOINCREMENT,
  user_id integer NOT NULL,
  token_id text NOT NULL UNIQUE,
  expires_at integer NOT NULL,
  rotated_at integer,
  revoked integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  id integer PRIMARY KEY AUTOINCREMENT,
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_pass_encrypted text,
  smtp_from text,
  smtp_secure integer NOT NULL DEFAULT 0,
  emails_per_day integer NOT NULL DEFAULT 3,
  updated_at integer NOT NULL DEFAULT (strftime('%s','now'))
);
