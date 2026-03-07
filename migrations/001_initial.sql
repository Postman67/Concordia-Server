-- ============================================================
-- Concordia — initial schema
-- Run automatically by Docker when the volume is first created
--
-- Authentication is handled entirely by the Federation at
-- https://federation.concordiachat.com — this server stores
-- no passwords or emails, only Federation-issued user IDs.
-- ============================================================

-- Members: Federation user IDs who have joined this server.
-- username is a cached display name refreshed on each join/connect.
CREATE TABLE IF NOT EXISTS members (
  user_id    INTEGER PRIMARY KEY,    -- Federation-issued user ID
  username   VARCHAR(100) NOT NULL,  -- cached display name (public, not sensitive)
  joined_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channels (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(64) UNIQUE NOT NULL,
  description TEXT,
  created_by  INTEGER,               -- Federation user ID (no FK — user may leave)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL,       -- Federation user ID (no FK — user may leave)
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Speed up the most common query: fetch recent messages in a channel
CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON messages(channel_id, created_at DESC);

-- Seed a default general channel
INSERT INTO channels (name, description)
VALUES ('general', 'General discussion')
ON CONFLICT DO NOTHING;
