import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getServerConfig } from '../config/server';

const router = Router();

// GET /api/server/info — public, returns server metadata and member count
router.get('/info', async (_req, res) => {
  try {
    const config = getServerConfig();
    const countResult = await pool.query('SELECT COUNT(*) FROM members');
    res.json({
      name: config.name,
      description: config.description,
      member_count: parseInt(countResult.rows[0].count, 10),
    });
  } catch (err) {
    console.error('[server/info]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/server/join — authenticated users join this server
// Calling this endpoint is the explicit "join" action. The client calls it
// when a user first opens a server from their Federation server list.
// Subsequent calls are idempotent (username cache is refreshed).
router.post('/join', authenticate, async (req: AuthRequest, res) => {
  const { id, username } = req.user!;

  try {
    await pool.query(
      `INSERT INTO members (user_id, username)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username`,
      [id, username],
    );

    const config = getServerConfig();
    res.status(200).json({
      message: 'Joined server successfully.',
      server: { name: config.name, description: config.description },
    });
  } catch (err) {
    console.error('[server/join]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/server/members — lists member user IDs (no personal data beyond cached username)
router.get('/members', authenticate, async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT user_id, username, joined_at FROM members ORDER BY joined_at',
    );
    res.json({ members: result.rows });
  } catch (err) {
    console.error('[server/members]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
