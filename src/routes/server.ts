import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getSettings, updateSettings, isAdmin } from '../config/server';
import { requireRole } from '../middleware/roles';

const router = Router();

// GET /api/server/info — public, returns server metadata and member count
router.get('/info', async (_req, res) => {
  try {
    const [config, countResult] = await Promise.all([
      getSettings(),
      pool.query('SELECT COUNT(*) FROM members'),
    ]);
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

    const config = await getSettings();
    res.status(200).json({
      message: 'Joined server successfully.',
      server: { name: config.name, description: config.description },
    });
  } catch (err) {
    console.error('[server/join]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/server/members — lists members with their roles
router.get('/members', authenticate, async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT user_id, username, role, joined_at FROM members ORDER BY joined_at',
    );
    res.json({ members: result.rows });
  } catch (err) {
    console.error('[server/members]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/server/members/:userId/role — assign a role to a member (admin only)
router.put(
  '/members/:userId/role',
  authenticate,
  requireRole('admin'),
  async (req: AuthRequest, res) => {
    const targetId = parseInt(req.params.userId, 10);
    if (isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }

    const { role } = req.body as { role?: string };
    if (!role || !['member', 'moderator', 'admin'].includes(role)) {
      res.status(400).json({ error: 'role must be member, moderator, or admin' });
      return;
    }

    // Prevent demoting the server config owner
    if (await isAdmin(targetId) && role !== 'admin') {
      res.status(403).json({ error: 'Cannot change the role of the server owner' });
      return;
    }

    try {
      const result = await pool.query(
        'UPDATE members SET role = $1 WHERE user_id = $2 RETURNING user_id, username, role',
        [role, targetId],
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }
      res.json({ member: result.rows[0] });
    } catch (err) {
      console.error('[server/members/role]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// GET /api/server/settings — returns all admin-configurable settings (admin only)
router.get('/settings', authenticate, requireRole('admin'), async (_req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    console.error('[server/settings GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/server/settings — update one or more settings (admin only)
router.patch(
  '/settings',
  authenticate,
  requireRole('admin'),
  async (req: AuthRequest, res) => {
    const { name, description, admin_user_id } = req.body as {
      name?: unknown;
      description?: unknown;
      admin_user_id?: unknown;
    };

    const updates: Record<string, string | number> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
        res.status(400).json({ error: 'name must be a non-empty string up to 100 characters' });
        return;
      }
      updates['name'] = name.trim();
    }

    if (description !== undefined) {
      if (typeof description !== 'string' || description.length > 500) {
        res.status(400).json({ error: 'description must be a string up to 500 characters' });
        return;
      }
      updates['description'] = description;
    }

    if (admin_user_id !== undefined) {
      const id = Number(admin_user_id);
      if (!Number.isInteger(id) || id < 0) {
        res.status(400).json({ error: 'admin_user_id must be a non-negative integer' });
        return;
      }
      updates['admin_user_id'] = id;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields provided' });
      return;
    }

    try {
      await updateSettings(updates);
      const updated = await getSettings();
      res.json(updated);
    } catch (err) {
      console.error('[server/settings PATCH]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
