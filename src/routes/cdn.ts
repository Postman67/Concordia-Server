import { Router } from 'express';
import { statfsSync, promises as fsp } from 'fs';
import path from 'path';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/roles';
import { MEDIA_PATH, CDN_SUBDIRS, compressImageFile } from '../config/media';
import { getSettings } from '../config/server';
import { pool } from '../config/database';

const router = Router();

// All CDN management endpoints require authentication and MANAGE_SERVER permission.

// ── GET /api/cdn/health ───────────────────────────────────────────────────────
// Returns disk usage for the host volume and per-subfolder file counts.
router.get('/health', authenticate, requirePermission('MANAGE_SERVER'), async (_req, res) => {
  try {
    // Disk-level stats (bytes)
    let diskTotal = 0, diskUsed = 0, diskAvailable = 0;
    try {
      const st = statfsSync(MEDIA_PATH);
      diskTotal     = st.blocks  * st.bsize;
      diskUsed      = (st.blocks - st.bfree)  * st.bsize;
      diskAvailable = st.bavail  * st.bsize;
    } catch {
      // statfsSync may fail on some environments (e.g. network mounts on Windows dev boxes)
    }

    // Walk all CDN subdirs to count files and sum bytes
    let mediaUsedBytes = 0;
    const fileCounts: Record<string, number> = {};

    for (const subdir of CDN_SUBDIRS) {
      const dir = path.join(MEDIA_PATH, subdir);
      fileCounts[subdir] = 0;
      let entries: string[] = [];
      try { entries = await fsp.readdir(dir); } catch { continue; }

      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        try {
          const stat = await fsp.stat(path.join(dir, entry));
          if (stat.isFile()) {
            mediaUsedBytes += stat.size;
            fileCounts[subdir]++;
          }
        } catch { /* skip unreadable entries */ }
      }
    }

    res.json({
      media_path: MEDIA_PATH,
      disk_total_bytes:   diskTotal,
      disk_used_bytes:    diskUsed,
      disk_available_bytes: diskAvailable,
      disk_usage_percent: diskTotal > 0
        ? Math.round((diskUsed / diskTotal) * 1000) / 10
        : null,
      media_used_bytes: mediaUsedBytes,
      file_counts: fileCounts,
    });
  } catch (err) {
    console.error('[cdn/health]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/cdn/metrics ──────────────────────────────────────────────────────
// Returns ingress/egress totals, per-subfolder breakdowns, and a 30-day daily history.
router.get('/metrics', authenticate, requirePermission('MANAGE_SERVER'), async (_req, res) => {
  try {
    const [eventTotals, subdirBreakdown, dailyHistory] = await Promise.all([
      pool.query<{ event_type: string; count: string; total_bytes: string }>(
        `SELECT event_type,
                COUNT(*)              AS count,
                COALESCE(SUM(bytes), 0) AS total_bytes
         FROM media_metrics
         GROUP BY event_type`,
      ),
      pool.query<{ subfolder: string; event_type: string; count: string; total_bytes: string }>(
        `SELECT subfolder,
                event_type,
                COUNT(*)              AS count,
                COALESCE(SUM(bytes), 0) AS total_bytes
         FROM media_metrics
         GROUP BY subfolder, event_type
         ORDER BY subfolder, event_type`,
      ),
      pool.query<{ day: string; event_type: string; count: string; total_bytes: string }>(
        `SELECT DATE(created_at)       AS day,
                event_type,
                COUNT(*)              AS count,
                COALESCE(SUM(bytes), 0) AS total_bytes
         FROM media_metrics
         WHERE created_at > NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at), event_type
         ORDER BY day DESC, event_type`,
      ),
    ]);

    const totals: Record<string, { count: number; bytes: number }> = {};
    for (const row of eventTotals.rows) {
      totals[row.event_type] = {
        count: parseInt(row.count, 10),
        bytes: parseInt(row.total_bytes, 10),
      };
    }

    res.json({
      totals,
      by_subfolder: subdirBreakdown.rows.map((r) => ({
        subfolder:  r.subfolder,
        event_type: r.event_type,
        count:      parseInt(r.count, 10),
        bytes:      parseInt(r.total_bytes, 10),
      })),
      last_30_days: dailyHistory.rows.map((r) => ({
        day:        r.day,
        event_type: r.event_type,
        count:      parseInt(r.count, 10),
        bytes:      parseInt(r.total_bytes, 10),
      })),
    });
  } catch (err) {
    console.error('[cdn/metrics]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/cdn/optimize ────────────────────────────────────────────────────
// Re-compresses all image files currently stored in CDN subdirs using the
// current media_compression_level setting. GIFs and unsupported formats are
// skipped. Files are only replaced when the result is actually smaller.
router.post('/optimize', authenticate, requirePermission('MANAGE_SERVER'), async (_req, res) => {
  try {
    const settings = await getSettings();
    const level = settings.media_compression_level;

    if (level === 0) {
      res.json({
        message: 'Compression is disabled (media_compression_level = 0). Set a level > 0 to enable.',
        processed: 0,
        skipped: 0,
        errors: 0,
        bytes_before: 0,
        bytes_after: 0,
        bytes_saved: 0,
      });
      return;
    }

    const COMPRESSIBLE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    let processed = 0, skipped = 0, errors = 0;
    let bytesBeforeTotal = 0, bytesAfterTotal = 0;

    for (const subdir of CDN_SUBDIRS) {
      const dir = path.join(MEDIA_PATH, subdir);
      let entries: string[] = [];
      try { entries = await fsp.readdir(dir); } catch { continue; }

      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        if (!COMPRESSIBLE_EXTS.has(path.extname(entry).toLowerCase())) {
          skipped++;
          continue;
        }

        const filePath = path.join(dir, entry);
        try {
          const { originalBytes, finalBytes } = await compressImageFile(filePath, level);
          bytesBeforeTotal += originalBytes;
          bytesAfterTotal  += finalBytes;
          processed++;
        } catch (err) {
          console.error(`[cdn/optimize] failed on ${filePath}:`, err);
          errors++;
        }
      }
    }

    res.json({
      processed,
      skipped,
      errors,
      bytes_before: bytesBeforeTotal,
      bytes_after:  bytesAfterTotal,
      bytes_saved:  bytesBeforeTotal - bytesAfterTotal,
    });
  } catch (err) {
    console.error('[cdn/optimize]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
