const bcrypt = require('bcryptjs');
const { save } = require('../lib/adminStore');

const [,, username, email, password] = process.argv;

if (!username || !email || !password) {
  console.error('Usage: node scripts/set-admin-password.js <username> <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 12);
save({ username, email, passwordHash });
console.log(`Admin credentials saved for username "${username}" / email "${email}".`);
