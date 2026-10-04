/* ============================================================
   HEXSTEAD BOTS — heuristic players. decide() returns one action.
   ============================================================ */
const Bot = (() => {
  const E = typeof Engine !== 'undefined' ? Engine : require('./engine.js');
  const RES = E.RES;

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
  function vertexValue(s, v, p, prod) {
    const T = E.topo(s);
    let sc = 0;
    const seen = new Set();
    for (const hi of T.verts[v].hexes) {
      const h = s.board.hexes[hi];
      const r = E.T2R[h.t];
      if (!r) continue;
      let w = BASE_W[r];
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

  function inNetwork(s, p, v) {
    const T = E.topo(s);
    const b = s.bld[v];
    if (b && b.p === p) return true;
    if (b && b.p !== p) return false;
    return T.verts[v].edges.some(e => s.roads[e] === p);
  }

  /* first edge of a short path toward the best future settlement spot */
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
    return bestBy(legal, e => {
      const t = E.clone(s);
      t.roads[e] = p;
      return E.roadLength(t, p) + rng() * 0.2;
    });
  }

  function chooseDiscard(s, p, n) {
    const r = Object.assign({}, s.players[p].res);
    const out = E.emptyRes();
    const keep = { ore: 0.3, grain: 0.2, brick: 0.1, lumber: 0.1, wool: 0 };
    for (let i = 0; i < n; i++) {
      const k = bestBy(RES.filter(x => r[x] > 0), x => r[x] - keep[x]);
      r[k]--; out[k]++;
    }
    return out;
  }

  function chooseRobber(s, p, rng) {
    const T = E.topo(s);
    const hexes = E.legalRobberHexes(s, p);
    return bestBy(hexes, h => {
      const hx = s.board.hexes[h];
      const pip = E.PIPS[hx.n] || 0;
      let sc = rng() * 0.3;
      for (const v of T.hexVerts[h]) {
        const b = s.bld[v];
        if (!b) continue;
        if (b.p === p) sc -= 40;
        else sc += pip * (b.city ? 2 : 1) * (1 + E.publicVP(s, b.p) / 4) + (E.total(s.players[b.p].res) > 0 ? 1.5 : 0);
      }
      return sc;
    });
  }

  function chooseVictim(s, p, cands) {
    return bestBy(cands, q => E.publicVP(s, q) * 10 + E.total(s.players[q].res));
  }

  /* pick the build the bot is working toward */
  function pickGoal(s, p) {
    const P = s.players[p];
    const left = E.piecesLeft(s, p);
    const spots = left.settlement > 0 ? E.legalSettlements(s, p, false) : [];
    const cities = left.city > 0 ? E.legalCities(s, p) : [];
    const opts = [];
    if (cities.length) opts.push({ kind: 'city', cost: E.COST.city, miss: E.total(missing(P.res, E.COST.city)) - 0.4 });
    if (spots.length) opts.push({ kind: 'settlement', cost: E.COST.settlement, miss: E.total(missing(P.res, E.COST.settlement)) - 0.2 });
    if (!spots.length && left.settlement > 0 && left.road > 0) opts.push({ kind: 'road', cost: E.COST.road, miss: E.total(missing(P.res, E.COST.road)) + 0.5 });
    if (s.deck.length) opts.push({ kind: 'dev', cost: E.COST.dev, miss: E.total(missing(P.res, E.COST.dev)) + 1.2 });
    if (!opts.length) return null;
    opts.sort((a, b) => a.miss - b.miss);
    return opts[0];
  }

  function bankTradeToward(s, p, goal, force) {
    const P = s.players[p];
    if (!goal) return null;
    const miss = missing(P.res, goal.cost);
    const mt = E.total(miss);
    if (!mt) return null;
    const rt = E.rates(s, p);
    const surplus = {};
    let possible = 0;
    for (const r of RES) {
      surplus[r] = P.res[r] - (goal.cost[r] || 0);
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

  function actionsThisTurn(s, p) {
    let n = 0;
    for (let i = s.log.length - 1; i >= 0; i--) {
      const e = s.log[i];
      if (e.turn !== s.turn) break;
      if (e.p === p && (e.k === 'bank' || e.k === 'build' || e.k === 'buyDev' || e.k === 'play')) n++;
    }
    return n;
  }

  function devPlay(s, p, rng, prod) {
    const P = s.players[p];
    if (s.devPlayed) return null;
    const T = E.topo(s);
    const can = c => E.playable(s, p, c) > 0;
    // knight: robber hurting me, or largest army within reach
    if (can('knight')) {
      const onMe = s.board.robber >= 0 && T.hexVerts[s.board.robber].some(v => s.bld[v] && s.bld[v].p === p) && (E.PIPS[s.board.hexes[s.board.robber].n] || 0) >= 3;
      const holderN = s.la.p >= 0 ? s.players[s.la.p].knights : 2;
      const army = s.la.p !== p && P.knights + 1 >= 3 && P.knights + 1 > holderN;
      if (onMe || army) return { t: 'play', card: 'knight' };
    }
    if (s.phase !== 'main') return null;
    const goal = pickGoal(s, p);
    if (can('yearOfPlenty') && goal) {
      const m = missing(P.res, goal.cost);
      if (E.total(m) > 0 && E.total(m) <= 2) {
        const pick = E.emptyRes();
        let left = 2;
        for (const r of RES) while (m[r] > 0 && left > 0 && s.bank[r] - pick[r] > 0) { pick[r]++; m[r]--; left--; }
        while (left > 0) { const r = bestBy(RES.filter(x => s.bank[x] - pick[x] > 0), x => -prod[x]); if (!r) break; pick[r]++; left--; }
        if (E.total(pick) === 2) return { t: 'play', card: 'yearOfPlenty', res: pick };
      }
    }
    if (can('monopoly')) {
      const r = bestBy(RES, x => s.players.reduce((a, q, i) => a + (i === p ? 0 : q.res[x]), 0) * (goal && goal.cost[x] ? 1.4 : 1));
      const n = s.players.reduce((a, q, i) => a + (i === p ? 0 : q.res[r]), 0);
      if (n >= 4) return { t: 'play', card: 'monopoly', r };
    }
    if (can('roadBuilding')) {
      const left = E.piecesLeft(s, p);
      if (left.road >= 1 && E.legalRoads(s, p).length && (left.settlement > 0 && !E.legalSettlements(s, p, false).length)) return { t: 'play', card: 'roadBuilding' };
    }
    return null;
  }

  function respondTrade(s, p) {
    const t = s.trade;
    const P = s.players[p];
    if (!E.has(P.res, t.get)) return { t: 'respond', id: t.id, r: 'decline' };
    if (E.vp(s, t.from) >= s.settings.vpToWin - 2) return { t: 'respond', id: t.id, r: 'decline' };
    const goal = pickGoal(s, p);
    const cost = goal ? goal.cost : E.COST.dev;
    const miss = missing(P.res, cost);
    let gain = 0, loss = 0;
    for (const r of RES) {
      gain += (t.give[r] || 0) * (miss[r] > 0 ? 2 : 0.6);
      const after = P.res[r] - (t.get[r] || 0);
      loss += (t.get[r] || 0) * (after < (cost[r] || 0) ? 2 : 0.5);
    }
    const fair = E.total(t.get) <= E.total(t.give) + 1;
    return { t: 'respond', id: t.id, r: fair && gain > loss + 0.3 ? 'accept' : 'decline' };
  }

  function decide(s, p, rng, opts) {
    opts = opts || {};
    rng = rng || Math.random;
    if (s.phase === 'ended') return null;
    const P = s.players[p];
    const prod = prodOf(s, p);
    if (s.phase === 'discard') {
      const n = E.discardNeeded(s, p);
      return n ? { t: 'discard', res: chooseDiscard(s, p, n) } : null;
    }
    // trade response (non-active players)
    if (s.trade && s.trade.from !== p && s.trade.resp[p] === undefined && p !== s.cur) return respondTrade(s, p);
    if (s.phase === 'special') return specialBuild(s, p, prod, rng, opts);
    if (p !== s.cur) return null;

    if (s.phase === 'setup') {
      if (s.setup.step === 'settlement') {
        const spots = E.legalSettlements(s, p, true);
        const v = bestBy(spots, v => vertexValue(s, v, p, s.setup.i >= s.players.length ? prod : null) + rng() * 0.3);
        return { t: 'settle', v };
      }
      const T = E.topo(s);
      const v0 = s.setup.lastV;
      const e = bestBy(T.verts[v0].edges.filter(e => s.roads[e] === -1), e => {
        const w = E.otherEnd(T, e, v0);
        let sc = 0;
        for (const x of T.verts[w].adj) if (x !== v0 && E.settlementOk(s, p, x, true)) sc = Math.max(sc, vertexValue(s, x, p, prod));
        return sc + rng() * 0.2;
      });
      return { t: 'road', e };
    }
    if (s.phase === 'roll') {
      if (!opts.autopilot) { const d = devPlay(s, p, rng, prod); if (d && d.card === 'knight') return d; }
      return { t: 'roll' };
    }
    if (s.phase === 'robber') return { t: 'robber', h: chooseRobber(s, p, rng) };
    if (s.phase === 'steal') return { t: 'steal', q: chooseVictim(s, p, s.stealCands) };
    if (s.phase === 'roadBuilding') {
      let e = roadTowardTarget(s, p, prod);
      if (e < 0 || !E.roadOk(s, p, e)) e = roadForLength(s, p, rng);
      return e >= 0 ? { t: 'road', e } : { t: 'skipRoads' };
    }
    if (s.phase !== 'main') return null;
    if (opts.autopilot) return s.trade && s.trade.from === p ? { t: 'cancel' } : { t: 'end' };
    if (s.trade && s.trade.from === p) return { t: 'cancel' };
    if (actionsThisTurn(s, p) > 14) return { t: 'end' };

    const left = E.piecesLeft(s, p);
    const d = devPlay(s, p, rng, prod);
    if (d) return d;
    // city
    if (left.city > 0 && E.has(P.res, E.COST.city)) {
      const cs = E.legalCities(s, p);
      if (cs.length) return { t: 'city', v: bestBy(cs, v => vertexValue(s, v, p, null)) };
    }
    // settlement
    if (left.settlement > 0 && E.has(P.res, E.COST.settlement)) {
      const spots = E.legalSettlements(s, p, false);
      if (spots.length) return { t: 'settle', v: bestBy(spots, v => vertexValue(s, v, p, prod)) };
    }
    // road with purpose
    if (left.road > 0 && E.has(P.res, E.COST.road)) {
      const spots = left.settlement > 0 ? E.legalSettlements(s, p, false) : [];
      if (left.settlement > 0 && spots.length < 2) {
        const e = roadTowardTarget(s, p, prod);
        if (e >= 0 && E.roadOk(s, p, e)) return { t: 'road', e };
      }
      const myLen = E.roadLength(s, p);
      if (s.lr.p !== p && myLen >= 3 && myLen >= s.lr.len - 1 && left.road > 2) {
        const e = roadForLength(s, p, rng);
        if (e >= 0) return { t: 'road', e };
      }
    }
    // dev card when nothing better
    if (s.deck.length && E.has(P.res, E.COST.dev)) {
      const goal = pickGoal(s, p);
      if (!goal || goal.kind === 'dev' || E.total(missing(P.res, goal.cost)) > 2 || P.res.ore >= 4) return { t: 'buyDev' };
    }
    // bank trades
    const goal = pickGoal(s, p);
    const tr = bankTradeToward(s, p, goal, E.total(P.res) > s.settings.discardLimit);
    if (tr) return tr;
    return { t: 'end' };
  }

  /* special building phase (5-6 players): build if it helps, otherwise pass */
  function specialBuild(s, p, prod, rng, opts) {
    if (!s.special || s.special.q[0] !== p) return null;
    if (opts.autopilot || actionsThisTurn(s, p) > 6) return { t: 'pass' };
    const P = s.players[p];
    const left = E.piecesLeft(s, p);
    if (left.city > 0 && E.has(P.res, E.COST.city)) {
      const cs = E.legalCities(s, p);
      if (cs.length) return { t: 'city', v: bestBy(cs, v => vertexValue(s, v, p, null)) };
    }
    if (left.settlement > 0 && E.has(P.res, E.COST.settlement)) {
      const spots = E.legalSettlements(s, p, false);
      if (spots.length) return { t: 'settle', v: bestBy(spots, v => vertexValue(s, v, p, prod)) };
    }
    if (left.road > 0 && left.settlement > 0 && E.has(P.res, E.COST.road) && E.legalSettlements(s, p, false).length < 1) {
      const e = roadTowardTarget(s, p, prod);
      if (e >= 0 && E.roadOk(s, p, e)) return { t: 'road', e };
    }
    if (s.deck.length && E.has(P.res, E.COST.dev) && E.total(P.res) > s.settings.discardLimit) return { t: 'buyDev' };
    return { t: 'pass' };
  }

  return { decide, vertexValue, prodOf };
})();
if (typeof module !== 'undefined') module.exports = Bot;
