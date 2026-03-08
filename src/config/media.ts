import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { pool } from './database';

/**
 * Root directory where all CDN media is stored.
 * Defaults to ./media relative to the process working directory.
 * Override with the MEDIA_PATH environment variable.
 */
export const MEDIA_PATH: string = process.env.MEDIA_PATH
  ? path.resolve(process.env.MEDIA_PATH)
  : path.join(process.cwd(), 'media');

/** All CDN sub-directories that are served under /cdn. */
export const CDN_SUBDIRS = ['icon', 'emoji', 'stickers', 'images', 'videos', 'gifs'] as const;
export type CdnSubdir = (typeof CDN_SUBDIRS)[number];

/**
 * Creates all CDN sub-directories if they do not already exist.
 * Called once at server startup before any upload can be attempted.
 */
export function ensureMediaDirs(): void {
  for (const subdir of CDN_SUBDIRS) {
    fs.mkdirSync(path.join(MEDIA_PATH, subdir), { recursive: true });
  }
}

// ── Compression ───────────────────────────────────────────────────────────────

/**
 * Maps a 0-100 optimization level to a sharp quality value (50-99).
 * Level 0 is a no-op — callers should check before calling.
 * Higher level = more compression = lower quality.
 *   level  1 → quality 99  (barely perceptible)
 *   level 50 → quality 75  (good balance)
 *   level 100→ quality 50  (aggressive, still usable for icons)
 */
function levelToQuality(level: number): number {
  return Math.round(100 - level * 0.5);
}

/**
 * Compresses an image file in-place using sharp.
 * - JPEG / WebP: re-encoded at the calculated quality.
 * - PNG: re-encoded with sharp's quality option (maps to internal compression).
 * - GIF / unknown: skipped (returned unchanged).
 * The file is only replaced when the compressed version is actually smaller.
 *
 * @returns originalBytes and finalBytes for metrics / reporting.
 */
export async function compressImageFile(
  filePath: string,
  compressionLevel: number,
): Promise<{ originalBytes: number; finalBytes: number }> {
  const stat = await fs.promises.stat(filePath);
  const originalBytes = stat.size;

  const ext = path.extname(filePath).toLowerCase().slice(1); // 'jpg', 'png', …

  // GIF and unrecognised formats are left as-is (sharp GIF output requires
  // libvips giflib support that may not be present in all builds).
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return { originalBytes, finalBytes: originalBytes };
  }

  const quality = levelToQuality(compressionLevel);
  const tmpPath = `${filePath}.tmp`;

  try {
    let pipeline = sharp(filePath);
    if (ext === 'jpg' || ext === 'jpeg') {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    } else if (ext === 'png') {
      pipeline = pipeline.png({ quality });
    } else if (ext === 'webp') {
      pipeline = pipeline.webp({ quality });
    }
    await pipeline.toFile(tmpPath);

    const tmpStat = await fs.promises.stat(tmpPath);
    const finalBytes = tmpStat.size;

    if (finalBytes < originalBytes) {
      await fs.promises.rename(tmpPath, filePath);
      return { originalBytes, finalBytes };
    } else {
      // Compressed version is not smaller — keep the original
      await fs.promises.unlink(tmpPath);
      return { originalBytes, finalBytes: originalBytes };
    }
  } catch (err) {
    // Clean up temp file on error then rethrow
    await fs.promises.unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

// ── Metrics ───────────────────────────────────────────────────────────────────

/** Records a CDN event (upload / download / delete) asynchronously. Fire-and-forget safe. */
export async function recordMetric(
  eventType: 'upload' | 'download' | 'delete',
  subfolder: string,
  filename: string,
  bytes: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO media_metrics (event_type, subfolder, filename, bytes)
     VALUES ($1, $2, $3, $4)`,
    [eventType, subfolder, filename, bytes],
  );
}
