/* ============================================================
   HEXSTEAD UI — screens, panels, modals, events
   ============================================================ */
app.ui.practice = { bots: 3, vp: 10, layout: 'balanced', friendly: false, dice: 'random' };
const DICE_HELP = 'Balanced dice draw each roll from a shuffled deck of all 36 dice results, so over a game every number comes up about as often as the odds say.';
app.ui.fresh = new Map();
app.ui.prevPieces = null;
app.ui.glowRoll = null;
const LEVEL_NAME = { easy: 'Easy bot', normal: 'Normal bot', hard: 'Hard bot' };
const LEVEL_HELP = { easy: 'Learning the game: so-so spots, rarely trades', normal: 'Plays a solid game and trades when one card short', hard: 'Best spots, trades and counters aggressively, races for Largest Army' };

/* ---------- names ---------- */
function seatName(x) {
  if (!x) return '?';
  if (x.bot) return x.nick || 'Bot';
  if (x.nick) return x.nick;
  if (x.uid && app.names[x.uid]) return app.names[x.uid];
  if (x.uid && x.uid === myUid()) return app.me.name || 'You';
  return 'Player';
}
function pName(s, i) { return seatName(s.players[i]); }
function pTag(s, i) {
  const pl = s.players[i];
  if (!pl) return '?';
  return `<span class="pn" style="color:${COLOR_HEX[pl.color] || '#ccc'}">${esc(seatName(pl))}</span>`;
}
function uidName(d, uid) {
  const seat = (d.seats || []).find(s => s.uid === uid);
  if (seat) return seatName(seat);
  if (uid === myUid()) return app.me.name || 'You';
  return app.names[uid] || 'Guest';
}
function uidColor(d, uid) { const seat = (d.seats || []).find(s => s.uid === uid); return seat ? COLOR_HEX[seat.color] : '#9fb3c3'; }

/* ---------- toasts ---------- */
function toast(msg, kind) {
  const box = $('#toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'error' ? ' error' : '');
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  t.textContent = msg;
  box.appendChild(t);
  Sound.play(kind === 'error' ? 'error' : 'blip');
  setTimeout(() => t.remove(), kind === 'error' ? 4200 : 3000);
  while (box.children.length > 3) box.firstChild.remove();
}
function copyText(text, okMsg) {
  try {
    navigator.clipboard.writeText(text).then(() => toast(okMsg), () => toast('Copy this: ' + text));
  } catch (e) { toast('Copy this: ' + text); }
}

/* ---------- root ---------- */
function mount() {
  const root = $('#app');
  root.innerHTML = ICON_DEFS + '<section id="home" hidden></section><section id="room" hidden></section><div id="modalRoot"></div><div id="toasts" aria-live="polite"></div>';
}
function render() {
  if (!$('#home')) return;
  $('#home').hidden = app.view !== 'home';
  $('#room').hidden = app.view === 'home';
  const vk = app.view + ':' + (app.g ? app.g.code : '');
  if (app.ui.lastView !== vk) { app.ui.lastView = vk; try { window.scrollTo(0, 0); } catch (e) { } }
  if (app.view === 'home') renderHome(); else renderRoom();
  if (app.view === 'room' && app.g && app.g.view && typeof FX !== 'undefined') FX.run(app.g.view); // before pop-ups, so a roll is seen first
  renderModal();
  if (app.view === 'room' && app.g && app.g.view) { gameSounds(app.g.view); if (typeof Emotes !== 'undefined') Emotes.run(app.g.view); }
}

/* ---------- sound: play each new game event once ---------- */
function soundFor(e, me) {
  switch (e.k) {
    case 'start': return ['start', null, 0.4];
    case 'roll': return ['dice', null, 0.55];
    case 'gain': return e.p === me ? ['gain', { res: e.res }, 0.35] : null;
    case 'build': return [e.what === 'road' ? 'road' : e.what === 'city' ? 'city' : 'settlement', { soft: e.p !== me }, 0.18];
    case 'buyDev': return ['card'];
    case 'play': return e.card === 'monopoly' ? null : [e.card === 'knight' ? 'knight' : 'dev', null, 0.25];
    case 'robber': return ['robber', null, 0.35];
    case 'steal': return e.q === me ? ['stolen'] : ['steal', { me: e.p === me }];
    case 'discard': return ['discard'];
    case 'bank': return ['coin'];
    case 'offer': return e.p !== me ? ['offer'] : null;
    case 'counter': return e.q === me ? ['offer'] : null;
    case 'trade': return ['traded'];
    case 'mono': return ['monopoly', null, 0.4];
    case 'lr': case 'la': return ['award', null, 0.4];
    case 'lrLost': return ['lost'];
    case 'turn': return e.p === me ? ['yourTurn', null, 0.3] : ['tock'];
    case 'timeout': return ['alert'];
    case 'autoOn': case 'autoOff': return ['blip'];
    case 'win': return [me < 0 || e.p === me ? 'win' : 'lose'];
  }
  return null;
}
function gameSounds(d) {
  const S = app.ui.snd || (app.ui.snd = {});
  const s = d.game;
  const me = myIndexIn(d);
  const lastChat = (d.chat || [])[(d.chat || []).length - 1];
  const lastId = s && s.log.length ? (s.log[s.log.length - 1].id || 0) : 0;
  if (S.code !== d.code) { // first look at this table: remember where we are, play nothing
    Object.assign(S, { code: d.code, gameKey: d.startedAt, logId: lastId, seats: d.seats.length, chatAt: lastChat ? lastChat.at : 0, trade: '', need: '', special: '' });
    return;
  }
  if (d.seats.length !== S.seats && d.status === 'lobby') Sound.play(d.seats.length > S.seats ? 'join' : 'leave');
  S.seats = d.seats.length;
  if (lastChat && lastChat.at > S.chatAt) { if (lastChat.uid !== myUid()) Sound.play('chat'); S.chatAt = lastChat.at; }
  if (!s) return;
  if (d.startedAt !== S.gameKey) { S.gameKey = d.startedAt; S.logId = 0; } // a new game or rematch: play from its start
  if (lastId < S.logId) S.logId = lastId; // a predicted move was rolled back
  let fresh = s.log.filter(e => e.id && e.id > S.logId);
  if (fresh.length) S.logId = fresh[fresh.length - 1].id;
  if (fresh.length > 10) fresh = fresh.slice(-4); // catching up after a pause: just the latest events
  let delay = 0; const used = {};
  for (const e of fresh) {
    const r = soundFor(e, me);
    if (!r) continue;
    used[r[0]] = (used[r[0]] || 0) + 1;
    if (used[r[0]] > 2) continue;
    Sound.play(r[0], Object.assign({}, r[1] || {}, { delay }));
    delay += r[2] != null ? r[2] : 0.12;
  }
  // replies to my trade offer
  if (s.trade && s.trade.from === me) {
    const prev = S.trade && S.trade.id === s.trade.id ? S.trade.resp : {};
    for (const [q, r] of Object.entries(s.trade.resp)) if (prev[q] === undefined) Sound.play(r === 'decline' ? 'declined' : 'accepted', { delay });
    S.trade = { id: s.trade.id, resp: Object.assign({}, s.trade.resp) };
  } else S.trade = null;
  // things I must do now
  const need = s.phase === 'discard' && Engine.discardNeeded(s, me) ? s.rollId + ':' + s.turn : '';
  if (need && need !== S.need) Sound.play('alert', { delay });
  S.need = need;
  const sp = s.phase === 'special' && s.special && s.special.q[0] === me ? s.turn + ':' + s.special.q.length : '';
  if (sp && sp !== S.special) Sound.play('special', { delay });
  S.special = sp;
}
function soundIcons() {
  const off = Sound.get().muted;
  document.querySelectorAll('[data-act=sound]').forEach(b => { b.innerHTML = ic(off ? 'mute' : 'sound'); b.setAttribute('aria-label', off ? 'Sound is off. Sound settings' : 'Sound settings'); });
}

/* ============================================================
   HOME
   ============================================================ */
function renderHome() {
  const el = $('#home');
  if (!el._built) {
    el._built = true;
    el.innerHTML = `
      <div class="home-tools"><button class="btn small icon" data-act="sound" aria-label="Sound settings">${ic(Sound.get().muted ? 'mute' : 'sound')}</button></div>
      <header class="masthead">
        <div>
          <div class="eyebrow">Settle · Trade · Build</div>
          <h1 class="wordmark">Hex<span>stead</span></h1>
          <p class="tagline">Claim the best corners of the island, trade with your rivals, and be the first to reach the winning score.</p>
        </div>
        <div class="hero-board" id="hero" aria-hidden="true"></div>
      </header>
      <div class="home-grid">
        <section class="card">
          <h2>Play with friends</h2>
          <p class="sub">Open a table, send your friends the link, and start when everyone has a seat. No accounts needed.</p>
          <div class="field" style="margin-bottom:12px;max-width:320px"><label for="homeName">Your name</label><input class="input" id="homeName" maxlength="18" placeholder="What should others call you?" autocomplete="nickname"></div>
          <div class="row">
            <button class="btn primary big" data-act="create" id="createBtn">Open a table</button>
            <form class="row" id="joinForm" autocomplete="off">
              <input class="input code" id="joinCode" maxlength="5" placeholder="CODE" aria-label="Table code" spellcheck="false">
              <button class="btn big" type="submit" id="joinBtn">Join</button>
            </form>
          </div>
          <div class="status-line" id="netStatus"></div>
          <div class="eyebrow" style="margin-top:20px">Your tables</div>
          <div class="tables" id="tables"></div>
        </section>
        <section class="card">
          <h2>Practice</h2>
          <p class="sub">A full game against bots on this device. Nothing is saved.</p>
          <div id="practiceOpts"></div>
          <button class="btn primary big" data-act="practice" style="margin-top:6px">Start practice game</button>
        </section>
      </div>
      <details class="howto card"><summary>How to play</summary>${rulesHTML()}</details>
      <p class="note" style="text-align:center;margin-top:18px">Hexstead v${HEXSTEAD_VERSION}</p>`;
    $('#joinForm').addEventListener('submit', e => {
      e.preventDefault();
      const c = $('#joinCode').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{5}$/.test(c)) { toast('Table codes are 5 letters or digits.', 'error'); return; }
      openTable(c);
    });
    const hn = $('#homeName');
    hn.value = app.me.name;
    hn.addEventListener('input', () => setMyName(hn.value));
    drawHero();
  }
  renderHomeStatus();
  renderHomeTables();
  renderPractice();
}

function drawHero() {
  try {
    const r = () => Math.random();
    const s = Engine.newGame({ players: [{ color: 'red', bot: true }, { color: 'blue', bot: true }, { color: 'orange', bot: true }, { color: 'white', bot: true }], settings: { layout: 'balanced' } }, r);
    let st = s;
    for (let i = 0; i < 16; i++) { const a = Bot.decide(st, st.cur, r); st = Engine.apply(st, st.cur, a, r); }
    const b = boardSVG(st, {});
    $('#hero').innerHTML = `<svg viewBox="${b.vb}">${b.body}</svg>`;
  } catch (e) { console.warn(e); }
}

function renderHomeStatus() {
  const el = $('#netStatus'); if (!el) return;
  let html, can = false;
  if (onlineReady()) { can = true; html = '<span class="dot on"></span> Connected to the game server'; }
  else if (app.conn.state === 'closed') html = '<span class="dot"></span> Can\'t reach the game server. Retrying… (practice mode still works)';
  else html = '<span class="dot"></span> Connecting to the game server… (a sleeping server can take up to a minute to wake)';
  setHTML(el, html);
  const cb = $('#createBtn'), jb = $('#joinBtn');
  if (cb) cb.disabled = !can;
  if (jb) jb.disabled = !can;
}

function renderHomeTables() {
  const el = $('#tables'); if (!el) return;
  if (!onlineReady()) { setHTML(el, '<div class="empty">Your tables appear here once you\'re connected.</div>'); return; }
  const rows = app.lobbyList.filter(t => t && t.code);
  if (!rows.length) { setHTML(el, '<div class="empty">Tables you open or join show up here.</div>'); return; }
  setHTML(el, rows.map(t => {
    const mine = (t.uids || []).includes(app.me.uid);
    const own = t.owner === app.me.uid;
    const st = t.status === 'lobby' ? '<span class="chip ok">Waiting</span>' : t.status === 'playing' ? '<span class="chip brass">Playing</span>' : '<span class="chip">Finished</span>';
    const host = own ? 'you' : (t.ownerName || 'someone');
    const label = t.status === 'lobby' ? (mine ? 'Open' : 'Join') : (mine ? 'Rejoin' : 'Watch');
    return `<div class="table-row${mine ? ' mine' : ''}">
      <span class="code">${esc(t.code)}</span>
      <span class="meta">${st} ${t.map ? esc(Engine.mapInfo(t.map).name) + ' · ' : ''}Host: ${esc(host)} · ${t.n}/${t.max} seats${t.bots ? ' · ' + t.bots + ' bot' + (t.bots > 1 ? 's' : '') : ''} · ${ago(t.updatedAt)}</span>
      <span class="row">${own ? `<button class="btn small danger" data-act="del" data-code="${esc(t.code)}" aria-label="Delete table ${esc(t.code)}">Delete</button>` : ''}<button class="btn small${t.status === 'lobby' ? ' primary' : ''}" data-act="open" data-code="${esc(t.code)}">${label}</button></span>
    </div>`;
  }).join(''));
}
function ago(t) {
  const s = Math.max(0, (Date.now() - (t || 0)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}

function renderPractice() {
  const p = app.ui.practice;
  if (!p.map) p.map = 'standard';
  const maxBots = Engine.mapInfo(p.map).max - 1;
  if (p.bots > maxBots) p.bots = maxBots;
  const m = Engine.mapInfo(p.map);
  setHTML($('#practiceOpts'), `<div class="field" style="margin-bottom:12px"><span class="lbl">Map</span>${mapPicker('pmap', p.map)}<span class="note">${esc(m.blurb)}</span></div>
    <div class="settings-grid">
    <div class="field"><span class="lbl">Opponents</span><div class="seg" role="group" aria-label="Number of bots">${[1, 2, 3, 4, 5].filter(n => n <= maxBots).map(n => `<button data-act="pbots" data-n="${n}" aria-pressed="${p.bots === n}">${n}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl">Bot difficulty</span><div class="seg" role="group" aria-label="Bot difficulty">${Bot.LEVELS.map(l => `<button data-act="plevel" data-v="${l}" aria-pressed="${(p.level || 'normal') === l}" title="${esc(LEVEL_HELP[l])}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl">Points to win</span>${stepper('pvp', p.vp, 5, 20)}</div>
    <div class="field"><span class="lbl">Board</span><div class="seg" role="group" aria-label="Board layout">${[['random', 'Random'], ['balanced', 'Balanced']].map(([k, l]) => `<button data-act="playout" data-v="${k}" aria-pressed="${p.layout === k}">${l}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl" title="${esc(DICE_HELP)}">Dice</span><div class="seg" role="group" aria-label="Dice">${[['random', 'Random'], ['balanced', 'Balanced']].map(([k, l]) => `<button data-act="pdice" data-v="${k}" aria-pressed="${p.dice === k}" title="${k === 'balanced' ? esc(DICE_HELP) : 'Ordinary random dice'}">${l}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl">Friendly robber</span><label class="switch"><input type="checkbox" id="pfriendly" ${p.friendly ? 'checked' : ''}> <span class="note">Protect players with 2 points or fewer</span></label></div>
  </div>`);
  const f = $('#pfriendly'); if (f) f.onchange = () => { p.friendly = f.checked; };
}
function mapPicker(act, current, disabled, players) {
  return `<div class="maps" role="group" aria-label="Map">${Engine.MAP_ORDER.map(id => {
    const m = Engine.mapInfo(id);
    const tooSmall = players && players > m.max;
    return `<button class="map-card" data-act="${act}" data-v="${id}" aria-pressed="${current === id}" ${disabled || tooSmall ? 'disabled' : ''} title="${esc(m.blurb)}">
      <span class="map-thumb">${mapThumb(id)}</span><span class="map-name">${esc(m.name)}</span><span class="map-meta">${m.min}–${m.max} players</span></button>`;
  }).join('')}</div>`;
}
function stepper(key, val, lo, hi, disabled) {
  return `<div class="stepper"><button data-act="${key}" data-d="-1" ${disabled || val <= lo ? 'disabled' : ''} aria-label="Decrease">−</button><output>${val}</output><button data-act="${key}" data-d="1" ${disabled || val >= hi ? 'disabled' : ''} aria-label="Increase">+</button></div>`;
}

function rulesHTML() {
  const c = Engine.COST;
  const row = (what, cost, note) => `<span class="what">${what}</span><span>${resList(cost)}${note ? ' <span class="note">' + note + '</span>' : ''}</span>`;
  return `<div class="rules-cols">
    <div><h4>Build costs</h4><div class="costs">
      ${row('Road', c.road)}${row('Settlement', c.settlement, '1 point')}${row('City', c.city, '2 points')}${row('Development card', c.dev)}
    </div><p style="margin:8px 0 0">Everyone has ${Engine.PIECES.road} roads, ${Engine.PIECES.settlement} settlements and ${Engine.PIECES.city} cities. A city replaces a settlement, which goes back to your supply. Point at (or press and hold) a build button to see every spot it could go.</p></div>
    <div><h4>Your turn</h4><ul>
      <li>Roll the dice. Every hex showing that number pays its neighbours: 1 card per settlement, 2 per city.</li>
      <li>Build, buy development cards, and trade with the bank (4:1, or better at a harbour) or with other players.</li>
      <li>You can play one development card per turn, but not one you bought this turn.</li>
    </ul></div>
    <div><h4>Rolling a 7</h4><ul>
      <li>With <b>balanced dice</b> (a house rule), rolls come from a shuffled deck of all 36 results, reshuffled when 4 are left.</li>
      <li>Anyone holding more than 7 cards discards half.</li>
      <li>The roller moves the robber, which blocks that hex, and steals a card from a neighbour.</li>
    </ul></div>
    <div><h4>Points</h4><ul>
      <li>Settlement 1, city 2, Victory Point card 1.</li>
      <li>Longest Road (5+ connected roads): 2. Largest Army (3+ knights played): 2.</li>
      <li>Settlements must be at least two corners apart. The first to the target score on their own turn wins.</li>
    </ul></div>
    <div><h4>Maps and 5–6 players</h4><ul>
      <li>Pick a map before the game. Lakes and stretches of sea can't be crossed by roads.</li>
      <li>Grand Isle and Uncharted take up to 6 players. Big games use a bank of 24 per resource and 34 development cards.</li>
      <li>With 5 or 6 players, after each turn every other player in order gets a special building turn: build or buy cards, but no trading or playing cards.</li>
    </ul></div>
    <div><h4>Playing online</h4><ul>
      <li>Open a table and send the invite link. Friends pick a name and take a seat; no accounts needed.</li>
      <li>If someone drops, they can reopen the link to rejoin from the same browser. The host can let a bot play for anyone who's away.</li>
      <li>Tap the translate icon next to a chat message to read it in English.</li>
    </ul></div>
    <div><h4>Trading and bots</h4><ul>
      <li>Offer cards to everyone; each player can accept, decline, or send a counter-offer. You pick who to trade with.</li>
      <li>A quill next to a name means that player is writing a counter-offer. A crown marks whoever is in the lead.</li>
      <li>Bots come in three levels. Easy bots learn the ropes, Normal bots play a solid game, Hard bots grab the best spots and trade hard.</li>
    </ul></div>
  </div>`;
}

/* ============================================================
   ROOM (lobby + table)
   ============================================================ */
function renderRoom() {
  const root = $('#room');
  if (!root._built) {
    root._built = true;
    root.innerHTML = `<header class="topbar" id="topbar"></header>
      <main class="stage" id="stage"></main>
      <aside class="side" id="side">
        <div class="players" id="players"></div>
        <div class="feed">
          <div class="tabs" role="tablist" id="feedTabs"></div>
          <div class="feed-list" id="logList" role="log" aria-label="Game log"></div>
          <div class="feed-list" id="chatList" role="log" aria-label="Chat" hidden></div>
          <form class="chat-form" id="chatForm" autocomplete="off"><input class="input" id="chatInput" maxlength="200" placeholder="Message the table" aria-label="Chat message"><button class="btn icon" type="button" data-act="emotes" aria-label="Emotes and quick chat" title="Emotes and quick chat">${ic('smile')}</button><button class="btn" type="submit">Send</button></form>
        </div>
      </aside>`;
    $('#chatForm').addEventListener('submit', e => {
      e.preventDefault();
      const i = $('#chatInput'); const text = i.value.trim();
      if (!text) return;
      if (send({ t: 'chat', text })) i.value = '';
    });
  }
  const g = app.g;
  renderTopbar(g);
  const stage = $('#stage');
  if (!g || !g.view) {
    stage._mode = 'msg';
    setHTML(stage, `<div class="lobby"><div class="lobby-inner"><h1>${g && g.missing ? 'Table not found' : 'Joining table…'}</h1><p class="note">${g && g.missing ? 'It may have been deleted. Check the code and try again.' : (app.conn.state === 'open' ? 'Loading the latest state.' : 'Connecting to the game server…')}</p><div class="row"><button class="btn" data-act="home">Back to tables</button></div></div></div>`);
    setHTML($('#players'), '');
    renderFeed(null);
    return;
  }
  const d = g.view;
  if (d.status === 'lobby') renderLobby(stage, d);
  else renderTable(stage, d);
  renderFeed(d);
}

function renderTopbar(g) {
  const d = g && g.view;
  const local = g && g.local;
  let note = '';
  if (g && !local) {
    if (app.conn.state !== 'open') note = 'Reconnecting…';
    else if (g.pending.length && Date.now() - g.sentAt > 5000) note = 'Waiting for the server…';
    else if (d) note = 'Host: ' + esc(uidName(d, d.owner));
  }
  setHTML($('#topbar'), `
    <button class="btn small" data-act="home" aria-label="Back to tables">←<span class="hide-sm"> Tables</span></button>
    <div class="brand">Hex<span>stead</span></div>
    <span class="tcode">${local ? 'PRACTICE' : esc(g ? g.code : '')}</span>
    <span class="spacer"></span>
    <span class="host-note" id="hostNote">${note}</span>
    <button class="btn small icon" data-act="sound" aria-label="Sound settings">${ic(Sound.get().muted ? 'mute' : 'sound')}</button>
    <button class="btn small" data-act="rules">Rules</button>
    ${!local && g ? '<button class="btn small" data-act="copy-invite">Invite</button>' : ''}`);
}

/* ---------- lobby ---------- */
function renderLobby(stage, d) {
  if (stage._mode !== 'lobby') {
    stage._mode = 'lobby';
    stage.innerHTML = `<div class="lobby"><div class="lobby-inner"><div id="lobbyHead"></div><div id="lobbySeats"></div><div id="lobbyYou"></div><div id="lobbySettings"></div><div id="lobbyStart"></div></div></div>`;
    stage._h = null;
  }
  const g = app.g;
  const me = myUid();
  const isOwner = canManage(d);
  const seatIdx = d.seats.findIndex(s => !s.bot && s.uid === me);
  const online = onlineSet();
  setHTML($('#lobbyHead'), `<div class="eyebrow">Table</div><h1>Waiting for players</h1>
    <div class="invite" style="margin-top:10px"><span class="big-code">${esc(d.code)}</span>
      <button class="btn" data-act="copy-invite">Copy invite link</button></div>
    <p class="note" style="margin-top:8px">Send the link to your friends. They open it, type a name, and take a seat. They can also enter the code on the home page.</p>`);
  const seats = d.seats.map((s, i) => `<div class="seat">
      <div class="row" style="justify-content:space-between"><span class="sw" style="background:${COLOR_HEX[s.color]}"></span>
        <span class="row" style="gap:6px">${s.uid === d.owner ? '<span class="chip brass">Host</span>' : ''}${s.uid === me ? '<span class="chip ok">You</span>' : ''}${!s.bot && !g.local ? `<span class="dot${online.has(s.uid) || s.uid === me ? ' on' : ''}" title="${online.has(s.uid) || s.uid === me ? 'Online' : 'Not here right now'}"></span>` : ''}</span></div>
      <div class="nm">${esc(seatName(s))}</div>
      ${s.bot ? (isOwner ? `<div class="seg mini" role="group" aria-label="${esc(seatName(s))} difficulty">${Bot.LEVELS.map(l => `<button data-act="botlvl" data-i="${i}" data-l="${l}" aria-pressed="${(s.level || 'normal') === l}" title="${esc(LEVEL_HELP[l])}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</div>` : `<span class="chip lvl ${s.level || 'normal'}">${LEVEL_NAME[s.level || 'normal']}</span>`) : ''}
      ${isOwner && s.uid !== d.owner ? `<button class="btn small" data-act="kick" data-i="${i}">Remove</button>` : ''}
    </div>`);
  for (let i = d.seats.length; i < d.settings.maxPlayers; i++) seats.push(`<div class="seat open"><span>Open seat</span>${isOwner ? '<button class="btn small" data-act="addbot">Add a bot</button>' : ''}</div>`);
  setHTML($('#lobbySeats'), `<div class="eyebrow" style="margin-bottom:8px">Seats ${d.seats.length}/${d.settings.maxPlayers}</div><div class="seats">${seats.join('')}</div>`);

  // your seat block (keeps its input across renders)
  const you = $('#lobbyYou');
  const full = d.seats.length >= d.settings.maxPlayers;
  const key = seatIdx >= 0 ? 'seated' : full ? 'full' : 'open';
  if (you._key !== key) {
    you._key = key;
    if (key === 'seated') {
      you.innerHTML = `<div class="card"><div class="eyebrow" style="margin-bottom:8px">Your seat</div>
        <div class="row" style="align-items:flex-end"><div class="field" style="flex:1;min-width:160px"><label for="nickIn">Name at this table</label><input class="input" id="nickIn" maxlength="18" placeholder="${esc(app.me.name || 'Your name')}" value="${esc(d.seats[seatIdx].nick || '')}"></div>
        ${isOwner ? '' : '<button class="btn" data-act="unsit">Leave seat</button>'}</div>
        <div class="lbl" style="margin:12px 0 6px">Color</div><div id="youSwatches"></div></div>`;
      const ni = $('#nickIn');
      const commit = () => { const v = ni.value.trim(); const cur = (app.g.view.seats.find(s => s.uid === myUid()) || {}).nick || ''; if (v && v !== cur) { setMyName(v); send({ t: 'nick', nick: v }); } };
      ni.addEventListener('change', commit);
      ni.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ni.blur(); } });
    } else if (key === 'open') {
      you.innerHTML = `<div class="card"><div class="eyebrow" style="margin-bottom:8px">Join this game</div>
        <form class="row" id="sitForm" style="align-items:flex-end" autocomplete="off"><div class="field" style="flex:1;min-width:160px"><label for="sitNick">Your name</label><input class="input" id="sitNick" maxlength="18" placeholder="${esc(app.me.name || 'Your name')}"></div>
        <button class="btn primary" type="submit">Take a seat</button></form></div>`;
      $('#sitNick').value = app.me.name;
      $('#sitForm').addEventListener('submit', e => {
        e.preventDefault();
        const n = $('#sitNick').value.trim();
        if (!n) { toast('Pick a name first.', 'error'); $('#sitNick').focus(); return; }
        setMyName(n);
        send({ t: 'join', nick: n });
      });
    } else you.innerHTML = '<div class="note">The table is full. You can watch once the game starts.</div>';
  }
  if (key === 'seated') {
    const mine = d.seats[seatIdx].color;
    setHTML($('#youSwatches'), `<div class="swatches">${COLORS.map(c => {
      const taken = d.seats.some((s, j) => j !== seatIdx && s.color === c.id);
      return `<button class="swatch" style="background:${c.hex}" data-act="color" data-c="${c.id}" aria-label="${c.name}" aria-pressed="${mine === c.id}" ${taken ? 'disabled' : ''}></button>`;
    }).join('')}</div>`);
  }
  // settings
  const st = d.settings;
  const ro = !isOwner;
  const seg = (key, opts, val) => `<div class="seg" role="group">${opts.map(([v, l, off]) => `<button data-act="set" data-k="${key}" data-v="${v}" aria-pressed="${String(val) === String(v)}" ${ro || off ? 'disabled' : ''} ${off ? 'title="More people are already seated"' : ''}>${l}</button>`).join('')}</div>`;
  const mi = Engine.mapInfo(st.map);
  setHTML($('#lobbySettings'), `<div class="eyebrow" style="margin-bottom:8px">Map${ro ? ' <span class="note" style="text-transform:none;letter-spacing:0">(chosen by the host)</span>' : ''}</div>
    ${mapPicker('setmap', st.map, ro, d.seats.length)}
    <p class="note" style="margin:6px 0 18px"><b>${esc(mi.name)}:</b> ${esc(mi.blurb)}${mi.max > 4 ? ' With 5 or 6 players, everyone gets a special building turn after each player\'s turn.' : ''}</p>
    <div class="eyebrow" style="margin-bottom:8px">House rules${ro ? ' <span class="note" style="text-transform:none;letter-spacing:0">(set by the host)</span>' : ''}</div>
    <div class="settings-grid">
      <div class="field"><span class="lbl">Points to win</span>${stepper('setvp', st.vpToWin, 5, 20, ro)}</div>
      <div class="field"><span class="lbl">Hand limit on a 7</span>${stepper('setdl', st.discardLimit, 5, 15, ro)}</div>
      <div class="field"><span class="lbl">Players</span>${seg('maxPlayers', [2, 3, 4, 5, 6].filter(n => n <= Engine.mapInfo(st.map).max).map(n => [n, String(n), n < d.seats.length]), st.maxPlayers)}</div>
      <div class="field"><span class="lbl">Turn timer</span>${seg('timer', [[0, 'Off'], [60, '60s'], [90, '90s'], [120, '2m'], [180, '3m']], st.timer)}</div>
      <div class="field"><span class="lbl">Board</span>${seg('layout', [['random', 'Random'], ['balanced', 'Balanced']], st.layout)}</div>
      <div class="field"><span class="lbl" title="${esc(DICE_HELP)}">Dice</span>${seg('dice', [['random', 'Random'], ['balanced', 'Balanced']], st.dice || 'random')}</div>
      <div class="field"><span class="lbl">Friendly robber</span>${seg('friendlyRobber', [['false', 'Off'], ['true', 'On']], st.friendlyRobber)}</div>
    </div>`);
  setHTML($('#lobbyStart'), isOwner
    ? `<div class="row"><button class="btn primary big" data-act="start" ${d.seats.length < 2 ? 'disabled' : ''}>Start game</button>${d.seats.length < st.maxPlayers ? '<button class="btn big" data-act="addbot">Add a bot</button>' : ''}<span class="note">${d.seats.length < 2 ? 'You need at least 2 players.' : 'Seat order is shuffled when the game starts.'}</span></div>`
    : `<div class="note">Waiting for ${esc(uidName(d, d.owner))} to start the game.</div>`);
  if (isOwner && d.owner !== me) setHTML($('#lobbyStart'), $('#lobbyStart').innerHTML.replace('</div>', '<span class="note">The host isn\'t here, so you can start.</span></div>'));
  setHTML($('#players'), '');
}

function onlineSet() {
  const g = app.g;
  return g && g.online ? g.online : new Set();
}
function canManage(d) {
  const me = myUid();
  if (!d) return false;
  if (app.g && app.g.local) return true;
  if (d.owner === me) return true;
  return !onlineSet().has(d.owner) && (d.seats || []).some(s => !s.bot && s.uid === me);
}

/* ---------- table ---------- */
function isBusy() {
  const g = app.g;
  return !!(g && !g.local && g.pending.some(i => RANDOM_ACTS.has(i.a.t)));
}

function boardTargets(s, me) {
  if (me < 0 || s.phase === 'ended' || isBusy()) return {};
  const E = Engine;
  if (s.phase === 'special') {
    if (!s.special || s.special.q[0] !== me) return {};
    const m = app.ui.mode;
    if (m === 'road') return { e: E.legalRoads(s, me) };
    if (m === 'settle') return { v: E.legalSettlements(s, me, false) };
    if (m === 'city') return { v: E.legalCities(s, me) };
    return {};
  }
  if (s.cur !== me) return {};
  if (s.phase === 'setup') return s.setup.step === 'settlement' ? { v: E.legalSettlements(s, me, true) } : { e: E.legalRoads(s, me) };
  if (s.phase === 'robber') return { h: E.legalRobberHexes(s, me) };
  if (s.phase === 'roadBuilding') return { e: E.legalRoads(s, me) };
  if (s.phase === 'main') {
    const m = app.ui.mode;
    if (m === 'road') return { e: E.legalRoads(s, me) };
    if (m === 'settle') return { v: E.legalSettlements(s, me, false) };
    if (m === 'city') return { v: E.legalCities(s, me) };
  }
  return {};
}

function renderTable(stage, d) {
  if (stage._mode !== 'table') {
    stage._mode = 'table';
    stage.innerHTML = `<div class="board-wrap" id="boardWrap">
        <svg id="board" role="img" aria-label="Game board" preserveAspectRatio="xMidYMid meet"><g id="bMain"></g><g id="bGlow"></g><g id="bFx"></g><g id="bPrev"></g><g id="bTgt"></g></svg>
        <div class="peek-note" id="peekNote" hidden></div>
        <button class="emote-fab" id="emoteFab" data-act="emotes" aria-label="Emotes and quick chat" title="Emotes and quick chat" hidden>${ic('smile')}</button>
        <div class="hud hud-dice" id="hudDice"></div>
        <div class="hud hud-bank" id="hudBank"></div>
        <div class="banner-wrap"><div class="banner" id="banner" role="status"></div></div>
        <div id="floatTrade"></div>
      </div>
      <div class="dock" id="dock"></div>`;
    stage._h = null;
    app.ui.prevPieces = null;
  }
  const s = d.game;
  const me = myIndexIn(d);
  if (app.ui.mode && !((s.phase === 'main' && s.cur === me) || (s.phase === 'special' && s.special && s.special.q[0] === me))) app.ui.mode = null;

  // fresh-piece tracking for the drop-in animation
  const now = Date.now();
  const pieces = new Set();
  s.bld.forEach((b, v) => { if (b) pieces.add('v' + v + (b.city ? 'c' : '')); });
  s.roads.forEach((p, e) => { if (p >= 0) pieces.add('e' + e); });
  const gameKey = d.code + ':' + (d.startedAt || 0);
  if (app.ui.prevPieces && app.ui.prevKey === gameKey) for (const k of pieces) if (!app.ui.prevPieces.has(k)) app.ui.fresh.set(k, now + 700);
  app.ui.prevPieces = pieces; app.ui.prevKey = gameKey;
  const fresh = new Set();
  for (const [k, t] of app.ui.fresh) { if (t > now) fresh.add(k); else app.ui.fresh.delete(k); }

  const svg = $('#board');
  const b = boardSVG(s, { fresh });
  if (svg.getAttribute('viewBox') !== b.vb) svg.setAttribute('viewBox', b.vb);
  setHTML($('#bMain'), b.body);
  // targets
  const tg = boardTargets(s, me);
  setHTML($('#bTgt'), targetsOnly(s, tg));
  // roll glow
  const rollKey = gameKey + ':' + (s.rollId || 0);
  if (s.dice && app.ui.glowRoll !== rollKey) {
    const first = app.ui.glowRoll === null || !app.ui.glowRoll.startsWith(gameKey);
    app.ui.glowRoll = rollKey;
    const sum = s.dice[0] + s.dice[1];
    if (!first && sum !== 7) {
      const T = Engine.topo(s);
      setHTML($('#bGlow'), s.board.hexes.map((h, hi) => h.n === sum ? `<polygon class="hit-glow" points="${hexPoints(T, hi, 0.93)}"/>` : '').join('') + `<!--${rollKey}-->`);
    } else setHTML($('#bGlow'), '');
    const hd = $('#hudDice');
    if (!first) { hd.classList.remove('rolling'); void hd.offsetWidth; hd.classList.add('rolling'); }
  }
  // dice
  if (s.dice) {
    const last = [...s.log].reverse().find(e => e.k === 'roll');
    setHTML($('#hudDice'), `${dieSVG(s.dice[0])}${dieSVG(s.dice[1], true)}<span class="dice-sum" ${last ? `style="color:${COLOR_HEX[s.players[last.p].color]}"` : ''}>${s.dice[0] + s.dice[1]}</span>${s.settings.dice === 'balanced' ? `<span class="dice-mode" title="${esc(DICE_HELP)}">balanced</span>` : ''}`);
    $('#hudDice').hidden = false;
  } else $('#hudDice').hidden = true;
  // bank
  setHTML($('#hudBank'), Engine.RES.map(r => `<span class="bk" title="${RES_NAME[r]} in the bank">${ri(r)}${s.bank[r]}</span>`).join('') + `<span class="bk" title="Development cards left">${ic('card', 'ri')}${s.deck.length}</span>`);
  renderPreview();
  const fab = $('#emoteFab'); if (fab) fab.hidden = !Emotes.canEmote(d);
  renderBanner(d, s, me);
  renderFloatTrade(d, s, me);
  renderDock(d, s, me);
  renderPlayers(d, s, me);
}

/* ---------- build previews: every spot a piece could go, shown while pointing at a build button ---------- */
function previewInfo(s, me, kind) {
  const E = Engine, T = E.topo(s), S = 100;
  const out = [];
  const pt = v => [(T.verts[v].x * S).toFixed(1), (T.verts[v].y * S).toFixed(1)];
  if (kind === 'settle') {
    const all = E.legalSettlements(s, me, true); // the distance rule only: no building on or next to the corner, anyone's
    const near = new Set(me >= 0 ? all.filter(v => T.verts[v].edges.some(e => s.roads[e] === me)) : []);
    for (const v of all) { const [x, y] = pt(v); const r = near.has(v) ? 16 : 13; out.push(`<circle class="pv-halo" cx="${x}" cy="${y}" r="${r + 3}"/><circle class="pv-v${near.has(v) ? ' now' : ''}" cx="${x}" cy="${y}" r="${r}"/>`); }
    const rest = all.length - near.size;
    return { svg: out.join(''), note: !all.length ? 'No open spots left on the island' : (near.size ? `<span class="lg now"></span>${near.size} on your roads` : (me >= 0 ? 'None on your roads yet' : '')) + (rest ? ` <span class="lg open"></span>${rest} ${near.size ? 'more ' : ''}open spot${rest === 1 ? '' : 's'}` : '') };
  }
  if (kind === 'road') {
    if (me < 0) return { svg: '', note: '' };
    const es = E.legalRoads(Object.assign({}, s, { phase: 'main' }), me);
    for (const e of es) {
      const Ed = T.edges[e]; const a = T.verts[Ed.a], b = T.verts[Ed.b]; const k = 0.2;
      const c = `x1="${((a.x + (b.x - a.x) * k) * S).toFixed(1)}" y1="${((a.y + (b.y - a.y) * k) * S).toFixed(1)}" x2="${((b.x + (a.x - b.x) * k) * S).toFixed(1)}" y2="${((b.y + (a.y - b.y) * k) * S).toFixed(1)}"`;
      out.push(`<line class="pv-eh" ${c}/><line class="pv-e" ${c}/>`);
    }
    return { svg: out.join(''), note: es.length ? `<span class="lg road"></span>${es.length} place${es.length === 1 ? '' : 's'} for your next road` : 'No room for a road next to your pieces' };
  }
  if (kind === 'city') {
    if (me < 0) return { svg: '', note: '' };
    const vs = E.legalCities(s, me);
    for (const v of vs) { const [x, y] = pt(v); out.push(`<circle class="pv-halo" cx="${x}" cy="${y}" r="27"/><circle class="pv-c" cx="${x}" cy="${y}" r="24"/>`); }
    return { svg: out.join(''), note: vs.length ? `<span class="lg city"></span>${vs.length} settlement${vs.length === 1 ? '' : 's'} you can upgrade` : 'Build a settlement first. Cities replace settlements' };
  }
  return { svg: '', note: '' };
}
function renderPreview() {
  const g = app.g, d = g && g.view, s = d && d.game;
  const layer = $('#bPrev'), note = $('#peekNote');
  if (!layer || !note) return;
  const k = app.ui.preview;
  if (!s || !k || s.phase === 'ended' || k === app.ui.mode) { setHTML(layer, ''); note.hidden = true; return; }
  const me = myIndexIn(d);
  const p = previewInfo(s, me, k);
  setHTML(layer, p.svg);
  setHTML(note, `${ic('eye')}<span>${p.note}</span>`);
  note.hidden = !p.note;
}
function togglePreview(k, sticky) {
  clearTimeout(app.ui.previewTimer);
  app.ui.preview = app.ui.preview === k && sticky ? null : k;
  if (sticky && app.ui.preview) app.ui.previewTimer = setTimeout(() => { app.ui.preview = null; renderPreview(); syncPeekButtons(); }, 5000);
  renderPreview(); syncPeekButtons();
}
function syncPeekButtons() { document.querySelectorAll('[data-prev]').forEach(b => b.classList.toggle('peek', b.dataset.prev === app.ui.preview)); }

function targetsOnly(s, tg) {
  // boardSVG puts targets last; re-run with an empty board copy to get just the target markup
  const T = Engine.topo(s);
  const S = 100; const out = [];
  if (tg.h) for (const hi of tg.h) out.push(`<polygon class="tgt-h" data-h="${hi}" points="${hexPoints(T, hi, 0.9)}"><title>Move the robber here</title></polygon>`);
  if (tg.e) for (const e of tg.e) {
    const E = T.edges[e]; const a = T.verts[E.a], b = T.verts[E.b]; const k = 0.22;
    const c = [(a.x + (b.x - a.x) * k) * S, (a.y + (b.y - a.y) * k) * S, (b.x + (a.x - b.x) * k) * S, (b.y + (a.y - b.y) * k) * S].map(n => n.toFixed(1));
    out.push(`<line class="tgt-ehit" data-e="${e}" x1="${c[0]}" y1="${c[1]}" x2="${c[2]}" y2="${c[3]}"/><line class="tgt-e" pointer-events="none" x1="${c[0]}" y1="${c[1]}" x2="${c[2]}" y2="${c[3]}"/>`);
  }
  if (tg.v) for (const v of tg.v) {
    const p = T.verts[v];
    out.push(`<circle class="tgt-hit" data-v="${v}" cx="${(p.x * S).toFixed(1)}" cy="${(p.y * S).toFixed(1)}" r="22"/><circle class="tgt-v" pointer-events="none" cx="${(p.x * S).toFixed(1)}" cy="${(p.y * S).toFixed(1)}" r="10"/>`);
  }
  return out.join('');
}

function bannerInfo(d, s, me) {
  const mine = s.cur === me;
  const cur = pName(s, s.cur);
  const n = s.players.length;
  switch (s.phase) {
    case 'setup': {
      const first = s.setup.i < n;
      if (mine) return s.setup.step === 'settlement' ? `Place your ${first ? 'first' : 'second'} settlement` : 'Place a road next to it';
      return `${cur} is placing a ${s.setup.step}`;
    }
    case 'roll': return mine ? 'Your turn. Roll the dice' : `${cur}'s turn`;
    case 'discard': {
      const need = Engine.discardNeeded(s, me);
      if (need) return `Discard ${need} cards`;
      return 'Waiting for ' + Object.keys(s.discard).map(i => pName(s, +i)).join(', ') + ' to discard';
    }
    case 'robber': return mine ? 'Move the robber to any other hex' : `${cur} is moving the robber`;
    case 'steal': return mine ? 'Pick someone to rob' : `${cur} is picking someone to rob`;
    case 'roadBuilding': return mine ? `Place ${s.freeRoads} free road${s.freeRoads > 1 ? 's' : ''}` : `${cur} is building free roads`;
    case 'main':
      if (mine) return app.ui.mode ? `Pick where to build your ${app.ui.mode === 'settle' ? 'settlement' : app.ui.mode}` : 'Build, trade, or end your turn';
      return `${cur}'s turn`;
    case 'special': {
      const who = s.special.q[0];
      const ni = (s.cur + 1) % n;
      const next = ni === me ? 'your' : pName(s, ni) + '\'s';
      const before = ni === who ? '' : ` before ${next} turn`; // the next player builds in this phase too
      if (who === me) return app.ui.mode ? 'Pick where to build' : `Special build: you may build now${before}`;
      return `${pName(s, who)} is special building${before}`;
    }
    case 'ended': return s.winner === me ? `You win with ${Engine.vp(s, s.winner)} points` : `${pName(s, s.winner)} wins with ${Engine.vp(s, s.winner)} points`;
  }
  return '';
}
function renderBanner(d, s, me) {
  const actor = s.phase === 'special' && s.special ? s.special.q[0] : s.cur;
  const mine = s.phase !== 'ended' && ((s.phase === 'special' ? actor === me : s.cur === me) || (s.phase === 'discard' && Engine.discardNeeded(s, me) > 0));
  const who = s.phase === 'ended' ? s.winner : actor;
  const el = $('#banner');
  el.className = 'banner' + (mine ? ' you' : '');
  setHTML(el, `<span class="who" style="background:${COLOR_HEX[s.players[who].color]}"></span><span>${esc(bannerInfo(d, s, me))}</span><span class="clock" id="clock"></span>${s.phase === 'roadBuilding' && s.cur === me ? '<button class="btn small" data-act="skiproads">Skip</button>' : ''}${app.ui.mode ? '<button class="btn small" data-act="mode" data-m="">Cancel</button>' : ''}`);
  updateClock();
}
function updateClock() {
  const el = $('#clock');
  const g = app.g;
  if (!el || !g || !g.view || !g.view.game) return;
  const s = g.view.game;
  if (!s.deadline || s.phase === 'ended') { el.textContent = ''; return; }
  const skew = g.local || !Number.isFinite(g.skew) ? 0 : g.skew;
  const left = Math.max(0, Math.ceil((s.deadline - Date.now() - skew) / 1000));
  el.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  el.className = 'clock' + (left <= 10 ? ' low' : '');
  const me = myIndexIn(g.view);
  if (left > 0 && left <= 10 && me >= 0 && Engine.pendingActors(s).includes(me) && app.ui.lastTick !== left) { app.ui.lastTick = left; Sound.play('tick'); }
}

/* little resource cards for trade terms */
function tradeCards(res, none) {
  const parts = [];
  for (const r of Engine.RES) if (res && res[r]) parts.push(`<span class="tcard ${r}" title="${res[r]} ${RES_NAME[r]}">${ic(r)}${res[r] > 1 ? `<b>${res[r]}</b>` : ''}</span>`);
  return parts.length ? `<span class="tcards">${parts.join('')}</span>` : (none || '<span class="note">nothing</span>');
}
function missingText(have, want) {
  const miss = Engine.RES.filter(r => (want[r] || 0) > (have[r] || 0)).map(r => (want[r] - (have[r] || 0)) + ' more ' + RES_NAME[r].toLowerCase());
  return miss.length ? 'You need ' + miss.join(' and ') : '';
}
function respStatus(s, t, q) {
  const r = t.resp[q];
  if (r === undefined) return t.drafting && t.drafting[q] ? `<span class="st drafting">${ic('quill')}Writing a counter<span class="dots"><i></i><i></i><i></i></span></span>` : '<span class="st wait">Deciding…</span>';
  if (r === 'decline') return `<span class="st no">${ic('x')}Declined</span>`;
  if (r === 'accept') return `<span class="st yes">${ic('check')}Accepts</span>`;
  return `<span class="st counter">${ic('quill')}Counter-offer</span>`;
}

/* everyone else's answers to an offer, counter-offers spelled out */
function otherReplies(s, t, list) {
  if (!list.length) return '';
  return `<div class="ft-others">${list.map(i => {
    const r = t.resp[i];
    const terms = r && typeof r === 'object' ? `<span class="counter-terms">gives ${tradeCards(r.give)} for ${tradeCards(r.get)}</span>` : '';
    return `<div class="resp small"><span class="sw" style="background:${COLOR_HEX[s.players[i].color]}"></span><span class="nm">${esc(pName(s, i))}</span>${respStatus(s, t, i)}${terms}</div>`;
  }).join('')}</div>`;
}

function renderFloatTrade(d, s, me) {
  const el = $('#floatTrade');
  const t = s.trade;
  if (!t || s.phase === 'ended') { setHTML(el, ''); return; }
  const from = t.from;
  const others = s.players.map((_, i) => i).filter(i => i !== from);
  let html = '';
  if (from === me) {
    const P = s.players[me];
    const rows = others.map(i => {
      const pl = s.players[i];
      const r = t.resp[i];
      let act = '';
      if (r === 'accept') act = `<button class="btn small primary" data-act="confirm" data-q="${i}" data-id="${t.id}">Trade</button>`;
      else if (r && r !== 'decline') {
        const short = missingText(P.res, r.get);
        act = `<span class="counter-terms">you get ${tradeCards(r.give)} <span class="ft-swap">${ic('trade')}</span> you give ${tradeCards(r.get)}</span><button class="btn small primary" data-act="confirm" data-q="${i}" data-id="${t.id}" ${short ? `aria-disabled="true" title="${esc(short)}"` : ''}>Accept</button>`;
      }
      return `<div class="resp"><span class="sw" style="background:${COLOR_HEX[pl.color]}"></span><span class="nm">${esc(pName(s, i))}</span>${respStatus(s, t, i)}<span class="resp-act">${act}</span></div>`;
    }).join('');
    const waiting = others.filter(i => t.resp[i] === undefined).length;
    html = `<div class="float-trade mine">
      <div class="ft-top"><span class="ft-title">Your offer</span><div class="ft-deal"><span class="ft-side"><span class="lbl">You give</span>${tradeCards(t.give)}</span><span class="ft-swap">${ic('trade')}</span><span class="ft-side"><span class="lbl">You get</span>${tradeCards(t.get)}</span></div></div>
      <div class="resp-list">${rows}</div>
      <div class="ft-foot"><span class="note">${waiting ? 'Waiting for ' + waiting + ' ' + (waiting > 1 ? 'players' : 'player') + '…' : 'Everyone has answered.'}</span><button class="btn small" data-act="cancel-offer">Cancel offer</button></div></div>`;
  } else if (me < 0) {
    html = `<div class="float-trade"><div class="ft-top"><span class="ft-title">${pTag(s, from)} offers</span><div class="ft-deal"><span class="ft-side">${tradeCards(t.give)}</span><span class="ft-swap">${ic('trade')}</span><span class="ft-side">${tradeCards(t.get)}</span></div></div>
      ${otherReplies(s, t, others)}</div>`;
  } else {
    const r = t.resp[me];
    const P = s.players[me];
    const short = missingText(P.res, t.get);
    let ctl;
    if (r === undefined) ctl = `<button class="btn primary" data-act="accept" data-id="${t.id}" ${short ? `aria-disabled="true" title="${esc(short)}"` : ''}>${ic('check')}Accept</button><button class="btn" data-act="counter-open" data-id="${t.id}">${ic('quill')}Counter</button><button class="btn" data-act="decline" data-id="${t.id}">${ic('x')}Decline</button>${short ? `<span class="note">${esc(short)}</span>` : ''}`;
    else if (r === 'accept') ctl = `<span class="st yes">${ic('check')}You accepted.</span><span class="note">Waiting for ${esc(pName(s, from))} to pick a partner.</span>`;
    else if (r === 'decline') ctl = `<span class="st no">${ic('x')}You declined.</span>`;
    else ctl = `<span class="st counter">${ic('quill')}Counter sent:</span><span class="counter-terms">you give ${tradeCards(r.give)} for ${tradeCards(r.get)}</span>`;
    const rest = others.filter(i => i !== me);
    html = `<div class="float-trade incoming">
      <div class="ft-top"><span class="ft-title">${pTag(s, from)} offers you a trade</span><div class="ft-deal"><span class="ft-side"><span class="lbl">You get</span>${tradeCards(t.give)}</span><span class="ft-swap">${ic('trade')}</span><span class="ft-side"><span class="lbl">You give</span>${tradeCards(t.get)}</span></div></div>
      <div class="ft-actions">${ctl}</div>
      ${otherReplies(s, t, rest)}</div>`;
  }
  if (app.ui.ftId !== t.id) { app.ui.ftId = t.id; html = html.replace('class="float-trade', 'class="float-trade enter'); }
  setHTML(el, html);
}

function renderDock(d, s, me) {
  const el = $('#dock');
  if (me < 0) {
    setHTML(el, s.phase === 'ended' ? endBar(d, s) : '<div class="note">You\'re watching this game. Moves appear live.</div>');
    return;
  }
  const E = Engine;
  const P = s.players[me];
  if (s.phase === 'ended') { setHTML(el, endBar(d, s)); return; }
  if (P.auto && s.phase !== 'ended') {
    setHTML(el, `<div class="note" style="flex:1">A bot is playing your seat while you were away.</div><button class="btn primary" data-act="autoplay" data-i="${me}" data-on="">Take back my seat</button>`);
    return;
  }
  const myTurn = s.cur === me && s.phase !== 'ended';
  const special = s.phase === 'special' && s.special && s.special.q[0] === me;
  const turnMain = myTurn && s.phase === 'main';
  const main = turnMain || special; // may build
  const busy = isBusy();
  const left = E.piecesLeft(s, me);
  const hand = E.RES.map(r => `<div class="card-res ${r}${P.res[r] ? '' : ' zero'}" title="${RES_NAME[r]}: ${P.res[r]}">${ic(r)}<span class="n">${P.res[r]}</span></div>`).join('');
  const counts = {};
  for (const c of P.dev) counts[c] = (counts[c] || 0) + 1;
  const devOrder = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'vp'];
  const devs = devOrder.filter(c => counts[c]).map(c => {
    const ready = c !== 'vp' && myTurn && (s.phase === 'main' || s.phase === 'roll') && !s.devPlayed && E.playable(s, me, c) > 0 && !busy;
    const fresh = (P.newDev && P.newDev[c]) || 0;
    const tip = DEV_NAME[c] + ': ' + DEV_HELP[c] + (fresh ? ' (' + fresh + ' bought this turn)' : '');
    return `<button class="dev${ready ? ' ready' : ''}" data-act="play" data-card="${c}" ${ready ? '' : 'disabled'} title="${esc(tip)}">${ic(c)}<span>${DEV_NAME[c]}</span>${counts[c] > 1 ? `<span class="n">${counts[c]}</span>` : ''}</button>`;
  }).join('');
  const can = {
    road: main && E.has(P.res, E.COST.road) && left.road > 0 && E.legalRoads(s, me).length > 0,
    settle: main && E.has(P.res, E.COST.settlement) && left.settlement > 0 && E.legalSettlements(s, me, false).length > 0,
    city: main && E.has(P.res, E.COST.city) && left.city > 0 && E.legalCities(s, me).length > 0,
    dev: main && E.has(P.res, E.COST.dev) && s.deck.length > 0 && !busy,
  };
  const costText = cost => E.RES.filter(r => cost[r]).map(r => cost[r] + ' ' + RES_NAME[r].toLowerCase()).join(', ');
  const OUT = { road: 'All ' + E.PIECES.road + ' of your roads are on the board', settle: 'All ' + E.PIECES.settlement + ' of your settlements are on the board. Upgrading one to a city gives it back', city: 'All ' + E.PIECES.city + ' of your cities are on the board', dev: 'No development cards left' };
  const why = (k, cost, pieces) => pieces <= 0 ? OUT[k] : !main ? 'Available on your turn after rolling' : !E.has(P.res, cost) ? 'Costs ' + costText(cost) : 'No legal spot right now';
  const btn = (k, label, icon, cost, pieces) => `<button class="btn act${app.ui.mode === k ? ' on' : ''}${app.ui.preview === k ? ' peek' : ''}" data-act="mode" data-m="${k}" data-prev="${k}" ${can[k] ? '' : 'aria-disabled="true"'} title="${esc(can[k] ? label + ' (' + costText(cost) + ')' : why(k, cost, pieces))}">${ic(icon)}<span>${label}</span><span class="left${pieces <= 0 ? ' out' : pieces <= 2 ? ' low' : ''}" aria-label="${pieces} left">${pieces}</span></button>`;
  let actions;
  if (myTurn && s.phase === 'roll') {
    actions = `<button class="btn primary big" data-act="roll" ${busy ? 'disabled' : ''}>${ic('die')} ${busy ? 'Rolling…' : 'Roll dice'}</button>`;
  } else {
    actions = btn('road', 'Road', 'road', E.COST.road, left.road) + btn('settle', 'Settlement', 'settlement', E.COST.settlement, left.settlement) + btn('city', 'City', 'city', E.COST.city, left.city) +
      `<button class="btn act" data-act="buydev" ${can.dev ? '' : 'disabled'} title="${esc(can.dev ? 'Buy a development card (1 wool, 1 grain, 1 ore)' : why('dev', E.COST.dev, s.deck.length))}">${ic('card')}<span>Dev card</span></button>` +
      `<button class="btn act" data-act="trade" ${turnMain ? '' : 'disabled'} title="${special ? 'No trading during special building' : 'Trade with the bank or other players'}">${ic('trade')}<span>Trade</span></button>` +
      (special ? `<button class="btn act primary" data-act="pass" ${busy ? 'disabled' : ''}>${ic('end')}<span>Done</span></button>`
        : `<button class="btn act${main ? ' primary' : ''}" data-act="end" ${main && !busy ? '' : 'disabled'}>${ic('end')}<span>End turn</span></button>`);
  }
  const costs = app.ui.costs ? `<div class="costs-pop"><div class="costs">${['road', 'settlement', 'city', 'dev'].map(k => `<span class="what">${k === 'dev' ? 'Dev card' : k[0].toUpperCase() + k.slice(1)}</span><span>${resList(E.COST[k])}</span>`).join('')}</div><p class="note" style="margin:8px 0 0">Pieces left: ${left.road} of ${E.PIECES.road} roads, ${left.settlement} of ${E.PIECES.settlement} settlements, ${left.city} of ${E.PIECES.city} cities. Point at a build button (or press and hold it) to see every spot on the board.</p></div>` : '';
  setHTML(el, `<div class="hand" aria-label="Your cards">${hand}</div>${devs ? `<div class="devs">${devs}</div>` : ''}<div class="actions">${actions}<button class="btn small icon" data-act="costs" aria-label="Build costs" aria-expanded="${!!app.ui.costs}">?</button></div>${costs}`);
}

/* who wears the crown: kept by the engine (one leader; a tie doesn't move it) */
function leaders(s) {
  if (s.phase === 'ended') return new Set([s.winner]);
  return new Set(Number.isInteger(s.crown) && s.crown >= 0 ? [s.crown] : []);
}
/* what a player is doing with the open offer, for the players panel */
function tradeStatus(s, i) {
  const t = s.trade;
  if (!t || s.phase === 'ended') return '';
  if (i === t.from) return `<span class="tstat offer" title="Made the open offer">${ic('trade')}</span>`;
  const r = t.resp[i];
  if (t.drafting && t.drafting[i] && r === undefined) return `<span class="tstat drafting" title="Writing a counter-offer">${ic('quill')}<i></i><i></i><i></i></span>`;
  if (r === 'accept') return `<span class="tstat yes" title="Accepted the offer">${ic('check')}</span>`;
  if (r === 'decline') return `<span class="tstat no" title="Declined the offer">${ic('x')}</span>`;
  if (r) return `<span class="tstat counter" title="Counter-offer: gives ${Engine.RES.filter(k => r.give[k]).map(k => r.give[k] + ' ' + RES_NAME[k].toLowerCase()).join(', ')} for ${Engine.RES.filter(k => r.get[k]).map(k => r.get[k] + ' ' + RES_NAME[k].toLowerCase()).join(', ')}">${ic('quill')}</span>`;
  return '';
}

function endBar(d, s) {
  const g = app.g;
  return `<div class="end-bar"><span class="crown">${ic('crown')}</span><span>${s.winner === myIndexIn(d) ? '<b>You win</b>' : `<b>${esc(pName(s, s.winner))}</b> wins`} with ${Engine.vp(s, s.winner)} points</span>
    <span class="spacer"></span><button class="btn" data-act="show-results">Results</button>${canManage(d) ? `<button class="btn primary" data-act="rematch">${g.local ? 'Play again' : 'Rematch'}</button>` : ''}</div>`;
}

function renderPlayers(d, s, me) {
  const online = onlineSet();
  const ended = s.phase === 'ended';
  const g = app.g;
  const crown = leaders(s);
  setHTML($('#players'), s.players.map((pl, i) => {
    const show = ended || i === me;
    const vp = show ? Engine.vp(s, i) : Engine.publicVP(s, i);
    const hidden = i === me && !ended ? Engine.vpCards(s, i) : 0;
    const cards = pl.nCards != null ? pl.nCards : Engine.total(pl.res);
    const len = Engine.roadLength(s, i);
    const turn = !ended && (s.phase === 'special' && s.special ? s.special.q[0] === i : s.cur === i);
    const pend = s.phase === 'discard' && s.discard && s.discard[i];
    const dot = !pl.bot && !g.local ? `<span class="dot${online.has(pl.uid) || pl.uid === myUid() ? ' on' : ''}" title="${online.has(pl.uid) || pl.uid === myUid() ? 'Online' : 'Not here right now'}"></span>` : '';
    const lvl = pl.bot && pl.level ? `<span class="chip lvl ${pl.level}" title="Bot difficulty">${LEVEL_NAME[pl.level] || 'Bot'}</span>` : pl.bot ? '<span class="chip">Bot</span>' : '';
    const crowned = crown.has(i) ? `<span class="crown" title="${ended ? 'Winner' : 'In the lead with ' + Engine.publicVP(s, i) + ' points'}">${ic('crown')}</span>` : '';
    return `<div class="pl${turn ? ' turn' : ''}">
      <span class="bar" style="background:${COLOR_HEX[pl.color]}"></span>
      <div class="nm">${crowned}<span class="t">${esc(seatName(pl))}</span>${tradeStatus(s, i)}${i === me ? '<span class="chip ok">You</span>' : ''}${lvl}${pl.auto ? '<span class="chip brass" title="A bot is playing this seat">Bot playing</span>' : ''}${dot}${!g.local && !ended && !pl.bot && !pl.auto && i !== me && canManage(d) && !online.has(pl.uid) ? `<button class="btn small" data-act="autoplay" data-i="${i}" data-on="1" title="${esc(seatName(pl))} isn't here. Let a bot take their turns until they come back.">Bot plays</button>` : ''}${pend ? '<span class="chip brass">Discarding</span>' : ''}${s.winner === i ? '<span class="chip brass">Winner</span>' : ''}</div>
      <div class="vp" title="${hidden ? 'Includes ' + hidden + ' hidden Victory Point card' + (hidden > 1 ? 's' : '') : 'Victory points'}">${vp}<small>${hidden ? '+' + hidden + ' hidden' : 'PTS'}</small></div>
      <div class="stats">
        <span title="Resource cards">${ic('cards')}${cards}</span>
        <span title="Development cards">${ic('card')}${pl.dev.length}</span>
        <span title="Knights played">${ic('army')}${pl.knights}</span>
        <span title="Longest road">${ic('road')}${len}</span>
        ${s.lr.p === i ? '<span class="badge">Longest Road</span>' : ''}${s.la.p === i ? '<span class="badge">Largest Army</span>' : ''}
      </div>
    </div>`;
  }).join(''));
}

/* ---------- feed ---------- */
function renderFeed(d) {
  const g = app.g;
  const local = g && g.local;
  const chatN = d ? (d.chat || []).length : 0;
  if (app.ui.tab === 'chat') app.ui.seenChat = chatN;
  const unread = chatN > app.ui.seenChat && app.ui.tab !== 'chat';
  const playing = d && d.game;
  const fm = playing ? 'game' : 'lobby';
  if (app.ui.feedMode !== fm) { app.ui.feedMode = fm; app.ui.tab = playing ? 'log' : 'chat'; }
  if (!playing && app.ui.tab === 'log') app.ui.tab = 'chat';
  if (local) app.ui.tab = 'log';
  setHTML($('#feedTabs'), `${playing ? `<button role="tab" data-act="tab" data-tab="log" aria-selected="${app.ui.tab === 'log'}">Log</button>` : ''}${local ? '' : `<button role="tab" data-act="tab" data-tab="chat" aria-selected="${app.ui.tab === 'chat'}">Chat${unread ? '<span class="unread"></span>' : ''}</button>`}`);
  const logEl = $('#logList'), chatEl = $('#chatList');
  logEl.hidden = app.ui.tab !== 'log';
  chatEl.hidden = app.ui.tab !== 'chat';
  $('#chatForm').hidden = local || app.ui.tab !== 'chat';
  if (!d) { setHTML(logEl, ''); setHTML(chatEl, ''); return; }
  const stick = el => el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  if (playing) {
    const s = d.game, me = myIndexIn(d);
    const atBottom = stick(logEl);
    setHTML(logEl, s.log.slice(-140).map(e => logLine(s, e, me)).join(''));
    if (atBottom || !logEl._scrolled) { logEl.scrollTop = logEl.scrollHeight; logEl._scrolled = true; }
  }
  const atB = stick(chatEl);
  setHTML(chatEl, (d.chat || []).length ? d.chat.map((c, i) => chatLine(d, c, i)).join('') : '<div class="note">No messages yet. Say hi.</div>');
  if (atB || !chatEl._scrolled) { chatEl.scrollTop = chatEl.scrollHeight; chatEl._scrolled = true; }
}

/* ---------- chat translation ---------- */
app.tr = new Map();
function langName(code) {
  if (!code) return '';
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code.split('-')[0]) || code; } catch (e) { return code; }
}
function trTarget(text) {
  // into English, as a rule; a reader whose browser speaks another language gets plain-Latin messages in their own language
  const nav = String(navigator.language || 'en').slice(0, 2).toLowerCase();
  if (nav !== 'en' && /^[a-z]{2}$/.test(nav) && !/[^\u0000-\u024f]/.test(text)) return nav;
  return 'en';
}
function chatLine(d, c, i) {
  if (c.q) { // a quick phrase: shown in this reader's language
    const s = d.game;
    const nm = c.p != null && s && s.players[c.p] ? pName(s, c.p) : uidName(d, c.uid);
    const col = c.p != null && s && s.players[c.p] ? COLOR_HEX[s.players[c.p].color] : uidColor(d, c.uid);
    return `<div class="chat-e"><div class="chat-row"><span class="chat-body"><span class="pn" style="color:${col}">${esc(nm)}</span> <span class="qc" dir="auto">${Emotes.phraseHTML(c.q, c.r)}</span></span></div></div>`;
  }
  const mine = c.uid === myUid();
  const tr = app.tr.get(c.uid + ':' + c.at);
  let out = '';
  if (tr && tr.shown) {
    if (tr.state === 'loading') out = '<div class="tr-out note">Translating…</div>';
    else if (tr.state === 'same') out = `<div class="tr-out note">Already in ${esc(langName(tr.to))}.</div>`;
    else if (tr.state === 'err') out = `<div class="tr-out note">${tr.err === 'quota' ? 'The free translator has hit its daily limit for your connection and for the game server. Tap to try again later.' : 'Couldn\'t translate that right now. Tap to try again.'}</div>`;
    else out = `<div class="tr-out"><span class="tr-from">${esc(langName(tr.from) || 'Translated')} → ${esc(langName(tr.to))}</span><span dir="auto">${esc(tr.text)}</span></div>`;
  }
  const btn = mine ? '' : `<button class="tr-btn${tr && tr.shown ? ' on' : ''}" data-act="translate" data-k="${i}" title="${tr && tr.shown ? 'Hide translation' : 'Translate'}" aria-label="${tr && tr.shown ? 'Hide translation' : 'Translate this message'}">${ic('translate')}</button>`;
  return `<div class="chat-e"><div class="chat-row"><span class="chat-body"><span class="pn" style="color:${uidColor(d, c.uid)}">${esc(uidName(d, c.uid))}</span> <span dir="auto">${esc(c.text)}</span></span>${btn}</div>${out}</div>`;
}
function translateChat(d, i) {
  const c = (d.chat || [])[i];
  if (!c) return;
  const key = c.uid + ':' + c.at;
  const cur = app.tr.get(key);
  if (cur && cur.state !== 'err') { cur.shown = !cur.shown; return renderFeed(d); }
  const entry = { state: 'loading', shown: true, to: trTarget(c.text) };
  app.tr.set(key, entry);
  renderFeed(d);
  translateText(c.text, entry.to).then(r => {
    if (r.same) entry.state = 'same';
    else if (r.err || !r.text) { entry.state = 'err'; entry.err = r.err; }
    else Object.assign(entry, { state: 'done', text: r.text, from: r.from });
    if (app.g && app.g.view) renderFeed(app.g.view);
  });
}

// "4:1", or "2:1 harbour"; blank when several kinds were given at once
function bankRate(e) {
  const kinds = Engine.RES.filter(r => e.give[r]);
  if (kinds.length !== 1 || !Engine.total(e.get)) return '';
  const n = e.give[kinds[0]] / Engine.total(e.get);
  return n + ':1' + (n < 4 ? ' harbour' : '');
}
function logLine(s, e, me) {
  const P = i => pTag(s, i);
  const V = (i, third, plain) => (i === me && pName(s, i) === 'You' ? plain : third); // "You offer", "Ada offers"
  switch (e.k) {
    case 'start': return '<div class="log-e">The island is ready. Each player places two settlements and two roads, in snake order.</div>';
    case 'turn': return `<div class="log-turn">${esc(pName(s, e.p))} · turn ${e.turn}</div>`;
    case 'roll': return `<div class="log-e">${P(e.p)} rolled <span class="mini-die">${e.d[0]}</span><span class="mini-die">${e.d[1]}</span> <b>${e.d[0] + e.d[1]}</b></div>`;
    case 'gain': return `<div class="log-e">${P(e.p)} ${e.setup ? 'starts with' : e.card ? 'took' : 'got'} ${resList(e.res)}${e.card ? ' <span class="note">from the bank with Year of Plenty</span>' : e.setup ? ' <span class="note">from their second settlement</span>' : ''}</div>`;
    case 'build': return `<div class="log-e">${P(e.p)} built a ${e.what}${e.free ? ' (free)' : ''}</div>`;
    case 'buyDev': return `<div class="log-e">${P(e.p)} bought a development card${e.p === me ? ': <b>' + DEV_NAME[e.card] + '</b>' : ''}</div>`;
    case 'play': return `<div class="log-e">${P(e.p)} played <b>${DEV_NAME[e.card]}</b></div>`;
    case 'robber': { const h = s.board.hexes[e.h]; return `<div class="log-e">${P(e.p)} moved the robber to ${TERRAIN[h.t].name}${h.n ? ' ' + h.n : ''}</div>`; }
    case 'steal': return `<div class="log-e">${P(e.p)} stole ${e.p === me || e.q === me ? resList({ [e.r]: 1 }) : 'a card'} from ${P(e.q)}</div>`;
    case 'stealNone': return `<div class="log-e">${P(e.q)} had nothing to steal</div>`;
    case 'discard': return `<div class="log-e">${P(e.p)} discarded ${e.n} cards</div>`;
    case 'bank': { const rate = bankRate(e); return `<div class="log-e">${P(e.p)} traded ${resList(e.give)} for ${resList(e.get)} with the bank <span class="note">${rate}</span></div>`; }
    case 'offer': return `<div class="log-e">${P(e.p)} ${V(e.p, 'offers', 'offer')} ${resList(e.give)} for ${resList(e.get)}</div>`;
    case 'counter': return `<div class="log-e">${P(e.p)} ${V(e.p, 'counters', 'counter')}: ${resList(e.give)} for ${resList(e.get)}</div>`;
    case 'trade': return `<div class="log-e">${P(e.p)} gave ${resList(e.give)} to ${P(e.q)} for ${resList(e.get)}</div>`;
    case 'mono': return `<div class="log-e">${P(e.p)} took all ${e.n} ${ri(e.r)} from the other players with Monopoly</div>`;
    case 'lr': return `<div class="log-e">${P(e.p)} ${V(e.p, 'holds', 'hold')} <b>Longest Road</b> (${e.len})</div>`;
    case 'lrLost': return `<div class="log-e">Longest Road is up for grabs again</div>`;
    case 'la': return `<div class="log-e">${P(e.p)} ${V(e.p, 'holds', 'hold')} <b>Largest Army</b> (${e.n} knights)</div>`;
    case 'short': return `<div class="log-e">The bank ran short of ${e.res.map(r => RES_NAME[r].toLowerCase()).join(', ')}. Nobody was paid that resource.</div>`;
    case 'special': { const ni = (e.p + 1) % s.players.length; return `<div class="log-e note">Special building before ${ni === me ? 'your' : P(ni) + '\'s'} turn</div>`; }
    case 'autoOn': return `<div class="log-e">A bot is playing for ${P(e.p)} while they're away</div>`;
    case 'autoOff': return `<div class="log-e">${P(e.p)} is back</div>`;
    case 'timeout': return `<div class="log-e">${P(e.p)} ran out of time. Moves were made for them.</div>`;
    case 'win': return `<div class="log-e"><b>${e.p === me ? 'You win' : P(e.p) + ' wins'} with ${e.vp} points!</b></div>`;
  }
  return '';
}

/* ============================================================
   MODALS
   ============================================================ */
function picker(kind, draft, opts) {
  // opts: {max: r=>n, extra: r=>html, total cap}
  return `<div class="picker">${Engine.RES.map(r => {
    const max = opts.max(r);
    const v = draft[r] || 0;
    const capHit = opts.cap != null && Engine.total(draft) >= opts.cap;
    const full = v >= max || capHit;
    return `<div class="pick${v ? ' sel' : ''}"><button class="card-res ${r} pick-add" data-act="step" data-k="${kind}" data-r="${r}" data-d="1" ${full ? 'aria-disabled="true"' : ''} aria-label="Add one ${RES_NAME[r].toLowerCase()}">${ic(r)}</button>${opts.extra ? opts.extra(r) : ''}
      <div class="stepper"><button data-act="step" data-k="${kind}" data-r="${r}" data-d="-1" ${v <= 0 ? 'disabled' : ''} aria-label="Less ${RES_NAME[r]}">−</button><output>${v}</output><button data-act="step" data-k="${kind}" data-r="${r}" data-d="1" ${v >= max || capHit ? 'disabled' : ''} aria-label="More ${RES_NAME[r]}">+</button></div></div>`;
  }).join('')}</div>`;
}

function currentModal() {
  const g = app.g;
  const d = g && g.view;
  const s = d && d.game;
  const me = myIndexIn(d);
  if (app.view === 'room' && s && me >= 0) {
    const need = Engine.discardNeeded(s, me);
    if (s.phase === 'discard' && need) {
      const wait = typeof FX !== 'undefined' ? FX.holdFor() : 0;
      if (wait > 0) { clearTimeout(app.ui.modalWait); app.ui.modalWait = setTimeout(renderModal, wait + 30); return null; }
      return { type: 'discard', need };
    }
    if (s.phase === 'steal' && s.cur === me) return { type: 'steal' };
  }
  const mm = app.ui.modal;
  if (mm && mm.type === 'counter' && (!s || !s.trade || s.trade.id !== mm.id || (me >= 0 && s.trade.resp[me] !== undefined))) {
    app.ui.modal = null;
    if (!s || !s.trade || s.trade.id !== mm.id) toast(offerEndedText(s));
  }
  if (mm && mm.type === 'trade' && (!s || s.phase !== 'main' || s.cur !== me)) { app.ui.modal = null; if (s && s.phase !== 'ended' && s.cur !== me) toast('Your turn ended.'); }
  if (app.ui.modal) return app.ui.modal;
  if (app.view === 'room' && d && d.status === 'ended' && s && app.ui.endDismissed !== d.code + ':' + d.endedAt) return { type: 'end' };
  return null;
}

function renderModal() {
  const root = $('#modalRoot');
  if (!root) return;
  const m = currentModal();
  const mtype = m ? m.type : null;
  if (mtype && mtype !== app.ui.lastModal && mtype !== 'end') Sound.play('open');
  app.ui.lastModal = mtype;
  if (!m) { setHTML(root, ''); return; }
  const g = app.g, d = g && g.view, s = d && d.game, me = myIndexIn(d);
  let body = '', wide = false, dismiss = true;
  if (m.type === 'discard') {
    dismiss = false;
    const key = s.rollId + ':' + m.need;
    if (!app.ui.disc || app.ui.disc.key !== key) app.ui.disc = { key, res: Engine.emptyRes() };
    const P = s.players[me];
    const t = Engine.total(app.ui.disc.res);
    body = `<h2>Discard ${m.need} cards</h2><p class="sub">A 7 was rolled and you hold more than ${s.settings.discardLimit} cards. Pick the ones to give back.</p>
      ${picker('disc', app.ui.disc.res, { max: r => P.res[r], cap: m.need, extra: r => `<span class="have">have ${P.res[r]}</span>` })}
      <div class="modal-actions"><button class="btn primary" data-act="disc-send" ${t === m.need ? '' : 'disabled'}>Discard ${t}/${m.need}</button></div>`;
  } else if (m.type === 'steal') {
    dismiss = false;
    const busy = isBusy();
    body = `<h2>Rob a neighbour</h2><p class="sub">You take one random card from the player you pick.</p><div class="victims">${s.stealCands.map(q => `<div class="victim"><span>${pTag(s, q)} <span class="note">· ${s.players[q].nCards != null ? s.players[q].nCards : Engine.total(s.players[q].res)} cards</span></span><button class="btn primary small" data-act="steal" data-q="${q}" ${busy ? 'disabled' : ''}>Rob</button></div>`).join('')}</div>`;
  } else if (m.type === 'trade' || m.type === 'counter') {
    wide = true;
    body = tradeModal(s, me, m);
  } else if (m.type === 'yop') {
    const err = tradeCheck(s, me, { t: 'play', card: 'yearOfPlenty', res: m.res });
    body = `<h2>Year of Plenty</h2><p class="sub">Take any two resources from the bank.</p>${picker('yop', m.res, { max: r => s.bank[r], cap: 2, extra: r => `<span class="have">bank ${s.bank[r]}</span>` })}
      <div class="modal-actions"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="yop-send" ${err ? 'disabled' : ''}>Take ${Engine.total(m.res)}/2</button></div>`;
  } else if (m.type === 'mono') {
    body = `<h2>Monopoly</h2><p class="sub">Name a resource. Every other player hands you all of theirs.</p><div class="picker">${Engine.RES.map(r => `<div class="pick${m.r === r ? ' sel' : ''}"><button class="whole" data-act="mono-pick" data-r="${r}" aria-pressed="${m.r === r}"><div class="card-res ${r}">${ic(r)}</div><span>${RES_NAME[r]}</span></button></div>`).join('')}</div>
      <div class="modal-actions"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="mono" data-r="${m.r || ''}" ${m.r ? '' : 'disabled'}>${m.r ? 'Take all the ' + RES_NAME[m.r].toLowerCase() : 'Pick a resource'}</button></div>`;
  } else if (m.type === 'sound') {
    body = `<h2>Sound</h2><p class="sub">Effects play for game events. The music is a quiet background track. Press M anytime to mute or unmute everything.</p>
      <div class="snd">
        <label class="switch snd-all"><input type="checkbox" id="sndAll"> <span>All sound</span></label>
        <div class="snd-row"><label class="switch"><input type="checkbox" id="sndFx"> <span>Effects</span></label><input type="range" id="sndFxVol" min="0" max="100" step="1" aria-label="Effects volume"><output id="sndFxOut"></output></div>
        <div class="snd-row"><label class="switch"><input type="checkbox" id="sndMusic"> <span>Music</span></label><input type="range" id="sndMusicVol" min="0" max="100" step="1" aria-label="Music volume"><output id="sndMusicOut"></output></div>
      </div>
      <div class="modal-actions"><button class="btn" data-act="snd-test">Test effects</button><button class="btn primary" data-act="close">Done</button></div>`;
  } else if (m.type === 'rules') {
    wide = true;
    body = `<h2>How to play</h2>${rulesHTML()}<div class="modal-actions"><button class="btn primary" data-act="close">Got it</button></div>`;
  } else if (m.type === 'leave') {
    body = `<h2>Leave the table?</h2><p class="sub">You're hosting this game. While you're away the game pauses, unless another player who can edit this page takes over hosting.</p><div class="modal-actions"><button class="btn" data-act="close">Stay</button><button class="btn primary" data-act="leave-now">Leave</button></div>`;
  } else if (m.type === 'del') {
    body = `<h2>Delete table ${esc(m.code)}?</h2><p class="sub">The game and its chat are removed for everyone.</p><div class="modal-actions"><button class="btn" data-act="close">Keep it</button><button class="btn primary danger" data-act="del-now" data-code="${esc(m.code)}">Delete</button></div>`;
  } else if (m.type === 'end') {
    wide = true;
    body = endScreen(d, s, me);
  }
  setHTML(root, `<div class="modal-back" ${dismiss ? 'data-act="backdrop"' : ''}><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${body}</div></div>`);
  if (m.type === 'sound') bindSoundPanel();
}
function bindSoundPanel() {
  const all = $('#sndAll');
  if (!all || all._bound) return;
  all._bound = true;
  const fx = $('#sndFx'), fv = $('#sndFxVol'), mu = $('#sndMusic'), mv = $('#sndMusicVol');
  const show = () => {
    const c = Sound.get();
    all.checked = !c.muted; fx.checked = c.sfxOn; mu.checked = c.musicOn;
    fv.value = Math.round(c.sfxVol * 100); mv.value = Math.round(c.musicVol * 100);
    $('#sndFxOut').textContent = fv.value + '%'; $('#sndMusicOut').textContent = mv.value + '%';
    fx.disabled = fv.disabled = mu.disabled = mv.disabled = c.muted;
    soundIcons();
  };
  show();
  all.onchange = () => { Sound.set({ muted: !all.checked }); show(); };
  fx.onchange = () => { Sound.set({ sfxOn: fx.checked }); show(); };
  mu.onchange = () => { Sound.set({ musicOn: mu.checked }); show(); };
  fv.oninput = () => { Sound.set({ sfxVol: fv.value / 100 }); $('#sndFxOut').textContent = fv.value + '%'; };
  fv.onchange = () => Sound.play('coin');
  mv.oninput = () => { Sound.set({ musicVol: mv.value / 100 }); $('#sndMusicOut').textContent = mv.value + '%'; };
}

/* ---------- trade window ---------- */
function bankCredits(m, rt) { return Engine.RES.reduce((n, r) => n + Math.floor((m.give[r] || 0) / rt[r]), 0); }
function tileRow(kind, m, info) {
  // info(r) -> { dis: reason|'' , note: html, badge: html }
  return `<div class="tiles">${Engine.RES.map(r => {
    const v = m[kind][r] || 0;
    const x = info(r);
    return `<div class="tile-wrap"><button class="tile ${r}${v ? ' sel' : ''}" data-act="tadd" data-k="${kind}" data-r="${r}" ${x.dis ? `aria-disabled="true" title="${esc(x.dis)}"` : `title="Add ${RES_NAME[r].toLowerCase()}"`} aria-label="${kind === 'give' ? 'Give' : 'Get'} ${RES_NAME[r]}${v ? ', ' + v + ' picked' : ''}">
        ${ic(r)}${x.badge || ''}${v ? `<span class="cnt">${v}</span>` : ''}</button>
      <span class="tile-note">${x.note || ''}</span>
      ${v ? `<button class="tile-minus" data-act="tsub" data-k="${kind}" data-r="${r}" aria-label="Remove one ${RES_NAME[r].toLowerCase()}">−</button>` : ''}</div>`;
  }).join('')}</div>`;
}
function tradeModal(s, me, m) {
  const E = Engine;
  const P = s.players[me];
  if (m.type === 'counter') {
    const t = s.trade;
    const err = tradeCheck(s, me, { t: 'counter', id: m.id, give: m.give, get: m.get });
    const changed = E.RES.some(r => (m.give[r] || 0) !== (t.get[r] || 0) || (m.get[r] || 0) !== (t.give[r] || 0));
    return `<h2>Counter-offer</h2><p class="sub">${pTag(s, t.from)} offered ${tradeCards(t.give)} for ${tradeCards(t.get)}. Change the terms and send them back. They'll see you're writing one.</p>
      <div class="tr-sec"><div class="tr-lbl">You give</div>${tileRow('give', m, r => ({ dis: P.res[r] - (m.give[r] || 0) <= 0 ? 'You have no more ' + RES_NAME[r].toLowerCase() : '', note: 'have ' + P.res[r] }))}</div>
      <div class="tr-sec"><div class="tr-lbl">You get</div>${tileRow('get', m, r => ({ dis: E.total(m.get) >= 10 ? 'That\'s plenty' : '', note: '' }))}</div>
      <div class="tr-sum">${E.total(m.give) && E.total(m.get) ? `You give ${tradeCards(m.give)} <span class="ft-swap">${ic('trade')}</span> you get ${tradeCards(m.get)}` : '<span class="note">Pick at least one card on each side.</span>'}</div>
      <div class="modal-actions"><button class="btn" data-act="close">Never mind</button><button class="btn primary" data-act="counter-send" ${err || !changed ? `disabled title="${esc(err || 'Change something first')}"` : ''}>Send counter-offer</button></div>`;
  }
  const tab = m.tab || 'players';
  const tabs = `<div class="tr-tabs" role="tablist"><button role="tab" data-act="ttab" data-tab="players" aria-selected="${tab === 'players'}">${ic('people')}Players</button><button role="tab" data-act="ttab" data-tab="bank" aria-selected="${tab === 'bank'}">${ic('bank')}Bank</button></div>`;
  if (tab === 'bank') {
    const rt = E.rates(s, me);
    const credits = bankCredits(m, rt);
    const picked = E.total(m.get);
    const err = tradeCheck(s, me, { t: 'bank', give: m.give, get: m.get });
    const ports = E.RES.filter(r => rt[r] < 4);
    let sum;
    if (!E.total(m.give)) sum = '<span class="note">Tap a resource you have plenty of. Each tap adds one batch at your rate.</span>';
    else if (picked < credits) sum = `You give ${tradeCards(m.give)} <span class="ft-swap">${ic('trade')}</span> <span class="note">now pick ${credits - picked} card${credits - picked > 1 ? 's' : ''} to get</span>`;
    else sum = `You give ${tradeCards(m.give)} <span class="ft-swap">${ic('trade')}</span> you get ${tradeCards(m.get)}`;
    return `<h2>Trade</h2>${tabs}
      <p class="sub">Your rates: ${ports.length ? E.RES.map(r => `<span class="rate-pill${rt[r] < 4 ? ' good' : ''}">${ri(r)} ${rt[r]}:1</span>`).join(' ') : '4:1 for everything. Build on a harbour for better rates.'}</p>
      <div class="tr-sec"><div class="tr-lbl">You give</div>${tileRow('give', m, r => ({ dis: m.get[r] ? 'You\'re getting ' + RES_NAME[r].toLowerCase() : P.res[r] - (m.give[r] || 0) < rt[r] ? 'You need ' + rt[r] + ' ' + RES_NAME[r].toLowerCase() + ' for one card' : '', badge: `<span class="rate-badge${rt[r] < 4 ? ' good' : ''}">${rt[r]}:1</span>`, note: 'have ' + P.res[r] }))}</div>
      <div class="tr-sec"><div class="tr-lbl">You get</div>${tileRow('get', m, r => ({ dis: m.give[r] ? 'You\'re giving ' + RES_NAME[r].toLowerCase() : !credits ? 'Pick what to give first' : picked >= credits ? 'Give more to get more' : s.bank[r] - (m.get[r] || 0) <= 0 ? 'The bank has no ' + RES_NAME[r].toLowerCase() + ' left' : '', note: 'bank ' + s.bank[r] }))}</div>
      <div class="tr-sum">${sum}</div>
      <div class="modal-actions"><button class="btn" data-act="tclear" ${E.total(m.give) + picked ? '' : 'disabled'}>Clear</button><button class="btn primary" data-act="bank" ${err ? `disabled title="${esc(err)}"` : ''}>${ic('bank')}Trade with the bank</button></div>`;
  }
  const err = tradeCheck(s, me, { t: 'offer', give: m.give, get: m.get });
  const others = s.players.map((_, i) => i).filter(i => i !== me);
  const sum = E.total(m.give) && E.total(m.get) ? `You give ${tradeCards(m.give)} <span class="ft-swap">${ic('trade')}</span> you get ${tradeCards(m.get)}`
    : `<span class="note">${!E.total(m.give) && !E.total(m.get) ? 'Tap cards to build your offer: what you give on top, what you want below.' : !E.total(m.give) ? 'Now pick what you give.' : 'Now pick what you want.'}</span>`;
  return `<h2>Trade</h2>${tabs}
    <div class="tr-sec"><div class="tr-lbl">You give</div>${tileRow('give', m, r => ({ dis: P.res[r] - (m.give[r] || 0) <= 0 ? (P.res[r] ? 'That\'s all your ' + RES_NAME[r].toLowerCase() : 'You have no ' + RES_NAME[r].toLowerCase()) : '', note: 'have ' + P.res[r] }))}</div>
    <div class="tr-sec"><div class="tr-lbl">You want</div>${tileRow('get', m, r => ({ dis: E.total(m.get) >= 10 ? 'That\'s plenty' : '', note: '' }))}</div>
    <div class="tr-sum">${sum}</div>
    <div class="tr-to"><span class="lbl">Goes to</span>${others.map(i => `<span class="to-pill"><span class="sw" style="background:${COLOR_HEX[s.players[i].color]}"></span>${esc(pName(s, i))}<span class="note">${s.players[i].nCards != null ? s.players[i].nCards : E.total(s.players[i].res)} cards</span></span>`).join('')}</div>
    <div class="modal-actions"><button class="btn" data-act="tclear" ${E.total(m.give) + E.total(m.get) ? '' : 'disabled'}>Clear</button><button class="btn primary" data-act="offer" ${err ? `disabled title="${esc(err)}"` : ''}>${ic('trade')}Send offer</button></div>`;
}

function tradeCheck(s, me, a) {
  if (me < 0) return 'You are watching.';
  try { Engine.apply(s, me, a, () => 0.5); return ''; } catch (e) { return e.message || 'Not possible.'; }
}

function endScreen(d, s, me) {
  const E = Engine;
  const g = app.g;
  const isOwner = canManage(d);
  const rows = s.players.map((pl, i) => {
    let st = 0, ci = 0;
    s.bld.forEach(b => { if (b && b.p === i) { if (b.city) ci++; else st++; } });
    return { i, st, ci, lr: s.lr.p === i ? 2 : 0, la: s.la.p === i ? 2 : 0, vpc: E.vpCards(s, i), total: E.vp(s, i) };
  }).sort((a, b) => b.total - a.total);
  const table = `<table class="score-table"><thead><tr><th>Player</th><th>Settlements</th><th>Cities</th><th>Road</th><th>Army</th><th>VP cards</th><th>Total</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.i === s.winner ? 'win' : ''}"><td>${pTag(s, r.i)}</td><td>${r.st}</td><td>${r.ci} <span class="note">(${r.ci * 2})</span></td><td>${r.lr}</td><td>${r.la}</td><td>${r.vpc}</td><td><b>${r.total}</b></td></tr>`).join('')}</tbody></table>`;
  const statsRows = `<table class="score-table" style="margin-top:12px"><thead><tr><th>Player</th><th>Cards from rolls</th><th>Cards stolen</th><th>Cards lost</th><th>Knights</th></tr></thead><tbody>${s.players.map((pl, i) => `<tr><td>${pTag(s, i)}</td><td>${s.stats.gained[i]}</td><td>${s.stats.stolen[i]}</td><td>${s.stats.lost[i]}</td><td>${pl.knights}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="winner-line"><span class="sw" style="background:${COLOR_HEX[s.players[s.winner].color]}"></span><div><div class="eyebrow">Game over · ${s.turn} turns</div><h2>${s.winner === me ? 'You win!' : esc(pName(s, s.winner)) + ' wins'}</h2></div></div>
    <div class="table-scroll">${table}</div><div class="table-scroll">${statsRows}</div>
    <div class="eyebrow" style="margin-top:16px">Dice rolls</div><div class="chart-wrap">${diceChart(s.stats.rolls)}</div>
    <div class="modal-actions"><button class="btn" data-act="end-dismiss">View the board</button><button class="btn" data-act="home">Back to tables</button>${isOwner ? `<button class="btn primary" data-act="rematch">${g.local ? 'Play again' : 'Rematch'}</button>` : ''}</div>`;
}

function diceChart(rolls) {
  const W = 520, H = 180, padL = 28, padB = 24, padT = 24;
  const n = rolls.reduce((a, b) => a + b, 0) || 1;
  const exp = k => n * (6 - Math.abs(7 - k)) / 36;
  const max = Math.max(1, ...rolls.slice(2), ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(exp));
  const bw = (W - padL - 10) / 11;
  const y = v => H - padB - (v / max) * (H - padB - padT);
  let bars = '', line = '', ticks = '';
  for (let k = 2; k <= 12; k++) {
    const x = padL + (k - 2) * bw;
    const v = rolls[k] || 0;
    bars += `<rect x="${(x + 4).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 8).toFixed(1)}" height="${(H - padB - y(v)).toFixed(1)}" rx="3" fill="${k === 7 ? '#8a93a5' : k === 6 || k === 8 ? '#e6b05a' : '#4f86b8'}"><title>${k}: rolled ${v} times (expected ${exp(k).toFixed(1)})</title></rect>`;
    bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y(v) - 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#e9eef1">${v}</text>`;
    ticks += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="12" fill="#8fa5b6">${k}</text>`;
    line += (k === 2 ? 'M' : 'L') + (x + bw / 2).toFixed(1) + ' ' + y(exp(k)).toFixed(1);
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Dice roll counts versus expected"><line x1="${padL}" x2="${W - 6}" y1="${H - padB}" y2="${H - padB}" stroke="#24425c"/>${bars}<path d="${line}" fill="none" stroke="#f3e8cf" stroke-width="1.6" stroke-dasharray="4 4"/>${ticks}<text x="${W - 8}" y="${padT + 8}" text-anchor="end" font-size="11" fill="#8fa5b6">dashed line: expected</text></svg>`;
}

/* ============================================================
   EVENTS
   ============================================================ */
function offerEndedText(s) {
  if (!s) return 'The offer closed.';
  for (let i = s.log.length - 1; i >= Math.max(0, s.log.length - 30); i--) {
    const e = s.log[i];
    if (e.k === 'trade') return `${pName(s, e.p)} traded with ${pName(s, e.q)}, so the offer closed.`;
    if (e.k === 'turn') return 'The turn ended, so the offer closed.';
    if (e.k === 'offer') break;
  }
  return 'The offer was withdrawn.';
}
function dismissEnd() {
  const m = currentModal();
  if (!m || m.type !== 'end') return false;
  const d = app.g.view;
  app.ui.endDismissed = d.code + ':' + d.endedAt;
  render();
  return true;
}
function closeModal() {
  const m = app.ui.modal;
  app.ui.modal = null;
  const s = app.g && app.g.view && app.g.view.game;
  if (m && m.type === 'counter' && s && s.trade && s.trade.id === m.id && s.trade.drafting && s.trade.drafting[myIndexIn(app.g.view)]) send({ t: 'draft', id: m.id, on: false });
  render();
}
function leaveRoom() {
  Emotes.close();
  closeSession();
  app.view = 'home';
  setHash('');
  render();
}

function handleAct(act, ds, el) {
  const g = app.g;
  const d = g && g.view;
  const s = d && d.game;
  const me = myIndexIn(d);
  const m = app.ui.modal;
  switch (act) {
    case 'create': {
      const n = ($('#homeName') && $('#homeName').value.trim()) || app.me.name;
      if (!n) { toast('Enter your name first.', 'error'); if ($('#homeName')) $('#homeName').focus(); return; }
      setMyName(n);
      return createTable(n);
    }
    case 'autoplay': return send({ t: 'autoplay', i: +ds.i, on: !!ds.on });
    case 'open': return openTable(ds.code);
    case 'del': app.ui.modal = { type: 'del', code: ds.code }; return render();
    case 'del-now': app.ui.modal = null; render(); return deleteTable(ds.code);
    case 'pbots': app.ui.practice.bots = +ds.n; return renderPractice();
    case 'pmap': app.ui.practice.map = ds.v; return renderPractice();
    case 'playout': app.ui.practice.layout = ds.v; return renderPractice();
    case 'pdice': app.ui.practice.dice = ds.v; return renderPractice();
    case 'pvp': app.ui.practice.vp = Math.max(5, Math.min(20, app.ui.practice.vp + +ds.d)); return renderPractice();
    case 'practice': {
      const p = app.ui.practice;
      app.ui.lastPractice = { bots: p.bots, level: p.level || 'normal', settings: { vpToWin: p.vp, layout: p.layout, dice: p.dice || 'random', friendlyRobber: p.friendly, map: p.map || 'standard', maxPlayers: p.bots + 1 } };
      return startPractice(app.ui.lastPractice);
    }
    case 'home':
      return leaveRoom();
    case 'leave-now': app.ui.modal = null; return leaveRoom();
    case 'rules': app.ui.modal = { type: 'rules' }; return render();
    case 'sound': app.ui.modal = { type: 'sound' }; return render();
    case 'snd-test': ['dice', 'settlement', 'coin', 'yourTurn'].forEach((n, i) => Sound.play(n, { delay: i * 0.6 })); return;
    case 'copy-invite': {
      if (!g) return;
      return copyText(inviteLink(g.code), 'Invite link copied.');
    }
    case 'unsit': return send({ t: 'leave' });
    case 'color': return send({ t: 'color', color: ds.c });
    case 'addbot': return send({ t: 'addBot' });
    case 'kick': return send({ t: 'kick', i: +ds.i });
    case 'set': {
      let v = ds.v;
      if (ds.k === 'friendlyRobber') v = v === 'true';
      else if (ds.k === 'maxPlayers' || ds.k === 'timer') v = +v;
      return send({ t: 'settings', settings: { [ds.k]: v } });
    }
    case 'setmap': return send({ t: 'settings', settings: { map: ds.v } });
    case 'setvp': return send({ t: 'settings', settings: { vpToWin: d.settings.vpToWin + +ds.d } });
    case 'setdl': return send({ t: 'settings', settings: { discardLimit: d.settings.discardLimit + +ds.d } });
    case 'start': return send({ t: 'start' });
    case 'rematch':
      app.ui.modal = null;
      if (g.local) return startPractice(app.ui.lastPractice || { bots: 3, settings: {} });
      return send({ t: 'rematch' });
    case 'end-dismiss': app.ui.endDismissed = d.code + ':' + d.endedAt; return render();
    case 'show-results': app.ui.endDismissed = null; return render();
    case 'roll': app.ui.costs = false; return send({ t: 'roll' });
    case 'mode': app.ui.mode = ds.m && app.ui.mode !== ds.m ? ds.m : null; clearTimeout(app.ui.previewTimer); if (app.ui.mode) app.ui.preview = null; return render();
    case 'buydev': return send({ t: 'buyDev' });
    case 'end': app.ui.mode = null; app.ui.costs = false; return send({ t: 'end' });
    case 'pass': app.ui.mode = null; app.ui.costs = false; return send({ t: 'pass' });
    case 'costs': app.ui.costs = !app.ui.costs; return render();
    case 'skiproads': return send({ t: 'skipRoads' });
    case 'play': {
      const c = ds.card;
      if (c === 'yearOfPlenty') { app.ui.modal = { type: 'yop', res: Engine.emptyRes() }; return render(); }
      if (c === 'monopoly') { app.ui.modal = { type: 'mono' }; return render(); }
      return send({ t: 'play', card: c });
    }
    case 'trade': app.ui.mode = null; app.ui.preview = null; app.ui.modal = { type: 'trade', tab: app.ui.tradeTab || 'players', give: Engine.emptyRes(), get: Engine.emptyRes() }; return render();
    case 'ttab': if (m) { m.tab = app.ui.tradeTab = ds.tab; m.give = Engine.emptyRes(); m.get = Engine.emptyRes(); } return renderModal();
    case 'tclear': if (m) { m.give = Engine.emptyRes(); m.get = Engine.emptyRes(); } return renderModal();
    case 'tadd': case 'tsub': {
      if (!m || !s || me < 0) return;
      const k = ds.k, r = ds.r, other = k === 'give' ? m.get : m.give;
      const bank = m.type === 'trade' && m.tab === 'bank';
      const step = bank && k === 'give' ? Engine.rates(s, me)[r] : 1;
      if (act === 'tadd') { m[k][r] = (m[k][r] || 0) + step; other[r] = 0; }
      else m[k][r] = Math.max(0, (m[k][r] || 0) - step);
      if (bank) { // never ask the bank for more than the cards given pay for
        const credits = bankCredits(m, Engine.rates(s, me));
        let extra = Engine.total(m.get) - credits;
        for (const x of [...Engine.RES].reverse()) while (extra > 0 && m.get[x]) { m.get[x]--; extra--; }
      }
      return renderModal();
    }
    case 'step': {
      const k = ds.k, r = ds.r, dd = +ds.d;
      let target;
      if (k === 'disc') target = app.ui.disc && app.ui.disc.res;
      else if (k === 'yop' && m) target = m.res;
      else if ((k === 'give' || k === 'get') && m) target = m[k];
      if (!target) return;
      target[r] = Math.max(0, (target[r] || 0) + dd);
      if ((k === 'give' || k === 'get') && m) { const other = k === 'give' ? m.get : m.give; if (dd > 0 && other[r]) other[r] = 0; }
      return renderModal();
    }
    case 'disc-send': return send({ t: 'discard', res: Object.assign({}, app.ui.disc.res) });
    case 'steal': return send({ t: 'steal', q: +ds.q });
    case 'yop-send': { const res = Object.assign({}, m.res); if (send({ t: 'play', card: 'yearOfPlenty', res })) { app.ui.modal = null; render(); } return; }
    case 'mono-pick': if (m) { m.r = ds.r; renderModal(); } return;
    case 'mono': if (!ds.r) return; if (send({ t: 'play', card: 'monopoly', r: ds.r })) { app.ui.modal = null; render(); } return;
    case 'offer': if (send({ t: 'offer', give: Object.assign({}, m.give), get: Object.assign({}, m.get) })) { app.ui.modal = null; render(); } return;
    case 'bank': if (send({ t: 'bank', give: Object.assign({}, m.give), get: Object.assign({}, m.get) })) { m.give = Engine.emptyRes(); m.get = Engine.emptyRes(); toast('Traded with the bank.'); render(); } return;
    case 'counter-open': {
      if (!s || !s.trade) return;
      app.ui.modal = { type: 'counter', id: s.trade.id, give: Object.assign(Engine.emptyRes(), s.trade.get), get: Object.assign(Engine.emptyRes(), s.trade.give) };
      send({ t: 'draft', id: s.trade.id, on: true }); // lets everyone see you're writing a counter
      return render();
    }
    case 'counter-send': if (send({ t: 'counter', id: m.id, give: Object.assign({}, m.give), get: Object.assign({}, m.get) })) { app.ui.modal = null; render(); } return;
    case 'accept': return send({ t: 'respond', id: +ds.id, r: 'accept' });
    case 'decline': return send({ t: 'respond', id: +ds.id, r: 'decline' });
    case 'confirm': return send({ t: 'confirm', id: +ds.id, q: +ds.q });
    case 'cancel-offer': return send({ t: 'cancel' });
    case 'tab': app.ui.tab = ds.tab; return render();
    case 'translate': return d ? translateChat(d, +ds.k) : undefined;
    case 'emotes': return Emotes.toggle(el);
    case 'emote': return Emotes.sendEmote({ e: ds.e });
    case 'qchat': return Emotes.sendEmote(ds.r ? { q: ds.q, r: ds.r } : { q: ds.q });
    case 'botlvl': return send({ t: 'botLevel', i: +ds.i, level: ds.l });
    case 'plevel': app.ui.practice.level = ds.v; return renderPractice();
    case 'close': return closeModal();
    case 'backdrop': return;
  }
}

function onVertex(v) {
  const g = app.g; const d = g && g.view; const s = d && d.game; if (!s) return;
  const me = myIndexIn(d);
  if (s.phase === 'setup') return send({ t: 'settle', v });
  if (app.ui.mode === 'settle') { if (send({ t: 'settle', v })) app.ui.mode = null; return render(); }
  if (app.ui.mode === 'city') { if (send({ t: 'city', v })) app.ui.mode = null; return render(); }
}
function onEdge(e) {
  const g = app.g; const d = g && g.view; const s = d && d.game; if (!s) return;
  if (s.phase === 'setup' || s.phase === 'roadBuilding') return send({ t: 'road', e });
  if (app.ui.mode === 'road') { if (send({ t: 'road', e })) app.ui.mode = null; return render(); }
}
function onHex(h) { send({ t: 'robber', h }); }

function bindEvents() {
  const wake = () => Sound.unlock();
  // phones only allow audio from a finished tap, so listen to the end of touches and clicks too
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, wake, true);
  document.addEventListener('click', e => {
    if (app.ui.held && e.target.closest('[data-prev]')) { app.ui.held = 0; return; } // that was a press-and-hold, not a tap
    if (app.ui.emotesOpen && !e.target.closest('#emotePop') && !e.target.closest('[data-act=emotes]')) Emotes.close();
    const t = e.target.closest('[data-act]');
    if (t) {
      if (t.disabled) return;
      if (t.getAttribute('aria-disabled') === 'true') {
        if (t.dataset.act === 'mode') { if (app.ui.lastPointer === 'touch') togglePreview(t.dataset.m, true); if (t.title) toast(t.title); }
        else if (t.title) toast(t.title, 'error');
        return;
      }
      if (t.dataset.act !== 'backdrop') Sound.play(t.dataset.act === 'step' ? 'step' : 'click');
      if (t.dataset.act === 'backdrop' && e.target !== t) return;
      if (t.dataset.act === 'backdrop') { if (app.ui.modal) closeModal(); else dismissEnd(); return; }
      handleAct(t.dataset.act, t.dataset, t);
      return;
    }
    const v = e.target.closest('[data-v]'); if (v && v.closest('#board')) return onVertex(+v.dataset.v);
    const ed = e.target.closest('[data-e]'); if (ed) return onEdge(+ed.dataset.e);
    const h = e.target.closest('[data-h]'); if (h) return onHex(+h.dataset.h);
    if (app.ui.costs && !e.target.closest('.costs-pop')) { app.ui.costs = false; render(); }
  });
  // build previews follow a mouse or keyboard focus; touch screens use a tap on a greyed-out button instead
  document.addEventListener('pointerover', e => {
    const b = e.target.closest && e.target.closest('[data-prev]');
    if (!b || e.pointerType === 'touch') return;
    if (app.ui.preview !== b.dataset.prev) { clearTimeout(app.ui.previewTimer); app.ui.preview = b.dataset.prev; renderPreview(); syncPeekButtons(); }
  });
  document.addEventListener('pointerout', e => {
    const b = e.target.closest && e.target.closest('[data-prev]');
    if (!b || e.pointerType === 'touch' || (e.relatedTarget && b.contains(e.relatedTarget))) return;
    if (app.ui.preview === b.dataset.prev) { app.ui.preview = null; renderPreview(); syncPeekButtons(); }
  });
  // on touch screens, press and hold any build button to see the spots
  document.addEventListener('pointerdown', e => {
    app.ui.lastPointer = e.pointerType;
    const b = e.target.closest && e.target.closest('[data-prev]');
    if (!b || e.pointerType !== 'touch') return;
    clearTimeout(app.ui.holdTimer);
    app.ui.held = 0;
    app.ui.holdTimer = setTimeout(() => { app.ui.held = 1; app.ui.preview = null; togglePreview(b.dataset.prev, true); }, 450);
  });
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => clearTimeout(app.ui.holdTimer));
  document.addEventListener('focusin', e => { const b = e.target.closest && e.target.closest('[data-prev]'); let kb = false; try { kb = b && b.matches(':focus-visible'); } catch (x) { } if (b && kb) { app.ui.preview = b.dataset.prev; renderPreview(); syncPeekButtons(); } });
  document.addEventListener('focusout', e => { const b = e.target.closest && e.target.closest('[data-prev]'); if (b && app.ui.preview === b.dataset.prev) { app.ui.preview = null; renderPreview(); syncPeekButtons(); } });
  document.addEventListener('keydown', e => {
    const typing = e.target.matches && e.target.matches('textarea, select, input:not([type=checkbox]):not([type=range]):not([type=radio])');
    if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
      const off = !Sound.get().muted;
      Sound.set({ muted: off });
      soundIcons();
      if ($('#sndAll')) { $('#sndAll')._bound = false; bindSoundPanel(); }
      toast(off ? 'Sound off. Press M to turn it back on.' : 'Sound on.');
      return;
    }
    if (e.key !== 'Escape') return;
    if (app.ui.emotesOpen) { Emotes.close(); return; }
    if (app.ui.modal) { closeModal(); return; }
    if (dismissEnd()) return;
    if (app.ui.mode || app.ui.costs) { app.ui.mode = null; app.ui.costs = false; render(); }
  });
  setInterval(() => {
    updateClock();
    const g = app.g;
    if (g && !g.local && app.view === 'room') {
      const hn = $('#hostNote');
      if (hn && g.pending.length && Date.now() - g.sentAt > 5000 && hn.textContent !== 'Waiting for the server…') renderTopbar(g);
    }
  }, 500);
}

/* ---------- start ---------- */
function boot() {
  // installed on a phone or computer: lets the app open (and practice work) without a connection
  if ('serviceWorker' in navigator && location.protocol !== 'file:') { try { navigator.serviceWorker.register('/sw.js').catch(() => { }); } catch (e) { } }
  mount();
  bindEvents();
  connect();
  const code = (location.hash || '').replace('#', '').toUpperCase();
  if (/^[A-Z0-9]{5}$/.test(code)) enterOnline(code);
  render();
  window.addEventListener('hashchange', () => {
    const c = (location.hash || '').replace('#', '').toUpperCase();
    if (/^[A-Z0-9]{5}$/.test(c) && (!app.g || app.g.code !== c)) enterOnline(c);
  });
}
boot();
