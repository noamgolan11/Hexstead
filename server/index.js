/* Hexstead server: serves the site and runs every table over WebSockets. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Table, COLORS } = require('./table.js');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'tables.json');
const MAX_TABLES = 3000;
const MAX_OWNED = 12;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ---------------- static files ---------------- */
const JS = 'application/javascript; charset=utf-8';
const FILES = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/index.html': ['public/index.html', 'text/html; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['public/favicon.svg', 'image/svg+xml'],
  '/engine.js': ['shared/engine.js', JS],
  '/bot.js': ['shared/bot.js', JS],
  '/net.js': ['public/net.js', JS],
  '/ui-board.js': ['public/ui-board.js', JS],
  '/ui.js': ['public/ui.js', JS],
};
const cache = new Map();
function fileFor(url) {
  const f = FILES[url];
  if (!f) return null;
  const full = path.join(ROOT, f[0]);
  const st = fs.statSync(full);
  const hit = cache.get(full);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const body = fs.readFileSync(full);
  const entry = { body, type: f[1], mtime: st.mtimeMs, etag: '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '"' };
  cache.set(full, entry);
  return entry;
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok ' + tables.size); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let f;
  try { f = fileFor(url); } catch (e) { f = null; }
  if (!f) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
  const headers = { 'content-type': f.type, 'cache-control': 'no-cache', etag: f.etag, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); res.end(); return; }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : f.body);
});

/* ---------------- tables ---------------- */
const tables = new Map();
let dirty = false;
const sockets = new Set();

function send(ws, m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }
const hooks = {
  broadcast(t) { for (const ws of t.subs) send(ws, { t: 'state', doc: t.viewFor(ws.uid), now: Date.now() }); },
  indexChanged(t) {
    const e = t.indexEntry();
    const key = [e.status, e.n, e.max, e.uids.join(',')].join('|');
    if (t._indexKey === key) return;
    t._indexKey = key;
    for (const ws of sockets) if (ws.lobby && ws.uid && (e.uids.includes(ws.uid) || e.owner === ws.uid)) sendTables(ws);
  },
  dirty() { dirty = true; },
};
function sendTables(ws) {
  const list = [];
  for (const t of tables.values()) {
    const e = t.indexEntry();
    if (e.owner === ws.uid || e.uids.includes(ws.uid)) list.push(e);
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  send(ws, { t: 'tables', list: list.slice(0, 25) });
}
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!tables.has(c)) return c;
  }
}
function subscribe(ws, t) {
  if (ws.table && ws.table !== t) unsubscribe(ws);
  ws.table = t;
  t.subs.add(ws);
  hooks.broadcast(t);
  t.scheduleBots();
}
function unsubscribe(ws) {
  const t = ws.table;
  if (!t) return;
  t.subs.delete(ws);
  ws.table = null;
  hooks.broadcast(t);
}
function uidOf(token) { return 'p_' + crypto.createHash('sha256').update('hexstead:' + token).digest('hex').slice(0, 20); }
const cleanNick = n => String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 18);

function handle(ws, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t !== 'hello' && m.t !== 'ping' && !ws.uid) return send(ws, { t: 'error', m: 'Say hello first.' });
  switch (m.t) {
    case 'hello': {
      if (typeof m.token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(m.token)) return send(ws, { t: 'error', m: 'Bad session token.' });
      ws.uid = uidOf(m.token);
      send(ws, { t: 'welcome', uid: ws.uid });
      if (ws.lobby) sendTables(ws);
      return;
    }
    case 'ping': return send(ws, { t: 'pong', now: Date.now() });
    case 'lobby': ws.lobby = !!m.on; if (ws.lobby) sendTables(ws); return;
    case 'create': {
      if (tables.size >= MAX_TABLES) return send(ws, { t: 'error', m: 'The server is full right now. Try again later.' });
      let owned = 0;
      for (const t of tables.values()) if (t.doc.owner === ws.uid && t.doc.status !== 'ended') owned++;
      if (owned >= MAX_OWNED) return send(ws, { t: 'error', m: 'You have too many open tables. Delete some first.' });
      const code = newCode();
      const t = new Table(code, ws.uid, hooks);
      t.doc.seats.push({ uid: ws.uid, bot: false, nick: cleanNick(m.nick) || 'Player 1', color: COLORS.includes(m.color) ? m.color : 'red' });
      tables.set(code, t);
      send(ws, { t: 'created', code });
      subscribe(ws, t);
      t.changed();
      return;
    }
    case 'open': {
      const code = String(m.code || '').toUpperCase();
      const t = tables.get(code);
      if (!t) return send(ws, { t: 'missing', code });
      subscribe(ws, t);
      return;
    }
    case 'close': return unsubscribe(ws);
    case 'act': {
      const t = tables.get(String(m.code || ''));
      if (!t) return send(ws, { t: 'missing', code: m.code });
      if (!ws.table || ws.table !== t) subscribe(ws, t);
      const s = Number.isFinite(m.s) ? m.s : undefined;
      const r = t.submit(ws.uid, s, m.a);
      if (!r.ok) send(ws, { t: 'rej', code: t.doc.code, s, m: r.err });
      if (r.dup || !r.ok) send(ws, { t: 'state', doc: t.viewFor(ws.uid), now: Date.now() });
      return;
    }
    case 'delete': {
      const t = tables.get(String(m.code || ''));
      if (!t) return sendTables(ws);
      if (t.doc.owner !== ws.uid) return send(ws, { t: 'error', m: 'Only the host can delete this table.' });
      t.stop();
      tables.delete(t.doc.code);
      const affected = new Set(t.indexEntry().uids);
      for (const s of t.subs) { s.table = null; send(s, { t: 'missing', code: t.doc.code }); }
      for (const s of sockets) if (s.lobby && affected.has(s.uid)) sendTables(s);
      dirty = true;
      return;
    }
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  ws.uid = null; ws.table = null; ws.lobby = false; ws.alive = true;
  ws.bucket = 40; ws.last = Date.now(); ws.warned = false;
  sockets.add(ws);
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    // token bucket: about 20 messages a second, bursts of 40
    const now = Date.now();
    ws.bucket = Math.min(40, ws.bucket + (now - ws.last) / 50); ws.last = now;
    if (ws.bucket < 1) { if (!ws.warned) { ws.warned = true; send(ws, { t: 'error', m: 'Slow down a little.' }); } return; }
    ws.bucket -= 1; ws.warned = false;
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    try { handle(ws, m); } catch (e) { console.error('handler error', e); }
  });
  ws.on('close', () => { sockets.delete(ws); unsubscribe(ws); });
  ws.on('error', () => { });
});

/* heartbeats, timers, cleanup, persistence */
setInterval(() => { for (const ws of sockets) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch (e) { } } }, 30000);
setInterval(() => { for (const t of tables.values()) { try { t.tick(); } catch (e) { console.error('tick', e); } } }, 1000);
setInterval(() => {
  const now = Date.now();
  for (const [code, t] of tables) {
    if (t.subs.size) continue;
    const age = now - t.doc.updatedAt;
    const limit = t.doc.status === 'playing' ? 48 * 3600e3 : 8 * 3600e3;
    if (age > limit) { t.stop(); tables.delete(code); dirty = true; }
  }
}, 10 * 60 * 1000);

function save() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...tables.values()].map(t => t.doc)));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error('save failed', e.message); }
}
function load() {
  try {
    const docs = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const d of docs) { const t = Table.restore(d, hooks); tables.set(d.code, t); t.scheduleBots(); }
    console.log('restored', tables.size, 'tables');
  } catch (e) { /* first start */ }
}
setInterval(save, 5000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { save(); process.exit(0); });

load();
server.listen(PORT, () => console.log('Hexstead running on http://localhost:' + PORT));
