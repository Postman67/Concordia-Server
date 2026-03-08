-- ============================================================
-- Migration 007: server icon
--
-- Adds the 'icon' setting key to server_settings.
-- Value is the stored filename (e.g. "server.png"), empty = no icon.
-- ============================================================

INSERT INTO server_settings (key, value)
  VALUES ('icon', '')
  ON CONFLICT (key) DO NOTHING;
