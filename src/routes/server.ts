import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getSettings, updateSettings, isAdmin } from '../config/server';
import { requirePermission, requireAdmin } from '../middleware/roles';
import { broadcast } from '../socket/broadcast';

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
      icon_url: config.icon ? `/cdn/icon/${config.icon}` : null,
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
  const { id, username, avatar_url } = req.user!;

  try {
    await pool.query(
      `INSERT INTO members (user_id, username, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url`,
      [id, username, avatar_url],
    );

    const [config, adminCheck] = await Promise.all([
      getSettings(),
      isAdmin(id),
    ]);
    res.status(200).json({
      message: 'Joined server successfully.',
      is_admin: adminCheck,
      server: { name: config.name, description: config.description },
    });
  } catch (err) {
    console.error('[server/join]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/server/@me — returns the authenticated user's member record, is_admin flag, and assigned roles
router.get('/@me', authenticate, async (req: AuthRequest, res) => {
  const { id } = req.user!;
  try {
    const [memberResult, adminCheck, rolesResult] = await Promise.all([
      pool.query(
        'SELECT user_id, username, avatar_url, joined_at FROM members WHERE user_id = $1',
        [id],
      ),
      isAdmin(id),
      pool.query(
        `SELECT r.id, r.name, r.color, r.position, r.permissions::text AS permissions, r.is_everyone
         FROM roles r
         JOIN member_roles mr ON mr.role_id = r.id
         WHERE mr.user_id = $1
         ORDER BY r.position DESC`,
        [id],
      ),
    ]);

    if (memberResult.rows.length === 0) {
      res.status(404).json({ error: 'Not a member of this server' });
      return;
    }

    res.json({
      ...memberResult.rows[0],
      is_admin: adminCheck,
      roles: rolesResult.rows,
    });
  } catch (err) {
    console.error('[server/@me]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/server/members — lists members with their assigned roles
router.get('/members', authenticate, async (_req, res) => {
  try {
    const membersResult = await pool.query(
      'SELECT user_id, username, avatar_url, joined_at FROM members ORDER BY joined_at',
    );

    // Fetch all member_roles in one query and group them
    const rolesResult = await pool.query(
      `SELECT mr.user_id, r.id, r.name, r.color, r.position,
              r.permissions::text AS permissions, r.is_everyone
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       ORDER BY r.position DESC`,
    );

    const rolesByUser: Record<string, typeof rolesResult.rows> = {};
    for (const row of rolesResult.rows) {
      if (!rolesByUser[row.user_id]) rolesByUser[row.user_id] = [];
      const { user_id: _uid, ...roleData } = row;
      rolesByUser[row.user_id].push(roleData);
    }

    const members = membersResult.rows.map(m => ({
      ...m,
      roles: rolesByUser[m.user_id] ?? [],
    }));

    res.json({ members });
  } catch (err) {
    console.error('[server/members]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/server/settings — returns all admin-configurable settings (admin only)
router.get('/settings', authenticate, requireAdmin(), async (_req, res) => {
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
  requireAdmin(),
  async (req: AuthRequest, res) => {
    const { name, description, admin_user_id } = req.body as {
      name?: unknown;
      description?: unknown;
      admin_user_id?: unknown;
    };

    const updates: Record<string, string> = {};

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
      // Accept a valid UUID (to set admin) or empty string (to unset)
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (admin_user_id !== '' && (typeof admin_user_id !== 'string' || !UUID_RE.test(admin_user_id))) {
        res.status(400).json({ error: 'admin_user_id must be a valid UUID or empty string to unset' });
        return;
      }
      updates['admin_user_id'] = admin_user_id as string;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields provided' });
      return;
    }

    try {
      await updateSettings(updates);
      const updated = await getSettings();
      // Only broadcast publicly-visible fields — admin_user_id stays server-side
      if (updates['name'] !== undefined || updates['description'] !== undefined) {
        broadcast('server:updated', { name: updated.name, description: updated.description });
      }
      res.json(updated);
    } catch (err) {
      console.error('[server/settings PATCH]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
