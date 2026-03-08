import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, requireAdmin } from '../middleware/roles';
import { broadcast } from '../socket/broadcast';
import { Permissions, PermissionKey } from '../config/permissions';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Validate and parse a permissions bitmask from the request body. */
function parsePermissionBits(raw: unknown): bigint | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return BigInt(Math.floor(raw));
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw);
  return null;
}

/**
 * Validate a permissions object map like { VIEW_CHANNELS: true, SEND_MESSAGES: false }.
 * Returns a bitmask or null on error.
 */
function permMapToBits(map: Record<string, unknown>): bigint | null {
  let bits = BigInt(0);
  for (const [key, val] of Object.entries(map)) {
    if (!(key in Permissions)) return null;
    if (val === true) bits |= Permissions[key as PermissionKey];
  }
  return bits;
}

/** Shared validation for allow_bits / deny_bits override payloads. */
function parseOverrideBits(body: Record<string, unknown>): { allow: bigint; deny: bigint } | { error: string } {
  const allow = parsePermissionBits(body.allow_bits);
  const deny  = parsePermissionBits(body.deny_bits);
  if (allow === null || deny === null) return { error: 'allow_bits and deny_bits must be numeric' };
  if ((allow & deny) !== BigInt(0)) return { error: 'A permission bit cannot be both allowed and denied' };
  return { allow, deny };
}

// ── GET /api/roles — list all roles ──────────────────────────────────────────
router.get('/', authenticate, async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, color, position, permissions::text AS permissions, is_everyone, created_at FROM roles ORDER BY position DESC, id',
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[roles/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/roles — create a custom role ─────────────────────────────────
router.post('/', authenticate, requirePermission('MANAGE_ROLES'), async (req: AuthRequest, res) => {
  const { name, color, position, permissions } = req.body as {
    name?: unknown;
    color?: unknown;
    position?: unknown;
    permissions?: unknown;
  };

  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 64) {
    res.status(400).json({ error: 'name must be a non-empty string up to 64 characters' });
    return;
  }

  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  if (color !== undefined && color !== null && (typeof color !== 'string' || !HEX_RE.test(color))) {
    res.status(400).json({ error: 'color must be a hex string like #5865F2' });
    return;
  }

  let permBits = BigInt(0);
  if (permissions !== undefined) {
    if (typeof permissions === 'object' && permissions !== null) {
      const parsed = permMapToBits(permissions as Record<string, unknown>);
      if (parsed === null) {
        res.status(400).json({ error: 'permissions contains unknown permission keys' });
        return;
      }
      permBits = parsed;
    } else {
      const parsed = parsePermissionBits(permissions);
      if (parsed === null) {
        res.status(400).json({ error: 'permissions must be a number or permission map' });
        return;
      }
      permBits = parsed;
    }
  }

  // Disallow granting ADMINISTRATOR through role creation — only the server admin gets that
  permBits = permBits & ~Permissions.ADMINISTRATOR;

  try {
    let pos: number;
    if (typeof position === 'number' && Number.isInteger(position)) {
      pos = position;
    } else {
      const maxResult = await pool.query('SELECT COALESCE(MAX(position), 0) AS max FROM roles');
      pos = (maxResult.rows[0].max as number) + 1;
    }

    const result = await pool.query(
      `INSERT INTO roles (name, color, position, permissions)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, color, position, permissions::text AS permissions, is_everyone, created_at`,
      [name.trim(), color ?? null, pos, permBits.toString()],
    );
    broadcast('role:created', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[roles/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/roles/:id — update a role ──────────────────────────────────────
router.patch('/:id', authenticate, requirePermission('MANAGE_ROLES'), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid role id' });
    return;
  }

  // @everyone name and is_everyone flag can only be changed by admin
  const existing = await pool.query(
    'SELECT is_everyone FROM roles WHERE id = $1',
    [id],
  );
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }

  const { name, color, position, permissions } = req.body as {
    name?: unknown;
    color?: unknown;
    position?: unknown;
    permissions?: unknown;
  };

  const fields: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown) => {
    fields.push(`${col} = $${fields.length + 1}`);
    values.push(val);
  };

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 64) {
      res.status(400).json({ error: 'name must be a non-empty string up to 64 characters' });
      return;
    }
    push('name', name.trim());
  }

  if ('color' in req.body) {
    const HEX_RE = /^#[0-9a-fA-F]{6}$/;
    if (color !== null && (typeof color !== 'string' || !HEX_RE.test(color))) {
      res.status(400).json({ error: 'color must be a hex string like #5865F2 or null' });
      return;
    }
    push('color', color ?? null);
  }

  if (position !== undefined) {
    if (typeof position !== 'number' || !Number.isInteger(position)) {
      res.status(400).json({ error: 'position must be an integer' });
      return;
    }
    push('position', position);
  }

  if (permissions !== undefined) {
    let permBits: bigint | null = null;
    if (typeof permissions === 'object' && permissions !== null) {
      permBits = permMapToBits(permissions as Record<string, unknown>);
    } else {
      permBits = parsePermissionBits(permissions);
    }
    if (permBits === null) {
      res.status(400).json({ error: 'permissions must be a number or permission map' });
      return;
    }
    // Disallow granting ADMINISTRATOR through role editing
    permBits = permBits & ~Permissions.ADMINISTRATOR;
    push('permissions', permBits.toString());
  }

  if (fields.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE roles SET ${fields.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, name, color, position, permissions::text AS permissions, is_everyone, created_at`,
      values,
    );
    broadcast('role:updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[roles/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/roles/:id — delete a role ─────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('MANAGE_ROLES'), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid role id' });
    return;
  }

  try {
    // Prevent deleting @everyone
    const check = await pool.query('SELECT is_everyone FROM roles WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }
    if (check.rows[0].is_everyone) {
      res.status(403).json({ error: 'Cannot delete the @everyone role' });
      return;
    }

    await pool.query('DELETE FROM roles WHERE id = $1', [id]);
    broadcast('role:deleted', { id });
    res.status(204).send();
  } catch (err) {
    console.error('[roles/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/roles/members/:userId — get roles for a user ────────────────────
router.get('/members/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pool.query(
      `SELECT r.id, r.name, r.color, r.position, r.permissions::text AS permissions, r.is_everyone
       FROM roles r
       JOIN member_roles mr ON mr.role_id = r.id
       WHERE mr.user_id = $1
       ORDER BY r.position DESC`,
      [userId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[roles/member-roles]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/roles/members/:userId — set roles for a user ────────────────────
// Body: { role_ids: number[] }
router.put('/members/:userId', authenticate, requirePermission('MANAGE_ROLES'), async (req: AuthRequest, res) => {
  const { userId } = req.params;
  const { role_ids } = req.body as { role_ids?: unknown };

  if (!Array.isArray(role_ids) || !role_ids.every(Number.isInteger)) {
    res.status(400).json({ error: 'role_ids must be an array of integers' });
    return;
  }

  // Disallow assigning roles with ADMINISTRATOR bit
  if (role_ids.length > 0) {
    const check = await pool.query(
      `SELECT id FROM roles WHERE id = ANY($1::int[]) AND (permissions & $2) != 0`,
      [role_ids, Permissions.ADMINISTRATOR.toString()],
    );
    if (check.rows.length > 0) {
      res.status(403).json({ error: 'Cannot assign a role that holds the ADMINISTRATOR permission' });
      return;
    }
  }

  try {
    const memberCheck = await pool.query('SELECT user_id FROM members WHERE user_id = $1', [userId]);
    if (memberCheck.rows.length === 0) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM member_roles WHERE user_id = $1', [userId]);
      for (const roleId of role_ids as number[]) {
        await client.query(
          'INSERT INTO member_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, roleId],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const updated = await pool.query(
      `SELECT r.id, r.name, r.color, r.position, r.permissions::text AS permissions, r.is_everyone
       FROM roles r
       JOIN member_roles mr ON mr.role_id = r.id
       WHERE mr.user_id = $1
       ORDER BY r.position DESC`,
      [userId],
    );
    const payload = { user_id: userId, roles: updated.rows };
    broadcast('member:roles_updated', payload);
    res.json(payload);
  } catch (err) {
    console.error('[roles/set-member-roles]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/roles/permissions — list all permission names and bit values ─────
router.get('/permissions', authenticate, (_req, res) => {
  const list = Object.entries(Permissions).map(([key, bit]) => ({
    key,
    bit: bit.toString(),
  }));
  res.json(list);
});

// ── Channel permission overrides ──────────────────────────────────────────────

// GET /api/roles/overrides/channel/:channelId
router.get('/overrides/channel/:channelId', authenticate, async (req, res) => {
  const channelId = parseInt(req.params.channelId, 10);
  if (isNaN(channelId)) { res.status(400).json({ error: 'Invalid channel id' }); return; }
  try {
    const result = await pool.query(
      `SELECT cpo.role_id, r.name AS role_name, r.is_everyone,
              cpo.allow_bits::text, cpo.deny_bits::text
       FROM channel_permission_overrides cpo
       JOIN roles r ON r.id = cpo.role_id
       WHERE cpo.channel_id = $1
       ORDER BY r.position DESC`,
      [channelId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[overrides/channel/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/roles/overrides/channel/:channelId/:roleId
router.put('/overrides/channel/:channelId/:roleId', authenticate, requirePermission('MANAGE_CHANNELS'), async (req: AuthRequest, res) => {
  const channelId = parseInt(req.params.channelId, 10);
  const roleId    = parseInt(req.params.roleId, 10);
  if (isNaN(channelId) || isNaN(roleId)) {
    res.status(400).json({ error: 'Invalid channel or role id' });
    return;
  }

  const parsed = parseOverrideBits(req.body as Record<string, unknown>);
  if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return; }

  try {
    await pool.query(
      `INSERT INTO channel_permission_overrides (channel_id, role_id, allow_bits, deny_bits)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (channel_id, role_id) DO UPDATE SET allow_bits = EXCLUDED.allow_bits, deny_bits = EXCLUDED.deny_bits`,
      [channelId, roleId, parsed.allow.toString(), parsed.deny.toString()],
    );
    const row = { channel_id: channelId, role_id: roleId, allow_bits: parsed.allow.toString(), deny_bits: parsed.deny.toString() };
    broadcast('channel:overrides_updated', row);
    res.json(row);
  } catch (err) {
    console.error('[overrides/channel/put]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/roles/overrides/channel/:channelId/:roleId
router.delete('/overrides/channel/:channelId/:roleId', authenticate, requirePermission('MANAGE_CHANNELS'), async (req: AuthRequest, res) => {
  const channelId = parseInt(req.params.channelId, 10);
  const roleId    = parseInt(req.params.roleId, 10);
  if (isNaN(channelId) || isNaN(roleId)) {
    res.status(400).json({ error: 'Invalid channel or role id' });
    return;
  }
  try {
    await pool.query(
      'DELETE FROM channel_permission_overrides WHERE channel_id = $1 AND role_id = $2',
      [channelId, roleId],
    );
    broadcast('channel:overrides_updated', { channel_id: channelId, role_id: roleId, deleted: true });
    res.status(204).send();
  } catch (err) {
    console.error('[overrides/channel/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Category permission overrides ─────────────────────────────────────────────

// GET /api/roles/overrides/category/:categoryId
router.get('/overrides/category/:categoryId', authenticate, async (req, res) => {
  const categoryId = parseInt(req.params.categoryId, 10);
  if (isNaN(categoryId)) { res.status(400).json({ error: 'Invalid category id' }); return; }
  try {
    const result = await pool.query(
      `SELECT cpo.role_id, r.name AS role_name, r.is_everyone,
              cpo.allow_bits::text, cpo.deny_bits::text
       FROM category_permission_overrides cpo
       JOIN roles r ON r.id = cpo.role_id
       WHERE cpo.category_id = $1
       ORDER BY r.position DESC`,
      [categoryId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[overrides/category/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/roles/overrides/category/:categoryId/:roleId
router.put('/overrides/category/:categoryId/:roleId', authenticate, requirePermission('MANAGE_CATEGORIES'), async (req: AuthRequest, res) => {
  const categoryId = parseInt(req.params.categoryId, 10);
  const roleId     = parseInt(req.params.roleId, 10);
  if (isNaN(categoryId) || isNaN(roleId)) {
    res.status(400).json({ error: 'Invalid category or role id' });
    return;
  }

  const parsed = parseOverrideBits(req.body as Record<string, unknown>);
  if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return; }

  try {
    await pool.query(
      `INSERT INTO category_permission_overrides (category_id, role_id, allow_bits, deny_bits)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (category_id, role_id) DO UPDATE SET allow_bits = EXCLUDED.allow_bits, deny_bits = EXCLUDED.deny_bits`,
      [categoryId, roleId, parsed.allow.toString(), parsed.deny.toString()],
    );
    const row = { category_id: categoryId, role_id: roleId, allow_bits: parsed.allow.toString(), deny_bits: parsed.deny.toString() };
    broadcast('category:overrides_updated', row);
    res.json(row);
  } catch (err) {
    console.error('[overrides/category/put]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/roles/overrides/category/:categoryId/:roleId
router.delete('/overrides/category/:categoryId/:roleId', authenticate, requirePermission('MANAGE_CATEGORIES'), async (req: AuthRequest, res) => {
  const categoryId = parseInt(req.params.categoryId, 10);
  const roleId     = parseInt(req.params.roleId, 10);
  if (isNaN(categoryId) || isNaN(roleId)) {
    res.status(400).json({ error: 'Invalid category or role id' });
    return;
  }
  try {
    await pool.query(
      'DELETE FROM category_permission_overrides WHERE category_id = $1 AND role_id = $2',
      [categoryId, roleId],
    );
    broadcast('category:overrides_updated', { category_id: categoryId, role_id: roleId, deleted: true });
    res.status(204).send();
  } catch (err) {
    console.error('[overrides/category/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/roles/@me/permissions — resolve calling user's effective perms ───
router.get('/@me/permissions', authenticate, async (req: AuthRequest, res) => {
  const channelId = req.query.channelId
    ? parseInt(req.query.channelId as string, 10)
    : undefined;

  try {
    const [bits, ownerCheck] = await Promise.all([
      import('../config/permissions').then(m =>
        m.resolvePermissions(req.user!.id, channelId),
      ),
      import('../config/server').then(m => m.isAdmin(req.user!.id)),
    ]);
    // Return each permission's name and whether it's granted
    const resolved: Record<string, boolean> = {};
    for (const [key, bit] of Object.entries(Permissions)) {
      resolved[key] = (bits & bit) === bit;
    }
    res.json({ bits: bits.toString(), resolved, is_owner: ownerCheck });
  } catch (err) {
    console.error('[roles/@me/permissions]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
