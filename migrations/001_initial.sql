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
-- role: 'member' (default) | 'moderator' | 'admin'
CREATE TABLE IF NOT EXISTS members (
  user_id    INTEGER PRIMARY KEY,    -- Federation-issued user ID
  username   VARCHAR(100) NOT NULL,  -- cached display name (public, not sensitive)
  role       VARCHAR(20)  NOT NULL DEFAULT 'member'
               CHECK (role IN ('member', 'moderator', 'admin')),
  joined_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Channel categories (e.g. "Text Channels", "Voice Channels")
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(64) NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channels (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(64) UNIQUE NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  position    INTEGER NOT NULL DEFAULT 0,
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

-- Seed: default category + general channel (idempotent)
DO $$
DECLARE cat_id INTEGER;
BEGIN
  INSERT INTO categories (name, position)
  SELECT 'Text Channels', 0
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Text Channels');

  SELECT id INTO cat_id FROM categories WHERE name = 'Text Channels' LIMIT 1;

  INSERT INTO channels (name, description, category_id, position)
  VALUES ('general', 'General discussion', cat_id, 0)
  ON CONFLICT (name) DO NOTHING;
END $$;
