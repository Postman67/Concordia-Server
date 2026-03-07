-- ============================================================
-- Migration 005: avatar_url on members
--
-- Caches the user's Federation avatar URL so the server can
-- include it in message history and real-time events without
-- a round-trip to the Federation on every request.
-- ============================================================

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);
