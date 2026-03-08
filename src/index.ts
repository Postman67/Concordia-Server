import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { pool } from './config/database';
import { runMigrations } from './db/migrate';
import { getSettings, updateSettings } from './config/server';
import { initializeSocket } from './socket';
import { setIO } from './socket/broadcast';
import serverRoutes from './routes/server';
import categoryRoutes from './routes/categories';
import channelRoutes from './routes/channels';
import messageRoutes from './routes/messages';
import roleRoutes from './routes/roles';

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
app.use('/api/server', serverRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/roles', roleRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
setIO(io);
initializeSocket(io);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start(): Promise<void> {
  try {
    await pool.query('SELECT 1'); // verify DB is reachable
    console.log('[db] connected');
  } catch (err) {
    console.error('[db] failed to connect:', err);
    process.exit(1);
  }

  try {
    await runMigrations(pool);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  // Bootstrap: if ADMIN_USER_ID env var is set and no admin is configured in
  // the DB yet, seed the DB once so the admin can then manage settings from the client.
  const envAdminId = process.env.ADMIN_USER_ID || '';
  if (envAdminId !== '') {
    const current = await getSettings();
    if (current.admin_user_id === '') {
      await updateSettings({ admin_user_id: envAdminId });
      console.log(`[server] admin_user_id bootstrapped from ADMIN_USER_ID env var: ${envAdminId}`);
    }
  }

  const config = await getSettings();
  httpServer.listen(PORT, HOST, () => {
    console.log(`[server] "${config.name}" listening on ${HOST}:${PORT}`);
    console.log(`[server] federation: ${process.env.FEDERATION_URL || 'https://federation.concordiachat.com'}`);
    if (!config.admin_user_id && !envAdminId) {
      console.warn('[server] WARNING: No admin configured. Set ADMIN_USER_ID env var on first deploy, or PATCH /api/server/settings once you have access.');
    }
  });
}

start();
