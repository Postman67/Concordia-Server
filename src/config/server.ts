import { pool } from './database';

export interface ServerSettings {
  name: string;
  description: string;
  /** Federation user ID of the server owner / primary admin. 0 = unset. */
  admin_user_id: number;
}

const DEFAULTS: ServerSettings = {
  name: 'Concordia Server',
  description: '',
  admin_user_id: 0,
};

const CACHE_TTL_MS = 30_000;

let _cache: { data: ServerSettings; expiresAt: number } | null = null;

/** Clears the in-memory settings cache (call after any updateSettings). */
export function invalidateSettingsCache(): void {
  _cache = null;
}

/** Reads all settings from the DB with a 30-second in-memory cache. */
export async function getSettings(): Promise<ServerSettings> {
  if (_cache && Date.now() < _cache.expiresAt) return _cache.data;

  try {
    const result = await pool.query<{ key: string; value: string }>(
      'SELECT key, value FROM server_settings',
    );
    const map: Record<string, string> = {};
    for (const row of result.rows) map[row.key] = row.value;

    const data: ServerSettings = {
      name:          map['name']          ?? DEFAULTS.name,
      description:   map['description']   ?? DEFAULTS.description,
      admin_user_id: parseInt(map['admin_user_id'] ?? '0', 10),
    };

    _cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
  } catch {
    // If the table doesn't exist yet during migration startup, return defaults
    return DEFAULTS;
  }
}

/** Persists one or more settings to the DB and invalidates the cache. */
export async function updateSettings(
  updates: Partial<ServerSettings>,
): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    await pool.query(
      `INSERT INTO server_settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)],
    );
  }
  invalidateSettingsCache();
}

/**
 * Returns true if userId is the server admin.
 *
 * ADMIN_USER_ID env var acts as a permanent override — useful for
 * initial bootstrap and emergency access recovery.
 */
export async function isAdmin(userId: number): Promise<boolean> {
  const envAdmin = parseInt(process.env.ADMIN_USER_ID || '0', 10);
  if (envAdmin !== 0 && envAdmin === userId) return true;

  const { admin_user_id } = await getSettings();
  return admin_user_id !== 0 && admin_user_id === userId;
}
