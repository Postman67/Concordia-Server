-- ============================================================
-- Migration 004: server_settings table
--
-- Moves server configuration (name, description, admin) from
-- server.config.json / environment variables into the database
-- so admins can update them live from the client.
-- ============================================================

CREATE TABLE IF NOT EXISTS server_settings (
  key   VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed defaults (idempotent)
INSERT INTO server_settings (key, value) VALUES
  ('name',          'Concordia Server'),
  ('description',   ''),
  ('admin_user_id', '0')
ON CONFLICT (key) DO NOTHING;
