import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getSettings, updateSettings, isAdmin } from '../config/server';
import { requirePermission, requireAdmin } from '../middleware/roles';
import { broadcast } from '../socket/broadcast';
import { resolvePermissions, hasPermission, Permissions } from '../config/permissions';

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
    const upsertResult = await pool.query(
      `INSERT INTO members (user_id, username, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url
       RETURNING user_id, username, avatar_url, joined_at, (xmax = 0) AS is_new_member`,
      [id, username, avatar_url],
    );

    const [config, ownerCheck] = await Promise.all([
      getSettings(),
      isAdmin(id),
    ]);

    if (upsertResult.rows[0].is_new_member) {
      const { user_id, username: uname, avatar_url: uavatar, joined_at } = upsertResult.rows[0];
      broadcast('member:joined', { user_id, username: uname, avatar_url: uavatar, joined_at, is_owner: ownerCheck });
    }

    res.status(200).json({
      message: 'Joined server successfully.',
      is_owner: ownerCheck,
      server: { name: config.name, description: config.description },
    });
  } catch (err) {
    console.error('[server/join]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/server/@me — leave the server
// The server owner cannot leave; they must transfer ownership first.
router.delete('/@me', authenticate, async (req: AuthRequest, res) => {
  const { id } = req.user!;

  try {
    const ownerCheck = await isAdmin(id);
    if (ownerCheck) {
      res.status(403).json({ error: 'The server owner cannot leave. Transfer ownership first.' });
      return;
    }

    const result = await pool.query(
      'DELETE FROM members WHERE user_id = $1 RETURNING user_id, username',
      [id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not a member of this server' });
      return;
    }

    broadcast('member:left', { user_id: result.rows[0].user_id, username: result.rows[0].username });
    res.status(200).json({ message: 'Left server successfully.' });
  } catch (err) {
    console.error('[server/DELETE @me]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/server/@me — returns the authenticated user's member record, is_owner flag, and assigned roles
router.get('/@me', authenticate, async (req: AuthRequest, res) => {
  const { id } = req.user!;
  try {
    const [memberResult, ownerCheck, rolesResult] = await Promise.all([
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
      is_owner: ownerCheck,
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
    const [membersResult, rolesResult, settings] = await Promise.all([
      pool.query(
        'SELECT user_id, username, avatar_url, joined_at FROM members ORDER BY joined_at',
      ),
      pool.query(
        `SELECT mr.user_id, r.id, r.name, r.color, r.position,
                r.permissions::text AS permissions, r.is_everyone
         FROM member_roles mr
         JOIN roles r ON r.id = mr.role_id
         ORDER BY r.position DESC`,
      ),
      getSettings(),
    ]);

    // Determine owner IDs without a per-member DB call
    const envAdmin = process.env.ADMIN_USER_ID || '';
    const ownerIds = new Set<string>();
    if (envAdmin !== '') ownerIds.add(envAdmin);
    if (settings.admin_user_id !== '') ownerIds.add(settings.admin_user_id);

    // Fetch all member_roles in one query and group them
    const rolesByUser: Record<string, typeof rolesResult.rows> = {};
    for (const row of rolesResult.rows) {
      if (!rolesByUser[row.user_id]) rolesByUser[row.user_id] = [];
      const { user_id: _uid, ...roleData } = row;
      rolesByUser[row.user_id].push(roleData);
    }

    const members = membersResult.rows.map(m => ({
      ...m,
      is_owner: ownerIds.has(m.user_id),
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
    const { name, description, admin_user_id, media_compression_level } = req.body as {
      name?: unknown;
      description?: unknown;
      admin_user_id?: unknown;
      media_compression_level?: unknown;
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

    if (media_compression_level !== undefined) {
      const level = Number(media_compression_level);
      if (!Number.isInteger(level) || level < 0 || level > 100) {
        res.status(400).json({ error: 'media_compression_level must be an integer between 0 and 100' });
        return;
      }
      updates['media_compression_level'] = String(level);
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

// POST /api/server/load — single call that returns everything the client needs when selecting a server.
// Equivalent to: POST /join + GET /@me + GET /info + GET /members + GET /channels + GET /categories
//                + GET /roles/@me/permissions + GET /health — all in one round trip.
router.post('/load', authenticate, async (req: AuthRequest, res) => {
  const { id, username, avatar_url } = req.user!;

  try {
    // Step 1: Upsert member — must happen before parallel queries so the row exists for @me lookups.
    const upsertResult = await pool.query(
      `INSERT INTO members (user_id, username, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url
       RETURNING user_id, username, avatar_url, joined_at, (xmax = 0) AS is_new_member`,
      [id, username, avatar_url],
    );
    const { is_new_member: isNewMember, ...meRow } = upsertResult.rows[0] as {
      user_id: string; username: string; avatar_url: string | null;
      joined_at: string; is_new_member: boolean;
    };

    // Step 2: Fire all independent queries in parallel.
    const [
      settings,
      ownerCheck,
      myRolesResult,
      allMembersResult,
      memberRolesResult,
      allChannelsResult,
      categoriesResult,
      permBits,
    ] = await Promise.all([
      getSettings(),
      isAdmin(id),
      pool.query(
        `SELECT r.id, r.name, r.color, r.position, r.permissions::text AS permissions, r.is_everyone
         FROM roles r
         JOIN member_roles mr ON mr.role_id = r.id
         WHERE mr.user_id = $1
         ORDER BY r.position DESC`,
        [id],
      ),
      pool.query(
        'SELECT user_id, username, avatar_url, joined_at FROM members ORDER BY joined_at',
      ),
      pool.query(
        `SELECT mr.user_id, r.id, r.name, r.color, r.position,
                r.permissions::text AS permissions, r.is_everyone
         FROM member_roles mr
         JOIN roles r ON r.id = mr.role_id
         ORDER BY r.position DESC`,
      ),
      pool.query(
        `SELECT c.id, c.name, c.description, c.category_id, c.position, c.created_at,
                cat.name AS category_name, cat.position AS category_position
         FROM channels c
         LEFT JOIN categories cat ON cat.id = c.category_id
         ORDER BY COALESCE(cat.position, 999999), c.position, c.name`,
      ),
      pool.query(
        'SELECT id, name, position, created_at FROM categories ORDER BY position, name',
      ),
      resolvePermissions(id),
    ]);

    // Step 3: Filter channels by VIEW_CHANNELS, resolving per-channel overrides in parallel.
    const channelVisibility = await Promise.all(
      allChannelsResult.rows.map(async (ch) => {
        const chPerms = await resolvePermissions(id, ch.id as number);
        return hasPermission(chPerms, Permissions.VIEW_CHANNELS) ? ch : null;
      }),
    );

    // Assemble members list (same logic as GET /members)
    const envAdmin = process.env.ADMIN_USER_ID || '';
    const ownerIds = new Set<string>();
    if (envAdmin !== '') ownerIds.add(envAdmin);
    if (settings.admin_user_id !== '') ownerIds.add(settings.admin_user_id);

    const rolesByUser: Record<string, object[]> = {};
    for (const row of memberRolesResult.rows) {
      if (!rolesByUser[row.user_id]) rolesByUser[row.user_id] = [];
      const { user_id: _uid, ...roleData } = row;
      rolesByUser[row.user_id].push(roleData);
    }
    const members = allMembersResult.rows.map(m => ({
      ...m,
      is_owner: ownerIds.has(m.user_id as string),
      roles: rolesByUser[m.user_id as string] ?? [],
    }));

    // Resolved permissions map
    const resolved: Record<string, boolean> = {};
    for (const [key, bit] of Object.entries(Permissions)) {
      resolved[key] = (permBits & bit) === bit;
    }

    // Broadcast member:joined only on first join
    if (isNewMember) {
      broadcast('member:joined', {
        user_id: meRow.user_id,
        username: meRow.username,
        avatar_url: meRow.avatar_url,
        joined_at: meRow.joined_at,
        is_owner: ownerCheck,
      });
    }

    res.json({
      server: {
        name: settings.name,
        description: settings.description,
        member_count: allMembersResult.rows.length,
        icon_url: settings.icon ? `/cdn/icon/${settings.icon}` : null,
      },
      me: {
        ...meRow,
        is_owner: ownerCheck,
        roles: myRolesResult.rows,
        permissions: { bits: permBits.toString(), resolved },
      },
      members,
      channels: channelVisibility.filter(Boolean),
      categories: categoriesResult.rows,
    });
  } catch (err) {
    console.error('[server/load]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
