/**
 * GPS Tracking — Backend for cloud deploy (Render / any Node host)
 * --------------------------------------------------------------
 * Same API as the local backend, but self-contained for cloud:
 *   - serves the dashboard from ./public
 *   - reads PORT from the environment (Render provides it)
 *
 * Endpoints:
 *   POST /api/register   { screenId, name, plate, phone, cooperative }
 *   POST /api/positions  { screenId, lat, lng, accuracy, speed, heading }
 *   GET  /api/drivers
 *   GET  /api/positions
 *   GET  /api/health
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ONLINE_WINDOW_MS = 300 * 1000;  // 5 min — tolerates the ~90s watchdog cycle so it doesn't flap offline

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    const b = req.body && Object.keys(req.body).length ? ' ' + JSON.stringify(req.body) : '';
    console.log(new Date().toISOString(), req.method, req.url + b);
  }
  next();
});

let db = { devices: {}, positions: {} };

function loadDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      db.devices = db.devices || {};
      db.positions = db.positions || {};
    }
  } catch (e) { db = { devices: {}, positions: {} }; }
}

let saveTimer = null;
function saveDb() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), () => {});
  }, 500);
}

loadDb();

function isOnline(id) {
  const p = db.positions[id];
  return !!(p && Date.now() - new Date(p.timestamp).getTime() < ONLINE_WINDOW_MS);
}

function driverView(id) {
  const d = db.devices[id];
  return {
    id: id,
    plate: d.plate || '',
    name: d.name || ('GPS Device ' + id),
    phone: d.phone || '',
    cooperative: d.cooperative || '',
    status: isOnline(id) ? 'active' : 'inactive',
    registeredAt: d.registeredAt
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, devices: Object.keys(db.devices).length, time: new Date().toISOString() });
});

app.post('/api/register', (req, res) => {
  const { screenId, name, plate, phone, cooperative } = req.body || {};
  const id = String(screenId || '').trim();
  if (!id) return res.status(400).json({ error: 'screenId is required' });
  const existing = db.devices[id] || {};
  db.devices[id] = {
    name: name || existing.name || ('GPS Device ' + id),
    plate: plate || existing.plate || '',
    phone: phone || existing.phone || '',
    cooperative: cooperative || existing.cooperative || '',
    registeredAt: existing.registeredAt || new Date().toISOString()
  };
  saveDb();
  console.log('[register]', id, db.devices[id].name);
  res.json({ ok: true, driver: driverView(id) });
});

app.post('/api/positions', (req, res) => {
  const { screenId, lat, lng, accuracy, speed, heading } = req.body || {};
  const id = String(screenId || '').trim();
  if (!id) return res.status(400).json({ error: 'screenId is required' });
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat/lng must be numbers' });
  }
  if (!db.devices[id]) {
    db.devices[id] = { name: 'GPS Device ' + id, plate: '', phone: '', cooperative: '', registeredAt: new Date().toISOString() };
  }
  db.positions[id] = {
    screenId: id, lat, lng,
    accuracy: accuracy ?? null,
    speed: speed ?? 0,
    heading: heading ?? null,
    timestamp: new Date().toISOString()
  };
  saveDb();
  res.json({ ok: true });
});

app.get('/api/drivers', (req, res) => {
  res.json(Object.keys(db.devices).map(driverView));
});

app.get('/api/positions', (req, res) => {
  const out = {};
  Object.keys(db.positions).forEach((id) => {
    out[id] = Object.assign({}, db.positions[id], { online: isOnline(id) });
  });
  res.json(out);
});

app.delete('/api/drivers/:id', (req, res) => {
  delete db.devices[req.params.id];
  delete db.positions[req.params.id];
  saveDb();
  res.json({ ok: true });
});

// serve the dashboard from ./public
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/02-Map.html'));

app.listen(PORT, '0.0.0.0', () => {
  console.log('GPS Tracking backend running on port ' + PORT);
});
