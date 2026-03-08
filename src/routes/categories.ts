import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/roles';
import { broadcast } from '../socket/broadcast';

const router = Router();

// GET /api/categories — list all categories ordered by position
router.get('/', authenticate, async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, position, created_at FROM categories ORDER BY position, name',
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[categories/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/categories — create a category (admin only)
// position is auto-assigned (appended to end) unless explicitly provided.
router.post('/', authenticate, requirePermission('MANAGE_CATEGORIES'), async (req: AuthRequest, res) => {
  const { name, position } = req.body as { name?: string; position?: number };

  if (!name || typeof name !== 'string' || name.length < 1 || name.length > 64) {
    res.status(400).json({ error: 'name must be 1–64 characters' });
    return;
  }

  try {
    let pos: number;
    if (typeof position === 'number' && Number.isInteger(position)) {
      pos = position;
    } else {
      const maxResult = await pool.query('SELECT COALESCE(MAX(position), -1) AS max FROM categories');
      pos = (maxResult.rows[0].max as number) + 1;
    }

    const result = await pool.query(
      'INSERT INTO categories (name, position) VALUES ($1, $2) RETURNING id, name, position, created_at',
      [name, pos],
    );
    broadcast('category:created', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[categories/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/categories/reorder — atomically reposition all categories (admin only)
// Body: array of { id: number, position: number }
// The client sends the full desired order (e.g. after a drag-and-drop), and the
// server applies all changes inside a single transaction.
router.put('/reorder', authenticate, requirePermission('MANAGE_CATEGORIES'), async (req: AuthRequest, res) => {
  const items = req.body as unknown;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Body must be a non-empty array of { id, position }' });
    return;
  }

  for (const item of items) {
    if (
      typeof item !== 'object' || item === null ||
      !Number.isInteger((item as Record<string, unknown>).id) ||
      !Number.isInteger((item as Record<string, unknown>).position)
    ) {
      res.status(400).json({ error: 'Each item must have integer id and position' });
      return;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items as Array<{ id: number; position: number }>) {
      await client.query('UPDATE categories SET position = $1 WHERE id = $2', [
        item.position,
        item.id,
      ]);
    }
    await client.query('COMMIT');

    const updated = await pool.query(
      'SELECT id, name, position, created_at FROM categories ORDER BY position, name',
    );
    broadcast('categories:reordered', updated.rows);
    res.json(updated.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[categories/reorder]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/categories/:id — rename or reposition a category (moderator or admin)
router.patch('/:id', authenticate, requirePermission('MANAGE_CATEGORIES'), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid category id' });
    return;
  }

  const { name, position } = req.body as { name?: string; position?: number };

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

  if (name !== undefined)     { fields.push(`name = $${fields.length + 1}`);     values.push(name); }
  if (position !== undefined) { fields.push(`position = $${fields.length + 1}`); values.push(position); }

  if (fields.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE categories SET ${fields.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, name, position, created_at`,
      values,
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    broadcast('category:updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[categories/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/categories/:id — delete a category (admin only)
// Channels in the category become uncategorized (category_id → NULL).
router.delete('/:id', authenticate, requirePermission('MANAGE_CATEGORIES'), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid category id' });
    return;
  }

  try {
    const result = await pool.query(
      'DELETE FROM categories WHERE id = $1 RETURNING id',
      [id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    broadcast('category:deleted', { id });
    res.status(204).send();
  } catch (err) {
    console.error('[categories/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
