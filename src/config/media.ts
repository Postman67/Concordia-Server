import path from 'path';
import fs from 'fs';

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
