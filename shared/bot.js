/* ============================================================
   HEXSTEAD BOTS — heuristic players with three difficulty levels.
   decide(view, p, rng, opts) returns ONE action, or null to wait.
   `view` is Engine.redact(state, p): bots only know what a person
   in their seat could know.
   ============================================================ */
const Bot = (() => {
  const E = typeof Engine !== 'undefined' ? Engine : require('./engine.js');
  const RES = E.RES;

  /* What each level does differently:
     easy   – picks so-so starting spots, builds in no particular order, sometimes ends its turn early,
              moves the robber anywhere, hardly trades with the bank, never offers trades, accepts generous-looking deals.
     normal – good (not always the best) starting spots, cities before settlements, trades with the bank to finish a build,
              offers a player trade when one card short, counters offers it can't accept.
     hard   – always takes the strongest starting spots, plus everything normal does and: offers trades when up to
              two cards short (twice a turn), keeps its hand under the discard limit, plays knights early to win
              Largest Army, and builds roads ahead toward its next settlement spot. */
  const PROFILES = {
    easy: { noise: 1.8, setupTop: 0.45, quitEarly: 0.12, robberRandom: true, bank: 'rich', smartDev: false, offers: 0, maxMissing: 0, counters: false, acceptMargin: -0.4, leaderCare: false, handCare: false, planSetup: false, planGoals: false, roadRace: false, knightPush: false, randomOrder: true },
    normal: { noise: 1.0, setupTop: 0.15, quitEarly: 0, robberRandom: false, bank: 'goal', smartDev: true, offers: 1, maxMissing: 1, counters: true, acceptMargin: 0.3, leaderCare: true, handCare: false, planSetup: false, planGoals: false, roadRace: true, knightPush: false, randomOrder: false },
    // each hard-only setting below was kept because it won more games in head-to-head simulations
    hard: { noise: 0.3, setupTop: 0, quitEarly: 0, robberRandom: false, bank: 'goal', smartDev: true, offers: 2, maxMissing: 2, counters: true, acceptMargin: 0.3, leaderCare: true, handCare: true, planSetup: false, planGoals: false, roadRace: true, knightPush: true, roadAhead: 3, randomOrder: false },
  };
  const LEVELS = ['easy', 'normal', 'hard'];
  // a person's seat played by a bot (away, or out of time) gets steady, precise play rather than a difficulty level
  PROFILES.stand_in = Object.assign({}, PROFILES.normal, { noise: 0.3, setupTop: 0 });
  function profileOf(s, p) { const pl = s.players[p]; return pl.bot ? (PROFILES[pl.level] || PROFILES.normal) : PROFILES.stand_in; }

  /* ---------------- shared helpers ---------------- */
  function cards(s, q) { const P = s.players[q]; return P.nCards != null ? P.nCards : E.total(P.res); }
  function prodOf(s, p) {
    const T = E.topo(s);
    const prod = E.emptyRes();
    s.bld.forEach((b, v) => {
      if (!b || b.p !== p) return;
      for (const hi of T.verts[v].hexes) {
        const h = s.board.hexes[hi];
        const r = E.T2R[h.t];
        if (!r || hi === s.board.robber) continue;
        prod[r] += E.PIPS[h.n] * (b.city ? 2 : 1);
      }
    });
    return prod;
  }
  const BASE_W = { lumber: 1.1, brick: 1.1, wool: 0.85, grain: 1.05, ore: 1.0 };
  const scarceCache = new WeakMap();
  function scarcity(s) {
    let f = scarceCache.get(s.board);
    if (f) return f;
    const pips = E.emptyRes();
    for (const h of s.board.hexes) { const r = E.T2R[h.t]; if (r) pips[r] += E.PIPS[h.n]; }
    const mean = RES.reduce((a, r) => a + pips[r], 0) / 5;
    f = {}; for (const r of RES) f[r] = Math.max(0.75, Math.min(1.4, Math.sqrt(mean / Math.max(1, pips[r]))));
    scarceCache.set(s.board, f);
    return f;
  }
  function vertexValue(s, v, p, prod, P) {
    const T = E.topo(s);
    const sf = P && P.scarcity ? scarcity(s) : null;
    let sc = 0;
    const seen = new Set();
    for (const hi of T.verts[v].hexes) {
      const h = s.board.hexes[hi];
      const r = E.T2R[h.t];
      if (!r) continue;
      let w = BASE_W[r] * (sf ? sf[r] : 1);
      if (prod && prod[r] === 0) w += 0.45;
      sc += E.PIPS[h.n] * w * (hi === s.board.robber ? 0.4 : 1);
      seen.add(r);
    }
    sc += seen.size * 0.9;
    const port = E.portAt(s, v);
    if (port === 'any') sc += 1.2;
    else if (port && prod) sc += 0.6 + prod[port] * 0.25;
    return sc;
  }
  /* hard: also value what a spot leads to and avoid stacking the same numbers */
  function plannedValue(s, v, p, prod, P) {
    const T = E.topo(s);
    let sc = vertexValue(s, v, p, prod, P);
    if (P.dupPenalty) {
      const mine = new Set();
      s.bld.forEach((b, w) => { if (b && b.p === p) for (const hi of T.verts[w].hexes) if (s.board.hexes[hi].n) mine.add(s.board.hexes[hi].n); });
      for (const hi of T.verts[v].hexes) { const n = s.board.hexes[hi].n; if (n && mine.has(n)) sc -= P.dupPenalty; }
    }
    if (P.expandW) {
      let best = 0;
      for (const w of T.verts[v].adj) for (const x of T.verts[w].adj) {
        if (x === v || !E.settlementOk(s, p, x, true)) continue;
        best = Math.max(best, vertexValue(s, x, p, prod, P));
      }
      sc += best * P.expandW;
    }
    if (prod && P.needBL) { // second settlement: make sure we can build roads and settlements at all
      if (!prod.brick && T.verts[v].hexes.some(hi => s.board.hexes[hi].t === 'hills')) sc += P.needBL;
      if (!prod.lumber && T.verts[v].hexes.some(hi => s.board.hexes[hi].t === 'forest')) sc += P.needBL;
    }
    return sc;
  }
  function missing(res, cost) {
    const m = E.emptyRes();
    for (const r of RES) m[r] = Math.max(0, (cost[r] || 0) - (res[r] || 0));
    return m;
  }
  function bestBy(list, fn) {
    let best = null, bs = -Infinity;
    for (const x of list) { const v = fn(x); if (v > bs) { bs = v; best = x; } }
    return best;
  }
  function pickRandom(list, rng) { return list[Math.floor(rng() * list.length)]; }
  function inNetwork(s, p, v) {
    const T = E.topo(s);
    const b = s.bld[v];
    if (b && b.p === p) return true;
    if (b && b.p !== p) return false;
    return T.verts[v].edges.some(e => s.roads[e] === p);
  }
  function roadTowardTarget(s, p, prod) {
    const T = E.topo(s);
    const dist = new Map(), first = new Map(), q = [];
    for (let v = 0; v < T.verts.length; v++) if (inNetwork(s, p, v)) { dist.set(v, 0); first.set(v, -1); q.push(v); }
    let best = -1, bs = -Infinity;
    while (q.length) {
      const v = q.shift();
      const d = dist.get(v);
      if (d >= 4) continue;
      for (const e of T.verts[v].edges) {
        if (s.roads[e] !== -1) continue;
        const w = E.otherEnd(T, e, v);
        if (dist.has(w)) continue;
        if (s.bld[w] && s.bld[w].p !== p) continue;
        dist.set(w, d + 1);
        first.set(w, first.get(v) === -1 ? e : first.get(v));
        q.push(w);
        if (E.settlementOk(s, p, w, true)) {
          const sc = vertexValue(s, w, p, prod) - 2.4 * (d + 1);
          if (sc > bs) { bs = sc; best = first.get(w); }
        }
      }
    }
    return best;
  }
  function roadForLength(s, p, rng) {
    const legal = E.legalRoads(s, p);
    if (!legal.length) return -1;
    return bestBy(legal, e => { const t = E.clone(s); t.roads[e] = p; return E.roadLength(t, p) + rng() * 0.2; });
  }
  function actionsThisTurn(s, p, kinds) {
    kinds = kinds || ['bank', 'build', 'buyDev', 'play'];
    let n = 0;
    for (let i = s.log.length - 1; i >= 0; i--) {
      const e = s.log[i];
      if (e.turn !== s.turn) break;
      if (e.p === p && kinds.includes(e.k)) n++;
    }
    return n;
  }
  function leaderVP(s, p) { let m = 0; s.players.forEach((_, i) => { if (i !== p) m = Math.max(m, E.publicVP(s, i)); }); return m; }

  /* ---------------- goals ---------------- */
  /* expected turns to collect `cost`, from production per roll plus trading surplus at our rates */
  function turnsFor(s, p, cost, prod) {
    const me = s.players[p];
    const rt = E.rates(s, p);
    const rate = {}; let conv = 0;
    for (const r of RES) { rate[r] = prod[r] / 36; conv += rate[r] / rt[r]; }
    let t = 0;
    for (const r of RES) {
      const m = Math.max(0, (cost[r] || 0) - (me.res[r] || 0));
      if (m) t += m / (rate[r] + conv * 0.5 + 0.02);
    }
    return t;
  }
  function pickGoal(s, p, P) {
    const me = s.players[p];
    const left = E.piecesLeft(s, p);
    const spots = left.settlement > 0 ? E.legalSettlements(s, p, false) : [];
    const cities = left.city > 0 ? E.legalCities(s, p) : [];
    const prod = prodOf(s, p);
    const opts = [];
    const miss = c => E.total(missing(me.res, c));
    if (P.planGoals) {
      // value of each build divided by how long it will take to afford it
      const add = (kind, cost, value) => opts.push({ kind, cost, score: value / (turnsFor(s, p, cost, prod) + 0.6) });
      if (cities.length) add('city', E.COST.city, 1 + Math.max(...cities.map(v => vertexValue(s, v, p, null))) * 0.05);
      if (spots.length) add('settlement', E.COST.settlement, 1 + Math.max(...spots.map(v => vertexValue(s, v, p, prod))) * 0.05);
      if (!spots.length && left.settlement > 0 && left.road > 0) add('road', E.COST.road, 0.45);
      if (s.deck.length) add('dev', E.COST.dev, 0.5 + (s.la.p !== p && me.knights + 2 >= Math.max(3, s.la.n || 0) ? 0.2 : 0));
    } else {
      if (cities.length) opts.push({ kind: 'city', cost: E.COST.city, score: -(miss(E.COST.city) - 0.4) });
      if (spots.length) opts.push({ kind: 'settlement', cost: E.COST.settlement, score: -(miss(E.COST.settlement) - 0.2) });
      if (!spots.length && left.settlement > 0 && left.road > 0) opts.push({ kind: 'road', cost: E.COST.road, score: -(miss(E.COST.road) + 0.5) });
      if (s.deck.length) opts.push({ kind: 'dev', cost: E.COST.dev, score: -(miss(E.COST.dev) + 1.2) });
    }
    if (!opts.length) return null;
    opts.sort((a, b) => b.score - a.score);
    return opts[0];
  }

  /* how good is it for p to give `give` and receive `get` */
  function tradeValue(s, p, give, get, P) {
    const me = s.players[p];
    const goal = pickGoal(s, p, P);
    const cost = goal ? goal.cost : E.COST.dev;
    const miss = missing(me.res, cost);
    let gain = 0, loss = 0;
    for (const r of RES) {
      gain += (get[r] || 0) * (miss[r] > 0 ? 2 : 0.6);
      const after = (me.res[r] || 0) - (give[r] || 0);
      loss += (give[r] || 0) * (after < (cost[r] || 0) ? 2 : 0.5);
    }
    if (E.total(give) > E.total(get) + 1) loss += 1;
    return gain - loss;
  }

  /* ---------------- trading with players ---------------- */
  function respondTrade(s, p, P) {
    const t = s.trade, me = s.players[p];
    const no = { t: 'respond', id: t.id, r: 'decline' };
    if (P.leaderCare && E.publicVP(s, t.from) >= s.settings.vpToWin - 2) return no;
    if (E.has(me.res, t.get)) {
      const v = tradeValue(s, p, t.get, t.give, P);
      if (v > P.acceptMargin && E.total(t.get) <= E.total(t.give) + 1) return { t: 'respond', id: t.id, r: 'accept' };
    }
    if (P.counters) {
      const c = craftCounter(s, p, P, t.give, t.get);
      if (c) return t.drafting && t.drafting[p] ? { t: 'counter', id: t.id, give: c.give, get: c.get } : { t: 'draft', id: t.id, on: true };
    }
    return no;
  }
  /* they offer `offered` and want `wanted`; propose a version that works for us */
  function craftCounter(s, p, P, offered, wanted) {
    const me = s.players[p];
    const goal = pickGoal(s, p, P);
    if (!goal) return null;
    const miss = missing(me.res, goal.cost);
    const want = RES.filter(r => (offered[r] || 0) > 0 && miss[r] > 0);
    if (!want.length) return null;
    const spare = RES.filter(r => (me.res[r] || 0) - (goal.cost[r] || 0) > 0 && !(offered[r] > 0));
    if (!spare.length) return null;
    const giveR = bestBy(spare, r => (me.res[r] || 0) - (goal.cost[r] || 0));
    const getR = want[0];
    const give = E.emptyRes(), get = E.emptyRes();
    give[giveR] = 1; get[getR] = 1;
    // don't send back exactly what they asked for (we would have accepted it)
    if (E.total(wanted) === 1 && wanted[giveR] === 1 && E.total(offered) === 1 && offered[getR] === 1) return null;
    return { give, get };
  }
  function offersThisTurn(s, p) { return actionsThisTurn(s, p, ['offer']); }
  function proposeTrade(s, p, P, rng) {
    if (!P.offers || offersThisTurn(s, p) >= P.offers) return null;
    const me = s.players[p];
    const goal = pickGoal(s, p, P);
    if (!goal) return null;
    const miss = missing(me.res, goal.cost);
    const mt = E.total(miss);
    if (!mt || mt > P.maxMissing) return null;
    const spare = RES.filter(r => (me.res[r] || 0) - (goal.cost[r] || 0) > 0);
    if (!spare.length) return null;
    // with a cheap harbour trade available, a careful player just uses the bank
    const rt = E.rates(s, p);
    if (P.planGoals && spare.some(r => rt[r] <= 2 && me.res[r] - (goal.cost[r] || 0) >= rt[r])) return null;
    const getR = bestBy(RES.filter(r => miss[r] > 0), r => miss[r] + rng() * 0.1);
    const giveR = bestBy(spare, r => (me.res[r] - (goal.cost[r] || 0)) + rng() * 0.1);
    const give = E.emptyRes(), get = E.emptyRes();
    give[giveR] = 1; get[getR] = 1;
    // a second try this turn sweetens the deal if we can afford it
    if (offersThisTurn(s, p) >= 1 && me.res[giveR] - (goal.cost[giveR] || 0) >= 2) give[giveR] = 2;
    const key = JSON.stringify([give, get]);
    for (let i = s.log.length - 1; i >= 0 && s.log[i].turn === s.turn; i--) {
      const e = s.log[i];
      if (e.k === 'offer' && e.p === p && JSON.stringify([e.give, e.get]) === key) return null;
    }
    return { t: 'offer', give, get };
  }
  function handleOwnTrade(s, p, P, opts) {
    const t = s.trade, me = s.players[p];
    const others = s.players.map((_, i) => i).filter(i => i !== p);
    let best = null, bs = -Infinity;
    for (const q of others) {
      const r = t.resp[q];
      if (!r || r === 'decline') continue;
      if (P.leaderCare && E.publicVP(s, q) >= s.settings.vpToWin - 2) continue;
      if (r === 'accept') { if (E.has(me.res, t.give)) { const sc = 1 - E.publicVP(s, q) * 0.02; if (sc > bs) { bs = sc; best = q; } } }
      else if (E.has(me.res, r.get)) {
        const v = tradeValue(s, p, r.get, r.give, P);
        if (v > P.acceptMargin && v - 0.2 > bs) { bs = v - 0.2; best = q; }
      }
    }
    if (best !== null) return { t: 'confirm', id: t.id, q: best };
    const pending = others.filter(q => t.resp[q] === undefined);
    const drafting = others.some(q => t.drafting && t.drafting[q]);
    const age = opts.tradeAge || 0;
    if (pending.length && (age < 9000 || (drafting && age < 16000))) return null; // wait for answers
    return { t: 'cancel' };
  }

  /* ---------------- other choices ---------------- */
  function chooseDiscard(s, p, n, P, rng) {
    const me = s.players[p];
    const r = Object.assign({}, me.res);
    const out = E.emptyRes();
    const goal = P.planGoals ? pickGoal(s, p, P) : null;
    const keep = { ore: 0.3, grain: 0.2, brick: 0.1, lumber: 0.1, wool: 0 };
    for (let i = 0; i < n; i++) {
      const k = P.randomOrder
        ? pickRandom(RES.filter(x => r[x] > 0), rng)
        : bestBy(RES.filter(x => r[x] > 0), x => r[x] - keep[x] - (goal && r[x] <= (goal.cost[x] || 0) ? 3 : 0));
      r[k]--; out[k]++;
    }
    return out;
  }
  function chooseRobber(s, p, P, rng) {
    const T = E.topo(s);
    const hexes = E.legalRobberHexes(s, p);
    const safe = hexes.filter(h => !T.hexVerts[h].some(v => s.bld[v] && s.bld[v].p === p));
    if (P.robberRandom) return pickRandom(safe.length ? safe : hexes, rng);
    const lead = leaderVP(s, p);
    return bestBy(hexes, h => {
      const pip = E.PIPS[s.board.hexes[h].n] || 0;
      let sc = rng() * 0.3;
      for (const v of T.hexVerts[h]) {
        const b = s.bld[v];
        if (!b) continue;
        if (b.p === p) { sc -= 40; continue; }
        const vp = E.publicVP(s, b.p);
        const focus = P.robberLeader ? (vp === lead ? 2.2 : 1) : 1 + vp / 4;
        sc += pip * (b.city ? 2 : 1) * focus + (cards(s, b.p) > 0 ? 1.5 : 0);
      }
      return sc;
    });
  }
  function chooseVictim(s, p, cands, P, rng) {
    if (P.robberRandom) return pickRandom(cands, rng);
    return bestBy(cands, q => E.publicVP(s, q) * 10 + cards(s, q));
  }
  function bankTradeToward(s, p, goal, force, P) {
    const me = s.players[p];
    if (!goal) return null;
    const miss = missing(me.res, goal.cost);
    const mt = E.total(miss);
    if (!mt) return null;
    const rt = E.rates(s, p);
    const surplus = {};
    let possible = 0;
    for (const r of RES) {
      surplus[r] = me.res[r] - (goal.cost[r] || 0);
      if (surplus[r] >= rt[r]) possible += Math.floor(surplus[r] / rt[r]);
    }
    if (!possible) return null;
    if (possible < mt && !force) return null;
    const giveR = bestBy(RES.filter(r => surplus[r] >= rt[r]), r => surplus[r] / rt[r] - (rt[r] === 4 ? 0.1 : 0));
    const getR = bestBy(RES.filter(r => miss[r] > 0 && s.bank[r] > 0), r => miss[r]);
    if (!giveR || !getR) return null;
    const give = E.emptyRes(), get = E.emptyRes();
    give[giveR] = rt[giveR]; get[getR] = 1;
    return { t: 'bank', give, get };
  }
  /* hard: before ending the turn, get under the discard limit if possible */
  function trimHand(s, p, P) {
    const me = s.players[p];
    if (E.total(me.res) <= s.settings.discardLimit) return null;
    const left = E.piecesLeft(s, p);
    if (left.road > 0 && E.has(me.res, E.COST.road)) { const e = roadTowardTarget(s, p, prodOf(s, p)); if (e >= 0 && E.roadOk(s, p, e)) return { t: 'road', e }; }
    if (s.deck.length && E.has(me.res, E.COST.dev)) return { t: 'buyDev' };
    const rt = E.rates(s, p);
    const giveR = bestBy(RES.filter(r => me.res[r] >= rt[r]), r => me.res[r] - rt[r]);
    const getR = bestBy(RES.filter(r => s.bank[r] > 0 && r !== giveR), r => -me.res[r]);
    if (giveR && getR) { const give = E.emptyRes(), get = E.emptyRes(); give[giveR] = rt[giveR]; get[getR] = 1; return { t: 'bank', give, get }; }
    return null;
  }

  function devPlay(s, p, P, rng, prod) {
    const me = s.players[p];
    if (s.devPlayed) return null;
    const T = E.topo(s);
    const can = c => E.playable(s, p, c) > 0;
    if (!P.smartDev) { // easy: plays whatever it has, without much thought
      const have = ['knight', 'yearOfPlenty', 'monopoly', 'roadBuilding'].filter(can);
      if (!have.length || rng() < 0.5) return null;
      const c = pickRandom(have, rng);
      if (c === 'yearOfPlenty') { const r1 = pickRandom(RES.filter(r => s.bank[r] > 0), rng); const pick = E.emptyRes(); pick[r1]++; const r2 = pickRandom(RES.filter(r => s.bank[r] - pick[r] > 0), rng); if (!r2) return null; pick[r2]++; return { t: 'play', card: c, res: pick }; }
      if (c === 'monopoly') return { t: 'play', card: c, r: pickRandom(RES, rng) };
      if (c === 'roadBuilding' && !(E.piecesLeft(s, p).road > 0 && E.legalRoads(s, p).length)) return null;
      if (c === 'knight' || s.phase === 'main') return { t: 'play', card: c };
      return null;
    }
    if (can('knight')) {
      const onMe = s.board.robber >= 0 && T.hexVerts[s.board.robber].some(v => s.bld[v] && s.bld[v].p === p) && (E.PIPS[s.board.hexes[s.board.robber].n] || 0) >= (P.knightPush ? 2 : 3);
      const holderN = s.la.p >= 0 ? s.players[s.la.p].knights : 2;
      const army = s.la.p !== p && me.knights + 1 >= 3 && me.knights + 1 > holderN;
      const push = P.knightPush && s.la.p !== p && me.knights + 2 > holderN && s.phase === 'main';
      if (onMe || army || push) return { t: 'play', card: 'knight' };
    }
    if (s.phase !== 'main') return null;
    const goal = pickGoal(s, p, P);
    if (can('yearOfPlenty') && goal) {
      const m = missing(me.res, goal.cost);
      if (E.total(m) > 0 && E.total(m) <= 2) {
        const pick = E.emptyRes();
        let left = 2;
        for (const r of RES) while (m[r] > 0 && left > 0 && s.bank[r] - pick[r] > 0) { pick[r]++; m[r]--; left--; }
        while (left > 0) { const r = bestBy(RES.filter(x => s.bank[x] - pick[x] > 0), x => -prod[x]); if (!r) break; pick[r]++; left--; }
        if (E.total(pick) === 2) return { t: 'play', card: 'yearOfPlenty', res: pick };
      }
    }
    if (can('monopoly')) {
      // guess like a person would: how many cards each opponent holds, split by what their buildings produce
      const est = E.emptyRes();
      s.players.forEach((q, i) => {
        if (i === p) return;
        const n = cards(s, i);
        if (!n) return;
        const pr = prodOf(s, i);
        let tot = 0; for (const r of RES) tot += pr[r] + 1;
        for (const r of RES) est[r] += n * (pr[r] + 1) / tot;
      });
      const r = bestBy(RES, x => est[x] * (goal && goal.cost[x] ? 1.4 : 1));
      if (est[r] >= 3.5) return { t: 'play', card: 'monopoly', r };
    }
    if (can('roadBuilding')) {
      const left = E.piecesLeft(s, p);
      if (left.road >= 1 && E.legalRoads(s, p).length && (left.settlement > 0 && !E.legalSettlements(s, p, false).length)) return { t: 'play', card: 'roadBuilding' };
    }
    return null;
  }

  /* ---------------- builds in the main phase ---------------- */
  function buildOptions(s, p, P, prod, rng) {
    const me = s.players[p];
    const left = E.piecesLeft(s, p);
    const out = [];
    if (left.city > 0 && E.has(me.res, E.COST.city)) {
      const cs = E.legalCities(s, p);
      if (cs.length) out.push({ t: 'city', v: bestBy(cs, v => vertexValue(s, v, p, null) + rng() * P.noise) });
    }
    if (left.settlement > 0 && E.has(me.res, E.COST.settlement)) {
      const spots = E.legalSettlements(s, p, false);
      if (spots.length) out.push({ t: 'settle', v: bestBy(spots, v => (P.planSetup ? plannedValue(s, v, p, prod, P) : vertexValue(s, v, p, prod, P)) + rng() * P.noise) });
    }
    if (left.road > 0 && E.has(me.res, E.COST.road)) {
      const spots = left.settlement > 0 ? E.legalSettlements(s, p, false) : [];
      let road = null;
      if (left.settlement > 0 && spots.length < (P.roadAhead || 2)) {
        const e = roadTowardTarget(s, p, prod);
        if (e >= 0 && E.roadOk(s, p, e)) road = { t: 'road', e };
      }
      if (!road && P.roadRace) {
        const myLen = E.roadLength(s, p);
        if (s.lr.p !== p && myLen >= 3 && myLen >= s.lr.len - 1 && left.road > 2) { const e = roadForLength(s, p, rng); if (e >= 0) road = { t: 'road', e }; }
      }
      if (!road && P.randomOrder && rng() < 0.3) { const legal = E.legalRoads(s, p); if (legal.length) road = { t: 'road', e: pickRandom(legal, rng) }; }
      if (road) out.push(road);
    }
    return out;
  }

  function decide(s, p, rng, opts) {
    opts = opts || {};
    rng = rng || Math.random;
    if (s.phase === 'ended') return null;
    const P = opts.autopilot ? PROFILES.stand_in : profileOf(s, p);
    const me = s.players[p];
    const prod = prodOf(s, p);
    if (s.phase === 'discard') {
      const n = E.discardNeeded(s, p);
      return n ? { t: 'discard', res: chooseDiscard(s, p, n, P, rng) } : null;
    }
    if (s.trade && s.trade.from !== p && s.trade.resp[p] === undefined && p !== s.cur) {
      return opts.autopilot ? { t: 'respond', id: s.trade.id, r: 'decline' } : respondTrade(s, p, P);
    }
    if (s.phase === 'special') return specialBuild(s, p, P, prod, rng, opts);
    if (p !== s.cur) return null;

    if (s.phase === 'setup') {
      if (s.setup.step === 'settlement') {
        const spots = E.legalSettlements(s, p, true);
        const second = s.setup.i >= s.players.length;
        const val = v => (P.planSetup ? plannedValue(s, v, p, second ? prod : null, P) : vertexValue(s, v, p, second ? prod : null, P));
        if (P.setupTop) {
          const ranked = spots.map(v => [v, val(v)]).sort((a, b) => b[1] - a[1]);
          const top = ranked.slice(0, Math.max(3, Math.ceil(ranked.length * P.setupTop)));
          return { t: 'settle', v: pickRandom(top, rng)[0] };
        }
        return { t: 'settle', v: bestBy(spots, v => val(v) + rng() * P.noise) };
      }
      const T = E.topo(s);
      const v0 = s.setup.lastV;
      const e = bestBy(T.verts[v0].edges.filter(e => s.roads[e] === -1), e => {
        const w = E.otherEnd(T, e, v0);
        let sc = 0;
        for (const x of T.verts[w].adj) if (x !== v0 && E.settlementOk(s, p, x, true)) sc = Math.max(sc, vertexValue(s, x, p, prod));
        return sc + rng() * (0.2 + P.noise);
      });
      return { t: 'road', e };
    }
    if (s.phase === 'roll') {
      if (!opts.autopilot) { const d = devPlay(s, p, P, rng, prod); if (d && d.card === 'knight') return d; }
      return { t: 'roll' };
    }
    if (s.phase === 'robber') return { t: 'robber', h: chooseRobber(s, p, P, rng) };
    if (s.phase === 'steal') return { t: 'steal', q: chooseVictim(s, p, s.stealCands, P, rng) };
    if (s.phase === 'roadBuilding') {
      let e = roadTowardTarget(s, p, prod);
      if (e < 0 || !E.roadOk(s, p, e)) e = roadForLength(s, p, rng);
      return e >= 0 ? { t: 'road', e } : { t: 'skipRoads' };
    }
    if (s.phase !== 'main') return null;
    if (opts.autopilot) return s.trade && s.trade.from === p ? { t: 'cancel' } : { t: 'end' };
    if (s.trade && s.trade.from === p) return handleOwnTrade(s, p, P, opts);
    if (actionsThisTurn(s, p) > 14) return { t: 'end' };
    if (P.quitEarly && rng() < P.quitEarly && actionsThisTurn(s, p) > 0) return { t: 'end' };

    const d = devPlay(s, p, P, rng, prod);
    if (d) return d;
    const builds = buildOptions(s, p, P, prod, rng);
    if (builds.length) return P.randomOrder ? pickRandom(builds, rng) : builds[0];
    const goal = pickGoal(s, p, P);
    // development card when nothing better
    if (s.deck.length && E.has(me.res, E.COST.dev)) {
      const after = Object.assign({}, me.res); E.addRes(after, E.COST.dev, -1);
      const hurtsCity = P.saveForCity && goal && goal.kind === 'city' && E.total(missing(after, E.COST.city)) > E.total(missing(me.res, E.COST.city)) && E.total(missing(me.res, E.COST.city)) <= 2;
      if (!hurtsCity && (!goal || goal.kind === 'dev' || E.total(missing(me.res, goal.cost)) > (P.devEager ? 1 : 2) || me.res.ore >= 4 || P.randomOrder)) return { t: 'buyDev' };
    }
    // ask the other players
    const offer = proposeTrade(s, p, P, rng);
    if (offer) return offer;
    // the bank
    const rich = E.total(me.res) > s.settings.discardLimit;
    if (P.bank !== 'rich' || rich) {
      const tr = bankTradeToward(s, p, goal, rich || (P.bank === 'smart' && E.total(missing(me.res, goal ? goal.cost : {})) <= 1), P);
      if (tr) return tr;
    }
    if (P.handCare) { const t = trimHand(s, p, P); if (t) return t; }
    return { t: 'end' };
  }

  function specialBuild(s, p, P, prod, rng, opts) {
    if (!s.special || s.special.q[0] !== p) return null;
    if (opts.autopilot || actionsThisTurn(s, p) > 6 || (P.quitEarly && rng() < 0.4)) return { t: 'pass' };
    const builds = buildOptions(s, p, P, prod, rng);
    if (builds.length) return builds[0];
    const me = s.players[p];
    if (s.deck.length && E.has(me.res, E.COST.dev) && E.total(me.res) > s.settings.discardLimit) return { t: 'buyDev' };
    return { t: 'pass' };
  }

  return { decide, vertexValue, prodOf, LEVELS, PROFILES };
})();
if (typeof module !== 'undefined') module.exports = Bot;
