const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      // Deferred: don't crash the whole process at boot just because the DB
      // isn't configured yet (e.g. local dev before Vercel Postgres exists).
      // Actual queries will fail with a clear error instead.
      console.warn('POSTGRES_URL (or DATABASE_URL) is not set — database operations will fail until it is configured.');
    }
    pool = new Pool({
      connectionString,
      ssl: connectionString && !connectionString.includes('sslmode=disable') ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

module.exports = { getPool };
