const bcrypt = require('bcryptjs');
const { save } = require('../lib/adminStore');

const [,, username, password] = process.argv;

if (!username || !password) {
  console.error('Usage: node scripts/set-admin-password.js <username> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 12);
save({ username, passwordHash });
console.log(`Admin credentials saved for username "${username}".`);
