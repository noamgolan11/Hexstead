/* ============================================================
   HEXSTEAD CLIENT NET — talks to the game server over a WebSocket.
   The server owns every online table. Practice games run locally.
   ============================================================ */
const COLORS = [
  { id: 'red', name: 'Crimson', hex: '#d8463b' },
  { id: 'blue', name: 'Cobalt', hex: '#3b78e0' },
  { id: 'orange', name: 'Amber', hex: '#ef8f2f' },
  { id: 'white', name: 'Ivory', hex: '#f1ece0' },
  { id: 'green', name: 'Jade', hex: '#41a85e' },
  { id: 'purple', name: 'Plum', hex: '#9b5fd3' },
];
const COLOR_HEX = Object.fromEntries(COLORS.map(c => [c.id, c.hex]));
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dov', 'Esme', 'Finn', 'Gus', 'Hana'];
const META_ACTS = new Set(['join', 'leave', 'nick', 'color', 'addBot', 'kick', 'settings', 'start', 'chat', 'rematch', 'autoplay']);
// actions whose result depends on dice, hidden cards or other players' hands: never predicted locally
const RANDOM_ACTS = new Set(['roll', 'buyDev', 'steal', 'robber', 'confirm']);

function rng() {
  if (window.crypto && crypto.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
  return Math.random();
}
function randId(n) { let s = ''; for (let i = 0; i < (n || 10); i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rng() * 36)]; return s; }
function deep(x) { return JSON.parse(JSON.stringify(x)); }
function clampInt(v, lo, hi, d) { v = Number(v); if (!Number.isFinite(v)) return d; return Math.max(lo, Math.min(hi, Math.round(v))); }
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

const app = {
  me: { uid: null, name: store('hexstead.name') || '', token: null },
  conn: { ws: null, state: 'connecting', tries: 0 },
  names: {},
  view: 'home',
  lobbyList: [],
  g: null,
  ui: { mode: null, modal: null, tab: 'log', draft: null, seenChat: 0 },
};
(function initToken() {
  let t = store('hexstead.token');
  if (!t || !/^[A-Za-z0-9_-]{16,64}$/.test(t)) { t = randId(32); store('hexstead.token', t); }
  app.me.token = t;
})();
function setMyName(n) { app.me.name = String(n || '').trim().slice(0, 18); store('hexstead.name', app.me.name); }

/* ---------------- connection ---------------- */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  let ws;
  try { ws = new WebSocket(proto + location.host + '/ws'); } catch (e) { scheduleReconnect(); return; }
  app.conn.ws = ws;
  app.conn.state = 'connecting';
  ws.onopen = () => {
    app.conn.state = 'open'; app.conn.tries = 0;
    wsSend({ t: 'hello', token: app.me.token });
    wsSend({ t: 'lobby', on: true });
    const g = app.g;
    if (g && !g.local) {
      wsSend({ t: 'open', code: g.code });
      for (const it of g.pending) wsSend({ t: 'act', code: g.code, s: it.s, a: it.a });
    }
    render();
  };
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMessage(m); };
  ws.onclose = () => { if (app.conn.ws === ws) { app.conn.state = 'closed'; render(); scheduleReconnect(); } };
  ws.onerror = () => { };
}
function scheduleReconnect() {
  const n = ++app.conn.tries;
  setTimeout(connect, Math.min(10000, 600 * Math.pow(1.7, n)));
}
function wsSend(m) {
  const ws = app.conn.ws;
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
  return false;
}
setInterval(() => wsSend({ t: 'ping' }), 25000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.conn.state === 'closed') { app.conn.tries = 0; connect(); }
});

function onlineReady() { return app.conn.state === 'open' && !!app.me.uid; }

function onMessage(m) {
  const g = app.g;
  switch (m.t) {
    case 'welcome': app.me.uid = m.uid; render(); return;
    case 'tables': app.lobbyList = m.list || []; if (app.view === 'home') renderHomeTables(); return;
    case 'created':
      if (app.wantCreate) { app.wantCreate = false; enterOnline(m.code, true); }
      return;
    case 'state': {
      const d = m.doc;
      if (!g || g.local || !d || d.code !== g.code) return;
      g.doc = d; g.missing = false;
      g.online = new Set(d.online || []);
      onRemoteDoc(g);
      return;
    }
    case 'missing':
      if (g && !g.local && g.code === m.code) { g.missing = true; g.doc = null; g.view = null; render(); }
      return;
    case 'rej': {
      if (g && !g.local && g.code === m.code) {
        g.pending = g.pending.filter(i => i.s !== m.s);
        if (m.m) toast(m.m, 'error');
        refreshView(g); render();
      }
      return;
    }
    case 'error': toast(m.m || 'Something went wrong.', 'error'); return;
  }
}

/* ---------------- sessions ---------------- */
function newSession(code, local) {
  return { code, local, doc: null, view: null, host: null, pending: [], lastSeq: 0, sentAt: 0, online: new Set(), missing: false };
}
function closeSession() {
  const g = app.g;
  if (!g) return;
  if (g.host) g.host.stop();
  if (!g.local) wsSend({ t: 'close' });
  app.g = null;
  app.ui.mode = null; app.ui.modal = null; app.ui.draft = null;
}
function emptyDoc(code, owner) {
  const now = Date.now();
  return { v: 1, code, status: 'lobby', owner, createdAt: now, updatedAt: now, settings: Object.assign({}, Engine.DEFAULT_SETTINGS), seats: [], chat: [], applied: {}, game: null };
}
function createTable(nick) {
  if (!onlineReady()) { toast('Not connected to the server yet.', 'error'); return; }
  app.wantCreate = true;
  wsSend({ t: 'create', nick });
}
function enterOnline(code) {
  closeSession();
  const g = newSession(code, false);
  app.g = g;
  app.view = 'room';
  setHash(code);
  wsSend({ t: 'open', code });
  render();
}
function openTable(code) {
  code = String(code || '').toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) { toast('Table codes are 5 letters or digits.', 'error'); return; }
  enterOnline(code);
}
function deleteTable(code) { wsSend({ t: 'delete', code }); toast('Table ' + code + ' deleted.'); }

function startPractice(opts) {
  closeSession();
  const g = newSession('LOCAL', true);
  app.g = g;
  const doc = emptyDoc('LOCAL', 'me');
  doc.settings = Object.assign({}, Engine.DEFAULT_SETTINGS, opts.settings || {});
  doc.seats.push({ uid: 'me', bot: false, nick: app.me.name || 'You', color: opts.color || 'red' });
  const used = new Set([doc.seats[0].color]);
  const names = Engine.shuffle(BOT_NAMES.slice(), rng);
  for (let i = 0; i < opts.bots; i++) {
    const c = COLORS.find(c => !used.has(c.id)); used.add(c.id);
    doc.seats.push({ uid: null, bot: true, nick: names[i], color: c.id });
  }
  g.doc = doc;
  g.host = new LocalHost(g);
  g.host.doc.game = Engine.newGame({ players: doc.seats, settings: doc.settings }, rng);
  g.host.doc.status = 'playing';
  g.host.doc.startedAt = Date.now();
  g.host.changed();
  app.view = 'room';
  setHash('');
  render();
}

function onRemoteDoc(g) {
  const d = g.doc;
  const ap = (d.applied || {})[app.me.uid] || 0;
  g.pending = g.pending.filter(i => i.s > ap);
  if (d.updatedAt) { const sk = d.updatedAt - Date.now(); g.skew = Number.isFinite(g.skew) ? Math.max(g.skew - 50, sk) : sk; }
  refreshView(g);
  render();
}

/* optimistic view: server state + our own deterministic pending actions */
function refreshView(g) {
  const d = g.doc;
  if (!d) { g.view = null; return; }
  if (g.local || !g.pending.length || d.status !== 'playing' || !d.game) { g.view = d; return; }
  const p = myIndexIn(d);
  if (p < 0) { g.view = d; return; }
  let s = d.game;
  const noRng = () => { throw new Error('random'); };
  for (const it of g.pending) {
    const a = it.a;
    if (META_ACTS.has(a.t) || RANDOM_ACTS.has(a.t) || (a.t === 'play' && a.card === 'monopoly')) break;
    try { s = Engine.apply(s, p, a, noRng); } catch (e) { break; }
  }
  g.view = s === d.game ? d : Object.assign({}, d, { game: s });
}

function myUid() { return app.g && app.g.local ? 'me' : app.me.uid; }
function myIndexIn(d) {
  if (!d || !d.game) return -1;
  const uid = myUid();
  return d.game.players.findIndex(p => !p.bot && p.uid === uid);
}

/* ---------------- sending ---------------- */
function send(a) {
  const g = app.g;
  if (!g) return false;
  if (g.local) {
    const r = g.host.submit('me', a);
    if (!r.ok) toast(r.err, 'error');
    return r.ok;
  }
  if (!g.doc) return false;
  // check game moves locally first so mistakes show instantly (trade confirmations depend on hidden hands)
  if (!META_ACTS.has(a.t) && a.t !== 'confirm' && g.view && g.view.game) {
    const p = myIndexIn(g.view);
    try { Engine.apply(g.view.game, p, a, () => 0.5); }
    catch (e) { toast(e.rule ? e.message : 'That move isn\'t possible right now.', 'error'); return false; }
  }
  const s = Math.max(Date.now(), g.lastSeq + 1);
  g.lastSeq = s;
  g.pending.push({ s, a });
  g.sentAt = Date.now();
  wsSend({ t: 'act', code: g.code, s, a });
  refreshView(g);
  render();
  return true;
}

function setHash(code) {
  try { history.replaceState(null, '', code ? '#' + code : location.pathname + location.search); } catch (e) { }
}
function inviteLink(code) { return location.origin + location.pathname + '#' + code; }

/* ============================================================
   LOCAL HOST — practice games against bots in this browser
   ============================================================ */
class LocalHost {
  constructor(g) {
    this.g = g; this.doc = g.doc;
    this.botTimer = null; this.stopped = false;
  }
  stop() { this.stopped = true; clearTimeout(this.botTimer); }
  submit(uid, a) {
    try {
      const d = this.doc;
      if (a.t === 'chat' || META_ACTS.has(a.t)) return { ok: false, err: 'Not available in practice games.' };
      if (d.status !== 'playing') return { ok: false, err: 'The game is over.' };
      d.game = Engine.apply(d.game, 0 + d.game.players.findIndex(p => p.uid === 'me'), a, rng);
      this.changed();
      return { ok: true };
    } catch (e) { if (!e.rule) console.warn(e); return { ok: false, err: e.rule ? e.message : 'Something went wrong with that move.' }; }
  }
  changed() {
    if (this.stopped) return;
    const d = this.doc;
    if (d.game && d.game.phase === 'ended' && d.status === 'playing') { d.status = 'ended'; d.endedAt = Date.now(); }
    d.updatedAt = Date.now();
    this.g.view = d;
    this.scheduleBots();
    render();
  }
  botActors(s) {
    const out = [];
    if (!s || s.phase === 'ended') return out;
    if (s.trade) s.players.forEach((pl, i) => { if (pl.bot && i !== s.trade.from && s.trade.resp[i] === undefined) out.push(i); });
    for (const p of Engine.pendingActors(s)) if (s.players[p].bot && !out.includes(p)) out.push(p);
    return out;
  }
  scheduleBots() {
    clearTimeout(this.botTimer);
    const d = this.doc;
    if (this.stopped || d.status !== 'playing' || !d.game) return;
    const s = d.game;
    if (!this.botActors(s).length) return;
    const delay = s.phase === 'setup' ? 850 : s.phase === 'roll' ? 750 : s.trade ? 1100 : 650;
    this.botTimer = setTimeout(() => this.runBot(), delay);
  }
  runBot() {
    if (this.stopped) return;
    const d = this.doc, s = d.game;
    if (!s || d.status !== 'playing') return;
    const actors = this.botActors(s);
    if (!actors.length) return;
    const p = actors[0];
    const a = Bot.decide(s, p, rng);
    if (!a) return;
    try { d.game = Engine.apply(s, p, a, rng); }
    catch (e) {
      const b = Bot.decide(s, p, rng, { autopilot: true });
      try { d.game = Engine.apply(s, p, b, rng); } catch (e2) { console.warn('bot stuck', a, b, e2); return; }
    }
    this.changed();
  }
}
