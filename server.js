const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const { luhnCheck } = require('./lib/luhn');
const adminStore = require('./lib/adminStore');
const { getPool } = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3100;

app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  store: new pgSession({ pool: getPool(), createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  name: 'ledger.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000
  }
}));

// Static assets (public/*.html, shared.css, world-map.svg). On Vercel these
// are served directly by the static builder per vercel.json; this is what
// runs them for local dev (`node server.js`).
app.use(express.static(path.join(__dirname, 'public')));

function newId() {
  return Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

function normSerial(s) { return (s || '').trim().toUpperCase(); }
function normEmail(s) { return (s || '').trim().toLowerCase(); }
function normDigits(s) { return (s || '').replace(/\D/g, ''); }

function asyncRoute(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch(err => {
      console.error(err);
      res.status(500).json({ error: 'Server error.' });
    });
  };
}

// ---- Auth ----
// Everything below protects the ledger (viewing/adding/removing devices).
// The device check-in flow (public/checkin.html + POST /api/checkin) is
// intentionally left open — it must work for whoever is holding a tracked
// device, who will not have admin credentials. index.html itself is a
// plain static file (no server-side page gate); it checks /api/whoami on
// load and redirects to /login.html client-side if not authenticated. The
// real security boundary is the /api/entries* endpoints below, which always
// require a valid session regardless of how the page was reached.

const failedAttempts = new Map(); // ip -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

function requireAuthApi(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Not logged in.' });
}

app.get('/api/whoami', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.isAdmin), username: req.session && req.session.username });
});

app.post('/api/login', asyncRoute(async (req, res) => {
  const ip = req.ip;
  const attempt = failedAttempts.get(ip);
  if (attempt && attempt.lockedUntil > Date.now()) {
    const secs = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${secs}s.` });
  }

  const { username = '', password = '' } = req.body || {};
  const admin = await adminStore.load();

  const identifierMatches = admin && (
    username === admin.username ||
    (admin.email && username.toLowerCase() === admin.email.toLowerCase())
  );
  const ok = identifierMatches && bcrypt.compareSync(password, admin.passwordHash);
  if (!ok) {
    const next = { count: (attempt ? attempt.count : 0) + 1, lockedUntil: 0 };
    if (next.count >= MAX_ATTEMPTS) next.lockedUntil = Date.now() + LOCKOUT_MS;
    failedAttempts.set(ip, next);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  failedAttempts.delete(ip);
  req.session.isAdmin = true;
  req.session.username = admin.username;
  res.json({ ok: true });
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/change-password', requireAuthApi, asyncRoute(async (req, res) => {
  const { currentPassword = '', newPassword = '' } = req.body || {};
  const admin = await adminStore.load();
  if (!admin || !bcrypt.compareSync(currentPassword, admin.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  await adminStore.save({ username: admin.username, email: admin.email, passwordHash: bcrypt.hashSync(newPassword, 12) });
  res.json({ ok: true });
}));

// ---- Entries (admin only) ----

app.get('/api/entries', requireAuthApi, asyncRoute(async (req, res) => {
  res.json(await store.listEntries());
}));

app.post('/api/entries', requireAuthApi, asyncRoute(async (req, res) => {
  const { name = '', model = '', os = '', serial = '', imei = '', phone = '', email = '' } = req.body || {};

  if (!name.trim() && !model.trim() && !serial.trim() && !normDigits(imei) && !normDigits(phone) && !email.trim()) {
    return res.status(400).json({ error: 'Provide at least a name, model, serial, IMEI, phone, or email.' });
  }

  const imeiDigits = normDigits(imei);
  let imeiValid = null;
  if (imeiDigits.length === 15) {
    imeiValid = luhnCheck(imeiDigits.split('').map(Number)).valid;
  }

  const entry = await store.createEntry({
    id: newId(),
    name: name.trim(),
    model: model.trim(),
    os: os.trim(),
    serial: serial.trim(),
    imei: imeiDigits,
    imeiValid,
    phone: phone.trim(),
    email: email.trim(),
    ts: Date.now()
  });
  res.status(201).json(entry);
}));

app.delete('/api/entries/:id', requireAuthApi, asyncRoute(async (req, res) => {
  const deleted = await store.deleteEntry(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

app.get('/api/entries/:id/locations', requireAuthApi, asyncRoute(async (req, res) => {
  res.json(await store.listLocationHistory(req.params.id));
}));

// ---- Check-in (self-reported location, requires the device's own consent) ----
// A device identifies itself by one of its own known identifiers and reports
// its own current position. This never looks up or infers another device's
// location — it only records what the reporting device explicitly shares.
// Deliberately NOT behind requireAuthApi: the person checking in is the
// device holder, not the ledger admin.

app.post('/api/checkin', asyncRoute(async (req, res) => {
  const { lookupType, lookupValue, lat, lon, accuracy } = req.body || {};

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'lat/lon are required and must be numbers.' });
  }
  if (!['serial', 'email', 'imei', 'phone'].includes(lookupType)) {
    return res.status(400).json({ error: 'lookupType must be one of serial, email, imei, phone.' });
  }
  if (!lookupValue || !String(lookupValue).trim()) {
    return res.status(400).json({ error: 'lookupValue is required.' });
  }

  let normalizedValue;
  if (lookupType === 'serial') normalizedValue = normSerial(lookupValue);
  else if (lookupType === 'email') normalizedValue = normEmail(lookupValue);
  else normalizedValue = normDigits(lookupValue);

  const match = await store.findEntry(lookupType, normalizedValue);
  if (!match) {
    return res.status(404).json({ error: 'No ledger entry matches that identifier. Ask the ledger owner to add this device first.' });
  }

  const ts = Date.now();
  const normalizedAccuracy = typeof accuracy === 'number' ? accuracy : null;
  await store.addLocationHistory({ id: newId(), entryId: match.id, lat, lon, accuracy: normalizedAccuracy, ts });
  await store.updateEntryLocation(match.id, { lat, lon, accuracy: normalizedAccuracy, ts });

  res.json({ ok: true, deviceName: match.name || match.model || 'Unnamed device' });
}));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Device Ledger running at http://localhost:${PORT}`);
  });
}

module.exports = app;
