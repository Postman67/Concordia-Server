# Concordia Server — API Changelog

All notable changes to the Concordia Server API are documented here.  
Most recent changes appear at the top.

---

## Saturday, March 7, 2026 — 19:30

### Fix: `@everyone` default permissions

The `@everyone` role was seeded with bitmask `7` by migration `006`, which was written against an older bit layout. With the current layout in `permissions.ts` the value `7` resolves to `ADMINISTRATOR | VIEW_CHANNELS | SEND_MESSAGES` — granting the dangerous `ADMINISTRATOR` bit and omitting `READ_MESSAGE_HISTORY`.

**Correct value is `14`** (`VIEW_CHANNELS=2 | SEND_MESSAGES=4 | READ_MESSAGE_HISTORY=8`).

- `006_permissions.sql` comment and seed value corrected to `14` (affects fresh deployments).
- `010_fix_everyone_permissions.sql` added — updates the live row from `7` → `14` only if it hasn't been intentionally customised (safe to re-run).

> **Note:** The `EVERYONE_DEFAULT_PERMISSIONS` constant in `permissions.ts` was already correct (`14`) throughout.

---

## Saturday, March 7, 2026 — 19:00

### Message Edit & Delete

**New field on all message objects:**
- `is_edited: boolean` — `true` if the message content was ever changed after sending. No edit count or timestamp is stored.

**New REST endpoints:**

| Endpoint | Who can call it | Notes |
|----------|----------------|-------|
| `PATCH /api/messages/:id` | Author only | Updates `content`, sets `is_edited = true`. No permission can override the author-only rule. |
| `DELETE /api/messages/:id` | Author, or `MANAGE_MESSAGES` + higher role | Callers with `MANAGE_MESSAGES` can only delete messages from users whose *highest role position* is strictly below their own. |

**New socket events (Client → Server):**
- `message:edit { messageId, content }` — same author-only restriction as the REST endpoint.
- `message:delete { messageId }` — same hierarchy rules as the REST endpoint.

**New broadcast events (Server → channel room):**
- `message:edited { id, channelId, content, is_edited: true }`
- `message:deleted { id, channelId }`

**New permission helper:** `getTopRolePosition(userId)` in `permissions.ts` — returns the user's highest non-`@everyone` role `position`, or `Infinity` for the server owner. Used for the hierarchy check on message deletion.

**Migration:** `009_message_edits.sql` — `ALTER TABLE messages ADD COLUMN is_edited BOOLEAN NOT NULL DEFAULT FALSE`.

---

## Saturday, March 7, 2026 — 18:00

### Server Owner Identity

Introduced the concept of the **server owner** (`is_owner`) as a distinct, explicitly communicated identity.

- `POST /api/server/join` — `is_admin` renamed to `is_owner`.
- `GET /api/server/@me` — `is_admin` renamed to `is_owner`.
- `GET /api/server/members` — each member object now includes `is_owner: boolean`, so clients can render owner badges without a separate request.
- `GET /api/roles/@me/permissions` — response now includes `is_owner: boolean`. When `true`, `bits` equals `ALL_PERMISSIONS` and every `resolved` entry is `true`.

The owner is determined by `admin_user_id` in `server_settings` **or** the `ADMIN_USER_ID` env var (permanent override). The owner always receives every permission via `resolvePermissions()` regardless of role assignments.

> **Breaking change:** `is_admin` field removed from `/join` and `/@me` responses. Clients must use `is_owner`.

---

## Saturday, March 7, 2026 — 17:00

### CDN Management — Health, Metrics & Compression

**New setting: `media_compression_level`**
- `PATCH /api/server/settings` now accepts `media_compression_level` (integer 0–100).
- `0` = disabled (originals stored unchanged). `1–100` = optimization intensity; mapped to a sharp quality of `100 − level × 0.5` (floor 50). Applies at upload time.
- Supported formats: JPEG (MozJPEG), PNG, WebP. GIFs are always stored as-is.
- Files are only replaced if the compressed output is actually smaller than the original.

**New endpoints under `/api/cdn` (require `MANAGE_SERVER`):**

| Endpoint | Description |
|----------|-------------|
| `GET /api/cdn/health` | Disk total / used / available in bytes, `disk_usage_percent`, `media_used_bytes`, per-subfolder file counts. |
| `GET /api/cdn/metrics` | Ingress (upload) and egress (download) totals and per-subfolder breakdown, plus a 30-day daily history. |
| `POST /api/cdn/optimize` | Bulk re-compresses all eligible images under `MEDIA_PATH` at the current `media_compression_level`. Returns `processed`, `skipped`, `errors`, and `bytes_saved`. No-op if level is `0`. |

**Automatic metrics tracking:**
- Every upload records an `upload` event with the final file size.
- Every delete records a `delete` event.
- Every file served from `/cdn` records a `download` event with `content-length` bytes (egress).

**Migration:** `008_media_metrics.sql` — creates `media_metrics` table; seeds `media_compression_level = 0` in `server_settings`.

---

## Saturday, March 7, 2026 — 16:00

### CDN Static File Serving & Server Icon Upload

**New `/cdn` static endpoint:**
- Files under `MEDIA_PATH` are served at `/cdn/<subfolder>/<filename>`.
- Active sub-paths: `icon`, `emoji`, `stickers`, `images`, `videos`, `gifs` (only `icon` is functional; others are reserved).
- All CDN responses include `Cross-Origin-Resource-Policy: cross-origin` so browser clients on different origins can load assets.
- Configurable storage root via `MEDIA_PATH` env var (default `./media`).

**New upload endpoints under `/api/upload` (require `MANAGE_SERVER`):**

| Endpoint | Description |
|----------|-------------|
| `POST /api/upload/icon` | Upload or replace the server icon. Multipart field: `icon`. Allowed types: PNG, JPEG, GIF, WebP. Max 8 MB. Icon is stored as `server.<ext>`; old file with a different extension is cleaned up automatically. |
| `DELETE /api/upload/icon` | Remove the server icon. |

**`GET /api/server/info` response updated:**
- Now includes `icon_url` (`"/cdn/icon/server.png"` or `null`).

**`server:updated` socket event updated:**
- Payload now also carries `icon_url` when the icon changes.

**Migration:** `007_server_icon.sql` — seeds `icon` key in `server_settings`.

---
