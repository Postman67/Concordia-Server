import { Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { isAdmin } from '../config/server';
import { AuthRequest } from './auth';

export type Role = 'member' | 'moderator' | 'admin';

const ROLE_RANK: Record<Role, number> = { member: 0, moderator: 1, admin: 2 };

/**
 * Returns the effective role for a user.
 * The server config owner is always 'admin' regardless of the DB value.
 */
export async function getMemberRole(userId: number): Promise<Role> {
  if (await isAdmin(userId)) return 'admin';
  try {
    const result = await pool.query(
      'SELECT role FROM members WHERE user_id = $1',
      [userId],
    );
    return (result.rows[0]?.role as Role) ?? 'member';
  } catch {
    return 'member';
  }
}

/**
 * Express middleware factory. Ensures the authenticated user's role is
 * at least `minRole`. Must be placed after the `authenticate` middleware.
 */
export function requireRole(minRole: 'moderator' | 'admin') {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const role = await getMemberRole(req.user!.id);
      if (ROLE_RANK[role] >= ROLE_RANK[minRole]) {
        next();
        return;
      }
      res.status(403).json({ error: 'Insufficient permissions' });
    } catch (err) {
      console.error('[roles]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
