import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { isAdmin } from '../config/server';

const router = Router();

// GET /api/channels — list all channels (any authenticated user)
router.get('/', authenticate, async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, created_at FROM channels ORDER BY name',
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[channels/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/channels — create a channel (admin only)
router.post('/', authenticate, async (req: AuthRequest, res) => {
  if (!isAdmin(req.user!.id)) {
    res.status(403).json({ error: 'Only the server admin can create channels' });
    return;
  }

  const { name, description } = req.body as {
    name?: string;
    description?: string;
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
    const exists = await pool.query(
      'SELECT id FROM channels WHERE name = $1',
      [name],
    );
    if (exists.rows.length > 0) {
      res.status(409).json({ error: 'Channel name already taken' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO channels (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, created_at`,
      [name, description ?? null, req.user!.id],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[channels/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/channels/:id — delete a channel (admin only)
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!isAdmin(req.user!.id)) {
    res.status(403).json({ error: 'Only the server admin can delete channels' });
    return;
  }

  const id = parseInt(req.params.id, 10);

  try {
    const result = await pool.query(
      'SELECT id FROM channels WHERE id = $1',
      [id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    await pool.query('DELETE FROM channels WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('[channels/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
