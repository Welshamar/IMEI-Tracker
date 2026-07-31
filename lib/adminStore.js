const { getPool } = require('./db');

async function load() {
  const { rows } = await getPool().query(
    'SELECT username, email, password_hash AS "passwordHash" FROM admin WHERE id = 1'
  );
  return rows[0] || null;
}

async function save({ username, email, passwordHash }) {
  await getPool().query(
    `INSERT INTO admin (id, username, email, password_hash) VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET username = $1, email = $2, password_hash = $3`,
    [username, email, passwordHash]
  );
}

module.exports = { load, save };
