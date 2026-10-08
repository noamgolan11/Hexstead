/* ============================================================
   HEXSTEAD FX — makes every game event easy to see:
   big dice on each roll, a ripple and a name tag where something
   was built, cards flying between the bank, the board and the
   players, and a short ticker of what just happened.
   Driven by new log entries, so it shows the same thing to everyone.
   ============================================================ */
const FX = (() => {
  const S = 100;
  const st = { key: null, logId: 0, dice: null };
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  let quiet = false; // catching up on many old events: list them, don't animate them

  /* ---------- where things are on screen ---------- */
  function layer() {
    let el = document.getElementById('fx');
    if (!el) { el = document.createElement('div'); el.id = 'fx'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); }
    return el;
  }
  function svgPt(x, y) {
    const svg = document.getElementById('board');
    if (!svg || !svg.getScreenCTM) return null;
    const m = svg.getScreenCTM(); if (!m) return null;
    const p = svg.createSVGPoint(); p.x = x; p.y = y;
    const q = p.matrixTransform(m);
    return onScreen({ x: q.x, y: q.y });
  }
  function onScreen(p) { return p && p.x > -20 && p.y > -20 && p.x < innerWidth + 20 && p.y < innerHeight + 20 ? p : null; }
  function elCenter(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, el };
  }
  const T = s => Engine.topo(s);
  const hexAt = (s, hi) => { const c = T(s).centers[hi]; return c ? svgPt(c.x * S, c.y * S) : null; };
  const vertAt = (s, v) => { const c = T(s).verts[v]; return c ? svgPt(c.x * S, c.y * S) : null; };
  const edgeAt = (s, e) => { const t = T(s), E = t.edges[e]; if (!E) return null; const a = t.verts[E.a], b = t.verts[E.b]; return svgPt((a.x + b.x) / 2 * S, (a.y + b.y) / 2 * S); };
  function playerAt(i, me, r) {
    if (i === me) { const c = elCenter(r ? document.querySelector('.hand .card-res.' + r) : null) || elCenter(document.querySelector('.hand')); if (c) return c; }
    return elCenter(document.querySelector(`#players .pl:nth-child(${i + 1}) .stats span`)) || elCenter(document.querySelector(`#players .pl:nth-child(${i + 1})`));
  }
  // where a "+2" / "−4" goes: beside a player's points, or over the matching card in your own hand
  function scoreAt(i, me, r) {
    if (i === me) { const c = elCenter(r ? document.querySelector('.hand .card-res.' + r) : null) || elCenter(document.querySelector('.hand .card-res')); if (c) return { x: c.x, y: c.y - 24 }; }
    const v = document.querySelector(`#players .pl:nth-child(${i + 1}) .vp`);
    const c = elCenter(v);
    return c ? { x: c.x - 46, y: c.y } : null;
  }
  function bankAt() {
    const b = elCenter(document.getElementById('hudBank'));
    if (b) return b;
    const w = document.getElementById('boardWrap'); if (!w) return null;
    const r = w.getBoundingClientRect();
    return onScreen({ x: r.right - 36, y: r.top + 36 });
  }

  /* ---------- building blocks ---------- */
  const cardHTML = r => r ? `<span class="tcard ${r}">${ic(r)}</span>` : `<span class="fx-back">${ic('card')}</span>`;
  function bump(el) { try { el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' }); } catch (e) { } }
  function fly(from, to, r, delay, opts) {
    opts = opts || {};
    if (!from || !to || reduced() || quiet) return;
    const el = document.createElement('div');
    el.className = 'fx-fly' + (opts.small ? ' small' : '');
    el.innerHTML = opts.html || cardHTML(r);
    el.style.left = from.x + 'px'; el.style.top = from.y + 'px';
    layer().appendChild(el);
    const dx = to.x - from.x, dy = to.y - from.y;
    const lift = -Math.min(110, 30 + Math.hypot(dx, dy) * 0.22);
    let a;
    try {
      a = el.animate([
        { transform: 'translate(0,0) scale(.5)', opacity: 0 },
        { transform: `translate(${dx * 0.12}px,${dy * 0.12 + lift * 0.4}px) scale(1.1)`, opacity: 1, offset: 0.18 },
        { transform: `translate(${dx * 0.55}px,${dy * 0.55 + lift}px) scale(1.05)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx}px,${dy}px) scale(.75)`, opacity: 0.85 },
      ], { duration: opts.dur || 820, delay: delay || 0, easing: 'cubic-bezier(.35,.6,.3,1)', fill: 'both' });
    } catch (e) { el.remove(); return; }
    a.onfinish = () => { el.remove(); if (to.el) bump(to.el); };
  }
  function floatText(at, html, cls, delay) {
    if (!at || quiet) return;
    const el = document.createElement('div');
    el.className = 'fx-float ' + (cls || '');
    el.innerHTML = html;
    el.style.left = at.x + 'px'; el.style.top = at.y + 'px';
    layer().appendChild(el);
    const kf = reduced() ? [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }] : [{ transform: 'translate(-50%,-30%)', opacity: 0 }, { transform: 'translate(-50%,-90%)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,-140%)', opacity: 1, offset: 0.75 }, { transform: 'translate(-50%,-180%)', opacity: 0 }];
    try { el.animate(kf, { duration: 1700, delay: delay || 0, fill: 'both' }).onfinish = () => el.remove(); } catch (e) { setTimeout(() => el.remove(), 1800); }
  }
  // a ring that spreads out from a spot on the board, in the player's colour, plus a name tag
  function ripple(s, at, color, label, delay) {
    if (quiet) return;
    const g = document.getElementById('bFx');
    if (g && at.svg) {
      const NS = 'http://www.w3.org/2000/svg';
      for (const k of [0, 1]) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', at.svg.x); c.setAttribute('cy', at.svg.y); c.setAttribute('r', at.big ? 48 : 26);
        c.setAttribute('class', 'fx-ring'); c.style.stroke = color; c.style.animationDelay = ((delay || 0) + k * 260) + 'ms';
        g.appendChild(c);
        setTimeout(() => c.remove(), 1700 + (delay || 0) + k * 260);
      }
    }
    if (label && at.screen) {
      const el = document.createElement('div');
      el.className = 'fx-tag';
      el.style.left = at.screen.x + 'px'; el.style.top = at.screen.y + 'px'; el.style.borderColor = color;
      el.innerHTML = label;
      layer().appendChild(el);
      const tags = layer().querySelectorAll('.fx-tag'); // never more than two name tags on the board at once
      for (let i = 0; i < tags.length - 2; i++) tags[i].remove();
      const kf = [{ opacity: 0, transform: 'translate(-50%,-120%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%,-150%) scale(1)', offset: 0.14 }, { opacity: 1, transform: 'translate(-50%,-150%) scale(1)', offset: 0.82 }, { opacity: 0, transform: 'translate(-50%,-160%) scale(1)' }];
      try { el.animate(kf, { duration: 1500, delay: delay || 0, fill: 'both' }).onfinish = () => el.remove(); } catch (e) { setTimeout(() => el.remove(), 1600); }
    }
  }
  function spot(s, kind, idx) {
    const t = T(s);
    let c;
    if (kind === 'v') c = t.verts[idx];
    else if (kind === 'h') c = t.centers[idx];
    else { const E = t.edges[idx]; if (!E) return null; const a = t.verts[E.a], b = t.verts[E.b]; c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    if (!c) return null;
    return { svg: { x: c.x * S, y: c.y * S }, screen: svgPt(c.x * S, c.y * S), big: kind === 'h' };
  }

  /* ---------- the big dice ---------- */
  function showDice(s, e, me) {
    if (quiet) return;
    const wrap = document.getElementById('boardWrap');
    if (!wrap) return;
    let box = document.getElementById('fxDice');
    if (!box) { box = document.createElement('div'); box.id = 'fxDice'; box.className = 'fx-dice'; wrap.appendChild(box); }
    clearInterval(st.diceSpin); clearTimeout(st.diceHide);
    const sum = e.d[0] + e.d[1];
    const who = e.p === me ? 'You rolled' : esc(pName(s, e.p)) + ' rolled';
    const color = COLOR_HEX[s.players[e.p].color] || '#fff';
    const faces = (a, b) => `<div class="fx-dice-row"><span class="fx-die">${dieSVG(a)}</span><span class="fx-die">${dieSVG(b, true)}</span></div>`;
    const result = `<div class="fx-dice-sum${sum === 7 ? ' seven' : ''}">${sum}</div><div class="fx-dice-who"><span class="who" style="background:${color}"></span>${who} ${sum}${sum === 7 ? ' · robber!' : ''}</div>`;
    box.className = 'fx-dice show';
    if (reduced()) {
      box.innerHTML = faces(e.d[0], e.d[1]) + result;
    } else {
      let n = 0;
      box.innerHTML = faces(1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)) + `<div class="fx-dice-who"><span class="who" style="background:${color}"></span>${e.p === me ? 'You roll…' : esc(pName(s, e.p)) + ' rolls…'}</div>`;
      box.classList.add('spinning');
      st.diceSpin = setInterval(() => {
        if (++n < 8) { box.querySelector('.fx-dice-row').outerHTML = faces(1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)); return; }
        clearInterval(st.diceSpin);
        box.classList.remove('spinning');
        box.innerHTML = faces(e.d[0], e.d[1]) + result;
        box.classList.add('landed');
      }, 75);
    }
    st.diceHide = setTimeout(() => { box.className = 'fx-dice'; }, reduced() ? 1600 : 1700); // short, so the board is free to watch the cards
  }

  /* ---------- the end of a game: a moment for the winner ---------- */
  function clearBoardFx() {
    clearInterval(st.diceSpin); clearTimeout(st.diceHide);
    const d = document.getElementById('fxDice'); if (d) d.className = 'fx-dice';
    layer().querySelectorAll('.fx-tag, .fx-fly, .fx-float').forEach(x => x.remove());
  }
  function showWin(s, e, me) {
    if (quiet) return;
    clearBoardFx();
    const wrap = document.getElementById('boardWrap'); if (!wrap) return;
    const old = document.getElementById('fxWin'); if (old) old.remove();
    const color = COLOR_HEX[s.players[e.p].color] || '#e6b05a';
    const el = document.createElement('div');
    el.id = 'fxWin'; el.className = 'fx-win';
    el.style.setProperty('--pc', color);
    el.innerHTML = `<div class="fx-win-card"><span class="fx-win-crown">${ic('crown')}</span><div class="fx-win-title">${e.p === me ? 'You win!' : esc(pName(s, e.p)) + ' wins'}</div><div class="fx-win-sub">${e.vp} points · ${s.turn} turns</div></div>`;
    wrap.appendChild(el);
    st.holdUntil = Date.now() + (reduced() ? 1200 : 2800); // the results wait for this moment
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, reduced() ? 1200 : 2800);
    if (reduced()) return;
    // confetti in every player's colour
    const colors = s.players.map(p => COLOR_HEX[p.color]).concat(['#e6b05a', '#f3e8cf']);
    const r = wrap.getBoundingClientRect();
    for (let i = 0; i < 70; i++) {
      const c = document.createElement('i');
      c.className = 'fx-confetti';
      c.style.background = colors[i % colors.length];
      c.style.left = (r.left + r.width / 2) + 'px'; c.style.top = (r.top + r.height * 0.42) + 'px';
      layer().appendChild(c);
      const ang = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 260;
      const dx = Math.cos(ang) * sp, dy = Math.sin(ang) * sp * 0.7 - 120;
      try {
        c.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) rotate(${Math.random() * 720}deg)`, opacity: 1, offset: 0.45 }, { transform: `translate(${dx * 1.15}px,${dy + 360}px) rotate(${Math.random() * 1080}deg)`, opacity: 0 }], { duration: 2200 + Math.random() * 900, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' }).onfinish = () => c.remove();
      } catch (err) { c.remove(); }
    }
  }

  /* ---------- the ticker: the last few things that happened ---------- */
  function ticker(html, color) {
    const wrap = document.getElementById('boardWrap');
    if (!wrap || !html) return;
    let box = document.getElementById('ticker');
    if (!box) { box = document.createElement('div'); box.id = 'ticker'; box.className = 'ticker'; box.setAttribute('aria-hidden', 'true'); wrap.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'tk';
    el.style.borderLeftColor = color || 'var(--line)';
    el.innerHTML = html;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 6500);
  }
  const name = (s, i, me) => i === me ? 'You' : esc(pName(s, i));
  const cards = res => tradeCards(res);

  /* ---------- one event ---------- */
  function play(s, e, me, ctx) {
    const color = i => COLOR_HEX[s.players[i] && s.players[i].color] || '#ccc';
    const P = i => `<b style="color:${color(i)}">${name(s, i, me)}</b>`;
    switch (e.k) {
      case 'roll': {
        showDice(s, e, me);
        ctx.roll = e; ctx.wait = reduced() ? 0 : 750;
        const sum = e.d[0] + e.d[1];
        ticker(`${P(e.p)} rolled <span class="mini-die">${e.d[0]}</span><span class="mini-die">${e.d[1]}</span> <b>${sum}</b>${sum === 7 ? ' · robber!' : ''}`, color(e.p));
        if (sum !== 7) ctx.gains = [];
        return;
      }
      case 'gain': {
        const res = e.res;
        const to = r => playerAt(e.p, me, r);
        if (e.setup) { // starting cards come from the hexes around the second settlement
          const last = [...s.log].reverse().find(x => x.id < e.id && x.k === 'build' && x.what === 'settlement' && x.p === e.p);
          const b = last ? last.v : -1;
          let k = 0;
          for (const r of Engine.RES) for (let n = 0; n < (res[r] || 0); n++) {
            const h = b >= 0 ? T(s).verts[b].hexes.find(h => Engine.T2R[s.board.hexes[h].t] === r) : -1;
            fly(h >= 0 ? hexAt(s, h) : bankAt(), to(r), r, 200 + k++ * 120);
          }
          ticker(`${P(e.p)} ${e.p === me ? 'start' : 'starts'} with ${cards(res)}`, color(e.p));
          return;
        }
        if (e.card) { // Year of Plenty
          let k = 0;
          for (const r of Engine.RES) for (let n = 0; n < (res[r] || 0); n++) fly(bankAt(), to(r), r, k++ * 140);
          ticker(`${P(e.p)} ${e.p === me ? 'take' : 'takes'} ${cards(res)} from the bank <span class="note">Year of Plenty</span>`, color(e.p));
          return;
        }
        // production: one card per settlement, two per city, from each hex showing the number
        const roll = ctx.roll || [...s.log].reverse().find(x => x.k === 'roll');
        const sum = roll ? roll.d[0] + roll.d[1] : 0;
        let k = 0;
        s.board.hexes.forEach((h, hi) => {
          const r = Engine.T2R[h.t];
          if (!r || h.n !== sum || hi === s.board.robber || !res[r]) return;
          for (const v of T(s).hexVerts[hi]) {
            const b = s.bld[v];
            if (!b || b.p !== e.p) continue;
            for (let n = 0; n < (b.city ? 2 : 1); n++) fly(hexAt(s, hi), to(r), r, (ctx.wait || 0) + k++ * 110);
          }
        });
        if (ctx.gains) ctx.gains.push(`${P(e.p)} +${cards(res)}`);
        floatText(scoreAt(e.p, me, Engine.RES.find(r => res[r])), '+' + Engine.total(res), 'up', (ctx.wait || 0) + 500);
        return;
      }
      case 'short': ticker(`The bank is out of ${e.res.map(r => RES_NAME[r].toLowerCase()).join(', ')}: nobody gets it this roll`); return;
      case 'build': {
        const at = e.what === 'road' ? spot(s, 'e', e.e) : spot(s, 'v', e.v);
        const what = e.what === 'settlement' ? 'Settlement' : e.what === 'city' ? 'City' : 'Road';
        // your own builds just ripple; other players' builds also get a name tag
        if (at) ripple(s, at, color(e.p), e.p === me ? '' : `<b style="color:${color(e.p)}">${name(s, e.p, me)}</b> · ${what}${e.free ? ' (free)' : ''}`);
        const duringSetup = !s.log.some(x => x.k === 'roll' && x.id < e.id); // the starting pieces are free
        if (!e.free && !duringSetup) {
          const c = Engine.COST[e.what]; let k = 0;
          for (const r of Engine.RES) for (let n = 0; n < (c[r] || 0); n++) fly(playerAt(e.p, me, r), bankAt(), r, k++ * 70, { small: true, dur: 600 });
        }
        ticker(`${P(e.p)} built a ${e.what}${e.free ? ' (free)' : ''}`, color(e.p));
        return;
      }
      case 'buyDev': {
        const c = Engine.COST.dev; let k = 0;
        for (const r of Engine.RES) for (let n = 0; n < (c[r] || 0); n++) fly(playerAt(e.p, me, r), bankAt(), r, k++ * 70, { small: true, dur: 600 });
        fly(bankAt(), playerAt(e.p, me), null, 380);
        ticker(`${P(e.p)} bought a development card${e.p === me && e.card ? ': <b>' + DEV_NAME[e.card] + '</b>' : ''}`, color(e.p));
        return;
      }
      case 'bank': {
        let k = 0;
        for (const r of Engine.RES) for (let n = 0; n < (e.give[r] || 0); n++) fly(playerAt(e.p, me, r), bankAt(), r, k++ * 80);
        let j = 0;
        for (const r of Engine.RES) for (let n = 0; n < (e.get[r] || 0); n++) fly(bankAt(), playerAt(e.p, me, r), r, 420 + k * 40 + j++ * 110);
        const rate = bankRate(e);
        ticker(`${P(e.p)} ${e.p === me ? 'trade' : 'trades'} with the bank: ${cards(e.give)} <span class="ft-swap">${ic('trade')}</span> ${cards(e.get)} <span class="note">${rate}</span>`, color(e.p));
        return;
      }
      case 'trade': {
        let k = 0;
        for (const r of Engine.RES) for (let n = 0; n < (e.give[r] || 0); n++) fly(playerAt(e.p, me, r), playerAt(e.q, me, r), r, k++ * 90);
        for (const r of Engine.RES) for (let n = 0; n < (e.get[r] || 0); n++) fly(playerAt(e.q, me, r), playerAt(e.p, me, r), r, 160 + k++ * 90);
        ticker(`${P(e.p)} <span class="ft-swap">${ic('trade')}</span> ${P(e.q)}: ${cards(e.give)} for ${cards(e.get)}`, color(e.p));
        return;
      }
      case 'steal': {
        const mine = e.p === me || e.q === me;
        fly(playerAt(e.q, me, mine ? e.r : null), playerAt(e.p, me, mine ? e.r : null), mine ? e.r : null, 150);
        if (e.q === me) floatText(scoreAt(me, me, e.r), '−1', 'down', 700);
        ticker(`${P(e.p)} stole ${mine && e.r ? cards({ [e.r]: 1 }) : 'a card'} from ${P(e.q)}`, color(e.p));
        return;
      }
      case 'stealNone': ticker(`${P(e.q)} had no cards to steal`); return;
      case 'discard': {
        for (let n = 0; n < e.n; n++) fly(playerAt(e.p, me), bankAt(), null, n * 70, { small: true, dur: 650 });
        floatText(scoreAt(e.p, me), '−' + e.n, 'down', 200);
        ticker(`${P(e.p)} discarded ${e.n} cards to the bank <span class="note">rolled 7</span>`, color(e.p));
        return;
      }
      case 'robber': {
        const at = spot(s, 'h', e.h);
        if (at) ripple(s, at, '#1b1b1b', `${ic('robber')} Robber`);
        const h = s.board.hexes[e.h];
        ticker(`${P(e.p)} moved the robber to ${TERRAIN[h.t].name}${h.n ? ' ' + h.n : ''}`, color(e.p));
        return;
      }
      case 'play': ticker(`${P(e.p)} played <b>${DEV_NAME[e.card]}</b>`, color(e.p)); return;
      case 'mono': {
        const others = s.players.map((_, i) => i).filter(i => i !== e.p);
        for (let n = 0; n < e.n; n++) fly(playerAt(others[n % others.length], me, e.r), playerAt(e.p, me, e.r), e.r, n * 90);
        ticker(`${P(e.p)} ${e.p === me ? 'take' : 'takes'} all the ${RES_NAME[e.r].toLowerCase()} from everyone: ${e.n} ${ri(e.r)} <span class="note">Monopoly</span>`, color(e.p));
        return;
      }
      case 'lr': ticker(`${P(e.p)} ${e.p === me ? 'take' : 'takes'} <b>Longest Road</b> (${e.len})`, color(e.p)); floatText(scoreAt(e.p, me), '+2 points', 'up'); return;
      case 'la': ticker(`${P(e.p)} ${e.p === me ? 'take' : 'takes'} <b>Largest Army</b>`, color(e.p)); floatText(scoreAt(e.p, me), '+2 points', 'up'); return;
      case 'offer': ticker(`${P(e.p)} ${e.p === me ? 'offer' : 'offers'} ${cards(e.give)} for ${cards(e.get)}`, color(e.p)); return;
      case 'counter': ticker(`${P(e.p)} ${e.p === me ? 'counter' : 'counters'}: ${cards(e.give)} for ${cards(e.get)}`, color(e.p)); return;
      case 'timeout': ticker(`${P(e.p)} ran out of time`, color(e.p)); return;
      case 'win': showWin(s, e, me); return;
    }
  }

  /* ---------- called after every render ---------- */
  function run(d) {
    const s = d && d.game;
    if (!s) return;
    const key = d.code + ':' + (d.startedAt || 0);
    const lastId = s.log.length ? (s.log[s.log.length - 1].id || 0) : 0;
    if (st.key !== key) { st.key = key; st.logId = lastId; return; } // first look at this game: show nothing old
    if (lastId < st.logId) { st.logId = lastId; return; } // a guessed move was undone
    let fresh = s.log.filter(e => e.id && e.id > st.logId);
    if (!fresh.length) return;
    st.logId = lastId;
    const me = myIndexIn(d);
    const catchUp = fresh.length > 14 || document.hidden; // a hidden tab would pile animations up
    if (catchUp) fresh = fresh.slice(-3); // catching up after a pause: just list the latest, no fireworks
    const ctx = {};
    if (!catchUp && fresh.some(e => e.k === 'roll')) st.rollShownUntil = Date.now() + (reduced() ? 300 : 1100);
    requestAnimationFrame(() => {
      quiet = catchUp;
      for (const e of fresh) { try { play(s, e, me, ctx); } catch (err) { console.warn('fx', err); } }
      quiet = false;
      if (ctx.gains && ctx.gains.length) setTimeout(() => ticker(ctx.gains.join(' · ')), ctx.wait || 0);
      else if (ctx.gains && ctx.roll) setTimeout(() => ticker('<span class="note">Nobody produced anything</span>'), ctx.wait || 0);
    });
  }
  function reset() { st.key = null; }
  // let the dice land before a pop-up (like "discard half") covers them
  function holdFor() { return Math.max(0, Math.max(st.rollShownUntil || 0, st.holdUntil || 0) - Date.now()); }
  return { run, reset, holdFor };
})();
