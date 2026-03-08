# Concordia Server — API Reference

> **Authentication is handled entirely by the [Federation](Federation-API.md).**  
> Clients log in via `https://federation.concordiachat.com` and pass the resulting JWT to this server.  
> This server stores **no passwords, no emails** — only Federation user IDs.

**Last updated on:** Saturday, March 7, 2026 at 17:00:00

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
  "member_count": 42,
  "icon_url": "/cdn/icon/server.png"
}
```

> `icon_url` is `null` when no icon has been uploaded.

---

### `POST /api/server/join` 🔒

Joins the authenticated user to this server. Call this when a user adds the server to their Federation server list and opens it for the first time. Subsequent calls are **idempotent** — they only refresh the cached display name.

**`200 OK`**
```json
{
  "message": "Joined server successfully.",
  "is_admin": false,
  "server": { "name": "My Concordia Server", "description": "A place to chat." }
}
```

> `is_admin` is `true` only if the joining user matches the `admin_user_id` configured in server settings.

**`401`** Missing/invalid federation token · **`500`** Server error

---

### `GET /api/server/@me` 🔒

Returns the authenticated user's member record, admin flag, and assigned roles. Call this on client startup (after the initial join) or whenever permissions may have changed.

**`200 OK`**
```json
{
  "user_id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f",
  "username": "petersmith",
  "avatar_url": "https://example.com/avatar.png",
  "joined_at": "2026-03-07T10:00:00.000Z",
  "is_admin": false,
  "roles": [
    { "id": 2, "name": "Moderators", "color": "#3498db", "position": 1, "permissions": "48", "is_everyone": false }
  ]
}
```

**`401`** Missing/invalid federation token · **`404`** Not a member of this server · **`500`** Server error

---

### `GET /api/server/members` 🔒

Returns the list of users who have joined this server, including their assigned custom roles.

**`200 OK`**
```json
{
  "members": [
    {
      "user_id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f",
      "username": "petersmith",
      "avatar_url": "https://example.com/avatar.png",
      "joined_at": "2026-03-07T10:00:00.000Z",
      "roles": [
        { "id": 2, "name": "Moderators", "color": "#3498db", "position": 1, "permissions": "48", "is_everyone": false }
      ]
    },
    {
      "user_id": "b1c2d3e4-1234-5678-9abc-def012345678",
      "username": "alice",
      "avatar_url": null,
      "joined_at": "2026-03-07T10:05:00.000Z",
      "roles": []
    }
  ]
}
```

**`401`** Missing/invalid federation token · **`500`** Server error

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

## Roles — `/api/roles` 🔒

Concordia uses a Discord-style granular permissions system. There are no predefined tiers — only custom roles and the special `@everyone` role.

### Permission flags

| Key | Bit | Description |
|-----|-----|-------------|
| `ADMINISTRATOR` | 1 | Grants all permissions. Only the server admin (owner) has this — **cannot** be assigned to a custom role. |
| `VIEW_CHANNELS` | 2 | See channels in the sidebar and join them. |
| `SEND_MESSAGES` | 4 | Post messages in text channels. |
| `READ_MESSAGE_HISTORY` | 8 | Read past messages in a channel. |
| `MANAGE_MESSAGES` | 16 | Edit or delete any user's message. |
| `MANAGE_CHANNELS` | 32 | Create, edit, delete channels and their permission overrides. |
| `MANAGE_CATEGORIES` | 64 | Create, edit, delete categories and their permission overrides. |
| `MANAGE_ROLES` | 128 | Create, edit, delete and assign custom roles. |
| `KICK_MEMBERS` | 256 | Remove members from the server. |
| `BAN_MEMBERS` | 512 | Ban and unban members. |
| `MANAGE_SERVER` | 1024 | Edit server name, description, and settings. |

Permissions are stored as a bitmask `BIGINT`. Use bitwise OR to combine flags.

```ts
// @everyone with VIEW_CHANNELS + SEND_MESSAGES + READ_MESSAGE_HISTORY
const everyone = 2 | 4 | 8; // = 14
```

**Permission resolution order** (highest priority last):
1. Server admin (`admin_user_id`) → full access regardless of roles
2. Union of all role permission bits (OR)
3. Category overrides (deny bits stripped, then allow bits added)
4. Channel overrides (deny bits stripped, then allow bits added)

**Override states per role per channel/category**: 3-state — *allow* (bit in `allow_bits`), *deny* (bit in `deny_bits`), or *inherit* (bit absent from both).

---

### `GET /api/roles`

Returns all roles ordered by position (descending — highest authority first).

**`200 OK`**
```json
[
  { "id": 1, "name": "@everyone", "color": null, "position": 0, "permissions": "14", "is_everyone": true, "created_at": "..." },
  { "id": 2, "name": "Moderators", "color": "#3498db", "position": 1, "permissions": "48", "is_everyone": false, "created_at": "..." }
]
```

---

### `POST /api/roles` 🔒 *(requires `MANAGE_ROLES`)*

Creates a custom role.

**Request body**

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | Required. 1–64 chars. |
| `color` | string \| null | Optional. Hex colour `#RRGGBB`. |
| `position` | number | Optional integer. Defaults to highest + 1. |
| `permissions` | number \| object | Optional. Bitmask integer **or** a map of `{ PERMISSION_KEY: true/false }`. Defaults to `0`. `ADMINISTRATOR` is silently stripped. |

```json
{ "name": "Moderators", "color": "#3498db", "permissions": { "MANAGE_MESSAGES": true, "MANAGE_CHANNELS": true } }
```

**`201 Created`** Returns the new role object.

**`400`** Validation failed · **`401`** Unauthorized · **`403`** Missing `MANAGE_ROLES` permission · **`500`** Server error

---

### `PATCH /api/roles/:id` 🔒 *(requires `MANAGE_ROLES`)*

Updates a role's name, colour, position, or permissions. Only sent fields are changed.

**`200 OK`** Returns the updated role.

**`400`** Validation failed · **`401`** Unauthorized · **`403`** Insufficient permissions · **`404`** Role not found · **`500`** Server error

---

### `DELETE /api/roles/:id` 🔒 *(requires `MANAGE_ROLES`)*

Deletes a custom role. The `@everyone` role cannot be deleted.

**`204 No Content`**

**`401`** Unauthorized · **`403`** Cannot delete @everyone / insufficient permissions · **`404`** Role not found · **`500`** Server error

---

### `GET /api/roles/permissions`

Returns all available permission keys and their bit values (as strings). Useful for building a permissions UI.

**`200 OK`**
```json
[
  { "key": "ADMINISTRATOR", "bit": "1" },
  { "key": "VIEW_CHANNELS", "bit": "2" },
  ...
]
```

---

### `GET /api/roles/members/:userId` 🔒

Returns all roles currently assigned to the given member.

**`200 OK`** Array of role objects.

---

### `PUT /api/roles/members/:userId` 🔒 *(requires `MANAGE_ROLES`)*

Replaces the full set of custom roles assigned to a member (atomic swap).

**Request body**
```json
{ "role_ids": [2, 3] }
```

Pass `{ "role_ids": [] }` to remove all custom roles.

**`200 OK`**
```json
{ "user_id": "...", "roles": [ { ...roleObject } ] }
```

**`400`** Validation failed · **`403`** Cannot assign an ADMINISTRATOR role · **`404`** Member not found · **`500`** Server error

---

### `GET /api/roles/@me/permissions` 🔒

Resolves and returns the calling user's effective permission bitmask. Optionally scoped to a channel.

**Query parameters**

| Param | Type | Description |
|-------|------|-------------|
| `channelId` | number | Optional. If provided, channel and category overrides are applied. |

**`200 OK`**
```json
{
  "bits": "14",
  "resolved": {
    "ADMINISTRATOR": false,
    "VIEW_CHANNELS": true,
    "SEND_MESSAGES": true,
    "READ_MESSAGE_HISTORY": true,
    "MANAGE_MESSAGES": false,
    "MANAGE_CHANNELS": false,
    "MANAGE_CATEGORIES": false,
    "MANAGE_ROLES": false,
    "KICK_MEMBERS": false,
    "BAN_MEMBERS": false,
    "MANAGE_SERVER": false
  }
}
```

---

### `GET /api/roles/overrides/channel/:channelId` 🔒

Returns all per-role permission overrides for a channel.

**`200 OK`**
```json
[
  { "role_id": 1, "role_name": "@everyone", "is_everyone": true, "allow_bits": "0", "deny_bits": "4" }
]
```

---

### `PUT /api/roles/overrides/channel/:channelId/:roleId` 🔒 *(requires `MANAGE_CHANNELS`)*

Sets the allow/deny override for a specific role on a channel. A bit **cannot** appear in both `allow_bits` and `deny_bits` simultaneously.

**Request body**
```json
{ "allow_bits": 2, "deny_bits": 4 }
```

**`200 OK`** Returns the updated override.

**`400`** Bit conflict / invalid values · **`401`** Unauthorized · **`403`** Insufficient permissions · **`500`** Server error

---

### `DELETE /api/roles/overrides/channel/:channelId/:roleId` 🔒 *(requires `MANAGE_CHANNELS`)*

Removes the override for a role on a channel (reverts to inherit).

**`204 No Content`**

---

### `GET /api/roles/overrides/category/:categoryId` 🔒

Returns all per-role permission overrides for a category.

---

### `PUT /api/roles/overrides/category/:categoryId/:roleId` 🔒 *(requires `MANAGE_CATEGORIES`)*

Sets the allow/deny override for a specific role on a category.

**Request body** — same shape as channel override.

**`200 OK`** Returns the updated override.

---

### `DELETE /api/roles/overrides/category/:categoryId/:roleId` 🔒 *(requires `MANAGE_CATEGORIES`)*

Removes the override for a role on a category.

---


## Categories â€” `/api/categories` ðŸ”’

Categories group channels in the sidebar (e.g. "Text Channels", "Voice Channels"). They act as top-level folders â€” no sub-categories are allowed. Channels within a category are ordered by their `position` field.

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

### `POST /api/categories` ðŸ”’ *(admin only)*

Creates a new category. Position is auto-assigned to the end of the list unless explicitly provided.

**Request body**

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | Required. 1â€“64 chars. |
| `position` | number | Optional integer. Defaults to end of list. |

```json
{ "name": "Staff Only" }
```

**`201 Created`**
```json
{ "id": 2, "name": "Staff Only", "position": 1, "created_at": "..." }
```

**`400`** Validation failed Â· **`401`** Unauthorized Â· **`403`** Not admin Â· **`500`** Server error

---

### `PATCH /api/categories/:id` ðŸ”’ *(moderator or admin)*

Renames a category. Only the fields you include are changed. For reordering, prefer `PUT /api/categories/reorder`.

**Request body** â€” all fields optional

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | 1â€“64 chars. |
| `position` | number | Integer. (Single move; prefer `/reorder` for drag-and-drop.) |

```json
{ "name": "Voice Channels" }
```

**`200 OK`** Returns updated category object.

**`400`** Validation failed Â· **`401`** Unauthorized Â· **`403`** Insufficient permissions Â· **`404`** Category not found Â· **`500`** Server error

---

### `PUT /api/categories/reorder` ðŸ”’ *(admin only)*

Atomically repositions all categories in a single transaction. Send the full desired order after a drag-and-drop; all positions are updated together so the client never sees a partial state.

**Request body** â€” array of `{ id, position }`

```json
[
  { "id": 2, "position": 0 },
  { "id": 1, "position": 1 }
]
```

**`200 OK`** Returns the full updated category list ordered by the new positions.

**`400`** Validation failed Â· **`401`** Unauthorized Â· **`403`** Not admin Â· **`500`** Server error

---

### `DELETE /api/categories/:id` ðŸ”’ *(admin only)*

Deletes a category. Channels inside it become uncategorized (`category_id` â†’ `null`) â€” they are **not** deleted.

**`204 No Content`**

**`401`** Unauthorized Â· **`403`** Not admin Â· **`404`** Category not found Â· **`500`** Server error

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
  }
]
```

---

### `POST /api/channels` 🔒 *(admin only)*

Creates a new channel. Position is auto-assigned to the end of `category_id`'s channel list unless explicitly provided.

**Request body**

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | Required. 1–64 chars. |
| `description` | string | Optional. |
| `category_id` | number | Optional. ID of an existing category. |
| `position` | number | Optional integer. Defaults to end of category. |

```json
{ "name": "random", "description": "Off-topic chat", "category_id": 1 }
```

**`201 Created`**
```json
{ "id": 3, "name": "random", "description": "Off-topic chat", "category_id": 1, "position": 2, "created_at": "..." }
```

**`400`** Validation failed · **`401`** Unauthorized · **`403`** Insufficient permissions · **`409`** Name taken · **`500`** Server error

---

### `PATCH /api/channels/:id` 🔒 *(moderator or admin)*

Updates a channel's name or description. Only the fields you include are changed. For moving a channel between categories or reordering, prefer `PUT /api/channels/reorder`.

**Request body** — all fields optional

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | 1–64 chars. |
| `description` | string \| null | Pass `null` to clear. |
| `category_id` | number \| null | Pass `null` to uncategorize. (Single move; prefer `/reorder` for drag-and-drop.) |
| `position` | number | Integer. (Single move; prefer `/reorder` for drag-and-drop.) |

```json
{ "name": "general-chat" }
```

**`200 OK`** Returns updated channel object.

**`400`** Validation failed · **`401`** Unauthorized · **`403`** Insufficient permissions · **`404`** Channel not found · **`409`** Name taken · **`500`** Server error

---

### `PUT /api/channels/reorder` 🔒 *(admin only)*

Atomically repositions channels and/or moves them between categories in a single transaction. Send the full desired layout after a drag-and-drop.

**Request body** — array of `{ id, category_id, position }`

| Field | Type | Rules |
|-------|------|-------|
| `id` | number | Channel ID. |
| `category_id` | number \| null | Target category. `null` = uncategorized. |
| `position` | number | Integer position within the target category. |

```json
[
  { "id": 1, "category_id": 1, "position": 0 },
  { "id": 3, "category_id": 1, "position": 1 },
  { "id": 2, "category_id": 2, "position": 0 }
]
```

**`200 OK`** Returns the full updated channel list (same shape as `GET /api/channels`).

**`400`** Validation failed · **`401`** Unauthorized · **`403`** Not admin · **`500`** Server error

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
    "username": "petersmith",
    "avatar_url": "https://example.com/avatar.png"
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
| Server → others in room | `user:joined` | `{ channelId, user: { id, username, avatar_url } }` |

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
| Server → others in room | `user:left` | `{ channelId, user: { id, username, avatar_url } }` |

```ts
socket.emit('channel:leave', 1);
```

---

### `message:send`

**Client → Server** `{ channelId: number, content: string }`

Send a message. The client must have joined the channel first. Content is 1–2000 characters.

| Direction | Event | Payload |
|-----------|-------|---------|
| Server → everyone in room | `message:new` | `{ id, channelId, content, createdAt, user: { id, username, avatar_url } }` |

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

### Server-push update events

These events are broadcast to **all connected clients** whenever an admin or moderator changes server configuration. Clients should update their local state immediately on receipt — no reconnect or re-fetch needed.

#### Server info

| Event | Payload | Trigger |
|-------|---------|----|
| `server:updated` | `{ name?, description?, icon_url? }` | `PATCH /api/server/settings` (name or description changed); `POST`/`DELETE /api/upload/icon` (icon changed) |

#### Categories

| Event | Payload | Trigger |
|-------|---------|----|
| `category:created` | `{ id, name, position, created_at }` | `POST /api/categories` |
| `category:updated` | `{ id, name, position, created_at }` | `PATCH /api/categories/:id` |
| `category:deleted` | `{ id }` | `DELETE /api/categories/:id` |
| `categories:reordered` | full categories array | `PUT /api/categories/reorder` |

#### Channels

| Event | Payload | Trigger |
|-------|---------|----|
| `channel:created` | `{ id, name, description, category_id, position, created_at, category_name, category_position }` | `POST /api/channels` |
| `channel:updated` | same as above | `PATCH /api/channels/:id` |
| `channel:deleted` | `{ id }` | `DELETE /api/channels/:id` |
| `channels:reordered` | full channels array | `PUT /api/channels/reorder` |

#### Members

| Event | Payload | Trigger |
|-------|---------|----|
| `member:roles_updated` | `{ user_id, roles }` | `PUT /api/roles/members/:userId` |
#### Roles

| Event | Payload | Trigger |
|-------|---------|----||
| `role:created` | role object | `POST /api/roles` |
| `role:updated` | role object | `PATCH /api/roles/:id` |
| `role:deleted` | `{ id }` | `DELETE /api/roles/:id` |

#### Permission overrides

| Event | Payload | Trigger |
|-------|---------|----||
| `channel:overrides_updated` | `{ channel_id, role_id, allow_bits, deny_bits }` or `{ ..., deleted: true }` | `PUT`/`DELETE /api/roles/overrides/channel/:channelId/:roleId` |
| `category:overrides_updated` | `{ category_id, role_id, allow_bits, deny_bits }` or `{ ..., deleted: true }` | `PUT`/`DELETE /api/roles/overrides/category/:categoryId/:roleId` |
```ts
// Subscribe once on connect
socket.on('server:updated',       (info)     => store.setServerInfo(info));
socket.on('category:created',     (cat)      => store.addCategory(cat));
socket.on('category:updated',     (cat)      => store.updateCategory(cat));
socket.on('category:deleted',     ({ id })   => store.removeCategory(id));
socket.on('categories:reordered', (cats)     => store.setCategories(cats));
socket.on('channel:created',      (ch)       => store.addChannel(ch));
socket.on('channel:updated',      (ch)       => store.updateChannel(ch));
socket.on('channel:deleted',      ({ id })   => store.removeChannel(id));
socket.on('channels:reordered',   (channels) => store.setChannels(channels));
socket.on('member:roles_updated',      (payload) => store.updateMemberRoles(payload));
socket.on('role:created',              (role)    => store.addRole(role));
socket.on('role:updated',              (role)    => store.updateRole(role));
socket.on('role:deleted',              ({ id })  => store.removeRole(id));
socket.on('channel:overrides_updated', (ov)      => store.updateChannelOverride(ov));
socket.on('category:overrides_updated',(ov)      => store.updateCategoryOverride(ov));
```

---

### `error`

**Server → Client** `{ message: string }`

Emitted by the server when a socket operation fails (channel not found, invalid payload, permission denied, etc.).

```ts
socket.on('error', ({ message }) => console.error('Server error:', message));
```

---

## CDN — `/cdn`

The server doubles as a mini CDN for served media files. All content under `/cdn` is served as public static files with `Cross-Origin-Resource-Policy: cross-origin` so clients on different origins can load them directly.

| Sub-path | Purpose |
|----------|---------|
| `/cdn/icon/*` | Server icon (managed via the upload API) |
| `/cdn/emoji/*` | Custom emoji (reserved — not yet implemented) |
| `/cdn/stickers/*` | Sticker packs (reserved — not yet implemented) |
| `/cdn/images/*` | Image attachments (reserved — not yet implemented) |
| `/cdn/videos/*` | Video attachments (reserved — not yet implemented) |
| `/cdn/gifs/*` | GIF attachments (reserved — not yet implemented) |

Files are stored in the directory pointed to by the `MEDIA_PATH` environment variable (default `./media`). Each sub-path maps directly to a subfolder: `<MEDIA_PATH>/icon/`, `<MEDIA_PATH>/emoji/`, etc.

> **Icon URL format** — `icon_url` returned by `/api/server/info` is a root-relative path (e.g. `/cdn/icon/server.png`). Prepend the server origin on the client side.

---

## Upload — `/api/upload`

Endpoints for managing uploaded server media. All require authentication and the `MANAGE_SERVER` permission.

### `POST /api/upload/icon` 🔒

Uploads (or replaces) the server icon. Send as `multipart/form-data` with the file in the `icon` field.

**Allowed types:** `image/png`, `image/jpeg`, `image/gif`, `image/webp`  
**Max size:** 8 MB  
**Required permission:** `MANAGE_SERVER`

The file is always stored as `server.<ext>` (e.g. `server.png`). If a previous icon with a different extension exists it is deleted automatically.

**`200 OK`**
```json
{ "icon_url": "/cdn/icon/server.png" }
```

**Error responses**

| Status | Meaning |
|--------|---------|
| `400` | No file provided, wrong MIME type, or file exceeds 8 MB |
| `403` | Missing `MANAGE_SERVER` permission |

---

### `DELETE /api/upload/icon` 🔒

Removes the current server icon and clears the setting.

**Required permission:** `MANAGE_SERVER`

**`204 No Content`** on success.

| Status | Meaning |
|--------|---------|
| `404` | No icon is currently set |
| `403` | Missing `MANAGE_SERVER` permission |

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
| `MEDIA_PATH` | `./media` | Absolute or relative path where uploaded media files (icons, etc.) are stored. Resolved relative to the process working directory when not absolute. |

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
| `005_avatar_url.sql` | Adds `avatar_url` to members |
| `006_permissions.sql` | Roles, member_roles, channel/category permission overrides |
| `007_server_icon.sql` | Adds `icon` key to server_settings |
