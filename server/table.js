/* One table: the authoritative copy of a game, its seats, chat and bots. */
const crypto = require('crypto');
const Engine = require('../shared/engine.js');
const Bot = require('../shared/bot.js');

const COLORS = ['red', 'blue', 'orange', 'white', 'green', 'purple'];
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dov', 'Esme', 'Finn', 'Gus', 'Hana'];

function rng() { return crypto.randomInt(0, 2 ** 32) / 2 ** 32; }
function clampInt(v, lo, hi, d) { v = Number(v); if (!Number.isFinite(v)) return d; return Math.max(lo, Math.min(hi, Math.round(v))); }
function ruleError(m) { const e = new Error(m); e.rule = true; return e; }
const cleanNick = n => String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 18);

class Table {
  constructor(code, ownerUid, hooks) {
    const now = Date.now();
    this.hooks = hooks; // { broadcast(table), indexChanged(table), dirty() }
    this.doc = {
      v: 1, code, status: 'lobby', owner: ownerUid, createdAt: now, updatedAt: now,
      settings: Object.assign({}, Engine.DEFAULT_SETTINGS),
      seats: [], chat: [], applied: {}, game: null,
    };
    this.subs = new Set();      // sockets watching this table
    this.botTimer = null;
    this.deadlineKey = '';
  }
  static restore(doc, hooks) {
    const t = new Table(doc.code, doc.owner, hooks);
    t.doc = doc;
    return t;
  }

  online() { const s = new Set(); for (const ws of this.subs) if (ws.uid) s.add(ws.uid); return s; }
  ownerHere() { return this.online().has(this.doc.owner); }
  canManage(uid) {
    const d = this.doc;
    if (uid === d.owner) return true;
    // if the owner is away, any seated person who is here can run the table
    return !this.ownerHere() && d.seats.some(s => !s.bot && s.uid === uid);
  }

  /* apply one action from a person; throws rule errors */
  apply(uid, a) {
    const d = this.doc;
    const fail = m => { throw ruleError(m); };
    const seatOf = u => d.seats.findIndex(s => !s.bot && s.uid === u);
    const freeColor = () => COLORS.find(c => !d.seats.some(s => s.color === c)) || COLORS[0];
    if (!a || typeof a.t !== 'string') fail('Unknown action.');
    switch (a.t) {
      case 'chat': {
        const text = String(a.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
        if (!text) fail('Empty message.');
        d.chat.push({ uid, text, at: Date.now() });
        if (d.chat.length > 80) d.chat.splice(0, d.chat.length - 80);
        return;
      }
      case 'join': {
        if (d.status !== 'lobby') fail('This game has already started.');
        if (seatOf(uid) >= 0) return;
        if (d.seats.length >= d.settings.maxPlayers) fail('The table is full.');
        const color = COLORS.includes(a.color) && !d.seats.some(s => s.color === a.color) ? a.color : freeColor();
        d.seats.push({ uid, bot: false, nick: cleanNick(a.nick) || 'Player ' + (d.seats.length + 1), color });
        return;
      }
      case 'leave': {
        if (d.status !== 'lobby') fail('You can\'t leave a game in progress.');
        if (uid === d.owner) fail('The host can\'t leave. Delete the table instead.');
        const i = seatOf(uid); if (i >= 0) d.seats.splice(i, 1);
        return;
      }
      case 'nick': {
        const i = seatOf(uid); if (i < 0) fail('Take a seat first.');
        const n = cleanNick(a.nick); if (!n) fail('Pick a name.');
        d.seats[i].nick = n;
        if (d.game) for (const p of d.game.players) if (!p.bot && p.uid === uid) p.nick = n;
        return;
      }
      case 'color': {
        if (d.status !== 'lobby') fail('Colors are locked once the game starts.');
        const i = seatOf(uid); if (i < 0) fail('Take a seat first.');
        if (!COLORS.includes(a.color)) fail('Unknown color.');
        if (d.seats.some((s, j) => j !== i && s.color === a.color)) fail('That color is taken.');
        d.seats[i].color = a.color;
        return;
      }
      case 'addBot': {
        if (!this.canManage(uid)) fail('Only the host can add bots.');
        if (d.status !== 'lobby') fail('The game has started.');
        if (d.seats.length >= d.settings.maxPlayers) fail('The table is full.');
        const used = new Set(d.seats.map(s => s.nick));
        d.seats.push({ uid: null, bot: true, nick: BOT_NAMES.find(n => !used.has(n)) || 'Bot', color: freeColor() });
        return;
      }
      case 'kick': {
        if (!this.canManage(uid)) fail('Only the host can remove players.');
        if (d.status !== 'lobby') fail('The game has started.');
        const i = a.i | 0;
        if (!d.seats[i] || d.seats[i].uid === d.owner) fail('You can\'t remove that seat.');
        d.seats.splice(i, 1);
        return;
      }
      case 'settings': {
        if (!this.canManage(uid)) fail('Only the host can change settings.');
        if (d.status !== 'lobby') fail('The game has started.');
        const x = a.settings || {}, st = d.settings;
        st.vpToWin = clampInt(x.vpToWin ?? st.vpToWin, 5, 20, 10);
        st.discardLimit = clampInt(x.discardLimit ?? st.discardLimit, 5, 15, 7);
        st.friendlyRobber = !!(x.friendlyRobber ?? st.friendlyRobber);
        const tm = Number(x.timer ?? st.timer);
        st.timer = [0, 60, 90, 120, 180, 300].includes(tm) ? tm : 0;
        st.layout = (x.layout ?? st.layout) === 'balanced' ? 'balanced' : 'random';
        const map = Engine.MAPS[x.map] ? x.map : (Engine.MAPS[st.map] ? st.map : 'standard');
        const cap = Engine.MAPS[map].max;
        if (d.seats.length > cap) fail(Engine.MAPS[map].name + ' is for up to ' + cap + ' players. Remove a seat first.');
        st.map = map;
        st.maxPlayers = clampInt(x.maxPlayers ?? st.maxPlayers, Math.max(2, d.seats.length), cap, Math.min(4, cap));
        return;
      }
      case 'start': {
        if (!this.canManage(uid)) fail('Only the host can start the game.');
        if (d.status !== 'lobby') fail('The game has started.');
        if (d.seats.length < 2) fail('You need at least 2 players.');
        d.game = Engine.newGame({ players: d.seats, settings: d.settings }, rng);
        d.game.players.forEach(p => { p.auto = false; });
        d.status = 'playing';
        d.startedAt = Date.now();
        return;
      }
      case 'rematch': {
        if (!this.canManage(uid)) fail('Only the host can start a rematch.');
        if (d.status !== 'ended') fail('The game is still going.');
        d.status = 'lobby'; d.game = null;
        return;
      }
      case 'autoplay': {
        // a bot plays for a seat: the player themselves, or the host for someone who isn't here
        if (d.status !== 'playing') fail('The game isn\'t running.');
        const i = a.i | 0;
        const p = d.game.players[i];
        if (!p || p.bot) fail('No such player.');
        const self = p.uid === uid;
        if (!self && !(this.canManage(uid) && !this.online().has(p.uid))) fail('You can only do that for players who are away.');
        if (!a.on && !self) fail('Only that player can take their seat back.');
        p.auto = !!a.on;
        d.game.log.push({ k: a.on ? 'autoOn' : 'autoOff', p: i, turn: d.game.turn });
        return;
      }
      default: {
        if (d.status !== 'playing' || !d.game) fail('The game hasn\'t started.');
        const p = d.game.players.findIndex(pl => !pl.bot && pl.uid === uid);
        if (p < 0) fail('You\'re watching this game.');
        d.game = Engine.apply(d.game, p, a, rng);
      }
    }
  }

  submit(uid, s, a) {
    const d = this.doc;
    if (typeof s === 'number' && s <= (d.applied[uid] || 0)) return { ok: true, dup: true };
    try {
      this.apply(uid, a);
      if (typeof s === 'number') d.applied[uid] = s;
      this.changed();
      return { ok: true };
    } catch (e) {
      if (typeof s === 'number') d.applied[uid] = s;
      if (!e.rule) console.error('action error', a, e);
      return { ok: false, err: e.rule ? e.message : 'That move wasn\'t accepted.' };
    }
  }

  changed() {
    const d = this.doc;
    if (d.game && d.game.phase === 'ended' && d.status === 'playing') { d.status = 'ended'; d.endedAt = Date.now(); }
    d.updatedAt = Date.now();
    this.updateDeadline();
    this.hooks.broadcast(this);
    this.hooks.indexChanged(this);
    this.hooks.dirty();
    this.scheduleBots();
  }

  /* ---- timers ---- */
  isBotSeat(s, i) { const p = s.players[i]; return p.bot || p.auto; }
  updateDeadline() {
    const d = this.doc, s = d.game;
    if (!s) return;
    if (!d.settings.timer || s.phase === 'ended') { s.deadline = 0; return; }
    const key = [s.phase, s.cur, s.turn, s.setup ? s.setup.i + s.setup.step : '', s.rollId || 0, s.special ? s.special.q.length : ''].join('|');
    if (key !== this.deadlineKey) {
      this.deadlineKey = key;
      const humans = Engine.pendingActors(s).some(p => !this.isBotSeat(s, p));
      s.deadline = humans ? Date.now() + d.settings.timer * 1000 : 0;
    }
  }
  tick() {
    const d = this.doc, s = d.game;
    if (!s || d.status !== 'playing' || !s.deadline || Date.now() < s.deadline + 400) return;
    let changed = false;
    for (let n = 0; n < 6; n++) {
      const st = d.game;
      if (!st.deadline || Date.now() < st.deadline + 400 || st.phase === 'ended') break;
      const humans = Engine.pendingActors(st).filter(p => !this.isBotSeat(st, p));
      if (!humans.length) break;
      const p = humans[0];
      const a = Bot.decide(st, p, rng, { autopilot: true });
      if (!a) break;
      try { d.game = Engine.apply(st, p, a, rng); changed = true; } catch (e) { console.error('autopilot', e); break; }
      if (n === 0) d.game.log.push({ k: 'timeout', p, turn: d.game.turn });
      if (a.t !== 'cancel') break;
    }
    if (changed) { this.deadlineKey = ''; this.changed(); }
  }

  /* ---- bots ---- */
  botActors(s) {
    const out = [];
    if (!s || s.phase === 'ended') return out;
    if (s.trade) s.players.forEach((pl, i) => { if (this.isBotSeat(s, i) && i !== s.trade.from && s.trade.resp[i] === undefined) out.push(i); });
    for (const p of Engine.pendingActors(s)) if (this.isBotSeat(s, p) && !out.includes(p)) out.push(p);
    return out;
  }
  scheduleBots() {
    clearTimeout(this.botTimer);
    const d = this.doc;
    if (d.status !== 'playing' || !d.game) return;
    const s = d.game;
    if (!this.botActors(s).length) return;
    const nobodyWatching = this.subs.size === 0;
    let delay = s.phase === 'setup' ? 850 : s.phase === 'roll' ? 750 : s.trade ? 1100 : 650;
    if (nobodyWatching || s.players.every((p, i) => this.isBotSeat(s, i))) delay = 300;
    this.botTimer = setTimeout(() => this.runBot(), delay);
  }
  runBot() {
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
      try { d.game = Engine.apply(s, p, b, rng); } catch (e2) { console.error('bot stuck', a, b, e2.message); return; }
    }
    this.changed();
  }
  stop() { clearTimeout(this.botTimer); }

  /* ---- what one viewer may see ---- */
  viewFor(uid) {
    const d = this.doc;
    const out = Object.assign({}, d, { online: [...this.online()] });
    if (!d.game) return out;
    const s = d.game;
    if (s.phase === 'ended') return out;
    const me = s.players.findIndex(p => !p.bot && p.uid === uid);
    const g = Object.assign({}, s);
    g.players = s.players.map((p, i) => i === me ? p : Object.assign({}, p, {
      res: Engine.emptyRes(), nCards: Engine.total(p.res), dev: p.dev.map(() => 'hidden'), newDev: {},
    }));
    g.deck = s.deck.map(() => 0);
    g.log = s.log.map(e => {
      if (e.k === 'steal' && e.p !== me && e.q !== me) return Object.assign({}, e, { r: null });
      if (e.k === 'buyDev' && e.p !== me) return Object.assign({}, e, { card: null });
      return e;
    });
    if (g.trade) g.trade = s.trade; // offers are public
    out.game = g;
    return out;
  }

  indexEntry() {
    const d = this.doc;
    return {
      code: d.code, status: d.status, owner: d.owner,
      ownerName: (d.seats.find(s => s.uid === d.owner) || {}).nick || '',
      map: d.settings.map, n: d.seats.length, max: d.settings.maxPlayers, bots: d.seats.filter(s => s.bot).length,
      uids: d.seats.filter(s => s.uid).map(s => s.uid), updatedAt: d.updatedAt,
    };
  }
}

module.exports = { Table, COLORS };
