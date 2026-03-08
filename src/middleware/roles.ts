import { Response, NextFunction } from 'express';
import { isAdmin } from '../config/server';
import { resolvePermissions, hasPermission, Permissions, PermissionKey } from '../config/permissions';
import { AuthRequest } from './auth';

/**
 * Returns true if the user is the server admin (owner).
 * Use this only for the narrow "owner-only" operations like changing admin_user_id.
 */
export async function getMemberIsAdmin(userId: string): Promise<boolean> {
  return isAdmin(userId);
}

/**
 * Express middleware factory. Checks that the authenticated user has the
 * given permission bit (resolved with all roles + overrides).
 *
 * @param permission - key from the Permissions map e.g. 'MANAGE_CHANNELS'
 * @param channelId  - if provided, channel + category overrides are applied
 */
export function requirePermission(
  permission: PermissionKey,
  getChannelId?: (req: AuthRequest) => number | undefined,
) {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const channelId = getChannelId ? getChannelId(req) : undefined;
      const perms = await resolvePermissions(req.user!.id, channelId);
      if (hasPermission(perms, Permissions[permission])) {
        next();
        return;
      }
      res.status(403).json({ error: 'Insufficient permissions' });
    } catch (err) {
      console.error('[permissions]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/**
 * Convenience wrapper — requires the ADMINISTRATOR shortcut
 * (server admin / owner only). Used for destructive or owner-level operations.
 */
export function requireAdmin() {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (await isAdmin(req.user!.id)) {
        next();
        return;
      }
      // Also allow if the user's resolved perms include ADMINISTRATOR bit
      const perms = await resolvePermissions(req.user!.id);
      if (hasPermission(perms, Permissions.ADMINISTRATOR)) {
        next();
        return;
      }
      res.status(403).json({ error: 'Insufficient permissions' });
    } catch (err) {
      console.error('[permissions]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// ── Legacy shim ───────────────────────────────────────────────────────────────
// Kept so existing route files compile while being incrementally migrated.

/** @deprecated Use requirePermission() instead. */
export function requireRole(minRole: 'moderator' | 'admin') {
  if (minRole === 'admin') return requireAdmin();

  // 'moderator' maps to MANAGE_MESSAGES as a reasonable proxy
  return requirePermission('MANAGE_MESSAGES');
}

/** @deprecated Use resolvePermissions() instead. */
export async function getMemberRole(userId: string): Promise<'member' | 'moderator' | 'admin'> {
  if (await isAdmin(userId)) return 'admin';
  const perms = await resolvePermissions(userId);
  if (hasPermission(perms, Permissions.MANAGE_MESSAGES)) return 'moderator';
  return 'member';
}
