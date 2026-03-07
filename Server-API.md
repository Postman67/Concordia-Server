# Concordia Server — API Reference

> **Authentication is handled entirely by the [Federation](Federation-API.md).**  
> Clients log in via `https://federation.concordiachat.com` and pass the resulting JWT to this server.  
> This server stores **no passwords, no emails** — only Federation user IDs.

**Last updated on:** Saturday, March 7, 2026 at 05:21:20

Base URL (default): `http://localhost:3000`

All request and response bodies are JSON.

### Authentication

Every protected endpoint (`🔒`) requires a Federation JWT in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are obtained from the Federation (`POST /api/auth/login`). The server verifies them by forwarding to `GET /api/user/me` on the Federation and caches the result for 60 seconds.

---

## Health Check

### `GET /health`

Public. Returns server uptime status.

**`200 OK`**
```json
{ "status": "ok", "timestamp": "2026-03-07T05:21:20.000Z" }
```

---

## Server — `/api/server`

### `GET /api/server/info`

Public. Returns server metadata and current member count.

**`200 OK`**
```json
{
  "name": "My Concordia Server",
  "description": "A place to chat.",
  "member_count": 42
}
```

---

### `POST /api/server/join` 🔒

Joins the authenticated user to this server. Call this when a user adds the server to their Federation server list and opens it for the first time. Subsequent calls are **idempotent** — they only refresh the cached display name.

**`200 OK`**
```json
{
  "message": "Joined server successfully.",
  "server": { "name": "My Concordia Server", "description": "A place to chat." }
}
```

**`401`** Missing/invalid federation token · **`500`** Server error

---

### `GET /api/server/members` 🔒

Returns the list of users who have joined this server, including their role.

**`200 OK`**
```json
{
  "members": [
    { "user_id": 1, "username": "petersmith", "role": "admin",     "joined_at": "2026-03-07T10:00:00.000Z" },
    { "user_id": 2, "username": "alice",       "role": "moderator", "joined_at": "2026-03-07T10:05:00.000Z" },
    { "user_id": 3, "username": "bob",         "role": "member",    "joined_at": "2026-03-07T10:10:00.000Z" }
  ]
}
```

**`401`** Missing/invalid federation token · **`500`** Server error

---

### `PUT /api/server/members/:userId/role` 🔒 *(admin only)*

Assigns a role to a member. The server config owner (`admin_user_id`) cannot be demoted.

**Request body**

| Field | Type | Values |
|-------|------|--------|
| `role` | string | `"member"` · `"moderator"` · `"admin"` |

```json
{ "role": "moderator" }
```

**`200 OK`**
```json
{ "member": { "user_id": 2, "username": "alice", "role": "moderator" } }
```

**`400`** Invalid role · **`401`** Unauthorized · **`403`** Not admin / cannot demote server owner · **`404`** Member not found · **`500`** Server error

---

## Roles

Roles control what actions a user can perform on the server.

| Role | Permissions |
|------|-------------|
| `member` | Read channels, read/send messages, join server |
| `moderator` | All of the above + create channels, rename/reposition channels and categories |
| `admin` | All of the above + create/delete categories, delete channels, assign roles to members |

> The user whose `user_id` matches `admin_user_id` in `server.config.json` is **always** treated as admin, regardless of what is stored in the database.

---

## Categories — `/api/categories` 🔒

Categories group channels in the sidebar (e.g. “Text Channels”, “Voice Channels”). Channels within a category are ordered by their `position` field.

### `GET /api/categories`

Returns all categories ordered by position.

**`200 OK`**
```json
[
  { "id": 1, "name": "Text Channels", "position": 0, "created_at": "..." },
  { "id": 2, "name": "Staff Only",    "position": 1, "created_at": "..." }
]
```

---

### `POST /api/categories` 🔒 *(admin only)*

Creates a new category.

**Request body**

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | Required. 1–64 chars. |
| `position` | number | Optional integer. Default `0`. |

```json
{ "name": "Staff Only", "position": 1 }
```

**`201 Created`**
```json
{ "id": 2, "name": "Staff Only", "position": 1, "created_at": "..." }
```

**`400`** Validation failed · **`401`** Unauthorized · **`403`** Not admin · **`500`** Server error

---

### `PATCH /api/categories/:id` 🔒 *(moderator or admin)*

Renames or repositions a category. Only the fields you include are changed.

**Request body** — all fields optional

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | 1–64 chars. |
| `position` | number | Integer. |

```json
{ "position": 2 }
```

**`200 OK`** Returns updated category object.

**`400`** Validation failed · **`401`** Unauthorized · **`403`** Insufficient permissions · **`404`** Category not found · **`500`** Server error

---

### `DELETE /api/categories/:id` 🔒 *(admin only)*

Deletes a category. Channels inside it become uncategorized (`category_id` → `null`) — they are **not** deleted.

**`204 No Content`**

**`401`** Unauthorized · **`403`** Not admin · **`404`** Category not found · **`500`** Server error

---

## Channels — `/api/channels` 🔒

### `GET /api/channels`

Returns all channels with their category info, ordered by category position then channel position.

**`200 OK`**
```json
[
  {
    "id": 1,
    "name": "general",
    "description": "General discussion",
    "category_id": 1,
    "category_name": "Text Channels",
    "category_position": 0,
    "position": 0,
    "created_at": "..."
  },
  {
    "id": 2,
    "name": "announcements",
    "description": null,
    "category_id": 1,
    "category_name": "Text Channels",
    "category_position": 0,
    "position": 1,
    "created_at": "..."
  }
]
```

---

### `POST /api/channels` 🔒 *(moderator or admin)*

Creates a new channel.

**Request body**

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | Required. 1–64 chars. |
| `description` | string | Optional. |
| `category_id` | number | Optional. ID of an existing category. |
| `position` | number | Optional integer. Default `0`. |

```json
{ "name": "random", "description": "Off-topic chat", "category_id": 1, "position": 2 }
```

**`201 Created`**
```json
{ "id": 3, "name": "random", "description": "Off-topic chat", "category_id": 1, "position": 2, "created_at": "..." }
```

**`400`** Validation failed · **`401`** Unauthorized · **`403`** Insufficient permissions · **`409`** Name taken · **`500`** Server error

---

### `PATCH /api/channels/:id` 🔒 *(moderator or admin)*

Updates a channel's name, description, category, or position. Only the fields you include are changed. Use this to move a channel between categories or reorder it within one.

**Request body** — all fields optional

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | 1–64 chars. |
| `description` | string \| null | Pass `null` to clear. |
| `category_id` | number \| null | Pass `null` to uncategorize. |
| `position` | number | Integer. |

```json
{ "category_id": 2, "position": 0 }
```

**`200 OK`** Returns updated channel object.

**`400`** Validation failed · **`401`** Unauthorized · **`403`** Insufficient permissions · **`404`** Channel not found · **`409`** Name taken · **`500`** Server error

---

### `DELETE /api/channels/:id` 🔒 *(admin only)*

Deletes a channel and all its messages.

**`204 No Content`**

**`401`** Unauthorized · **`403`** Not admin · **`404`** Channel not found · **`500`** Server error

---

## Messages — `/api/messages` 🔒

### `GET /api/messages/:channelId`

Fetches message history for a channel. Returns messages in **chronological order** (oldest first).

**Query parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `50` | Max messages to return (capped at 200). |
| `before` | ISO timestamp | — | Return messages older than this timestamp (pagination). |

**`200 OK`**
```json
[
  {
    "id": 12,
    "content": "Hello world!",
    "created_at": "2026-03-07T11:00:00.000Z",
    "user_id": 1,
    "username": "petersmith"
  }
]
```

**Pagination — load older messages**

Take the `created_at` of the oldest message you currently have and pass it as `before`:

```
GET /api/messages/1?limit=50&before=2026-03-07T11%3A00%3A00.000Z
```

**`400`** Invalid channel ID · **`401`** Unauthorized · **`404`** Channel not found · **`500`** Server error

---

## Real-time — Socket.IO

The server runs Socket.IO on the same port as the HTTP server.

### Connection

Pass the Federation JWT in the `auth` handshake. The server verifies it against the Federation and automatically upserts the user into `members` with their latest display name.

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token },           // Federation JWT
  transports: ['websocket'],
});

socket.on('connect', () => console.log('connected:', socket.id));
socket.on('connect_error', (err) => console.error('auth failed:', err.message));
```

---

### `channel:join`

**Client → Server** `channelId: number`

Join a channel room to receive real-time messages.

| Direction | Event | Payload |
|-----------|-------|---------|
| Server → caller | `channel:joined` | `{ channelId, name }` |
| Server → others in room | `user:joined` | `{ channelId, user: { id, username } }` |

```ts
socket.emit('channel:join', 1);
socket.on('channel:joined', ({ channelId, name }) => console.log(`Joined #${name}`));
```

---

### `channel:leave`

**Client → Server** `channelId: number`

Leave a channel room.

| Direction | Event | Payload |
|-----------|-------|---------|
| Server → others in room | `user:left` | `{ channelId, user: { id, username } }` |

```ts
socket.emit('channel:leave', 1);
```

---

### `message:send`

**Client → Server** `{ channelId: number, content: string }`

Send a message. The client must have joined the channel first. Content is 1–2000 characters.

| Direction | Event | Payload |
|-----------|-------|---------|
| Server → everyone in room | `message:new` | `{ id, channelId, content, createdAt, user: { id, username } }` |

```ts
socket.emit('message:send', { channelId: 1, content: 'Hello!' });
socket.on('message:new', (msg) => console.log(msg));
```

---

### Typing indicators

**Client → Server** `channelId: number`

| Event to emit | Meaning |
|---------------|---------|
| `typing:start` | User started typing |
| `typing:stop` | User stopped typing |

| Direction | Event | Payload |
|-----------|-------|---------|
| Server → others in room | `typing:update` | `{ channelId, user: { id, username }, isTyping: boolean }` |

```ts
socket.emit('typing:start', 1);
// ... 2 seconds later, or when message sent:
socket.emit('typing:stop', 1);

socket.on('typing:update', ({ user, isTyping }) => {
  console.log(`${user.username} is ${isTyping ? 'typing...' : 'done'}`);
});
```

---

### `error`

**Server → Client** `{ message: string }`

Emitted by the server when a socket operation fails (channel not found, invalid payload, permission denied, etc.).

```ts
socket.on('error', ({ message }) => console.error('Server error:', message));
```

---

## Admin setup

Set your Federation user ID in `server.config.json` at the project root:

```json
{
  "name": "My Concordia Server",
  "description": "A place to chat.",
  "admin_user_id": 1
}
```

Alternatively, set the `ADMIN_USER_ID` environment variable.  
If `admin_user_id` is `0` (default), the server will warn on startup and all privileged actions will be locked.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP / Socket.IO port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `concordia` | Database name |
| `DB_USER` | `concordia` | Database user |
| `DB_PASSWORD` | — | **Required.** Database password |
| `FEDERATION_URL` | `https://federation.concordiachat.com` | Override for local Federation instances |
| `ADMIN_USER_ID` | `0` | Fallback if `server.config.json` is absent |
| `CLIENT_ORIGIN` | `*` | CORS allowed origin |

---

## Database

The Postgres schema is initialised automatically via `migrations/001_initial.sql` when the DB volume is first created.

**Upgrading an existing DB:**

| From schema | Migration to run |
|-------------|------------------|
| Original (`users` table) | `002_federation_auth.sql` |
| Post-federation (no categories/roles) | `003_categories_roles.sql` |

**Fresh start** (drops all data):
```bash
docker-compose down -v
docker-compose up -d
```
