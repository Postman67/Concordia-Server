-- ============================================================
-- Concordia Server — full schema (consolidated)
--
-- This is the single source of truth for the database schema.
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- so it is safe to run against both fresh and existing databases.
--
-- Authentication is handled entirely by the Federation at
-- https://federation.concordiachat.com — this server stores
-- no passwords, only Federation-issued user IDs.
-- ============================================================

-- ── Core tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS members (
  user_id    UUID         PRIMARY KEY,   -- Federation-issued UUID
  username   VARCHAR(100) NOT NULL,      -- cached display name
  avatar_url VARCHAR(500),               -- cached Federation avatar URL
  joined_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL      PRIMARY KEY,
  name       VARCHAR(64) NOT NULL,
  position   INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channels (
  id          SERIAL      PRIMARY KEY,
  name        VARCHAR(64) UNIQUE NOT NULL,
  description TEXT,
  category_id INTEGER     REFERENCES categories(id) ON DELETE SET NULL,
  position    INTEGER     NOT NULL DEFAULT 0,
  created_by  UUID,                   -- Federation UUID; no FK (user may leave)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL      PRIMARY KEY,
  channel_id INTEGER     NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL, -- Federation UUID; no FK (user may leave)
  content    TEXT        NOT NULL,
  is_edited  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON messages (channel_id, created_at DESC);

-- ── Server settings ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS server_settings (
  key   VARCHAR(64) PRIMARY KEY,
  value TEXT        NOT NULL
);

INSERT INTO server_settings (key, value) VALUES
  ('name',                    'Concordia Server'),
  ('description',             ''),
  ('admin_user_id',           ''),
  ('icon',                    ''),
  ('media_compression_level', '0')
ON CONFLICT (key) DO NOTHING;

-- ── Roles & permissions ───────────────────────────────────────────────────────
-- Bit layout (see src/config/permissions.ts):
--   ADMINISTRATOR        = 1 << 0  = 1
--   VIEW_CHANNELS        = 1 << 1  = 2
--   SEND_MESSAGES        = 1 << 2  = 4
--   READ_MESSAGE_HISTORY = 1 << 3  = 8
--   MANAGE_MESSAGES      = 1 << 4  = 16
--   MANAGE_CHANNELS      = 1 << 5  = 32
--   MANAGE_CATEGORIES    = 1 << 6  = 64
--   MANAGE_ROLES         = 1 << 7  = 128
--   KICK_MEMBERS         = 1 << 8  = 256
--   BAN_MEMBERS          = 1 << 9  = 512
--   MANAGE_SERVER        = 1 << 10 = 1024
--   @everyone default    = 14 (VIEW_CHANNELS | SEND_MESSAGES | READ_MESSAGE_HISTORY)

CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL      PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  color       VARCHAR(7),              -- hex e.g. '#5865F2', nullable
  position    INTEGER     NOT NULL DEFAULT 0,  -- higher = more authority
  permissions BIGINT      NOT NULL DEFAULT 0,  -- bitmask
  is_everyone BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_everyone
  ON roles (is_everyone) WHERE is_everyone = TRUE;

-- allow_bits: explicitly granted regardless of role bits
-- deny_bits:  explicitly denied regardless of role bits
-- Bit absent from both = inherit from role / @everyone
CREATE TABLE IF NOT EXISTS channel_permission_overrides (
  channel_id INTEGER NOT NULL REFERENCES channels(id)  ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id)     ON DELETE CASCADE,
  allow_bits BIGINT  NOT NULL DEFAULT 0,
  deny_bits  BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, role_id)
);

CREATE TABLE IF NOT EXISTS category_permission_overrides (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id)      ON DELETE CASCADE,
  allow_bits  BIGINT  NOT NULL DEFAULT 0,
  deny_bits   BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, role_id)
);

CREATE TABLE IF NOT EXISTS member_roles (
  user_id UUID    NOT NULL REFERENCES members(user_id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id)        ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- ── CDN / media metrics ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS media_metrics (
  id         BIGSERIAL   PRIMARY KEY,
  event_type TEXT        NOT NULL CHECK (event_type IN ('upload', 'download', 'delete')),
  subfolder  TEXT        NOT NULL,
  filename   TEXT        NOT NULL,
  bytes      BIGINT      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_metrics_event_created_idx
  ON media_metrics (event_type, created_at DESC);

-- ── Seeds ─────────────────────────────────────────────────────────────────────

-- @everyone role (id = 1, cannot be deleted)
INSERT INTO roles (id, name, position, permissions, is_everyone)
  VALUES (1, '@everyone', 0, 14, TRUE)
  ON CONFLICT (id) DO NOTHING;

-- Ensure the sequence starts after the seeded role
SELECT setval('roles_id_seq', GREATEST((SELECT MAX(id) FROM roles), 1));

-- Default category + #general channel
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
