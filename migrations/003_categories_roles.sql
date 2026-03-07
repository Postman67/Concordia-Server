-- ============================================================
-- Concordia — categories + roles migration (003)
-- Apply only when upgrading an EXISTING database from 002.
-- Fresh deployments already include this schema via 001_initial.sql.
-- ============================================================

-- 1. Add role column to members
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'moderator', 'admin'));

-- 2. Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(64) NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Add category_id and position to channels
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- 4. Seed default category and assign uncategorized channels (idempotent)
DO $$
DECLARE cat_id INTEGER;
BEGIN
  INSERT INTO categories (name, position)
  SELECT 'Text Channels', 0
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Text Channels');

  SELECT id INTO cat_id FROM categories WHERE name = 'Text Channels' LIMIT 1;
  UPDATE channels SET category_id = cat_id WHERE category_id IS NULL;
END $$;
