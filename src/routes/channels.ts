import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { broadcast } from '../socket/broadcast';

const router = Router();

// GET /api/channels — list all channels with category info, ordered by category then position
router.get('/', authenticate, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.category_id, c.position, c.created_at,
              cat.name AS category_name, cat.position AS category_position
       FROM channels c
       LEFT JOIN categories cat ON cat.id = c.category_id
       ORDER BY COALESCE(cat.position, 999999), c.position, c.name`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[channels/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/channels — create a channel (admin only)
// position is auto-assigned (appended to end of category) unless explicitly provided.
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
  const { name, description, category_id, position } = req.body as {
    name?: string;
    description?: string;
    category_id?: number;
    position?: number;
  };

  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (name.length < 1 || name.length > 64) {
    res.status(400).json({ error: 'name must be 1–64 characters' });
    return;
  }

  try {
    const exists = await pool.query('SELECT id FROM channels WHERE name = $1', [name]);
    if (exists.rows.length > 0) {
      res.status(409).json({ error: 'Channel name already taken' });
      return;
    }

    const catId = typeof category_id === 'number' ? category_id : null;

    let pos: number;
    if (typeof position === 'number' && Number.isInteger(position)) {
      pos = position;
    } else {
      // Append to the end of whatever category this channel is going into
      const maxResult = await pool.query(
        'SELECT COALESCE(MAX(position), -1) AS max FROM channels WHERE category_id IS NOT DISTINCT FROM $1',
        [catId],
      );
      pos = (maxResult.rows[0].max as number) + 1;
    }

    const result = await pool.query(
      `INSERT INTO channels (name, description, category_id, position, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, category_id, position, created_at`,
      [name, description ?? null, catId, pos, req.user!.id],
    );
    const full = await pool.query(
      `SELECT c.id, c.name, c.description, c.category_id, c.position, c.created_at,
              cat.name AS category_name, cat.position AS category_position
       FROM channels c LEFT JOIN categories cat ON cat.id = c.category_id
       WHERE c.id = $1`,
      [result.rows[0].id],
    );
    broadcast('channel:created', full.rows[0]);
    res.status(201).json(full.rows[0]);
  } catch (err) {
    console.error('[channels/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/channels/reorder — atomically reposition channels, optionally moving between categories (admin only)
// Body: array of { id: number, category_id: number | null, position: number }
// The client sends the full desired layout after a drag-and-drop. All changes are
// applied inside a single transaction so the sidebar never shows a partial state.
router.put('/reorder', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
  const items = req.body as unknown;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Body must be a non-empty array of { id, category_id, position }' });
    return;
  }

  for (const item of items) {
    const i = item as Record<string, unknown>;
    if (
      typeof item !== 'object' || item === null ||
      !Number.isInteger(i.id) ||
      !Number.isInteger(i.position) ||
      (i.category_id !== null && !Number.isInteger(i.category_id))
    ) {
      res.status(400).json({ error: 'Each item must have integer id, position, and category_id (integer or null)' });
      return;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items as Array<{ id: number; category_id: number | null; position: number }>) {
      await client.query(
        'UPDATE channels SET category_id = $1, position = $2 WHERE id = $3',
        [item.category_id, item.position, item.id],
      );
    }
    await client.query('COMMIT');

    const updated = await pool.query(
      `SELECT c.id, c.name, c.description, c.category_id, c.position, c.created_at,
              cat.name AS category_name, cat.position AS category_position
       FROM channels c
       LEFT JOIN categories cat ON cat.id = c.category_id
       ORDER BY COALESCE(cat.position, 999999), c.position, c.name`,
    );
    broadcast('channels:reordered', updated.rows);
    res.json(updated.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[channels/reorder]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/channels/:id — update name, description, category, or position (moderator or admin)
router.patch('/:id', authenticate, requireRole('moderator'), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid channel id' });
    return;
  }

  const { name, description, category_id, position } = req.body as {
    name?: string;
    description?: string | null;
    category_id?: number | null;
    position?: number;
  };

  if (name !== undefined && (typeof name !== 'string' || name.length < 1 || name.length > 64)) {
    res.status(400).json({ error: 'name must be 1–64 characters' });
    return;
  }
  if (position !== undefined && (typeof position !== 'number' || !Number.isInteger(position))) {
    res.status(400).json({ error: 'position must be an integer' });
    return;
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  const push = (expr: string, val: unknown) => {
    fields.push(`${expr} = $${fields.length + 1}`);
    values.push(val);
  };

  if (name !== undefined)        push('name', name);
  if ('description' in req.body) push('description', description ?? null);
  if ('category_id' in req.body) push('category_id', category_id ?? null);
  if (position !== undefined)    push('position', position);

  if (fields.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE channels SET ${fields.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, name, description, category_id, position, created_at`,
      values,
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    const full = await pool.query(
      `SELECT c.id, c.name, c.description, c.category_id, c.position, c.created_at,
              cat.name AS category_name, cat.position AS category_position
       FROM channels c LEFT JOIN categories cat ON cat.id = c.category_id
       WHERE c.id = $1`,
      [result.rows[0].id],
    );
    broadcast('channel:updated', full.rows[0]);
    res.json(full.rows[0]);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'Channel name already taken' });
      return;
    }
    console.error('[channels/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/channels/:id — delete a channel (admin only)
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id, 10);

  try {
    const result = await pool.query('DELETE FROM channels WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    broadcast('channel:deleted', { id });
    res.status(204).send();
  } catch (err) {
    console.error('[channels/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
