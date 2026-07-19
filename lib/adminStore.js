const fs = require('fs');
const path = require('path');

const ADMIN_PATH = path.join(__dirname, '..', 'data', 'admin.json');

function load() {
  if (!fs.existsSync(ADMIN_PATH)) return null;
  const raw = fs.readFileSync(ADMIN_PATH, 'utf8').trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function save(admin) {
  fs.writeFileSync(ADMIN_PATH, JSON.stringify(admin, null, 2));
}

module.exports = { load, save };
