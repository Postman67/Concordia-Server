-- ============================================================
-- Migration 006: granular Discord-style permissions
--
-- Replaces the old 3-tier role column (member / moderator / admin)
-- with a flexible permissions system:
--
--   • Server-level roles with a permission bitmask
--   • @everyone role auto-seeded per server (id = 1 by convention)
--   • Members can hold multiple roles (member_roles junction)
--   • Per-channel and per-category permission overrides per role
--     stored as (allow_bits, deny_bits) — 3-state: allow / deny / inherit
-- ============================================================

-- ── 1. Roles ──────────────────────────────────────────────────────────────────
-- The @everyone role is seeded with id = 1 and is not deleteable.
-- position controls display order (higher = shown first, higher priority
-- in permission resolution). The @everyone role always has position 0.
CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  color       VARCHAR(7),                   -- hex colour e.g. '#5865F2', nullable
  position    INTEGER NOT NULL DEFAULT 0,   -- higher = more authority
  permissions BIGINT  NOT NULL DEFAULT 0,   -- bitmask; see Permission constants
  is_everyone BOOLEAN NOT NULL DEFAULT FALSE, -- marks the @everyone role
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_everyone
  ON roles (is_everyone) WHERE is_everyone = TRUE;

-- ── 2. Per-channel / per-category role overrides ─────────────────────────────
-- allow_bits: permissions explicitly granted regardless of role bits
-- deny_bits:  permissions explicitly denied   regardless of role bits
-- A bit absent from both means "inherit from role / @everyone"
CREATE TABLE IF NOT EXISTS channel_permission_overrides (
  channel_id  INTEGER NOT NULL REFERENCES channels(id)  ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id)     ON DELETE CASCADE,
  allow_bits  BIGINT  NOT NULL DEFAULT 0,
  deny_bits   BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, role_id)
);

CREATE TABLE IF NOT EXISTS category_permission_overrides (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id)      ON DELETE CASCADE,
  allow_bits  BIGINT  NOT NULL DEFAULT 0,
  deny_bits   BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, role_id)
);

-- ── 3. Member ↔ Role junction ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS member_roles (
  user_id UUID    NOT NULL REFERENCES members(user_id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id)        ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- ── 4. Drop old role column from members (retained as nullable for migration) ─
-- We keep the column only if it already exists; fresh DBs may not have it.
-- After this migration the column is no longer used for permission checks.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS legacy_role VARCHAR(20);

UPDATE members SET legacy_role = role WHERE legacy_role IS NULL;

-- ── 5. Seed @everyone role ────────────────────────────────────────────────────
-- Default permissions: VIEW_CHANNELS | READ_MESSAGE_HISTORY | SEND_MESSAGES
--   VIEW_CHANNELS        = 1 << 0 = 1
--   SEND_MESSAGES        = 1 << 1 = 2
--   READ_MESSAGE_HISTORY = 1 << 2 = 4
-- Default bitmask = 7 (all three on for @everyone)
INSERT INTO roles (id, name, position, permissions, is_everyone)
  VALUES (1, '@everyone', 0, 7, TRUE)
  ON CONFLICT (id) DO NOTHING;

-- Reset the sequence so new custom roles start from 2
SELECT setval('roles_id_seq', GREATEST((SELECT MAX(id) FROM roles), 1));
