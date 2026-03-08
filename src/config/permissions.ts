/**
 * Concordia permission system — Discord-style bitmask permissions.
 *
 * Each permission is a single bit in a BIGINT. The server owner (admin_user_id)
 * always has all permissions regardless of roles. Every other user starts from
 * the @everyone role permissions and accumulates bits from additional roles,
 * with per-channel / per-category overrides applied on top.
 *
 * Resolution order (highest = final):
 *   1. If user is server admin → ADMINISTRATOR bit → all perms granted
 *   2. Collect all role permission bits (union / OR)
 *   3. Apply category overrides  (deny first, then allow)
 *   4. Apply channel overrides   (deny first, then allow)
 */

import { pool } from '../config/database';
import { isAdmin } from '../config/server';

// ── Permission constants ──────────────────────────────────────────────────────

export const Permissions = {
  /** Full access — assigned to server admin only (not a real role bit). */
  ADMINISTRATOR:         BigInt(1) << BigInt(0),  // 1

  /** See channels in the sidebar. */
  VIEW_CHANNELS:         BigInt(1) << BigInt(1),  // 2

  /** Post messages in text channels. */
  SEND_MESSAGES:         BigInt(1) << BigInt(2),  // 4

  /** Read previous messages in a channel. */
  READ_MESSAGE_HISTORY:  BigInt(1) << BigInt(3),  // 8

  /** Manage (edit/delete) any message. */
  MANAGE_MESSAGES:       BigInt(1) << BigInt(4),  // 16

  /** Create, edit, or delete channels. */
  MANAGE_CHANNELS:       BigInt(1) << BigInt(5),  // 32

  /** Create, edit, or delete categories. */
  MANAGE_CATEGORIES:     BigInt(1) << BigInt(6),  // 64

  /** Create, edit, delete, or assign roles. */
  MANAGE_ROLES:          BigInt(1) << BigInt(7),  // 128

  /** Kick members from the server. */
  KICK_MEMBERS:          BigInt(1) << BigInt(8),  // 256

  /** Ban / unban members. */
  BAN_MEMBERS:           BigInt(1) << BigInt(9),  // 512

  /** Change server name, description, icon. */
  MANAGE_SERVER:         BigInt(1) << BigInt(10), // 1024
} as const;

export type PermissionKey = keyof typeof Permissions;

/** All permission bits OR'd together — used for the admin shortcut. */
export const ALL_PERMISSIONS: bigint = Object.values(Permissions).reduce(
  (acc, bit) => acc | bit,
  BigInt(0),
);

/** Default bits granted to @everyone on a fresh server. */
export const EVERYONE_DEFAULT_PERMISSIONS: bigint =
  Permissions.VIEW_CHANNELS | Permissions.SEND_MESSAGES | Permissions.READ_MESSAGE_HISTORY;

// ── Resolution ────────────────────────────────────────────────────────────────

/**
 * Resolves the effective permission bitmask for a user.
 *
 * @param userId   - Federation UUID
 * @param channelId - optional; applies channel + category overrides if set
 */
export async function resolvePermissions(
  userId: string,
  channelId?: number,
): Promise<bigint> {
  // Server admin gets everything
  if (await isAdmin(userId)) return ALL_PERMISSIONS;

  // 1. Union all role permission bits (includes @everyone via member_roles or direct fallback)
  const roleResult = await pool.query<{ permissions: string }>(
    `SELECT r.permissions
     FROM roles r
     WHERE r.is_everyone = TRUE
       OR r.id IN (
         SELECT role_id FROM member_roles WHERE user_id = $1
       )`,
    [userId],
  );

  let base = BigInt(0);
  for (const row of roleResult.rows) {
    base |= BigInt(row.permissions);
  }

  // ADMINISTRATOR shortcut — skip overrides
  if ((base & Permissions.ADMINISTRATOR) !== BigInt(0)) return ALL_PERMISSIONS;

  if (channelId === undefined) return base;

  // 2. Collect all role IDs for this user (for override lookups)
  const roleIds: number[] = [];
  const everyoneResult = await pool.query<{ id: number }>(
    'SELECT id FROM roles WHERE is_everyone = TRUE LIMIT 1',
  );
  if (everyoneResult.rows.length > 0) roleIds.push(everyoneResult.rows[0].id);

  const memberRoleResult = await pool.query<{ role_id: number }>(
    'SELECT role_id FROM member_roles WHERE user_id = $1',
    [userId],
  );
  for (const row of memberRoleResult.rows) {
    if (!roleIds.includes(row.role_id)) roleIds.push(row.role_id);
  }

  // 3. Apply category overrides (if this channel belongs to a category)
  const catResult = await pool.query<{ category_id: number | null }>(
    'SELECT category_id FROM channels WHERE id = $1',
    [channelId],
  );
  const categoryId = catResult.rows[0]?.category_id ?? null;

  if (categoryId !== null && roleIds.length > 0) {
    const catOverrides = await pool.query<{ allow_bits: string; deny_bits: string }>(
      `SELECT allow_bits, deny_bits
       FROM category_permission_overrides
       WHERE category_id = $1 AND role_id = ANY($2::int[])`,
      [categoryId, roleIds],
    );
    let catAllow = BigInt(0);
    let catDeny  = BigInt(0);
    for (const o of catOverrides.rows) {
      catAllow |= BigInt(o.allow_bits);
      catDeny  |= BigInt(o.deny_bits);
    }
    base = (base & ~catDeny) | catAllow;
  }

  // 4. Apply channel overrides
  if (roleIds.length > 0) {
    const chOverrides = await pool.query<{ allow_bits: string; deny_bits: string }>(
      `SELECT allow_bits, deny_bits
       FROM channel_permission_overrides
       WHERE channel_id = $1 AND role_id = ANY($2::int[])`,
      [channelId, roleIds],
    );
    let chAllow = BigInt(0);
    let chDeny  = BigInt(0);
    for (const o of chOverrides.rows) {
      chAllow |= BigInt(o.allow_bits);
      chDeny  |= BigInt(o.deny_bits);
    }
    base = (base & ~chDeny) | chAllow;
  }

  return base;
}

/**
 * Returns the highest role position held by a user (excluding @everyone).
 * The server owner always returns Infinity so they are never blocked by the
 * hierarchy check when deleting messages from any other member.
 *
 * Used to enforce: a moderator cannot delete messages from users whose
 * highest role position is >= their own.
 */
export async function getTopRolePosition(userId: string): Promise<number> {
  if (await isAdmin(userId)) return Infinity;

  const result = await pool.query<{ max_position: number | null }>(
    `SELECT MAX(r.position) AS max_position
     FROM roles r
     JOIN member_roles mr ON mr.role_id = r.id
     WHERE mr.user_id = $1 AND r.is_everyone = FALSE`,
    [userId],
  );
  return result.rows[0]?.max_position ?? 0;
}

/** Returns true if `perms` contains all bits in `required`. */
export function hasPermission(perms: bigint, required: bigint): boolean {
  return (perms & required) === required;
}
