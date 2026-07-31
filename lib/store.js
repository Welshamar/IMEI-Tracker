const { getPool } = require('./db');

function rowToEntry(row) {
  return {
    id: row.id,
    name: row.name || '',
    model: row.model || '',
    os: row.os || '',
    serial: row.serial || '',
    imei: row.imei || '',
    imeiValid: row.imei_valid,
    phone: row.phone || '',
    email: row.email || '',
    ts: Number(row.ts),
    lastLocation: row.last_ts
      ? { lat: row.last_lat, lon: row.last_lon, accuracy: row.last_accuracy, ts: Number(row.last_ts) }
      : null
  };
}

async function listEntries() {
  const { rows } = await getPool().query('SELECT * FROM entries ORDER BY ts DESC');
  return rows.map(rowToEntry);
}

async function createEntry(entry) {
  const { rows } = await getPool().query(
    `INSERT INTO entries (id, name, model, os, serial, imei, imei_valid, phone, email, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [entry.id, entry.name, entry.model, entry.os, entry.serial, entry.imei, entry.imeiValid, entry.phone, entry.email, entry.ts]
  );
  return rowToEntry(rows[0]);
}

async function deleteEntry(id) {
  const { rowCount } = await getPool().query('DELETE FROM entries WHERE id = $1', [id]);
  return rowCount > 0;
}

async function findEntry(lookupType, normalizedValue) {
  if (!normalizedValue) return null;
  let sql;
  switch (lookupType) {
    case 'serial':
      sql = `SELECT * FROM entries WHERE serial <> '' AND UPPER(TRIM(serial)) = $1 LIMIT 1`;
      break;
    case 'email':
      sql = `SELECT * FROM entries WHERE email <> '' AND LOWER(TRIM(email)) = $1 LIMIT 1`;
      break;
    case 'imei':
      sql = `SELECT * FROM entries WHERE imei <> '' AND imei = $1 LIMIT 1`;
      break;
    case 'phone':
      sql = `SELECT * FROM entries WHERE phone <> '' AND regexp_replace(phone, '\\D', '', 'g') = $1 LIMIT 1`;
      break;
    default:
      return null;
  }
  const { rows } = await getPool().query(sql, [normalizedValue]);
  return rows[0] ? rowToEntry(rows[0]) : null;
}

async function updateEntryLocation(entryId, loc) {
  await getPool().query(
    `UPDATE entries SET last_lat = $1, last_lon = $2, last_accuracy = $3, last_ts = $4 WHERE id = $5`,
    [loc.lat, loc.lon, loc.accuracy, loc.ts, entryId]
  );
}

async function addLocationHistory(locEntry) {
  await getPool().query(
    `INSERT INTO locations (id, entry_id, lat, lon, accuracy, ts) VALUES ($1,$2,$3,$4,$5,$6)`,
    [locEntry.id, locEntry.entryId, locEntry.lat, locEntry.lon, locEntry.accuracy, locEntry.ts]
  );
}

async function listLocationHistory(entryId) {
  const { rows } = await getPool().query(
    'SELECT * FROM locations WHERE entry_id = $1 ORDER BY ts ASC',
    [entryId]
  );
  return rows.map(r => ({
    id: r.id, entryId: r.entry_id, lat: r.lat, lon: r.lon, accuracy: r.accuracy, ts: Number(r.ts)
  }));
}

module.exports = {
  listEntries,
  createEntry,
  deleteEntry,
  findEntry,
  updateEntryLocation,
  addLocationHistory,
  listLocationHistory
};
