import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { registerChatHandlers } from './handlers';

export function initializeSocket(io: Server): void {
  // Authenticate every Socket.IO connection with a Bearer JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const payload = jwt.verify(
        token,
        process.env.JWT_SECRET as string,
      ) as { id: number; username: string };

      socket.data.user = { id: payload.id, username: payload.username };
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { username } = socket.data.user as { id: number; username: string };
    console.log(`[socket] connected: ${username} (${socket.id})`);

    registerChatHandlers(io, socket);

    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${username} (${socket.id})`);
    });
  });
}
