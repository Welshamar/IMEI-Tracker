require('dotenv').config({ path: '.env.local' });
const { getPool } = require('../lib/db');

async function migrate() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      model TEXT DEFAULT '',
      os TEXT DEFAULT '',
      serial TEXT DEFAULT '',
      imei TEXT DEFAULT '',
      imei_valid BOOLEAN,
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      ts BIGINT NOT NULL,
      last_lat DOUBLE PRECISION,
      last_lon DOUBLE PRECISION,
      last_accuracy DOUBLE PRECISION,
      last_ts BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      accuracy DOUBLE PRECISION,
      ts BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin (
      id INT PRIMARY KEY DEFAULT 1,
      username TEXT NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL
    );
  `);

  console.log('Migration complete: entries, locations, admin tables are ready.');
  console.log('(The "session" table used for logins is created automatically on first server start.)');
  await pool.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
