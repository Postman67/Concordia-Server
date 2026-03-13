# Concordia Server

Real-time chat server built with **Node.js**, **Socket.IO**, **Express**, and **PostgreSQL**.  
Architecture is intentionally simple so the client team can build on top of it quickly.

## Quick start (Docker — recommended)

```bash
# 1. Copy the env template and fill in the required values
cp .env.example .env
#    → set DB_PASSWORD and JWT_SECRET at minimum

# 2. Start everything (Postgres + server)
docker compose up --build

# 3. The server is now available at http://localhost:3000
```

The first time Postgres starts it will automatically run `migrations/001_initial.sql`,
which creates the schema and seeds a **#general** channel.

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
| `DB_PASSWORD` | **yes** | — | Database password |
| `JWT_SECRET` | **yes** | — | Secret for signing JWTs |
| `CLIENT_ORIGIN` | no | `*` | CORS allowed origin |

## Related repositories

| Repo | Description |
|---|---|
| [Concordia](https://github.com/Postman67/Concordia) | Marketing frontend |
| [Concordia-Federation](https://github.com/Postman67/Concordia-Federation) | Global identity — usernames, auth, server registry |
| [Concordia-Client](https://github.com/Postman67/Concordia-Client) | User-facing chat application |
| [Concordia-Server](https://github.com/Postman67/Concordia-Server) | Self-hostable server software |
| [Concordia-Social](https://github.com/Postman67/Concordia-Social) | Friends and direct messaging service |
