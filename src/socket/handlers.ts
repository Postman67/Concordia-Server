import { Server, Socket } from 'socket.io';
import { pool } from '../config/database';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  username: string;
}

interface MessageSendPayload {
  channelId: number;
  content: string;
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

      socket.join(roomName(id));
      socket.emit('channel:joined', {
        channelId: id,
        name: result.rows[0].name,
      });
      socket.to(roomName(id)).emit('user:joined', {
        channelId: id,
        user: { id: user.id, username: user.username },
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
      user: { id: user.id, username: user.username },
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
        user: { id: user.id, username: user.username },
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
}
