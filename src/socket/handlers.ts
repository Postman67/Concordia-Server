import { Server, Socket } from 'socket.io';
import { pool } from '../config/database';
import { resolvePermissions, hasPermission, Permissions, getTopRolePosition } from '../config/permissions';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  username: string;
  avatar_url: string | null;
}

interface MessageSendPayload {
  channelId: number;
  content: string;
}

interface MessageEditPayload {
  messageId: number;
  content: string;
}

interface MessageDeletePayload {
  messageId: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function roomName(channelId: number): string {
  return `channel:${channelId}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Event handlers
// ──────────────────────────────────────────────────────────────────────────────

export function registerChatHandlers(io: Server, socket: Socket): void {
  const user = socket.data.user as User;

  // ── channel:join ────────────────────────────────────────────────────────────
  // Client sends: { channelId: number }
  // Server emits back to sender:    channel:joined  { channelId, name }
  // Server emits to others in room: user:joined     { channelId, user }
  socket.on('channel:join', async (channelId: unknown) => {
    const id = Number(channelId);
    if (!Number.isInteger(id)) {
      socket.emit('error', { message: 'channelId must be an integer' });
      return;
    }

    try {
      const result = await pool.query(
        'SELECT id, name FROM channels WHERE id = $1',
        [id],
      );
      if (result.rows.length === 0) {
        socket.emit('error', { message: 'Channel not found' });
        return;
      }

      // Permission check: VIEW_CHANNELS
      const perms = await resolvePermissions(user.id, id);
      if (!hasPermission(perms, Permissions.VIEW_CHANNELS)) {
        socket.emit('error', { message: 'You do not have access to this channel' });
        return;
      }

      socket.join(roomName(id));
      socket.emit('channel:joined', {
        channelId: id,
        name: result.rows[0].name,
      });
      socket.to(roomName(id)).emit('user:joined', {
        channelId: id,
        user: { id: user.id, username: user.username, avatar_url: user.avatar_url },
      });
    } catch (err) {
      console.error('[socket] channel:join', err);
      socket.emit('error', { message: 'Failed to join channel' });
    }
  });

  // ── channel:leave ───────────────────────────────────────────────────────────
  // Client sends: channelId (number)
  socket.on('channel:leave', (channelId: unknown) => {
    const id = Number(channelId);
    if (!Number.isInteger(id)) return;

    socket.leave(roomName(id));
    socket.to(roomName(id)).emit('user:left', {
      channelId: id,
      user: { id: user.id, username: user.username, avatar_url: user.avatar_url },
    });
  });

  // ── message:send ────────────────────────────────────────────────────────────
  // Client sends: { channelId: number, content: string }
  // Server broadcasts to everyone in channel: message:new  { id, channelId, content, createdAt, user }
  socket.on('message:send', async (payload: unknown) => {
    const { channelId, content } = (payload ?? {}) as Partial<MessageSendPayload>;

    if (typeof channelId !== 'number' || typeof content !== 'string') {
      socket.emit('error', { message: 'Invalid payload' });
      return;
    }

    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > 2000) {
      socket.emit('error', { message: 'Message must be 1–2000 characters' });
      return;
    }

    if (!socket.rooms.has(roomName(channelId))) {
      socket.emit('error', {
        message: 'You must join the channel before sending messages',
      });
      return;
    }

    try {
      const channelCheck = await pool.query(
        'SELECT id FROM channels WHERE id = $1',
        [channelId],
      );
      if (channelCheck.rows.length === 0) {
        socket.emit('error', { message: 'Channel not found' });
        return;
      }

      // Permission check: SEND_MESSAGES
      const perms = await resolvePermissions(user.id, channelId);
      if (!hasPermission(perms, Permissions.SEND_MESSAGES)) {
        socket.emit('error', { message: 'You do not have permission to send messages in this channel' });
        return;
      }

      const result = await pool.query(
        `INSERT INTO messages (channel_id, user_id, content)
         VALUES ($1, $2, $3)
         RETURNING id, created_at`,
        [channelId, user.id, trimmed],
      );

      io.to(roomName(channelId)).emit('message:new', {
        id: result.rows[0].id,
        channelId,
        content: trimmed,
        createdAt: result.rows[0].created_at,
        user: { id: user.id, username: user.username, avatar_url: user.avatar_url },
      });
    } catch (err) {
      console.error('[socket] message:send', err);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // ── typing indicators ───────────────────────────────────────────────────────
  // Client sends: channelId (number)
  // Server broadcasts to others:  typing:update  { channelId, user, isTyping }
  socket.on('typing:start', (channelId: unknown) => {
    const id = Number(channelId);
    if (!Number.isInteger(id)) return;
    socket.to(roomName(id)).emit('typing:update', {
      channelId: id,
      user: { id: user.id, username: user.username },
      isTyping: true,
    });
  });

  socket.on('typing:stop', (channelId: unknown) => {
    const id = Number(channelId);
    if (!Number.isInteger(id)) return;
    socket.to(roomName(id)).emit('typing:update', {
      channelId: id,
      user: { id: user.id, username: user.username },
      isTyping: false,
    });
  });

  // ── message:edit ────────────────────────────────────────────────────────────
  // Client sends: { messageId: number, content: string }
  // Only the original author may edit. No exceptions.
  // Server broadcasts to channel: message:edited { id, channelId, content, is_edited: true }
  socket.on('message:edit', async (payload: unknown) => {
    const { messageId, content } = (payload ?? {}) as Partial<MessageEditPayload>;

    if (typeof messageId !== 'number' || typeof content !== 'string') {
      socket.emit('error', { message: 'Invalid payload' });
      return;
    }

    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > 2000) {
      socket.emit('error', { message: 'Message must be 1\u20132000 characters' });
      return;
    }

    try {
      const msgResult = await pool.query<{ user_id: string; channel_id: number }>(
        'SELECT user_id, channel_id FROM messages WHERE id = $1',
        [messageId],
      );
      if (msgResult.rows.length === 0) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      const msg = msgResult.rows[0];
      if (msg.user_id !== user.id) {
        socket.emit('error', { message: 'Only the author can edit their message' });
        return;
      }

      await pool.query(
        'UPDATE messages SET content = $1, is_edited = TRUE WHERE id = $2',
        [trimmed, messageId],
      );

      io.to(roomName(msg.channel_id)).emit('message:edited', {
        id: messageId,
        channelId: msg.channel_id,
        content: trimmed,
        is_edited: true,
      });
    } catch (err) {
      console.error('[socket] message:edit', err);
      socket.emit('error', { message: 'Failed to edit message' });
    }
  });

  // ── message:delete ──────────────────────────────────────────────────────────
  // Client sends: { messageId: number }
  // Authors can always delete their own messages.
  // Users with MANAGE_MESSAGES can delete others', but only if the target
  // author's highest role position is strictly below the requester's.
  // Server broadcasts to channel: message:deleted { id, channelId }
  socket.on('message:delete', async (payload: unknown) => {
    const { messageId } = (payload ?? {}) as Partial<MessageDeletePayload>;

    if (typeof messageId !== 'number') {
      socket.emit('error', { message: 'Invalid payload' });
      return;
    }

    try {
      const msgResult = await pool.query<{ user_id: string; channel_id: number }>(
        'SELECT user_id, channel_id FROM messages WHERE id = $1',
        [messageId],
      );
      if (msgResult.rows.length === 0) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      const msg = msgResult.rows[0];

      if (msg.user_id !== user.id) {
        // Not the author \u2014 check MANAGE_MESSAGES and role hierarchy
        const perms = await resolvePermissions(user.id, msg.channel_id);
        if (!hasPermission(perms, Permissions.MANAGE_MESSAGES)) {
          socket.emit('error', { message: 'You do not have permission to delete this message' });
          return;
        }

        const [requesterTop, authorTop] = await Promise.all([
          getTopRolePosition(user.id),
          getTopRolePosition(msg.user_id),
        ]);

        if (requesterTop <= authorTop) {
          socket.emit('error', { message: 'You cannot delete messages from members with an equal or higher role' });
          return;
        }
      }

      await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);

      io.to(roomName(msg.channel_id)).emit('message:deleted', {
        id: messageId,
        channelId: msg.channel_id,
      });
    } catch (err) {
      console.error('[socket] message:delete', err);
      socket.emit('error', { message: 'Failed to delete message' });
    }
  });
}
