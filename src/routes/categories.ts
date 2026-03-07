import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

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
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
  const { name, position } = req.body as { name?: string; position?: number };

  if (!name || typeof name !== 'string' || name.length < 1 || name.length > 64) {
    res.status(400).json({ error: 'name must be 1–64 characters' });
    return;
  }

  const pos = typeof position === 'number' ? position : 0;

  try {
    const result = await pool.query(
      'INSERT INTO categories (name, position) VALUES ($1, $2) RETURNING id, name, position, created_at',
      [name, pos],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[categories/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/categories/:id — rename or reposition a category (moderator or admin)
router.patch('/:id', authenticate, requireRole('moderator'), async (req: AuthRequest, res) => {
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
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[categories/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/categories/:id — delete a category (admin only)
// Channels in the category become uncategorized (category_id → NULL).
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
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
    res.status(204).send();
  } catch (err) {
    console.error('[categories/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
