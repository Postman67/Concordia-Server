import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/messages/:channelId
// Query params:
//   limit  — number of messages to return (default 50, max 200)
//   before — ISO timestamp; returns messages older than this (pagination)
router.get('/:channelId', authenticate, async (req, res) => {
  const channelId = parseInt(req.params.channelId, 10);
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
  const before = req.query.before as string | undefined;

  if (isNaN(channelId)) {
    res.status(400).json({ error: 'Invalid channel id' });
    return;
  }

  try {
    const channelCheck = await pool.query(
      'SELECT id FROM channels WHERE id = $1',
      [channelId],
    );
    if (channelCheck.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    let rows;
    if (before) {
      const result = await pool.query(
        `SELECT m.id, m.content, m.created_at,
                u.id AS user_id, u.username
         FROM messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.channel_id = $1 AND m.created_at < $2
         ORDER BY m.created_at DESC
         LIMIT $3`,
        [channelId, before, limit],
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT m.id, m.content, m.created_at,
                u.id AS user_id, u.username
         FROM messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.channel_id = $1
         ORDER BY m.created_at DESC
         LIMIT $2`,
        [channelId, limit],
      );
      rows = result.rows;
    }

    // Return in ascending (chronological) order so the client can
    // append them top-to-bottom without reversing.
    res.json(rows.reverse());
  } catch (err) {
    console.error('[messages/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
