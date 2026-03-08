-- Media metrics: tracks every upload, download, and delete event for CDN files.
-- Used for ingress/egress reporting and per-type file count summaries.
CREATE TABLE IF NOT EXISTS media_metrics (
  id          BIGSERIAL    PRIMARY KEY,
  event_type  TEXT         NOT NULL CHECK (event_type IN ('upload', 'download', 'delete')),
  subfolder   TEXT         NOT NULL,
  filename    TEXT         NOT NULL,
  bytes       BIGINT       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_metrics_event_created_idx
  ON media_metrics (event_type, created_at DESC);

-- Compression level: 0 = disabled (store originals), 1-100 = optimization level
-- Higher values apply more aggressive compression (lower final file quality).
INSERT INTO server_settings (key, value)
VALUES ('media_compression_level', '0')
ON CONFLICT (key) DO NOTHING;
