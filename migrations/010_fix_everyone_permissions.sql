-- Corrects the @everyone role permissions bitmask.
--
-- Migration 006 was seeded with bitmask 7 (VIEW_CHANNELS=1 | SEND_MESSAGES=2 | READ_MESSAGE_HISTORY=4)
-- using an old bit layout. The current layout in permissions.ts is:
--   ADMINISTRATOR        = 1 << 0 = 1   (should NOT be on @everyone)
--   VIEW_CHANNELS        = 1 << 1 = 2
--   SEND_MESSAGES        = 1 << 2 = 4
--   READ_MESSAGE_HISTORY = 1 << 3 = 8
--
-- Correct default bitmask = 14 (2 | 4 | 8)
--
-- This UPDATE is safe to re-run: any admin who has intentionally customised
-- @everyone permissions will have a value other than 7, and the WHERE clause
-- only touches rows that still hold the wrong seed value.
UPDATE roles
SET permissions = 14
WHERE is_everyone = TRUE
  AND permissions = 7;
