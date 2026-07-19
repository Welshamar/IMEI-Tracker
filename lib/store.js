const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { entries: [], locations: [] };
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8').trim();
  if (!raw) return { entries: [], locations: [] };
  return JSON.parse(raw);
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

module.exports = { load, save };
