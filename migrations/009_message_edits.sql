-- Add is_edited flag to messages. Tracks whether the content was ever changed
-- after initial send. We do not track edit count or edit timestamps.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN NOT NULL DEFAULT FALSE;
