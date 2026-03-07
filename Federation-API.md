# Concordia Federation — API Reference

> Last updated: March 7, 2026 2:48 PM PST

> The Federation is the sole authentication and settings authority for all Concordia clients.
> Individual servers never receive personal user data — only the user's `id`.

Base URL: `https://federation.concordiachat.com` (local: `http://localhost:3000`)

All request and response bodies are JSON.

### Authentication

All protected endpoints require a JWT in the `Authorization` header:
```
Authorization: Bearer <token>
```
Tokens are issued by `/api/auth/register` and `/api/auth/login`. They expire after the duration set in `JWT_EXPIRES_IN` (default `7d`).

---

## Health Check

### `GET /health`

**Response `200`**
```json
{ "status": "ok" }
```

---

## Auth — `/api/auth`

### `POST /api/auth/register`

Creates a new Federation account. Returns a JWT.

**Request body**

| Field | Type | Rules |
|-------|------|-------|
| `username` | string | 3–50 chars. Letters, numbers, `_`, `-` only. |
| `email` | string | Valid email address. |
| `password` | string | Min 8 chars, one uppercase letter, one number. |

```json
{ "username": "petersmith", "email": "peter@example.com", "password": "Secret123" }
```

**`201 Created`**
```json
{
  "message": "Account created successfully.",
  "token": "<jwt>",
  "user": { "id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f", "username": "petersmith", "email": "peter@example.com", "created_at": "..." }
}
```

**`400`** Validation failed · **`409`** Username or email already taken · **`500`** Server error

---

### `POST /api/auth/login`

Authenticates an existing user. Returns a JWT.

**Request body**

| Field | Type |
|-------|------|
| `email` | string |
| `password` | string |

**`200 OK`**
```json
{
  "message": "Login successful.",
  "token": "<jwt>",
  "user": { "id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f", "username": "petersmith", "email": "peter@example.com" }
}
```

**`400`** Validation failed · **`401`** Invalid credentials · **`500`** Server error

> The same `401` message is returned for both unknown email and wrong password to prevent user enumeration.

---

## User — `/api/user` 🔒

### `GET /api/user/me`

Returns the authenticated user's profile joined with their current settings.

**`200 OK`**
```json
{
  "user": {
    "id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f",
    "username": "petersmith",
    "email": "peter@example.com",
    "created_at": "...",
    "display_name": "Peter",
    "avatar_url": "https://example.com/avatar.png",
    "theme": "dark"
  }
}
```

**`401`** Missing/invalid token · **`404`** User not found · **`500`** Server error

---

## Settings — `/api/settings` 🔒

Globally synced across every client the user is logged into.

### `GET /api/settings`

Returns the authenticated user's settings.

**`200 OK`**
```json
{
  "settings": {
    "display_name": "Peter",
    "avatar_url": "https://example.com/avatar.png",
    "theme": "dark",
    "updated_at": "..."
  }
}
```

---

### `PUT /api/settings`

Updates one or more settings fields. Only sent fields are changed (others are left as-is).

**Request body** — all fields optional

| Field | Type | Rules |
|-------|------|-------|
| `display_name` | string | Max 100 chars. |
| `avatar_url` | string | Must be a valid URL. |
| `theme` | string | `"dark"` or `"light"`. |

```json
{ "display_name": "Peter", "theme": "light" }
```

**`200 OK`** Returns updated settings object.

**`400`** Validation failed · **`401`** Missing/invalid token · **`500`** Server error

---

## Servers — `/api/servers` 🔒

The user's personal server list, stored in the Federation.
Clients use this to populate the left-hand sidebar. No personal user data is ever sent to servers.

### `GET /api/servers`

Returns the authenticated user's full server list, ordered by `position`.

**`200 OK`**
```json
{
  "servers": [
    { "id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f", "server_address": "192.168.1.10:8080", "server_name": "My Home Server", "position": 0, "added_at": "..." },
    { "id": "b7e2d14f-3c55-4a2b-8e01-1f4d7b9c2e1a", "server_address": "play.concordia.gg:8080", "server_name": null, "position": 1, "added_at": "..." }
  ]
}
```

---

### `POST /api/servers`

Adds a server to the user's list.

**Request body**

| Field | Type | Rules |
|-------|------|-------|
| `server_address` | string | Required. IP or domain:port. Max 255 chars. |
| `server_name` | string | Optional. The server's display name, fetched from the server by the client and pushed here. Max 100 chars. |

```json
{ "server_address": "192.168.1.10:8080", "server_name": "My Home Server" }
```

**`201 Created`**
```json
{
  "server": { "id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f", "server_address": "192.168.1.10:8080", "server_name": "My Home Server", "position": 0, "added_at": "..." }
}
```

**`400`** Validation failed · **`401`** Missing/invalid token · **`409`** Server already in list · **`500`** Server error

---

### `PATCH /api/servers/:id`

Updates the `nickname` or `position` of an entry. Only sent fields are changed.

**Request body** — all fields optional

| Field | Type | Rules |
|-------|------|-------|
| `server_name` | string | The server's display name pushed from the client. Max 100 chars. |
| `position` | integer | Non-negative integer. |

**`200 OK`** Returns updated server object.

**`400`** Validation failed · **`401`** Missing/invalid token · **`404`** Not found · **`500`** Server error

---

### `DELETE /api/servers/:id`

Removes a server from the user's list.

**`204 No Content`** — deleted successfully.

**`401`** Missing/invalid token · **`404`** Not found · **`500`** Server error

---

## Database Schema

```
users
├── id             UUID         PRIMARY KEY DEFAULT gen_random_uuid()
├── username       VARCHAR(50)  UNIQUE NOT NULL
├── email          VARCHAR(255) UNIQUE NOT NULL
├── password_hash  VARCHAR(255) NOT NULL          ← bcrypt hash, never plaintext
├── created_at     TIMESTAMPTZ  DEFAULT NOW()
└── updated_at     TIMESTAMPTZ  DEFAULT NOW()

user_settings                                     ← one row per user, globally synced
├── user_id        UUID PRIMARY KEY → users.id
├── display_name   VARCHAR(100)
├── avatar_url     VARCHAR(500)
├── theme          VARCHAR(20)  DEFAULT 'dark'
└── updated_at     TIMESTAMPTZ  DEFAULT NOW()

user_servers                                      ← server list, no user PII sent to servers
├── id             UUID         PRIMARY KEY DEFAULT gen_random_uuid()
├── user_id        UUID → users.id
├── server_address VARCHAR(255) NOT NULL
├── server_name    VARCHAR(100)        ← pushed by client from the server
├── position       INTEGER DEFAULT 0
└── added_at       TIMESTAMPTZ  DEFAULT NOW()
```

