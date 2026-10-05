/* One table: the authoritative copy of a game, its seats, chat and bots. */
const crypto = require('crypto');
const Engine = require('../shared/engine.js');
const Bot = require('../shared/bot.js');

const COLORS = ['red', 'blue', 'orange', 'white', 'green', 'purple'];
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dov', 'Esme', 'Finn', 'Gus', 'Hana'];

function rng() { return crypto.randomInt(0, 2 ** 32) / 2 ** 32; }
function clampInt(v, lo, hi, d) { v = Number(v); if (!Number.isFinite(v)) return d; return Math.max(lo, Math.min(hi, Math.round(v))); }
const isIndex = (x, n) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < n;
function ruleError(m) { const e = new Error(m); e.rule = true; return e; }
// moves to try when a bot's own choice is refused, so a seat can never get stuck
const FALLBACKS = [{ t: 'cancel' }, { t: 'roll' }, { t: 'skipRoads' }, { t: 'pass' }, { t: 'end' }];
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
    this.tradeSeen = { id: null, at: 0 }; // when the open offer appeared, so bots know how long they've waited
  }
  static restore(doc, hooks) {
    const t = new Table(doc.code, doc.owner, hooks);
    t.doc = doc;
    const s = doc.game;
    if (s) {
      // the server was down for a while: don't count that against whoever's turn it was
      if (s.deadline && doc.savedAt) s.deadline += Math.max(0, Date.now() - doc.savedAt);
      t.deadlineKey = t.deadlineKeyFor(s);
    }
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
        const now = Date.now(), recent = d.chat.filter(c => c.uid === uid && now - c.at < 10000).length;
        if (recent >= 6) fail('Slow down a little.');
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
        const lastBot = [...d.seats].reverse().find(s => s.bot);
        const level = Bot.LEVELS.includes(a.level) ? a.level : (lastBot && lastBot.level) || 'normal';
        d.seats.push({ uid: null, bot: true, nick: BOT_NAMES.find(n => !used.has(n)) || 'Bot', color: freeColor(), level });
        return;
      }
      case 'botLevel': {
        if (!this.canManage(uid)) fail('Only the host can change bots.');
        if (d.status !== 'lobby') fail('The game has started.');
        const seat = isIndex(a.i, d.seats.length) ? d.seats[a.i] : null;
        if (!seat || !seat.bot) fail('That seat isn\'t a bot.');
        if (!Bot.LEVELS.includes(a.level)) fail('Unknown difficulty.');
        seat.level = a.level;
        return;
      }
      case 'kick': {
        if (!this.canManage(uid)) fail('Only the host can remove players.');
        if (d.status !== 'lobby') fail('The game has started.');
        const i = a.i;
        if (!isIndex(i, d.seats.length) || d.seats[i].uid === d.owner) fail('You can\'t remove that seat.');
        d.seats.splice(i, 1);
        return;
      }
      case 'settings': {
        if (!this.canManage(uid)) fail('Only the host can change settings.');
        if (d.status !== 'lobby') fail('The game has started.');
        const x = a.settings && typeof a.settings === 'object' ? a.settings : {}, st = d.settings;
        // check everything first, then change it all at once, so a refused change leaves nothing half-applied
        const map = Engine.hasMap(x.map) ? x.map : (Engine.hasMap(st.map) ? st.map : 'standard');
        const cap = Engine.MAPS[map].max;
        if (d.seats.length > cap) fail(Engine.MAPS[map].name + ' is for up to ' + cap + ' players. Remove a seat first.');
        const tm = Number(x.timer ?? st.timer);
        Object.assign(st, {
          vpToWin: clampInt(x.vpToWin ?? st.vpToWin, 5, 20, 10),
          discardLimit: clampInt(x.discardLimit ?? st.discardLimit, 5, 15, 7),
          friendlyRobber: !!(x.friendlyRobber ?? st.friendlyRobber),
          timer: [0, 60, 90, 120, 180, 300].includes(tm) ? tm : 0,
          layout: (x.layout ?? st.layout) === 'balanced' ? 'balanced' : 'random',
          map,
          maxPlayers: clampInt(x.maxPlayers ?? st.maxPlayers, Math.max(2, d.seats.length), cap, Math.min(4, cap)),
        });
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
        const i = a.i;
        const p = isIndex(i, d.game.players.length) ? d.game.players[i] : null;
        if (!p || p.bot) fail('No such player.');
        const self = p.uid === uid;
        if (!self && !(this.canManage(uid) && !this.online().has(p.uid))) fail('You can only do that for players who are away.');
        if (!a.on && !self) fail('Only that player can take their seat back.');
        p.auto = !!a.on;
        Engine.addLog(d.game, { k: a.on ? 'autoOn' : 'autoOff', p: i });
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
      // remember the number for people at the table (so a resend isn't applied twice), not for every passer-by
      if (typeof s === 'number' && d.seats.some(x => !x.bot && x.uid === uid)) d.applied[uid] = s;
      if (!e.rule) console.error('action error', a && a.t, e.message);
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
  // a new turn, step or roll gets a fresh clock; so does a seat switching between a person and a bot
  deadlineKeyFor(s) {
    return [s.phase, s.cur, s.turn, s.setup ? s.setup.i + s.setup.step : '', s.rollId || 0, s.special ? s.special.q.length : '', s.players.map(p => (p.auto ? 1 : 0)).join('')].join('|');
  }
  updateDeadline() {
    const d = this.doc, s = d.game;
    if (!s) return;
    if (!d.settings.timer || s.phase === 'ended') { s.deadline = 0; return; }
    const key = this.deadlineKeyFor(s);
    if (key !== this.deadlineKey) {
      this.deadlineKey = key;
      const humans = Engine.pendingActors(s).some(p => !this.isBotSeat(s, p));
      s.deadline = humans ? Date.now() + d.settings.timer * 1000 : 0;
    }
  }
  tick() {
    const d = this.doc, s = d.game;
    if (!s || d.status !== 'playing' || !s.deadline || Date.now() < s.deadline + 400) return;
    // time's up: play out what every late person still owes (their turn, a discard...) so the game moves on
    const late = new Set(Engine.pendingActors(s).filter(p => !this.isBotSeat(s, p)));
    const turn = s.turn, setupI = s.setup ? s.setup.i : -1, logged = new Set();
    let changed = false;
    for (let n = 0; n < 40; n++) {
      const st = d.game;
      if (st.phase === 'ended' || st.turn !== turn || (st.setup ? st.setup.i : -1) !== setupI && setupI >= 0) break; // only what was due when time ran out
      const p = Engine.pendingActors(st).find(q => late.has(q) && !this.isBotSeat(st, q));
      if (p === undefined) break;
      let a = null;
      try { a = Bot.decide(Engine.redact(st, p), p, rng, { autopilot: true }); } catch (e) { console.error('autopilot decide', e.message); }
      const tries = [a, ...FALLBACKS].filter(Boolean);
      let ok = false;
      for (const t of tries) { try { d.game = Engine.apply(st, p, t, rng); ok = true; break; } catch (e) { } }
      if (!ok) { console.error('autopilot stuck', st.phase); break; }
      if (!logged.has(p)) { logged.add(p); Engine.addLog(d.game, { k: 'timeout', p }); }
      changed = true;
    }
    if (changed) this.changed();
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
    const d = this.doc;
    const stopTimer = () => { clearTimeout(this.botTimer); this.botTimer = null; this.botDue = 0; };
    if (d.status !== 'playing' || !d.game) return stopTimer();
    const s = d.game;
    if (!this.botActors(s).length) return stopTimer();
    const nobodyWatching = this.subs.size === 0;
    const allBots = s.players.every((p, i) => this.isBotSeat(s, i));
    if (nobodyWatching && allBots) return stopTimer(); // nobody to play for: wait until someone opens the table
    let delay = s.phase === 'setup' ? 850 : s.phase === 'roll' ? 750 : s.trade ? 1100 : 650;
    if (s.trade && s.trade.drafting && Object.keys(s.trade.drafting).some(i => this.isBotSeat(s, +i))) delay = 1900; // a bot "thinking" about a counter
    if (nobodyWatching || allBots) delay = 300;
    const due = Date.now() + delay;
    if (this.botTimer && this.botDue && this.botDue <= due) return; // a bot move is already coming; chat or visitors must not push it back
    clearTimeout(this.botTimer);
    this.botDue = due;
    this.botTimer = setTimeout(() => { this.botTimer = null; this.botDue = 0; this.runBot(); }, delay);
  }
  later(ms) {
    clearTimeout(this.botTimer);
    this.botDue = Date.now() + ms;
    this.botTimer = setTimeout(() => { this.botTimer = null; this.botDue = 0; this.runBot(); }, ms);
  }
  runBot() {
    const d = this.doc, s = d.game;
    if (!s || d.status !== 'playing') return;
    const actors = this.botActors(s);
    if (!actors.length) return;
    if (s.trade && s.trade.id !== this.tradeSeen.id) this.tradeSeen = { id: s.trade.id, at: Date.now() };
    const tradeAge = s.trade ? Date.now() - this.tradeSeen.at : 0;
    for (const p of actors) {
      const view = Engine.redact(s, p); // bots only see what a person in their seat would
      let a = null;
      try { a = Bot.decide(view, p, rng, { tradeAge }); } catch (e) { console.error('bot decide', e.message); a = undefined; }
      if (a === null) continue; // a bot waiting for answers to its offer
      let auto = null;
      try { auto = Bot.decide(view, p, rng, { autopilot: true }); } catch (e) { }
      const tries = [a, auto, ...FALLBACKS].filter(Boolean);
      let ok = false;
      for (const t of tries) { try { d.game = Engine.apply(s, p, t, rng); ok = true; break; } catch (e) { } }
      if (!ok) { console.error('bot stuck', s.phase, a && a.t); continue; }
      this.changed();
      return;
    }
    // everyone is waiting on people; look again soon so an unanswered offer doesn't hang
    this.later(1500);
  }
  stop() { clearTimeout(this.botTimer); this.botTimer = null; this.botDue = 0; }

  /* someone closed the page: they can't still be writing a counter-offer */
  userLeft(uid) {
    const s = this.doc.game;
    if (!s || !s.trade || !s.trade.drafting || this.online().has(uid)) return;
    const i = s.players.findIndex(p => !p.bot && p.uid === uid);
    if (i >= 0 && s.trade.drafting[i]) { delete s.trade.drafting[i]; this.changed(); }
  }

  /* ---- what one viewer may see ---- */
  viewFor(uid) {
    const d = this.doc;
    const out = Object.assign({}, d, { online: [...this.online()], applied: uid && d.applied[uid] ? { [uid]: d.applied[uid] } : {} });
    delete out.savedAt;
    if (!d.game) return out;
    const s = d.game;
    if (s.phase === 'ended') return out;
    const me = s.players.findIndex(p => !p.bot && p.uid === uid);
    out.game = Engine.redact(s, me);
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
