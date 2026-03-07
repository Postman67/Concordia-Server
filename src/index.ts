import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { pool } from './config/database';
import { initializeSocket } from './socket';
import authRoutes from './routes/auth';
import channelRoutes from './routes/channels';
import messageRoutes from './routes/messages';

const app = express();
const httpServer = createServer(app);

const clientOrigin = process.env.CLIENT_ORIGIN || '*';

const io = new Server(httpServer, {
  cors: { origin: clientOrigin, methods: ['GET', 'POST'] },
});

// ── HTTP middleware ────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: clientOrigin }));
app.use(express.json());

// Rate-limit all API routes (100 req / 15 min per IP)
app.use(
  '/api/',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }),
);

// ── REST routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/messages', messageRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
initializeSocket(io);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);

async function start(): Promise<void> {
  try {
    await pool.query('SELECT 1'); // verify DB is reachable
    console.log('[db] connected');
  } catch (err) {
    console.error('[db] failed to connect:', err);
    process.exit(1);
  }

  httpServer.listen(PORT, () => {
    console.log(`[server] Concordia listening on port ${PORT}`);
  });
}

start();
