require('dotenv').config({ path: '.env.local' });
const bcrypt = require('bcryptjs');
const adminStore = require('../lib/adminStore');
const { getPool } = require('../lib/db');

const [,, username, email, password] = process.argv;

if (!username || !email || !password) {
  console.error('Usage: node scripts/set-admin-password.js <username> <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

(async () => {
  const passwordHash = bcrypt.hashSync(password, 12);
  await adminStore.save({ username, email, passwordHash });
  console.log(`Admin credentials saved for username "${username}" / email "${email}".`);
  await getPool().end();
})().catch(err => {
  console.error('Failed to save admin credentials:', err.message);
  process.exit(1);
});
