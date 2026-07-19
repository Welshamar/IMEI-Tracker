const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const { load, save } = require('./lib/store');
const { luhnCheck } = require('./lib/luhn');
const adminStore = require('./lib/adminStore');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.json());
app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  name: 'ledger.sid',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 }
}));

function newId() {
  return Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

function normSerial(s) { return (s || '').trim().toUpperCase(); }
function normEmail(s) { return (s || '').trim().toLowerCase(); }
function normDigits(s) { return (s || '').replace(/\D/g, ''); }

// ---- Auth ----
// Everything below protects the ledger (viewing/adding/removing devices).
// The device check-in flow (public/checkin.html + POST /api/checkin) is
// intentionally left open — it must work for whoever is holding a tracked
// device, who will not have admin credentials.

const failedAttempts = new Map(); // ip -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

function requireAuthPage(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/login.html');
}

function requireAuthApi(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Not logged in.' });
}

app.get('/api/whoami', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.isAdmin), username: req.session && req.session.username });
});

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const attempt = failedAttempts.get(ip);
  if (attempt && attempt.lockedUntil > Date.now()) {
    const secs = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${secs}s.` });
  }

  const { username = '', password = '' } = req.body || {};
  const admin = adminStore.load();

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
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/change-password', requireAuthApi, (req, res) => {
  const { currentPassword = '', newPassword = '' } = req.body || {};
  const admin = adminStore.load();
  if (!admin || !bcrypt.compareSync(currentPassword, admin.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  adminStore.save({ username: admin.username, passwordHash: bcrypt.hashSync(newPassword, 12) });
  res.json({ ok: true });
});

// ---- Protected pages ----
// Explicit routes for the ledger page run before express.static so an
// unauthenticated visitor is redirected to the login page instead of ever
// receiving the ledger HTML.

app.get(['/', '/index.html'], requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// login.html, checkin.html, shared.css, world-map.svg etc. stay public.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---- Entries (admin only) ----

app.get('/api/entries', requireAuthApi, (req, res) => {
  const db = load();
  res.json(db.entries.slice().sort((a, b) => b.ts - a.ts));
});

app.post('/api/entries', requireAuthApi, (req, res) => {
  const { name = '', model = '', os = '', serial = '', imei = '', phone = '', email = '' } = req.body || {};

  if (!name.trim() && !model.trim() && !serial.trim() && !normDigits(imei) && !normDigits(phone) && !email.trim()) {
    return res.status(400).json({ error: 'Provide at least a name, model, serial, IMEI, phone, or email.' });
  }

  const imeiDigits = normDigits(imei);
  let imeiValid = null;
  if (imeiDigits.length === 15) {
    imeiValid = luhnCheck(imeiDigits.split('').map(Number)).valid;
  }

  const db = load();
  const entry = {
    id: newId(),
    name: name.trim(),
    model: model.trim(),
    os: os.trim(),
    serial: serial.trim(),
    imei: imeiDigits,
    imeiValid,
    phone: phone.trim(),
    email: email.trim(),
    ts: Date.now(),
    lastLocation: null
  };
  db.entries.push(entry);
  save(db);
  res.status(201).json(entry);
});

app.delete('/api/entries/:id', requireAuthApi, (req, res) => {
  const db = load();
  const before = db.entries.length;
  db.entries = db.entries.filter(e => e.id !== req.params.id);
  db.locations = db.locations.filter(l => l.entryId !== req.params.id);
  save(db);
  if (db.entries.length === before) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.get('/api/entries/:id/locations', requireAuthApi, (req, res) => {
  const db = load();
  const history = db.locations
    .filter(l => l.entryId === req.params.id)
    .sort((a, b) => a.ts - b.ts);
  res.json(history);
});

// ---- Check-in (self-reported location, requires the device's own consent) ----
// A device identifies itself by one of its own known identifiers and reports
// its own current position. This never looks up or infers another device's
// location — it only records what the reporting device explicitly shares.
// Deliberately NOT behind requireAuthApi: the person checking in is the
// device holder, not the ledger admin.

app.post('/api/checkin', (req, res) => {
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

  const db = load();
  let match = null;

  if (lookupType === 'serial') {
    const v = normSerial(lookupValue);
    match = db.entries.find(e => normSerial(e.serial) === v && v);
  } else if (lookupType === 'email') {
    const v = normEmail(lookupValue);
    match = db.entries.find(e => normEmail(e.email) === v && v);
  } else if (lookupType === 'imei') {
    const v = normDigits(lookupValue);
    match = db.entries.find(e => e.imei === v && v);
  } else if (lookupType === 'phone') {
    const v = normDigits(lookupValue);
    match = db.entries.find(e => normDigits(e.phone) === v && v);
  }

  if (!match) {
    return res.status(404).json({ error: 'No ledger entry matches that identifier. Ask the ledger owner to add this device first.' });
  }

  const locEntry = {
    id: newId(),
    entryId: match.id,
    lat,
    lon,
    accuracy: typeof accuracy === 'number' ? accuracy : null,
    ts: Date.now()
  };
  db.locations.push(locEntry);
  match.lastLocation = { lat, lon, accuracy: locEntry.accuracy, ts: locEntry.ts };
  save(db);

  res.json({ ok: true, deviceName: match.name || match.model || 'Unnamed device' });
});

app.listen(PORT, () => {
  console.log(`Device Ledger running at http://localhost:${PORT}`);
});
