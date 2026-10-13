// Football score bug server. No dependencies. Run: node server.js
// Control panel:  http://localhost:8787/
// OBS overlay:    http://localhost:8787/overlay   (1920x1080 browser source)
// Set LAN=1 to allow control from your phone on the same wifi.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.LAN === '1' ? '0.0.0.0' : '127.0.0.1';
const STATE_FILE = path.join(__dirname, 'state.json');
const LOGO_DIR = path.join(__dirname, 'logos');
const FONT_DIR = path.join(__dirname, 'fonts');
fs.mkdirSync(LOGO_DIR, { recursive: true });

const TEAM = { name: '', color: '#333333', score: 0, timeouts: 3, rank: '', logo: '' };
const DEFAULTS = {
  home: { ...TEAM, name: 'AWAY TEAM', color: '#bf5700' },   // left side
  away: { ...TEAM, name: 'HOME TEAM', color: '#bb0000' },   // right side
  period: 1,
  periodPrefix: 'Q',
  status: '',              // '', 'HALFTIME', 'FINAL'
  clock: { mode: 'down', lengthMs: 15 * 60000, baseMs: 0, startedAt: null },
  possession: '',          // '', 'home', 'away'
  down: 1,
  distance: '10',
  showDown: true,
  alert: '',               // FLAG, TOUCHDOWN, etc. Replaces down & distance
  visible: true
};

const clone = o => JSON.parse(JSON.stringify(o));

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const s = { ...clone(DEFAULTS), ...saved };
    s.home = { ...DEFAULTS.home, ...saved.home };
    s.away = { ...DEFAULTS.away, ...saved.away };
    s.clock = { ...DEFAULTS.clock, ...saved.clock };
    return s;
  } catch {
    return clone(DEFAULTS);
  }
}

let state = load();
const clients = new Set();

const elapsed = () => {
  const c = state.clock;
  return c.baseMs + (c.startedAt ? Date.now() - c.startedAt : 0);
};

function setElapsed(ms) {
  const c = state.clock;
  c.baseMs = Math.max(0, ms);
  if (c.startedAt) c.startedAt = Date.now();
}

const payload = () => JSON.stringify({ state, serverNow: Date.now() });

function broadcast() {
  const msg = `data: ${payload()}\n\n`;
  for (const res of clients) res.write(msg);
  fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), () => {});
}

const TEAMS = ['home', 'away'];
const str = (v, n) => String(v).slice(0, n);

function apply(cmd) {
  const c = state.clock;
  const t = TEAMS.includes(cmd.team) ? state[cmd.team] : null;
  switch (cmd.type) {
    case 'score':
      if (!t) break;
      t.score = Math.max(0, t.score + (Number(cmd.delta) || 0));
      if (Number(cmd.delta) === 6) state.event = { kind: 'td', team: cmd.team, id: Date.now(), at: Date.now() };
      break;
    case 'setScore':
      if (t) t.score = Math.max(0, Math.floor(Number(cmd.value) || 0));
      break;
    case 'timeouts': {
      if (!t) break;
      const before = t.timeouts;
      t.timeouts = Math.min(3, Math.max(0, t.timeouts + (Number(cmd.delta) || 0)));
      if (t.timeouts < before) state.event = { kind: 'timeout', team: cmd.team, id: Date.now(), at: Date.now() };
      break;
    }
    case 'possession':
      state.possession = TEAMS.includes(cmd.team) ? cmd.team : '';
      break;
    case 'down':
      if (cmd.down !== undefined) state.down = Math.min(4, Math.max(1, Number(cmd.down) || 1));
      if (cmd.distance !== undefined) state.distance = str(cmd.distance, 8).toUpperCase();
      if (typeof cmd.showDown === 'boolean') state.showDown = cmd.showDown;
      break;
    case 'alert':
      state.alert = str(cmd.text || '', 14).toUpperCase();
      break;
    case 'status':
      state.status = ['', 'HALFTIME', 'FINAL'].includes(cmd.status) ? cmd.status : '';
      break;
    case 'start':
      if (!c.startedAt && !(c.mode === 'down' && elapsed() >= c.lengthMs)) c.startedAt = Date.now();
      break;
    case 'stop':
      if (c.startedAt) { c.baseMs = elapsed(); c.startedAt = null; }
      break;
    case 'toggle':
      apply({ type: c.startedAt ? 'stop' : 'start' });
      break;
    case 'resetClock':
      c.baseMs = 0; c.startedAt = null;
      break;
    case 'adjust': { // ms added to what's DISPLAYED
      const d = Number(cmd.ms) || 0;
      setElapsed(elapsed() + (c.mode === 'down' ? -d : d));
      break;
    }
    case 'setClock': { // ms = what should be DISPLAYED
      const ms = Math.max(0, Number(cmd.ms) || 0);
      setElapsed(c.mode === 'down' ? c.lengthMs - ms : ms);
      break;
    }
    case 'mode':
      if (cmd.mode === 'up' || cmd.mode === 'down') { c.mode = cmd.mode; c.baseMs = 0; c.startedAt = null; }
      break;
    case 'length':
      c.lengthMs = Math.max(1000, Number(cmd.ms) || 0);
      break;
    case 'period':
      state.period = Math.max(1, state.period + (Number(cmd.delta) || 0));
      break;
    case 'teams':
      for (const k of TEAMS) {
        const u = cmd[k];
        if (!u) continue;
        if (typeof u.name === 'string') state[k].name = str(u.name, 18).toUpperCase();
        if (typeof u.rank === 'string') state[k].rank = str(u.rank.replace(/[^0-9]/g, ''), 2);
        if (typeof u.color === 'string' && /^#[0-9a-f]{6}$/i.test(u.color)) state[k].color = u.color;
      }
      break;
    case 'clearLogo':
      if (t) t.logo = '';
      break;
    case 'swap':
      [state.home, state.away] = [state.away, state.home];
      state.event = null;
      if (state.possession) state.possession = state.possession === 'home' ? 'away' : 'home';
      break;
    case 'set':
      if (typeof cmd.periodPrefix === 'string') state.periodPrefix = str(cmd.periodPrefix, 4).toUpperCase();
      if (typeof cmd.visible === 'boolean') state.visible = cmd.visible;
      break;
    case 'resetGame':
      for (const k of TEAMS) { state[k].score = 0; state[k].timeouts = 3; }
      Object.assign(state, { period: 1, possession: '', down: 1, distance: '10', alert: '', status: '' });
      c.baseMs = 0; c.startedAt = null;
      break;
  }
}

// Countdown stops itself at 0:00
setInterval(() => {
  const c = state.clock;
  if (c.mode === 'down' && c.startedAt && elapsed() >= c.lengthMs) {
    c.baseMs = c.lengthMs; c.startedAt = null;
    broadcast();
  }
}, 50);

// Keep SSE connections alive
setInterval(() => { for (const r of clients) r.write(': ping\n\n'); }, 15000);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif'
};
const LOGO_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/gif': '.gif' };

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': file.endsWith('.html') ? 'no-store' : 'max-age=31536000'
    });
    res.end(data);
  });
}

function readBody(req, limit, cb) {
  const chunks = []; let size = 0;
  req.on('data', d => {
    size += d.length;
    if (size > limit) { req.destroy(); return; }
    chunks.push(d);
  });
  req.on('end', () => cb(Buffer.concat(chunks)));
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  if (req.method === 'GET' && (url === '/' || url === '/control')) return sendFile(res, path.join(__dirname, 'control.html'));
  if (req.method === 'GET' && url === '/overlay') return sendFile(res, path.join(__dirname, 'overlay.html'));
  if (req.method === 'GET' && /^\/fonts\/[\w.-]+$/.test(url)) return sendFile(res, path.join(FONT_DIR, path.basename(url)));
  if (req.method === 'GET' && /^\/textures\/[\w.-]+$/.test(url)) return sendFile(res, path.join(__dirname, 'textures', path.basename(url)));
  if (req.method === 'GET' && /^\/logos\/[\w.-]+$/.test(url)) return sendFile(res, path.join(LOGO_DIR, path.basename(url)));

  if (req.method === 'GET' && url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${payload()}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Logo upload: POST /logo/home or /logo/away with the raw image as the body
  const m = url.match(/^\/logo\/(home|away)$/);
  if (req.method === 'POST' && m) {
    const ext = LOGO_EXT[(req.headers['content-type'] || '').split(';')[0]];
    if (!ext) { res.writeHead(415); return res.end('use png, jpg, webp, svg or gif'); }
    return readBody(req, 8 * 1024 * 1024, buf => {
      const name = `${m[1]}-${Date.now()}${ext}`;
      fs.writeFile(path.join(LOGO_DIR, name), buf, err => {
        if (err) { res.writeHead(500); return res.end('save failed'); }
        state[m[1]].logo = name;
        broadcast();
        res.writeHead(200); res.end('ok');
      });
    });
  }

  if (req.method === 'POST' && url === '/cmd') {
    return readBody(req, 1e5, buf => {
      try {
        apply(JSON.parse(buf.toString('utf8')));
        broadcast();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(payload());
      } catch {
        res.writeHead(400); res.end('bad command');
      }
    });
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log('\nScore bug running');
  console.log(`  Control panel: http://localhost:${PORT}/`);
  console.log(`  OBS overlay:   http://localhost:${PORT}/overlay`);
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log(`  Phone control: http://${n.address}:${PORT}/`);
      }
    }
  }
  console.log('\nLeave this window open while streaming.\n');
});
