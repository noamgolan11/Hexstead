/* ============================================================
   HEXSTEAD CLIENT NET — talks to the game server over a WebSocket.
   The server owns every online table. Practice games run locally.
   ============================================================ */
const HEXSTEAD_VERSION = '2.2.1';
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
const META_ACTS = new Set(['join', 'leave', 'nick', 'color', 'addBot', 'botLevel', 'kick', 'settings', 'start', 'chat', 'rematch', 'autoplay', 'emote']);
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
    case 'welcome': app.me.uid = m.uid; app.serverTranslates = m.tr === 'server'; render(); return;
    case 'tables': app.lobbyList = m.list || []; if (app.view === 'home') renderHomeTables(); return;
    case 'created':
      if (app.wantCreate) { app.wantCreate = false; enterOnline(m.code, true); }
      return;
    case 'state': {
      const d = m.doc;
      if (!g || g.local || !d || d.code !== g.code) return;
      g.doc = d; g.missing = false;
      g.online = new Set(d.online || []);
      if (Number.isFinite(m.now)) g.skew = m.now - Date.now(); // server clock minus ours, for turn timers
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
    case 'translated': { const f = trWaiting.get(m.id); if (f) { trWaiting.delete(m.id); f(m); } return; }
    case 'pong': if (Number.isFinite(m.now) && app.g && !app.g.local) app.g.skew = m.now - Date.now(); return;
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
    doc.seats.push({ uid: null, bot: true, nick: names[i], color: c.id, level: Bot.LEVELS.includes(opts.level) ? opts.level : 'normal' });
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
  g.lastSeq = Math.max(g.lastSeq, ap); // next move numbers stay above what the server has seen, even if this clock is behind
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

/* ---------------- chat translation ----------------
   Tried in order, so a used-up allowance in one place doesn't stop translation:
   1. the browser's own built-in translator, when it has one (recent desktop Chrome): free, private, no limits;
   2. the free MyMemory service, asked directly by this browser (an allowance per internet connection);
   3. the game server asking MyMemory on the browser's behalf (the server's own allowance). */
const TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
const trWaiting = new Map();
const trMods = {};
let trDetector = null;
// scripts that give the language away (automatic detection mistakes short Hebrew for Yiddish, for example)
const SCRIPT_LANGS = [[/[֐-׿]/, 'he'], [/[؀-ۿ]/, 'ar'], [/[぀-ヿ]/, 'ja'], [/[가-힯]/, 'ko'], [/[一-鿿]/, 'zh'], [/[฀-๿]/, 'th'], [/[Ͱ-Ͽ]/, 'el']];
// built-in browser features can stall (some browsers never answer); never wait on them for long
function soon(promise, ms) { return Promise.race([Promise.resolve(promise).catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]); }
async function detectLang(text) {
  for (const [re, l] of SCRIPT_LANGS) if (re.test(text)) return l;
  try {
    if (typeof LanguageDetector !== 'undefined' && (await soon(LanguageDetector.availability(), 1500)) === 'available') {
      trDetector = trDetector || await soon(LanguageDetector.create(), 2000);
      const r = trDetector && ((await soon(trDetector.detect(text), 1500)) || [])[0];
      if (r && r.detectedLanguage && r.detectedLanguage !== 'und' && r.confidence >= 0.3) return r.detectedLanguage.split('-')[0];
    }
  } catch (e) { }
  return null;
}
async function builtInTranslate(text, from, to) {
  if (!from || typeof Translator === 'undefined') return null;
  try {
    const key = from + '>' + to;
    const av = await soon(Translator.availability({ sourceLanguage: from, targetLanguage: to }), 1500);
    if (!av || av === 'unavailable') return null;
    if (!trMods[key]) trMods[key] = Translator.create({ sourceLanguage: from, targetLanguage: to }).catch(() => { delete trMods[key]; return null; });
    if (av !== 'available') return null; // its language pack is downloading in the background; use it next time
    const t = await soon(trMods[key], 3000);
    if (!t) return null;
    const out = await soon(t.translate(text), 5000);
    return out ? { text: String(out).slice(0, 400), from } : null;
  } catch (e) { return null; }
}
function parseTranslation(j, text) {
  const d = (j && j.responseData) || {};
  const status = Number(j && j.responseStatus);
  if (status === 403 && /DISTINCT LANGUAGES/i.test(String(j.responseDetails || d.translatedText))) return { same: true };
  if (j && j.quotaFinished === true) return { err: 'quota' };
  if (status !== 200 || !d.translatedText || /^MYMEMORY WARNING/i.test(d.translatedText)) return { err: /QUOTA|ALL AVAILABLE FREE/i.test(String(d.translatedText) + j.responseDetails) ? 'quota' : 'failed' };
  const tmp = document.createElement('textarea'); tmp.innerHTML = d.translatedText; // decodes &#39; and friends; never inserted into the page
  if (text && tmp.value.trim().toLowerCase() === text.trim().toLowerCase()) return { same: true };
  return { text: tmp.value.slice(0, 400), from: String(d.detectedLanguage || '').slice(0, 12) };
}
function viaServer(text, to, from) {
  if (!onlineReady()) return Promise.resolve({ err: 'failed' });
  return new Promise(resolve => {
    const id = randId(12);
    const timer = setTimeout(() => { trWaiting.delete(id); resolve({ err: 'failed' }); }, 12000);
    trWaiting.set(id, m => { clearTimeout(timer); resolve(m); });
    wsSend({ t: 'translate', id, text, to, from: from || '' });
  });
}
async function translateText(text, to) {
  const from = await detectLang(text);
  if (from === to) return { same: true };
  const own = await builtInTranslate(text, from, to);
  if (own) return own;
  if (app.serverTranslates) { const first = await viaServer(text, to, from); if (!first.err) return first; } // the site has its own translator set up
  let sawQuota = false;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(TRANSLATE_URL + '?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent((from || 'autodetect') + '|' + to), { signal: ctl.signal });
    clearTimeout(timer);
    const out = parseTranslation(await r.json(), text);
    if (!out.err) return from && !out.from ? Object.assign(out, { from }) : out;
    if (out.err === 'quota') sawQuota = true;
  } catch (e) { /* blocked or offline */ }
  const srv = await viaServer(text, to, from); // a different connection, with its own allowance
  if (!srv.err) return srv;
  return { err: sawQuota || srv.err === 'quota' ? 'quota' : srv.err };
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
    this.tradeSeen = { id: null, at: 0 };
  }
  stop() { this.stopped = true; clearTimeout(this.botTimer); }
  submit(uid, a) {
    try {
      const d = this.doc;
      if (a.t === 'emote') { // emotes work in practice too; the bots might answer a "good game"
        const q = Quick.clean(a);
        if (!q) return { ok: false, err: 'Unknown emote.' };
        this.pushEmote(Object.assign({ uid: 'me' }, q));
        if (q.q === 'gg' && d.status === 'ended') d.game.players.forEach((pl, i) => { if (pl.bot && rng() < 0.5) setTimeout(() => { this.pushEmote({ p: i, q: 'gg' }); this.changed(true); }, 700 + Math.floor(rng() * 1600)); });
        this.changed(true);
        return { ok: true };
      }
      if (a.t === 'chat' || META_ACTS.has(a.t)) return { ok: false, err: 'Not available in practice games.' };
      if (d.status !== 'playing') return { ok: false, err: 'The game is over.' };
      const prev = d.game;
      d.game = Engine.apply(d.game, 0 + d.game.players.findIndex(p => p.uid === 'me'), a, rng);
      this.botReact(prev, d.game);
      this.changed();
      return { ok: true };
    } catch (e) { if (!e.rule) console.warn(e); return { ok: false, err: e.rule ? e.message : 'Something went wrong with that move.' }; }
  }
  pushEmote(x) {
    const d = this.doc;
    d.emoteN = (d.emoteN || 0) + 1;
    d.emotes = (d.emotes || []).concat([Object.assign({ n: d.emoteN, at: Date.now() }, x)]).slice(-20);
  }
  botReact(prev, next) {
    const now = Date.now();
    this.botEmoteAt = this.botEmoteAt || {};
    for (const r of Quick.reactions(prev, next, rng)) {
      if (now - (this.botEmoteAt[r.p] || 0) < 6000) continue;
      this.botEmoteAt[r.p] = now;
      this.pushEmote({ p: r.p, e: r.e });
    }
  }
  changed(onlyShow) {
    if (onlyShow) { if (!this.stopped || this.doc.status === 'ended') { this.g.view = this.doc; render(); } return; }
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
    let delay = s.phase === 'setup' ? 850 : s.phase === 'roll' ? 750 : s.trade ? 1100 : 650;
    if (s.trade && s.trade.drafting && Object.keys(s.trade.drafting).some(i => s.players[+i].bot)) delay = 1900;
    this.botTimer = setTimeout(() => this.runBot(), delay);
  }
  runBot() {
    if (this.stopped) return;
    const d = this.doc, s = d.game;
    if (!s || d.status !== 'playing') return;
    const actors = this.botActors(s);
    if (!actors.length) return;
    if (s.trade && s.trade.id !== this.tradeSeen.id) this.tradeSeen = { id: s.trade.id, at: Date.now() };
    const tradeAge = s.trade ? Date.now() - this.tradeSeen.at : 0;
    for (const p of actors) {
      const view = Engine.redact(s, p); // bots only see what a person in their seat would
      let a = null;
      try { a = Bot.decide(view, p, rng, { tradeAge }); } catch (e) { console.warn('bot', e); a = undefined; }
      if (a === null) continue; // a bot waiting for answers to its offer
      let auto = null;
      try { auto = Bot.decide(view, p, rng, { autopilot: true }); } catch (e) { }
      // if the bot's choice is refused, fall back to simple moves so the game can't get stuck
      const tries = [a, auto, { t: 'cancel' }, { t: 'roll' }, { t: 'skipRoads' }, { t: 'pass' }, { t: 'end' }].filter(Boolean);
      let ok = false;
      for (const t of tries) { try { d.game = Engine.apply(s, p, t, rng); ok = true; break; } catch (e) { } }
      if (!ok) { console.warn('bot stuck', s.phase); continue; }
      this.botReact(s, d.game);
      this.changed();
      return;
    }
    clearTimeout(this.botTimer);
    this.botTimer = setTimeout(() => this.runBot(), 1500);
  }
}
