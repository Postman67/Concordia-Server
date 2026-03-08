import { Router } from 'express';
import express from 'express';
import path from 'path';
import { MEDIA_PATH, CDN_SUBDIRS, recordMetric } from '../config/media';

const router = Router();

const staticOptions: Parameters<typeof express.static>[1] = {
  index: false,       // never serve a directory listing
  dotfiles: 'deny',  // block .hidden files
  fallthrough: false, // 404 immediately for missing files instead of passing to next middleware
};

// Each sub-directory is an independent static origin.
// Cross-Origin-Resource-Policy is set to 'cross-origin' so browsers on
// other origins (e.g. the Concordia client app) can load images/videos.
for (const subdir of CDN_SUBDIRS) {
  router.use(
    `/${subdir}`,
    (req, res, next) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // Track egress: hook into response finish to record bytes served
      res.on('finish', () => {
        if (res.statusCode === 200) {
          const bytes = parseInt((res.getHeader('content-length') as string) || '0', 10);
          const filename = path.basename(req.path) || '';
          recordMetric('download', subdir, filename, bytes).catch(() => undefined);
        }
      });
      next();
    },
    express.static(path.join(MEDIA_PATH, subdir), staticOptions),
    // Express doesn't call the next error handler for 'fallthrough: false' 404s —
    // the static middleware sends its own 404 response, which is fine.
  );
}

// Any /cdn path that didn't match a known subdirectory
router.use((_req, res) => {
  res.status(404).json({ error: 'CDN path not found' });
});

export default router;
