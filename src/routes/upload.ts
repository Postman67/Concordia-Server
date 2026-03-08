import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/roles';
import { MEDIA_PATH, compressImageFile, recordMetric } from '../config/media';
import { getSettings, updateSettings } from '../config/server';
import { broadcast } from '../socket/broadcast';

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const ICON_ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const ICON_ALLOWED_EXTS  = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const ICON_MAX_BYTES      = 8 * 1024 * 1024; // 8 MB

// ── Multer storage for server icons ──────────────────────────────────────────

const iconStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(MEDIA_PATH, 'icon'));
  },
  filename: (_req, file, cb) => {
    // Always written as server.<ext> so there is only ever one icon file
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `server${ext}`);
  },
});

const iconUpload = multer({
  storage: iconStorage,
  limits: { fileSize: ICON_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ICON_ALLOWED_MIMES.has(file.mimetype) && ICON_ALLOWED_EXTS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPG, GIF, and WebP images are allowed'));
    }
  },
});

// ── POST /api/upload/icon ─────────────────────────────────────────────────────
// Replaces the current server icon. Send the file as multipart/form-data
// in the field named "icon". Requires MANAGE_SERVER permission.
router.post(
  '/icon',
  authenticate,
  requirePermission('MANAGE_SERVER'),
  (req, res, next) => {
    iconUpload.single('icon')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        res.status(400).json({
          error: err.code === 'LIMIT_FILE_SIZE'
            ? `File too large. Maximum ${ICON_MAX_BYTES / 1024 / 1024} MB.`
            : err.message,
        });
        return;
      }
      if (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      next();
    });
  },
  async (req: AuthRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded. Send the image in a field named "icon".' });
      return;
    }

    const newFilename = req.file.filename; // e.g. "server.png"
    const uploadedPath = req.file.path;

    // Remove a stale icon with a different extension so only one icon file
    // ever lives in the directory.
    try {
      const settings = await getSettings();
      const prevFilename = settings.icon;
      if (prevFilename && prevFilename !== newFilename) {
        const prevPath = path.join(MEDIA_PATH, 'icon', prevFilename);
        if (fs.existsSync(prevPath)) fs.unlinkSync(prevPath);
      }
    } catch {
      // Non-fatal — proceed even if we can't clean up the old file
    }

    // Apply compression if enabled
    let finalBytes = req.file.size;
    try {
      const settings = await getSettings();
      const level = settings.media_compression_level;
      if (level > 0) {
        const result = await compressImageFile(uploadedPath, level);
        finalBytes = result.finalBytes;
      }
    } catch (err) {
      console.warn('[upload/icon] compression failed, keeping original:', err);
    }

    // Record ingress metric (fire-and-forget)
    recordMetric('upload', 'icon', newFilename, finalBytes).catch(console.error);

    await updateSettings({ icon: newFilename });

    const iconUrl = `/cdn/icon/${newFilename}`;
    broadcast('server:updated', { icon_url: iconUrl });
    res.json({ icon_url: iconUrl });
  },
);

// ── DELETE /api/upload/icon ───────────────────────────────────────────────────
// Removes the server icon. Requires MANAGE_SERVER permission.
router.delete(
  '/icon',
  authenticate,
  requirePermission('MANAGE_SERVER'),
  async (_req, res) => {
    const settings = await getSettings();
    if (!settings.icon) {
      res.status(404).json({ error: 'No server icon is currently set' });
      return;
    }

    const iconPath = path.join(MEDIA_PATH, 'icon', settings.icon);
    try {
      if (fs.existsSync(iconPath)) fs.unlinkSync(iconPath);
    } catch {
      // Non-fatal — file may already be gone
    }

    // Record delete metric (fire-and-forget)
    recordMetric('delete', 'icon', settings.icon, 0).catch(console.error);

    await updateSettings({ icon: '' });
    broadcast('server:updated', { icon_url: null });
    res.status(204).send();
  },
);

export default router;
