import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { resolvePermissions, hasPermission, Permissions, getTopRolePosition } from '../config/permissions';
import { broadcast } from '../socket/broadcast';

const router = Router();

// GET /api/messages/:channelId
router.get('/:channelId', authenticate, async (req: AuthRequest, res) => {
  const channelId = parseInt(req.params.channelId, 10);
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
  const before = req.query.before as string | undefined;

  if (isNaN(channelId)) {
    res.status(400).json({ error: 'Invalid channel id' });
    return;
  }

  try {
    const channelCheck = await pool.query(
      'SELECT id FROM channels WHERE id = $1',
      [channelId],
    );
    if (channelCheck.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Permission check: user must be able to view this channel and read history
    const perms = await resolvePermissions(req.user!.id, channelId);
    if (!hasPermission(perms, Permissions.VIEW_CHANNELS)) {
      res.status(403).json({ error: 'You do not have access to this channel' });
      return;
    }
    if (!hasPermission(perms, Permissions.READ_MESSAGE_HISTORY)) {
      res.status(403).json({ error: 'You cannot read message history in this channel' });
      return;
    }

    let rows;
    if (before) {
      const result = await pool.query(
        `SELECT m.id, m.content, m.is_edited, m.created_at,
                m.user_id, COALESCE(mem.username, m.user_id::text) AS username,
                mem.avatar_url
         FROM messages m
         LEFT JOIN members mem ON mem.user_id = m.user_id
         WHERE m.channel_id = $1 AND m.created_at < $2
         ORDER BY m.created_at DESC
         LIMIT $3`,
        [channelId, before, limit],
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT m.id, m.content, m.is_edited, m.created_at,
                m.user_id, COALESCE(mem.username, m.user_id::text) AS username,
                mem.avatar_url
         FROM messages m
         LEFT JOIN members mem ON mem.user_id = m.user_id
         WHERE m.channel_id = $1
         ORDER BY m.created_at DESC
         LIMIT $2`,
        [channelId, limit],
      );
      rows = result.rows;
    }

    // Return in ascending (chronological) order so the client can
    // append them top-to-bottom without reversing.
    res.json(rows.reverse());
  } catch (err) {
    console.error('[messages/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/messages/:id — edit a message
// Only the original author can edit. No exceptions.
router.patch('/:id', authenticate, async (req: AuthRequest, res) => {
  const messageId = parseInt(req.params.id, 10);
  if (isNaN(messageId)) {
    res.status(400).json({ error: 'Invalid message id' });
    return;
  }

  const { content } = req.body as { content?: unknown };
  if (typeof content !== 'string' || content.trim().length === 0 || content.trim().length > 2000) {
    res.status(400).json({ error: 'content must be a non-empty string up to 2000 characters' });
    return;
  }

  try {
    const msgResult = await pool.query<{ user_id: string; channel_id: number }>(
      'SELECT user_id, channel_id FROM messages WHERE id = $1',
      [messageId],
    );
    if (msgResult.rows.length === 0) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const msg = msgResult.rows[0];
    if (msg.user_id !== req.user!.id) {
      res.status(403).json({ error: 'Only the author can edit their message' });
      return;
    }

    const trimmed = content.trim();
    const updated = await pool.query<{ id: number; content: string; is_edited: boolean; created_at: string }>(
      `UPDATE messages SET content = $1, is_edited = TRUE
       WHERE id = $2
       RETURNING id, content, is_edited, created_at`,
      [trimmed, messageId],
    );

    broadcast('message:edited', {
      id: messageId,
      channelId: msg.channel_id,
      content: trimmed,
      is_edited: true,
    });

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('[messages/edit]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/messages/:id — delete a message
// Authors can always delete their own messages.
// Users with MANAGE_MESSAGES can delete others' messages, but only if the
// target author's highest role position is strictly below the deleter's.
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  const messageId = parseInt(req.params.id, 10);
  if (isNaN(messageId)) {
    res.status(400).json({ error: 'Invalid message id' });
    return;
  }

  try {
    const msgResult = await pool.query<{ user_id: string; channel_id: number }>(
      'SELECT user_id, channel_id FROM messages WHERE id = $1',
      [messageId],
    );
    if (msgResult.rows.length === 0) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const msg = msgResult.rows[0];
    const requesterId = req.user!.id;

    if (msg.user_id !== requesterId) {
      // Not the author — must have MANAGE_MESSAGES and outrank the author
      const perms = await resolvePermissions(requesterId, msg.channel_id);
      if (!hasPermission(perms, Permissions.MANAGE_MESSAGES)) {
        res.status(403).json({ error: 'You do not have permission to delete this message' });
        return;
      }

      const [requesterTop, authorTop] = await Promise.all([
        getTopRolePosition(requesterId),
        getTopRolePosition(msg.user_id),
      ]);

      if (requesterTop <= authorTop) {
        res.status(403).json({ error: 'You cannot delete messages from members with an equal or higher role' });
        return;
      }
    }

    await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);

    broadcast('message:deleted', { id: messageId, channelId: msg.channel_id });

    res.status(204).send();
  } catch (err) {
    console.error('[messages/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
