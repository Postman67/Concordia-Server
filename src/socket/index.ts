import { Server } from 'socket.io';
import { pool } from '../config/database';
import { verifyFederationToken } from '../middleware/auth';
import { registerChatHandlers } from './handlers';

export function initializeSocket(io: Server): void {
  // Verify every Socket.IO connection against the Federation.
  // Uses the same in-memory token cache as the HTTP middleware, so a user
  // who just called a REST endpoint will connect instantly without a round-trip.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const user = await verifyFederationToken(token);
    if (!user) {
      return next(new Error('Invalid or expired federation token'));
    }

    socket.data.user = user;

    // Refresh the member's cached username on every fresh connection
    try {
      await pool.query(
        `INSERT INTO members (user_id, username)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username`,
        [user.id, user.username],
      );
    } catch (err) {
      console.error('[socket] member upsert failed:', err);
    }

    next();
  });

  io.on('connection', (socket) => {
    const { username } = socket.data.user as { id: string; username: string };
    console.log(`[socket] connected: ${username} (${socket.id})`);

    registerChatHandlers(io, socket);

    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${username} (${socket.id})`);
    });
  });
}
