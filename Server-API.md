# Concordia Server — API Reference

> **Authentication is handled entirely by the [Federation](Federation-API.md).**  
> Clients log in via `https://federation.concordiachat.com` and pass the resulting JWT to this server.  
> This server stores **no passwords, no emails** — only Federation user IDs.

**Last updated on:** Saturday, March 7, 2026 at 15:09:19

> **User IDs are UUIDs** (e.g. `"a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f"`). The Federation issues these on registration.

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
    { "user_id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f", "username": "petersmith", "role": "admin",     "joined_at": "2026-03-07T10:00:00.000Z" },
    { "user_id": "b1c2d3e4-1234-5678-9abc-def012345678", "username": "alice",       "role": "moderator", "joined_at": "2026-03-07T10:05:00.000Z" },
    { "user_id": "c3d4e5f6-abcd-ef01-2345-678901234567", "username": "bob",         "role": "member",    "joined_at": "2026-03-07T10:10:00.000Z" }
  ]
}
```

**`401`** Missing/invalid federation token · **`500`** Server error

---

### `PUT /api/server/members/:userId/role` 🔒 *(admin only)*

Assigns a role to a member. The configured admin (`admin_user_id`) cannot be demoted.

**Request body**

| Field | Type | Values |
|-------|------|--------|
| `role` | string | `"member"` · `"moderator"` · `"admin"` |

```json
{ "role": "moderator" }
```

**`200 OK`**
```json
{ "member": { "user_id": "b1c2d3e4-1234-5678-9abc-def012345678", "username": "alice", "role": "moderator" } }
```

**`400`** Invalid role · **`401`** Unauthorized · **`403`** Not admin / cannot demote server owner · **`404`** Member not found · **`500`** Server error

---

### `GET /api/server/settings` 🔒 *(admin only)*

Returns all admin-configurable server settings.

**`200 OK`**
```json
{
  "name": "My Concordia Server",
  "description": "A place to chat.",
  "admin_user_id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f"
}
```

**`401`** Unauthorized · **`403`** Not admin · **`500`** Server error

---

### `PATCH /api/server/settings` 🔒 *(admin only)*

Updates one or more server settings. Only the fields you include are changed.

**Request body** — all fields optional

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | 1–100 chars. |
| `description` | string | 0–500 chars. |
| `admin_user_id` | string | Valid UUID (Federation user ID of the new admin), or `""` to unset. |

```json
{ "name": "Main Hub", "description": "A place to hang out." }
```

**`200 OK`** Returns the full updated settings object.

```json
{
  "name": "Main Hub",
  "description": "A place to hang out.",
  "admin_user_id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f"
}
```

**`400`** Validation failed · **`401`** Unauthorized · **`403`** Not admin · **`500`** Server error

> ⚠️ Changing `admin_user_id` transfers admin to another user. Pass `""` to unset. If you also remove the `ADMIN_USER_ID` env var when unsetting, you will be locked out of admin routes.

---

## Roles

Roles control what actions a user can perform on the server.

| Role | Permissions |
|------|-------------|
| `member` | Read channels, read/send messages, join server |
| `moderator` | All of the above + create channels, rename/reposition channels and categories |
| `admin` | All of the above + create/delete categories, delete channels, assign roles, change server settings |

> The user whose `user_id` matches `admin_user_id` in the `server_settings` table is **always** treated as admin, regardless of what is stored in the `members` table. If the `ADMIN_USER_ID` environment variable is set it overrides the database value (useful for emergency recovery).

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
    "user_id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f",
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

## First-time setup

All server settings are stored in the database and managed from the client. The workflow for a fresh deployment is:

1. **Find your Federation user ID** — log in to the Federation and call `GET /api/user/me`. Note the `id` field.
2. **Set `ADMIN_USER_ID` in your stack env** — add `ADMIN_USER_ID=<your-id>` to your `.env` or Portainer stack variables.
3. **Deploy** — the server seeds `admin_user_id` from the env var on first start (only if the database value is still `0`).
4. **Configure from the client** — open your client app, log in, and use `PATCH /api/server/settings` to set the server name, description, or transfer admin to another user.
5. **Optionally remove the env var** — once the database has your `admin_user_id`, the env var is no longer required. You can leave it set as a permanent emergency override.

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
| `ADMIN_USER_ID` | `` | Bootstrap admin on first deploy (seeds DB if `admin_user_id` is unset). Must be a valid Federation user UUID. Also acts as a permanent emergency override when set. |
| `CLIENT_ORIGIN` | `*` | CORS allowed origin |

Server name, description, and admin are stored in the `server_settings` database table and managed via `PATCH /api/server/settings`. The only **required** env var for a fresh deployment is `DB_PASSWORD`.

---

## Database

The schema and all migrations are applied automatically at startup by the built-in migration runner. No manual SQL execution is needed.

| Migration | Description |
|-----------|-------------|
| `001_initial.sql` | Core schema: members, categories, channels, messages |
| `002_federation_auth.sql` | Upgrade path from original `users`-table schema |
| `003_categories_roles.sql` | Adds `role` to members, `position`/`category_id` to channels |
| `004_server_settings.sql` | `server_settings` table for client-managed configuration |
