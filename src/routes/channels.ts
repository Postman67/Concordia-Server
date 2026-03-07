import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

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

// POST /api/channels — create a channel (moderator or admin)
router.post('/', authenticate, requireRole('moderator'), async (req: AuthRequest, res) => {
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

    const pos = typeof position === 'number' ? position : 0;
    const catId = typeof category_id === 'number' ? category_id : null;

    const result = await pool.query(
      `INSERT INTO channels (name, description, category_id, position, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, category_id, position, created_at`,
      [name, description ?? null, catId, pos, req.user!.id],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[channels/create]', err);
    res.status(500).json({ error: 'Internal server error' });
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
    res.json(result.rows[0]);
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
    res.status(204).send();
  } catch (err) {
    console.error('[channels/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
