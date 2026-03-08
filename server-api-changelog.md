# Concordia Server — API Changelog

All notable changes to the Concordia Server API are documented here.  
Most recent changes appear at the top.

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
