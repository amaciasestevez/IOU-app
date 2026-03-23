// importing tools from the pg (PostgreSQL) library - Pool keeps multiple connections open so we don't have to reconnect every request
import { Pool, QueryResult, QueryResultRow } from 'pg';

// In production (Railway), DATABASE_URL is a full connection string.
// In development, fall back to individual env vars from .env
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: parseInt(process.env.DB_PORT || '5432'),
    });

// middleman wrapper function - lets every route in server.ts talk to the database through one place instead of connecting directly each time
export default {
    query: <T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> => pool.query(text, params)
};
