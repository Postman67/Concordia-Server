import { readFileSync } from 'fs';
import { join } from 'path';

interface ServerConfig {
  name: string;
  description: string;
  /** Federation user ID of the server owner / primary admin. Set to 0 if unset. */
  admin_user_id: number;
}

let _config: ServerConfig | null = null;

export function getServerConfig(): ServerConfig {
  if (_config) return _config;

  try {
    const configPath = join(process.cwd(), 'server.config.json');
    const raw = readFileSync(configPath, 'utf-8');
    _config = JSON.parse(raw) as ServerConfig;
  } catch {
    // Fall back to environment variables when the config file isn't present
    _config = {
      name: process.env.SERVER_NAME || 'Concordia Server',
      description: process.env.SERVER_DESCRIPTION || '',
      admin_user_id: parseInt(process.env.ADMIN_USER_ID || '0', 10),
    };
  }

  return _config;
}

/** Returns true when userId matches the admin configured in server.config.json */
export function isAdmin(userId: number): boolean {
  const { admin_user_id } = getServerConfig();
  return admin_user_id !== 0 && admin_user_id === userId;
}
