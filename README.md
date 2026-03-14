# Concordia Server

Real-time chat server built with **Node.js**, **Socket.IO**, **Express**, and **PostgreSQL**.  
Architecture is intentionally simple so the client team can build on top of it quickly.

## Quick start (Docker — recommended)

Two deployment modes are available. Both persist data via named Docker volumes.

### Option A — Single container *(easiest)*

PostgreSQL and the Node server run together in one image. No `.env` required for a basic setup.

```bash
# Start (builds on first run)
docker compose -f docker-compose.single.yml up --build

# The server is now available at http://localhost:3000
```

> Set `ADMIN_USER_ID` in a `.env` file (or inline) to bootstrap an admin account on first start.

### Option B — Two containers *(recommended for production)*

PostgreSQL and the server run as separate services, making it easier to back up the database, scale, or upgrade each component independently.

```bash
# 1. Copy the env template and fill in the required values
cp .env.example .env
#    → set DB_PASSWORD and JWT_SECRET at minimum

# 2. Start everything (Postgres + server)
docker compose up --build

# 3. The server is now available at http://localhost:3000
```

The first time the server starts it will automatically run `migrations/001_schema.sql`,
which creates the schema and seeds a **#general** channel.

## Deploy to Railway

Railway runs the **Node server** as a standard Railpack service. PostgreSQL is a separate
Railway-managed database — no Docker or single-container image required.

### 1. Create the project

1. Push this repo to GitHub (or connect it in Railway directly)
2. In Railway click **"+ New"** → **"GitHub Repo"** → select `Concordia-Server`
3. Railway detects `railway.toml` and uses Railpack automatically

### 2. Add PostgreSQL

1. In your Railway project click **"+ New"** → **"Database"** → **"Add PostgreSQL"**
2. Railway creates a managed Postgres instance and injects `DATABASE_URL` into every
   service in the project automatically — no connection string to copy or configure
3. The server connects on startup and runs migrations automatically

### 3. Add a volume (persistent media)

Railway's default filesystem is ephemeral — files are lost on redeploy. To persist
uploaded server icons and media:

1. Open the **Concordia-Server** service → **Volumes** tab
2. Click **Add Volume**
3. Set **Mount path** to `/data/media`
4. In the **Variables** tab add `MEDIA_PATH=/data/media`

The volume is mounted at that path at runtime and survives deploys and restarts.
`MEDIA_PATH` tells the server where to read and write files.

### 4. Set environment variables

In the service **Variables** tab:

| Variable | Required | Value |
|---|---|---|
| `ADMIN_USER_ID` | **yes** | Your Federation user UUID (bootstraps server owner on first deploy) |
| `CLIENT_ORIGIN` | **yes** | Your frontend URL e.g. `https://app.concordiachat.com` |
| `MEDIA_PATH` | **yes** | `/data/media` |
| `FEDERATION_URL` | no | Only needed for self-hosted Federation — omit to use the public one |

> `DATABASE_URL` and `PORT` are injected by Railway automatically. Do not set them.

## Local development (no Docker)

```bash
# Prerequisites: Node 20+, a running Postgres 14+ instance

npm install
cp .env.example .env   # edit DB_* and JWT_SECRET

npm run dev            # ts-node-dev with live reload
```

## Project layout

```
src/
  index.ts               # HTTP server + Socket.IO bootstrap
  config/
    database.ts          # pg connection pool
  middleware/
    auth.ts              # JWT Bearer auth (Express + Socket.IO)
  routes/
    auth.ts              # POST /api/auth/register, /login
    channels.ts          # GET/POST/DELETE /api/channels
    messages.ts          # GET /api/messages/:channelId
  socket/
    index.ts             # Socket.IO initialisation & JWT middleware
    handlers.ts          # All real-time event handlers
migrations/
  001_initial.sql        # Schema + seed (auto-run by Docker)
```

## REST API

All authenticated endpoints require an `Authorization: Bearer <token>` header.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Create account → returns `{ token, user }` |
| POST | `/api/auth/login` | — | Login → returns `{ token, user }` |
| GET | `/api/channels` | ✓ | List all channels |
| POST | `/api/channels` | ✓ | Create a channel `{ name, description? }` |
| DELETE | `/api/channels/:id` | ✓ | Delete own channel |
| GET | `/api/messages/:channelId` | ✓ | Fetch history (query params: `limit`, `before`) |
| GET | `/health` | — | Server health check |

## Socket.IO events

Connect with `{ auth: { token: "<JWT>" } }`.

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `channel:join` | `channelId: number` | Join a channel room |
| `channel:leave` | `channelId: number` | Leave a channel room |
| `message:send` | `{ channelId, content }` | Send a message |
| `typing:start` | `channelId: number` | Broadcast typing started |
| `typing:stop` | `channelId: number` | Broadcast typing stopped |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `channel:joined` | `{ channelId, name }` | Confirms you joined |
| `user:joined` | `{ channelId, user }` | Another user joined |
| `user:left` | `{ channelId, user }` | Another user left |
| `message:new` | `{ id, channelId, content, createdAt, user }` | New message broadcast |
| `typing:update` | `{ channelId, user, isTyping }` | Typing state change |
| `error` | `{ message: string }` | Server-side validation error |

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | no | `3000` | HTTP port |
| `DB_HOST` | no | `localhost` | Postgres host |
| `DB_PORT` | no | `5432` | Postgres port |
| `DB_NAME` | no | `concordia` | Database name |
| `DB_USER` | no | `concordia` | Database user |
| `DB_PASSWORD` | yes *(Docker only)* | — | Database password |
| `DATABASE_URL` | yes *(Railway / managed Postgres)* | — | Full Postgres connection string — injected automatically by Railway |
| `DB_SSL` | no | auto | Set `false` to disable SSL when using `DATABASE_URL` |
| `CLIENT_ORIGIN` | no | `*` | CORS allowed origin |
| `MEDIA_PATH` | no | `./media` | Path for uploaded media files (set to `/data/media` on Railway) |

## Related repositories

| Repo | Description |
|---|---|
| [Concordia](https://github.com/Postman67/Concordia) | Marketing frontend |
| [Concordia-Federation](https://github.com/Postman67/Concordia-Federation) | Global identity — usernames, auth, server registry |
| [Concordia-Client](https://github.com/Postman67/Concordia-Client) | User-facing chat application |
| [Concordia-Server](https://github.com/Postman67/Concordia-Server) | Self-hostable server software |
| [Concordia-Social](https://github.com/Postman67/Concordia-Social) | Friends and direct messaging service |
