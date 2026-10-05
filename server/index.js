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
  '/audio.js': ['public/audio.js', JS],
  '/ui-board.js': ['public/ui-board.js', JS],
  '/fx.js': ['public/fx.js', JS],
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
const createdBy = new Map(); // network address -> times tables were opened, to stop one visitor filling the server
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
  const wasHere = t.online().has(ws.uid);
  ws.table = t;
  t.subs.add(ws);
  if (wasHere) send(ws, { t: 'state', doc: t.viewFor(ws.uid), now: Date.now() }); // reopening: only they need the state
  else hooks.broadcast(t); // someone new: everyone's "online" dots change
  t.scheduleBots();
}
function unsubscribe(ws) {
  const t = ws.table;
  if (!t) return;
  t.subs.delete(ws);
  ws.table = null;
  if (!t.online().has(ws.uid)) { hooks.broadcast(t); t.userLeft(ws.uid); }
}
/* ---------------- chat translation (fallback when the browser can't reach the service itself) ---------------- */
const TR_URL = process.env.TRANSLATE_URL || 'https://api.mymemory.translated.net/get';
const trCache = new Map();
const trUse = new Map(); // uid -> recent request times
let trInFlight = 0, trWindow = [];
function trAllowed(uid) {
  const now = Date.now();
  trWindow = trWindow.filter(x => now - x < 10 * 60e3);
  if (trWindow.length >= 400 || trInFlight >= 8) return false; // the whole server's share of the free service
  const mine = (trUse.get(uid) || []).filter(x => now - x < 60e3);
  if (mine.length >= 15) return false;
  mine.push(now); trUse.set(uid, mine); trWindow.push(now);
  if (trUse.size > 5000) trUse.clear();
  return true;
}
const decodeEntities = t => String(t).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
async function translate(text, to, from) {
  const key = (from || '') + '>' + to + '|' + text;
  if (trCache.has(key)) return trCache.get(key);
  let url = TR_URL + '?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent((from || 'autodetect') + '|' + to);
  if (process.env.MYMEMORY_EMAIL) url += '&de=' + encodeURIComponent(process.env.MYMEMORY_EMAIL);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  let j;
  try { j = await (await fetch(url, { signal: ctl.signal })).json(); } finally { clearTimeout(timer); }
  const d = (j && j.responseData) || {};
  const status = Number(j && j.responseStatus);
  let out;
  if (status === 403 && /DISTINCT LANGUAGES/i.test(String(j.responseDetails || d.translatedText))) out = { same: true };
  else if ((j && j.quotaFinished === true) || status !== 200 || !d.translatedText || /^MYMEMORY WARNING/i.test(d.translatedText)) out = { err: (j && j.quotaFinished === true) || /QUOTA|ALL AVAILABLE FREE/i.test(String(d.translatedText) + j.responseDetails) ? 'quota' : 'failed' };
  else if (decodeEntities(d.translatedText).trim().toLowerCase() === text.trim().toLowerCase()) out = { same: true };
  else out = { text: decodeEntities(d.translatedText).slice(0, 400), from: String(d.detectedLanguage || from || '').slice(0, 12) };
  if (!out.err) { trCache.set(key, out); if (trCache.size > 2000) trCache.delete(trCache.keys().next().value); }
  return out;
}

function uidOf(token) { return 'p_' + crypto.createHash('sha256').update('hexstead:' + token).digest('hex').slice(0, 20); }
const cleanNick = n => String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 18);

function handle(ws, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t !== 'hello' && m.t !== 'ping' && !ws.uid) return send(ws, { t: 'error', m: 'Say hello first.' });
  switch (m.t) {
    case 'hello': {
      if (typeof m.token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(m.token)) return send(ws, { t: 'error', m: 'Bad session token.' });
      if (ws.uid && ws.uid !== uidOf(m.token)) return send(ws, { t: 'error', m: 'This connection already has a player.' });
      ws.uid = uidOf(m.token);
      send(ws, { t: 'welcome', uid: ws.uid });
      if (ws.lobby) sendTables(ws);
      return;
    }
    case 'ping': return send(ws, { t: 'pong', now: Date.now() });
    case 'lobby': ws.lobby = !!m.on; if (ws.lobby) sendTables(ws); return;
    case 'create': {
      if (tables.size >= MAX_TABLES) return send(ws, { t: 'error', m: 'The server is full right now. Try again later.' });
      const ipNow = Date.now();
      const made = (createdBy.get(ws.ip) || []).filter(x => ipNow - x < 3600e3);
      if (made.length >= 40) return send(ws, { t: 'error', m: 'Too many new tables from your connection. Try again in a while.' });
      made.push(ipNow); createdBy.set(ws.ip, made);
      if (createdBy.size > 20000) createdBy.clear();
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
    case 'translate': {
      const id = String(m.id || '').slice(0, 40);
      const text = String(m.text || '').trim().slice(0, 200);
      const to = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(m.to) ? m.to : 'en';
      const from = /^[a-z]{2,3}$/.test(m.from) ? m.from : '';
      if (!text) return send(ws, { t: 'translated', id, err: 'failed' });
      if (!ws.table || !ws.table.doc.chat.some(c => c.text === text)) return send(ws, { t: 'translated', id, err: 'failed' }); // only messages from your table's chat
      const key = from + '>' + to + '|' + text;
      if (!trCache.has(key) && !trAllowed(ws.uid)) return send(ws, { t: 'translated', id, err: 'busy' });
      trInFlight++;
      translate(text, to, from).then(r => send(ws, Object.assign({ t: 'translated', id }, r)), () => send(ws, { t: 'translated', id, err: 'failed' })).finally(() => { trInFlight--; });
      return;
    }
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
wss.on('connection', (ws, req) => {
  const fwd = String((req && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  ws.ip = fwd || (req && req.socket && req.socket.remoteAddress) || '?';
  ws.uid = null; ws.table = null; ws.lobby = false; ws.alive = true;
  ws.bucket = 40; ws.last = Date.now(); ws.warned = false;
  sockets.add(ws);
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    // token bucket: about 20 messages a second, bursts of 40
    const now = Date.now();
    ws.bucket = Math.min(40, ws.bucket + (now - ws.last) / 50); ws.last = now;
    if (ws.bucket < 1) {
      if (!ws.warned) { ws.warned = true; send(ws, { t: 'error', m: 'Slow down a little.' }); }
      // a dropped move must be refused out loud, or the page keeps showing it as done
      try { const m = JSON.parse(raw.toString()); if (m && m.t === 'act' && Number.isFinite(m.s)) send(ws, { t: 'rej', code: String(m.code || ''), s: m.s, m: '' }); } catch (e) { }
      return;
    }
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
    const now = Date.now();
    fs.writeFileSync(tmp, JSON.stringify([...tables.values()].map(t => Object.assign({}, t.doc, { savedAt: now }))));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { dirty = true; console.error('save failed', e.message); } // try again next time
}
function load() {
  let raw;
  try { raw = fs.readFileSync(DATA_FILE, 'utf8'); } catch (e) { return; } // first start
  let docs;
  try { docs = JSON.parse(raw); if (!Array.isArray(docs)) throw new Error('not a list'); }
  catch (e) {
    // keep the damaged file instead of overwriting it with an empty server
    const bad = DATA_FILE + '.bad-' + Date.now();
    try { fs.renameSync(DATA_FILE, bad); } catch (e2) { }
    console.error('could not read saved tables (' + e.message + '); kept it as', bad);
    return;
  }
  for (const d of docs) {
    try { if (!d || !d.code || tables.has(d.code)) continue; const t = Table.restore(d, hooks); tables.set(d.code, t); t.scheduleBots(); }
    catch (e) { console.error('skipped a saved table', e.message); }
  }
  console.log('restored', tables.size, 'tables');
}
setInterval(save, 5000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { save(); process.exit(0); });

process.on('uncaughtException', e => { console.error('uncaught', e); });
process.on('unhandledRejection', e => { console.error('unhandled rejection', e); });
load();
server.listen(PORT, () => console.log('Hexstead running on http://localhost:' + PORT));
