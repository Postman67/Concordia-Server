import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// When DATABASE_URL is set (Railway / any managed Postgres), use it directly.
// SSL is enabled by default for external URLs; set DB_SSL=false to override.
const useSSL =
  process.env.DB_SSL !== 'false' && Boolean(process.env.DATABASE_URL);

export const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: useSSL ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'concordia',
        user: process.env.DB_USER || 'concordia',
        password: process.env.DB_PASSWORD,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      },
);
