import { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  user?: { id: string; username: string; avatar_url: string | null };
}

// ── Federation token verification ─────────────────────────────────────────────
// The server does NOT hold any JWT secret. It verifies every token by calling
// the Federation's /api/user/me endpoint and caches the result for CACHE_TTL_MS
// to avoid a round-trip on every single request.

const FEDERATION_URL =
  process.env.FEDERATION_URL || 'https://federation.concordiachat.com';

const CACHE_TTL_MS = 60_000; // 1 minute

interface CacheEntry {
  user: { id: string; username: string; avatar_url: string | null };
  expiresAt: number;
}

const tokenCache = new Map<string, CacheEntry>();

export async function verifyFederationToken(
  token: string,
): Promise<{ id: string; username: string; avatar_url: string | null } | null> {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  try {
    const res = await fetch(`${FEDERATION_URL}/api/user/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      tokenCache.delete(token);
      return null;
    }

    const data = (await res.json()) as { user: { id: string; username: string; avatar_url?: string | null } };
    const user = {
      id: data.user.id,
      username: data.user.username,
      avatar_url: data.user.avatar_url ?? null,
    };
    tokenCache.set(token, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    return user;
  } catch {
    return null;
  }
}

// ── HTTP middleware ────────────────────────────────────────────────────────────

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7);
  const user = await verifyFederationToken(token);

  if (!user) {
    res.status(401).json({ error: 'Invalid or expired federation token' });
    return;
  }

  req.user = user;
  next();
}
