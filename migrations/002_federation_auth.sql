-- ============================================================
-- Concordia — Federation auth migration (002)
-- Apply this only if you are upgrading an EXISTING database
-- from the original schema (001). Fresh deployments already
-- include this schema through 001_initial.sql.
-- ============================================================

-- 1. Drop FK constraints that point at the old users table
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_created_by_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_user_id_fkey;

-- 2. Drop the local users table — auth is now handled solely by
--    the Federation at https://federation.concordiachat.com
DROP TABLE IF EXISTS users CASCADE;

-- 3. Create the members table (Federation user IDs + cached display name)
CREATE TABLE IF NOT EXISTS members (
  user_id    INTEGER PRIMARY KEY,
  username   VARCHAR(100) NOT NULL,
  joined_at  TIMESTAMPTZ DEFAULT NOW()
);
