import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

// At runtime __dirname = dist/db/ — go up two levels to reach /migrations
const MIGRATIONS_DIR = join(__dirname, '../../migrations');

export async function runMigrations(pool: Pool): Promise<void> {
  // Tracking table — safe to call on every startup
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  const applied = new Set(rows.map((r) => r.filename));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // alphabetical → 001, 002, 003 …

  let pending = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    pending++;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      console.log(`[migrate] applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      // Abort startup with a clear message rather than running on a broken schema
      throw new Error(`[migrate] FAILED on ${file}: ${String(err)}`);
    } finally {
      client.release();
    }
  }

  if (pending === 0) {
    console.log('[migrate] schema is up to date');
  }
}
