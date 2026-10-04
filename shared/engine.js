/* ============================================================
   HEXSTEAD ENGINE — pure rules, no DOM. State is plain JSON.
   ============================================================ */
const Engine = (() => {
  const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
  const T2R = { forest: 'lumber', hills: 'brick', pasture: 'wool', fields: 'grain', mountains: 'ore', desert: null };
  const COST = {
    road: { lumber: 1, brick: 1 },
    settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
    city: { grain: 2, ore: 3 },
    dev: { wool: 1, grain: 1, ore: 1 },
  };
  const PIECES = { road: 15, settlement: 5, city: 4 };
  const DEV_COUNTS = { knight: 14, vp: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 };
  const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  const BANK_START = 19;
  const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

  const DEV_COUNTS_BIG = { knight: 20, vp: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 };
  const terr = (f, h, p, fi, m, d) => [...rep('forest', f), ...rep('hills', h), ...rep('pasture', p), ...rep('fields', fi), ...rep('mountains', m), ...rep('desert', d)];

  /* Maps. coords: land hexes in axial (q, r). terrains: exact multiset, or null to size it automatically.
     Water inside the coastline becomes a lake. Numbers and harbours are sized to the land. */
  const MAPS = {
    standard: {
      name: 'Classic', blurb: 'The familiar 19-hex island.', min: 2, max: 4,
      coords: () => radiusCoords(2), terrains: terr(4, 3, 4, 4, 3, 1), ports: 9,
    },
    lagoon: {
      name: 'Lagoon', blurb: 'A ring of land around a calm lake. The robber starts in the water.', min: 2, max: 4,
      coords: () => radiusCoords(2).filter(c => c.q || c.r), terrains: terr(4, 3, 4, 4, 3, 0), ports: 9,
    },
    crescent: {
      name: 'Crescent', blurb: 'A curved island wrapped around a deep bay lined with harbours.', min: 2, max: 4,
      coords: () => fromCols([[6, 8, 10], [5, 7, 9, 11], [2, 4, 6], [1, 3, 5], [2, 4, 6], [5, 7, 9, 11], [6, 8, 10]]),
      terrains: terr(5, 4, 5, 5, 3, 1), ports: 10,
    },
    twins: {
      name: 'Twin Isles', blurb: 'Two islands and no way across. Pick your starting coasts carefully.', min: 2, max: 4,
      coords: () => fromCols([[2, 4, 6, 14, 16, 18], [1, 3, 5, 7, 13, 15, 17, 19], [2, 4, 6, 14, 16, 18], [3, 5, 15, 17]]),
      terrains: terr(5, 4, 5, 4, 4, 2), ports: 10,
    },
    coast: {
      name: 'Long Coast', blurb: 'A narrow strip of land: short distances, coastline everywhere.', min: 2, max: 4,
      coords: () => fromCols([[2, 4, 6, 8, 10, 12, 14], [1, 3, 5, 7, 9, 11, 13], [0, 2, 4, 6, 8, 10, 12]]),
      terrains: terr(5, 4, 4, 4, 3, 1), ports: 10,
    },
    grand: {
      name: 'Grand Isle', blurb: 'A 30-hex island for up to 6 players, with a bigger bank and deck.', min: 2, max: 6, big: true,
      coords: () => fromCols([[4, 6, 8], [3, 5, 7, 9], [2, 4, 6, 8, 10], [1, 3, 5, 7, 9, 11], [2, 4, 6, 8, 10], [3, 5, 7, 9], [4, 6, 8]]),
      terrains: terr(6, 5, 6, 6, 5, 2), ports: 11,
    },
    uncharted: {
      name: 'Uncharted', blurb: 'A brand-new random coastline every game. Grows larger for 5 or 6 players.', min: 2, max: 6,
      coords: (rng, n) => randomIsland(n >= 5 ? 28 : 19, rng), terrains: null, ports: null,
    },
  };
  const MAP_ORDER = ['standard', 'lagoon', 'crescent', 'twins', 'coast', 'grand', 'uncharted'];

  function rep(x, n) { return Array(n).fill(x); }
  function radiusCoords(R) {
    const out = [];
    for (let r = -R; r <= R; r++) for (let q = -R; q <= R; q++) if (Math.abs(q + r) <= R) out.push({ q, r });
    return out;
  }
  function centerCoords(cs) {
    let mx = 0, my = 0;
    for (const c of cs) { mx += Math.sqrt(3) * (c.q + c.r / 2); my += 1.5 * c.r; }
    mx /= cs.length; my /= cs.length;
    const r0 = Math.round(my / 1.5), q0 = Math.round(mx / Math.sqrt(3) - r0 / 2);
    return cs.map(c => ({ q: c.q - q0, r: c.r - r0 })).sort((a, b) => a.r - b.r || a.q - b.q);
  }
  /* rows of column positions; columns step by 2 and odd rows sit on odd columns */
  function fromCols(rows) {
    const out = [];
    rows.forEach((cols, i) => cols.forEach(c => {
      if ((c - i) % 2 !== 0) throw new Error('map column parity, row ' + i + ' col ' + c);
      out.push({ q: (c - i) / 2, r: i });
    }));
    return centerCoords(out);
  }
  function randomIsland(N, rng) {
    const key = (q, r) => q + ',' + r;
    const land = new Map([[key(0, 0), { q: 0, r: 0 }]]);
    while (land.size < N) {
      const cand = new Map();
      for (const c of land.values()) for (const [dq, dr] of NEIGH) {
        const k = key(c.q + dq, c.r + dr);
        if (land.has(k)) continue;
        const e = cand.get(k) || { q: c.q + dq, r: c.r + dr, n: 0 };
        e.n++; cand.set(k, e);
      }
      const list = [...cand.values()];
      let tot = 0;
      for (const e of list) { e.w = e.n * e.n + 0.3; tot += e.w; }
      let x = rng() * tot, pick = list[list.length - 1];
      for (const e of list) { x -= e.w; if (x <= 0) { pick = e; break; } }
      land.set(key(pick.q, pick.r), { q: pick.q, r: pick.r });
    }
    return centerCoords([...land.values()]);
  }
  function autoTerrains(N) {
    const D = N >= 26 ? 2 : 1, n = N - D;
    const w = { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3 };
    const keys = Object.keys(w);
    const cnt = {}; let used = 0;
    for (const k of keys) { cnt[k] = Math.floor(n * w[k] / 18); used += cnt[k]; }
    const rest = keys.slice().sort((a, b) => (n * w[b] / 18 % 1) - (n * w[a] / 18 % 1));
    for (let i = 0; used < n; i++, used++) cnt[rest[i % rest.length]]++;
    return terr(cnt.forest, cnt.hills, cnt.pasture, cnt.fields, cnt.mountains, D);
  }
  const BASE_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  function tokens(n) {
    const t = BASE_TOKENS.slice();
    const add = [3, 11, 4, 10, 5, 9, 6, 8, 2, 12], drop = [12, 2, 11, 3, 10, 4, 9, 5];
    for (let i = 0; t.length < n; i++) t.push(add[i % add.length]);
    for (let i = 0; t.length > n; i++) { const k = t.indexOf(drop[i % drop.length]); if (k >= 0) t.splice(k, 1); }
    return t;
  }
  function portTypes(k) {
    const t = ['any', 'any', 'any', 'any', 'lumber', 'brick', 'wool', 'grain', 'ore'];
    const extra = ['any', 'wool', 'any', 'grain', 'any', 'ore'];
    for (let i = 0; t.length < k; i++) t.push(extra[i % extra.length]);
    while (t.length > k) t.splice(t.indexOf('any') >= 0 ? t.indexOf('any') : 0, 1);
    return t;
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function emptyRes() { return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 }; }
  function total(r) { let t = 0; for (const k of RES) t += (r && r[k]) || 0; return t; }
  function has(r, c) { return RES.every(k => (r[k] || 0) >= ((c && c[k]) || 0)); }
  function addRes(r, c, m = 1) { for (const k of RES) r[k] = (r[k] || 0) + m * ((c && c[k]) || 0); }
  function cleanRes(x) {
    const o = emptyRes();
    if (!x || typeof x !== 'object') return o;
    for (const k of RES) {
      const v = Number(x[k] || 0);
      if (!Number.isInteger(v) || v < 0 || v > 99) throw err('Invalid card amounts.');
      o[k] = v;
    }
    return o;
  }
  function err(m) { const e = new Error(m); e.rule = true; return e; }
  function need(c, m) { if (!c) throw err(m); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  /* ---------------- topology ---------------- */
  const topoCache = new Map();
  function buildTopology(coords) {
    const SQ3 = Math.sqrt(3);
    const verts = [], vmap = new Map(), hexVerts = [], centers = [];
    coords.forEach((h, hi) => {
      const cx = SQ3 * (h.q + h.r / 2), cy = 1.5 * h.r;
      centers.push({ x: cx, y: cy });
      const vs = [];
      for (let i = 0; i < 6; i++) {
        const ang = Math.PI / 180 * (60 * i - 90);
        const x = cx + Math.cos(ang), y = cy + Math.sin(ang);
        const key = Math.round(x * 100) + ',' + Math.round(y * 100);
        let vi = vmap.get(key);
        if (vi === undefined) {
          vi = verts.length; vmap.set(key, vi);
          verts.push({ x, y, hexes: [], adj: [], edges: [] });
        }
        verts[vi].hexes.push(hi);
        vs.push(vi);
      }
      hexVerts.push(vs);
    });
    const edges = [], emap = new Map();
    hexVerts.forEach((vs, hi) => {
      for (let i = 0; i < 6; i++) {
        const a = Math.min(vs[i], vs[(i + 1) % 6]), b = Math.max(vs[i], vs[(i + 1) % 6]);
        const key = a + '-' + b;
        let ei = emap.get(key);
        if (ei === undefined) {
          ei = edges.length; emap.set(key, ei);
          edges.push({ a, b, hexes: [] });
          verts[a].adj.push(b); verts[b].adj.push(a);
          verts[a].edges.push(ei); verts[b].edges.push(ei);
        }
        edges[ei].hexes.push(hi);
      }
    });
    const idx = new Map(coords.map((c, i) => [c.q + ',' + c.r, i]));
    const hexNbrs = coords.map(c => NEIGH.map(([dq, dr]) => idx.get((c.q + dq) + ',' + (c.r + dr))).filter(x => x !== undefined));
    return { verts, edges, hexVerts, centers, hexNbrs };
  }
  function topo(s) {
    const key = s.board.key;
    let t = topoCache.get(key);
    if (!t) { t = buildTopology(s.board.hexes); topoCache.set(key, t); }
    return t;
  }
  function edgeBetween(T, a, b) {
    for (const e of T.verts[a].edges) { const E = T.edges[e]; if ((E.a === a && E.b === b) || (E.a === b && E.b === a)) return e; }
    return -1;
  }
  function otherEnd(T, e, v) { const E = T.edges[e]; return E.a === v ? E.b : E.a; }

  /* ---------------- board generation ---------------- */
  function redAdjacent(hexes, nbrs) {
    for (let i = 0; i < hexes.length; i++) {
      const n = hexes[i].n;
      if (n !== 6 && n !== 8) continue;
      for (const j of nbrs[i]) if (hexes[j].n === 6 || hexes[j].n === 8) return true;
    }
    return false;
  }
  /* connected land masses, so deserts can be spread across islands */
  function islandIds(nbrs) {
    const id = Array(nbrs.length).fill(-1); let n = 0;
    for (let i = 0; i < nbrs.length; i++) {
      if (id[i] >= 0) continue;
      const st = [i]; id[i] = n;
      while (st.length) { const h = st.pop(); for (const j of nbrs[h]) if (id[j] < 0) { id[j] = n; st.push(j); } }
      n++;
    }
    return { id, n };
  }
  function desertsOk(hexes, nbrs, islands) {
    const per = {}; let d = 0;
    for (let i = 0; i < hexes.length; i++) {
      if (hexes[i].t !== 'desert') continue;
      d++;
      for (const j of nbrs[i]) if (hexes[j].t === 'desert') return false;
      per[islands.id[i]] = (per[islands.id[i]] || 0) + 1;
    }
    const cap = Math.ceil(d / islands.n);
    return Object.values(per).every(c => c <= cap);
  }
  function balanceScore(hexes, nbrs, T) {
    let sc = 0;
    for (let i = 0; i < hexes.length; i++) for (const j of nbrs[i]) {
      if (j < i) continue;
      if (hexes[i].t === hexes[j].t) sc += 3;
      if (hexes[i].n && hexes[i].n === hexes[j].n) sc += 2;
    }
    const pipsBy = {}, cnt = {};
    hexes.forEach(h => { const r = T2R[h.t]; if (!r) return; pipsBy[r] = (pipsBy[r] || 0) + PIPS[h.n]; cnt[r] = (cnt[r] || 0) + 1; });
    for (const r of RES) if (cnt[r]) sc += Math.abs(pipsBy[r] / cnt[r] - 3.2) * 3;
    for (const v of T.verts) {
      let p = 0; for (const hi of v.hexes) if (hexes[hi].n) p += PIPS[hexes[hi].n];
      if (p > 12) sc += (p - 12) * 2;
    }
    return sc;
  }
  /* outer coast (faces the open sea) vs. lake shores, and the lake hexes themselves */
  function coastInfo(coords, T) {
    const land = new Set(coords.map(c => c.q + ',' + c.r));
    let qmin = Infinity, qmax = -Infinity, rmin = Infinity, rmax = -Infinity;
    for (const c of coords) { qmin = Math.min(qmin, c.q); qmax = Math.max(qmax, c.q); rmin = Math.min(rmin, c.r); rmax = Math.max(rmax, c.r); }
    qmin -= 2; qmax += 2; rmin -= 2; rmax += 2;
    const inB = (q, r) => q >= qmin && q <= qmax && r >= rmin && r <= rmax;
    const ocean = new Set([qmin + ',' + rmin]);
    const st = [[qmin, rmin]];
    while (st.length) {
      const [q, r] = st.pop();
      for (const [dq, dr] of NEIGH) {
        const nq = q + dq, nr = r + dr, k = nq + ',' + nr;
        if (!inB(nq, nr) || land.has(k) || ocean.has(k)) continue;
        ocean.add(k); st.push([nq, nr]);
      }
    }
    const lakes = [];
    for (let r = rmin; r <= rmax; r++) for (let q = qmin; q <= qmax; q++) { const k = q + ',' + r; if (!land.has(k) && !ocean.has(k)) lakes.push({ q, r }); }
    const outer = [];
    T.edges.forEach((E, i) => {
      if (E.hexes.length !== 1) return;
      const c = T.centers[E.hexes[0]], a = T.verts[E.a], b = T.verts[E.b];
      const nx = (a.x + b.x) - c.x, ny = (a.y + b.y) - c.y;
      const r = Math.round(ny / 1.5), q = Math.round(nx / Math.sqrt(3) - r / 2);
      if (ocean.has(q + ',' + r)) outer.push(i);
    });
    return { outer, lakes };
  }
  /* spread k harbours along the outer coast: each new one as far as possible from the others */
  function spreadEdges(T, cand, k, rng) {
    const mid = e => { const E = T.edges[e]; return [(T.verts[E.a].x + T.verts[E.b].x) / 2, (T.verts[E.a].y + T.verts[E.b].y) / 2]; };
    const pts = new Map(cand.map(e => [e, mid(e)]));
    const chosen = [cand[Math.floor(rng() * cand.length)]];
    while (chosen.length < Math.min(k, cand.length)) {
      let best = null, bd = -1;
      for (const e of cand) {
        if (chosen.includes(e)) continue;
        const [x, y] = pts.get(e);
        let d = Infinity;
        for (const c of chosen) { const [cx, cy] = pts.get(c); d = Math.min(d, Math.hypot(x - cx, y - cy)); }
        d += rng() * 0.2;
        if (d > bd) { bd = d; best = e; }
      }
      chosen.push(best);
    }
    return chosen;
  }
  function genBoard(opts, rng) {
    const id = MAPS[opts.map] ? opts.map : 'standard';
    const def = MAPS[id];
    const coords = def.coords(rng, opts.players || 4);
    const N = coords.length;
    const terrains = def.terrains ? def.terrains.slice() : autoTerrains(N);
    if (terrains.length !== N) throw new Error('map ' + id + ': ' + terrains.length + ' terrains for ' + N + ' hexes');
    const numbers = tokens(N - terrains.filter(t => t === 'desert').length);
    const key = coords.map(c => c.q + ',' + c.r).join(';');
    const T = buildTopology(coords);
    topoCache.set(key, T);
    const balanced = opts.layout === 'balanced';
    const islands = islandIds(T.hexNbrs);
    let best = null, bestScore = Infinity;
    for (let attempt = 0; attempt < (balanced ? 300 : 3000); attempt++) {
      const terr = shuffle(terrains.slice(), rng);
      const nums = shuffle(numbers.slice(), rng);
      const hexes = coords.map((c, i) => ({ q: c.q, r: c.r, t: terr[i], n: 0 }));
      let k = 0;
      for (const h of hexes) if (h.t !== 'desert') h.n = nums[k++];
      if (redAdjacent(hexes, T.hexNbrs) || !desertsOk(hexes, T.hexNbrs, islands)) continue;
      if (!balanced) { best = hexes; break; }
      const sc = balanceScore(hexes, T.hexNbrs, T);
      if (sc < bestScore) { bestScore = sc; best = hexes; }
    }
    if (!best) {
      const terr = shuffle(terrains.slice(), rng), nums = shuffle(numbers.slice(), rng);
      best = coords.map((c, i) => ({ q: c.q, r: c.r, t: terr[i], n: 0 }));
      let k = 0; for (const h of best) if (h.t !== 'desert') h.n = nums[k++];
    }
    const geo = coastInfo(coords, T);
    const K = def.ports || (N >= 26 ? 11 : 9);
    const types = shuffle(portTypes(K), rng);
    const edges = spreadEdges(T, geo.outer, K, rng);
    const ports = edges.map((e, i) => ({ e, type: types[i] }));
    const robber = best.findIndex(h => h.t === 'desert');
    const board = { key, map: id, layout: balanced ? 'balanced' : 'random', hexes: best, ports, robber, lakes: geo.lakes };
    if (robber < 0) {
      const L = geo.lakes[0] || { q: 0, r: 0 };
      board.robberSpot = { x: Math.sqrt(3) * (L.q + L.r / 2), y: 1.5 * L.r };
    }
    return board;
  }
  function mapInfo(id) { const d = MAPS[id] || MAPS.standard; return { id: MAPS[id] ? id : 'standard', name: d.name, blurb: d.blurb, min: d.min, max: d.max }; }

  /* ---------------- game creation ---------------- */
  const DEFAULT_SETTINGS = { vpToWin: 10, discardLimit: 7, friendlyRobber: false, timer: 0, map: 'standard', layout: 'random', maxPlayers: 4 };
  function newGame(cfg, rng) {
    const st = Object.assign({}, DEFAULT_SETTINGS, cfg.settings || {});
    const def = MAPS[st.map] || MAPS.standard;
    const big = !!def.big || cfg.players.length >= 5;
    const board = genBoard({ map: st.map, layout: st.layout, players: cfg.players.length }, rng);
    const T = topo({ board });
    const players = shuffle(cfg.players.map(p => ({ uid: p.uid || null, bot: !!p.bot, nick: p.nick || '', color: p.color })), rng)
      .map(p => Object.assign(p, { res: emptyRes(), dev: [], newDev: {}, knights: 0, devUsed: 0 }));
    const deck = [];
    const counts = big ? DEV_COUNTS_BIG : DEV_COUNTS;
    for (const k of Object.keys(counts)) for (let i = 0; i < counts[k]; i++) deck.push(k);
    shuffle(deck, rng);
    const bankStart = big ? 24 : BANK_START;
    const bank = {}; for (const r of RES) bank[r] = bankStart;
    const s = {
      v: 1, settings: st, board, players, bank, deck, bankStart, deckTotal: deck.length, special: null,
      bld: Array(T.verts.length).fill(null),
      roads: Array(T.edges.length).fill(-1),
      phase: 'setup', cur: 0, turn: 0,
      setup: { i: 0, step: 'settlement', lastV: -1 },
      dice: null, devPlayed: false, freeRoads: 0, resume: null,
      discard: null, stealCands: null, trade: null,
      lr: { p: -1, len: 0 }, la: { p: -1, n: 0 },
      log: [], seq: 0, winner: -1,
      stats: { rolls: Array(13).fill(0), gained: players.map(() => 0), stolen: players.map(() => 0), lost: players.map(() => 0) },
    };
    log(s, { k: 'start' });
    return s;
  }

  function log(s, e) {
    e.turn = s.turn;
    s.logId = (s.logId || 0) + 1;
    e.id = s.logId;
    s.log.push(e);
    if (s.log.length > 160) s.log.splice(0, s.log.length - 160);
  }

  /* ---------------- queries ---------------- */
  function setupOrder(s) { const n = s.players.length; const o = []; for (let i = 0; i < n; i++) o.push(i); for (let i = n - 1; i >= 0; i--) o.push(i); return o; }
  function piecesUsed(s, p) {
    let road = 0, settlement = 0, city = 0;
    for (const r of s.roads) if (r === p) road++;
    for (const b of s.bld) if (b && b.p === p) { if (b.city) city++; else settlement++; }
    return { road, settlement, city };
  }
  function piecesLeft(s, p) { const u = piecesUsed(s, p); return { road: PIECES.road - u.road, settlement: PIECES.settlement - u.settlement, city: PIECES.city - u.city }; }
  function publicVP(s, p) {
    let v = 0;
    for (const b of s.bld) if (b && b.p === p) v += b.city ? 2 : 1;
    if (s.lr.p === p) v += 2;
    if (s.la.p === p) v += 2;
    return v;
  }
  function vpCards(s, p) { return s.players[p].dev.filter(d => d === 'vp').length; }
  function vp(s, p) { return publicVP(s, p) + vpCards(s, p); }
  function playable(s, p, card) {
    const P = s.players[p];
    return P.dev.filter(d => d === card).length - ((P.newDev && P.newDev[card]) || 0);
  }
  function rates(s, p) {
    const T = topo(s);
    const r = {}; for (const k of RES) r[k] = 4;
    for (const pt of s.board.ports) {
      const E = T.edges[pt.e];
      const mine = [E.a, E.b].some(v => s.bld[v] && s.bld[v].p === p);
      if (!mine) continue;
      if (pt.type === 'any') { for (const k of RES) r[k] = Math.min(r[k], 3); } else r[pt.type] = 2;
    }
    return r;
  }
  function portAt(s, v) {
    const T = topo(s);
    for (const pt of s.board.ports) { const E = T.edges[pt.e]; if (E.a === v || E.b === v) return pt.type; }
    return null;
  }
  function settlementOk(s, p, v, setup) {
    const T = topo(s);
    if (v < 0 || v >= T.verts.length || s.bld[v]) return false;
    for (const w of T.verts[v].adj) if (s.bld[w]) return false;
    if (setup) return true;
    return T.verts[v].edges.some(e => s.roads[e] === p);
  }
  function roadOk(s, p, e, fromV) {
    const T = topo(s);
    if (e < 0 || e >= T.edges.length || s.roads[e] !== -1) return false;
    const E = T.edges[e];
    if (fromV !== undefined && fromV !== null && fromV >= 0) return E.a === fromV || E.b === fromV;
    for (const x of [E.a, E.b]) {
      const b = s.bld[x];
      if (b && b.p === p) return true;
      if (b && b.p !== p) continue;
      if (T.verts[x].edges.some(f => f !== e && s.roads[f] === p)) return true;
    }
    return false;
  }
  function legalSettlements(s, p, setup) {
    const T = topo(s); const out = [];
    for (let v = 0; v < T.verts.length; v++) if (settlementOk(s, p, v, setup)) out.push(v);
    return out;
  }
  function legalRoads(s, p) {
    const T = topo(s); const out = [];
    const fromV = s.phase === 'setup' ? s.setup.lastV : null;
    for (let e = 0; e < T.edges.length; e++) if (roadOk(s, p, e, fromV)) out.push(e);
    return out;
  }
  function legalCities(s, p) {
    const out = [];
    s.bld.forEach((b, v) => { if (b && b.p === p && !b.city) out.push(v); });
    return out;
  }
  function robberProtected(s, q) { return s.settings.friendlyRobber && publicVP(s, q) <= 2; }
  function legalRobberHexes(s, p) {
    const T = topo(s);
    const all = [];
    for (let h = 0; h < s.board.hexes.length; h++) if (h !== s.board.robber) all.push(h);
    if (!s.settings.friendlyRobber) return all;
    const ok = all.filter(h => !T.hexVerts[h].some(v => s.bld[v] && s.bld[v].p !== p && robberProtected(s, s.bld[v].p)));
    return ok.length ? ok : all;
  }
  function stealCandidates(s, p, h) {
    const T = topo(s); const set = new Set();
    for (const v of T.hexVerts[h]) {
      const b = s.bld[v];
      if (b && b.p !== p && total(s.players[b.p].res) > 0 && !robberProtected(s, b.p)) set.add(b.p);
    }
    return [...set].sort((a, b) => a - b);
  }
  function discardNeeded(s, p) { return (s.discard && s.discard[p]) || 0; }

  /* who must act now (for UI + timers + bots) */
  function pendingActors(s) {
    if (s.phase === 'ended') return [];
    if (s.phase === 'discard') return Object.keys(s.discard || {}).map(Number);
    if (s.phase === 'special') return s.special && s.special.q.length ? [s.special.q[0]] : [];
    return [s.cur];
  }

  /* ---------------- longest road / largest army ---------------- */
  function roadLength(s, p) {
    const T = topo(s);
    const mine = [];
    s.roads.forEach((o, e) => { if (o === p) mine.push(e); });
    if (!mine.length) return 0;
    let best = 0;
    const used = new Set();
    const blocked = v => s.bld[v] && s.bld[v].p !== p;
    function dfs(v, len) {
      if (len > best) best = len;
      if (len > 0 && blocked(v)) return;
      for (const e of T.verts[v].edges) {
        if (s.roads[e] !== p || used.has(e)) continue;
        used.add(e);
        dfs(otherEnd(T, e, v), len + 1);
        used.delete(e);
      }
    }
    const starts = new Set();
    for (const e of mine) { starts.add(T.edges[e].a); starts.add(T.edges[e].b); }
    for (const v of starts) dfs(v, 0);
    return best;
  }
  function updateLR(s) {
    const lens = s.players.map((_, i) => roadLength(s, i));
    const max = Math.max(...lens);
    const cur = s.lr.p;
    let np;
    if (max < 5) np = -1;
    else if (cur >= 0 && lens[cur] === max) np = cur;
    else {
      const leaders = lens.map((l, i) => l === max ? i : -1).filter(i => i >= 0);
      np = leaders.length === 1 ? leaders[0] : -1;
    }
    if (np !== cur) {
      if (np >= 0) log(s, { k: 'lr', p: np, len: lens[np], from: cur });
      else log(s, { k: 'lrLost', p: cur });
    }
    s.lr = { p: np, len: np >= 0 ? lens[np] : 0 };
    s.roadLens = lens;
  }
  function updateLA(s, p) {
    const P = s.players[p];
    if (P.knights < 3) return;
    if (s.la.p === p) { s.la.n = P.knights; return; }
    if (s.la.p === -1 || P.knights > s.players[s.la.p].knights) {
      log(s, { k: 'la', p, n: P.knights, from: s.la.p });
      s.la = { p, n: P.knights };
    }
  }

  /* ---------------- production ---------------- */
  function produce(s, roll) {
    const T = topo(s);
    const owed = s.players.map(() => emptyRes());
    s.board.hexes.forEach((h, hi) => {
      if (h.n !== roll || hi === s.board.robber) return;
      const r = T2R[h.t]; if (!r) return;
      for (const v of T.hexVerts[hi]) { const b = s.bld[v]; if (b) owed[b.p][r] += b.city ? 2 : 1; }
    });
    const got = s.players.map(() => emptyRes());
    const short = [];
    for (const r of RES) {
      const tot = owed.reduce((a, o) => a + o[r], 0);
      if (!tot) continue;
      if (s.bank[r] >= tot) { owed.forEach((o, i) => { got[i][r] += o[r]; }); }
      else {
        const who = owed.map((o, i) => o[r] > 0 ? i : -1).filter(i => i >= 0);
        if (who.length === 1) got[who[0]][r] += s.bank[r];
        short.push(r);
      }
    }
    got.forEach((g, i) => {
      addRes(s.players[i].res, g); addRes(s.bank, g, -1);
      const t = total(g);
      s.stats.gained[i] += t;
      if (t) log(s, { k: 'gain', p: i, res: g });
    });
    if (short.length) log(s, { k: 'short', res: short });
  }

  /* ---------------- actions ---------------- */
  function advanceSetup(s) {
    const order = setupOrder(s);
    s.setup.i++;
    if (s.setup.i >= order.length) {
      s.phase = 'roll'; s.cur = 0; s.turn = 1; s.setup = null;
      log(s, { k: 'turn', p: 0 });
    } else {
      s.cur = order[s.setup.i];
      s.setup.step = 'settlement'; s.setup.lastV = -1;
    }
  }
  function doSteal(s, p, q, rng) {
    const V = s.players[q];
    const cards = [];
    for (const r of RES) for (let i = 0; i < V.res[r]; i++) cards.push(r);
    if (!cards.length) { log(s, { k: 'stealNone', p, q }); return; }
    const r = cards[Math.floor(rng() * cards.length)];
    V.res[r]--; s.players[p].res[r]++;
    s.stats.stolen[p]++; s.stats.lost[q]++;
    log(s, { k: 'steal', p, q, r });
  }
  function payCost(s, p, c) {
    const P = s.players[p];
    need(has(P.res, c), 'Not enough resources.');
    addRes(P.res, c, -1); addRes(s.bank, c, 1);
  }
  function checkWin(s) {
    if (s.phase === 'setup' || s.phase === 'ended' || s.phase === 'special') return; // you only win on your own turn
    const c = s.cur;
    if (vp(s, c) >= s.settings.vpToWin) {
      s.phase = 'ended'; s.winner = c; s.trade = null;
      log(s, { k: 'win', p: c, vp: vp(s, c) });
    }
  }
  function sanitizeTradeSide(x) { return cleanRes(x); }

  function act(s, p, a, rng) {
    need(a && typeof a.t === 'string', 'Unknown action.');
    need(s.phase !== 'ended', 'The game is over.');
    need(Number.isInteger(p) && p >= 0 && p < s.players.length, 'You are not in this game.');
    const P = s.players[p];
    const T = topo(s);
    const isCur = p === s.cur;
    const canBuild = (s.phase === 'main' && isCur) || (s.phase === 'special' && s.special && s.special.q[0] === p);
    switch (a.t) {
      case 'settle': {
        const v = a.v | 0;
        if (s.phase === 'setup') {
          need(isCur && s.setup.step === 'settlement', 'Not your placement.');
          need(settlementOk(s, p, v, true), 'You can\'t build there.');
          s.bld[v] = { p, city: false };
          s.setup.lastV = v; s.setup.step = 'road';
          log(s, { k: 'build', p, what: 'settlement', v });
          if (s.setup.i >= s.players.length) {
            const g = emptyRes();
            for (const hi of T.verts[v].hexes) { const r = T2R[s.board.hexes[hi].t]; if (r && s.bank[r] > 0) g[r]++; }
            addRes(P.res, g); addRes(s.bank, g, -1);
            if (total(g)) log(s, { k: 'gain', p, res: g, setup: true });
          }
          updateLR(s);
        } else {
          need(canBuild, 'You can only build on your turn after rolling.');
          need(piecesLeft(s, p).settlement > 0, 'No settlements left. Upgrade one to a city.');
          need(settlementOk(s, p, v, false), 'You can\'t build a settlement there.');
          payCost(s, p, COST.settlement);
          s.bld[v] = { p, city: false };
          log(s, { k: 'build', p, what: 'settlement', v });
          updateLR(s);
        }
        break;
      }
      case 'road': {
        const e = a.e | 0;
        if (s.phase === 'setup') {
          need(isCur && s.setup.step === 'road', 'Not your placement.');
          need(roadOk(s, p, e, s.setup.lastV), 'The road must touch the settlement you just placed.');
          s.roads[e] = p;
          log(s, { k: 'build', p, what: 'road', e });
          advanceSetup(s);
        } else if (s.phase === 'roadBuilding') {
          need(isCur, 'Not your turn.');
          need(piecesLeft(s, p).road > 0, 'No roads left.');
          need(roadOk(s, p, e), 'You can\'t build a road there.');
          s.roads[e] = p; s.freeRoads--;
          log(s, { k: 'build', p, what: 'road', e, free: true });
          updateLR(s);
          if (s.freeRoads <= 0 || piecesLeft(s, p).road <= 0 || !legalRoads(s, p).length) { s.phase = s.resume; s.resume = null; s.freeRoads = 0; }
        } else {
          need(canBuild, 'You can only build on your turn after rolling.');
          need(piecesLeft(s, p).road > 0, 'No roads left.');
          need(roadOk(s, p, e), 'You can\'t build a road there.');
          payCost(s, p, COST.road);
          s.roads[e] = p;
          log(s, { k: 'build', p, what: 'road', e });
          updateLR(s);
        }
        break;
      }
      case 'city': {
        const v = a.v | 0;
        need(canBuild, 'You can only build on your turn after rolling.');
        need(piecesLeft(s, p).city > 0, 'No cities left.');
        need(s.bld[v] && s.bld[v].p === p && !s.bld[v].city, 'Cities upgrade one of your settlements.');
        payCost(s, p, COST.city);
        s.bld[v].city = true;
        log(s, { k: 'build', p, what: 'city', v });
        break;
      }
      case 'skipRoads': {
        need(s.phase === 'roadBuilding' && isCur, 'Nothing to skip.');
        s.phase = s.resume; s.resume = null; s.freeRoads = 0;
        break;
      }
      case 'roll': {
        need(s.phase === 'roll' && isCur, 'You can\'t roll now.');
        const d1 = 1 + Math.floor(rng() * 6), d2 = 1 + Math.floor(rng() * 6);
        const sum = d1 + d2;
        s.dice = [d1, d2]; s.stats.rolls[sum]++;
        s.rollId = (s.rollId || 0) + 1;
        log(s, { k: 'roll', p, d: [d1, d2] });
        if (sum === 7) {
          const dis = {};
          s.players.forEach((pl, i) => { const t = total(pl.res); if (t > s.settings.discardLimit) dis[i] = Math.floor(t / 2); });
          s.resume = 'main';
          if (Object.keys(dis).length) { s.discard = dis; s.phase = 'discard'; } else s.phase = 'robber';
        } else {
          produce(s, sum);
          s.phase = 'main';
        }
        break;
      }
      case 'discard': {
        need(s.phase === 'discard' && discardNeeded(s, p) > 0, 'You don\'t need to discard.');
        const r = cleanRes(a.res);
        need(total(r) === s.discard[p], 'Discard exactly ' + s.discard[p] + ' cards.');
        need(has(P.res, r), 'You don\'t have those cards.');
        addRes(P.res, r, -1); addRes(s.bank, r, 1);
        s.stats.lost[p] += total(r);
        log(s, { k: 'discard', p, n: total(r) });
        delete s.discard[p];
        if (!Object.keys(s.discard).length) { s.discard = null; s.phase = 'robber'; }
        break;
      }
      case 'robber': {
        need(s.phase === 'robber' && isCur, 'You can\'t move the robber now.');
        const h = a.h | 0;
        need(h >= 0 && h < s.board.hexes.length && h !== s.board.robber, 'Move the robber to a different hex.');
        need(legalRobberHexes(s, p).includes(h), 'Friendly robber: that hex is protected.');
        s.board.robber = h;
        log(s, { k: 'robber', p, h });
        const cands = stealCandidates(s, p, h);
        if (!cands.length) { s.phase = s.resume; s.resume = null; }
        else if (cands.length === 1) { doSteal(s, p, cands[0], rng); s.phase = s.resume; s.resume = null; }
        else { s.phase = 'steal'; s.stealCands = cands; }
        break;
      }
      case 'steal': {
        need(s.phase === 'steal' && isCur, 'You can\'t steal now.');
        const q = a.q | 0;
        need(s.stealCands.includes(q), 'Pick a player next to the robber.');
        doSteal(s, p, q, rng);
        s.stealCands = null; s.phase = s.resume; s.resume = null;
        break;
      }
      case 'buyDev': {
        need(canBuild, 'You can only buy on your turn after rolling.');
        need(s.deck.length > 0, 'No development cards left.');
        payCost(s, p, COST.dev);
        const c = s.deck.pop();
        P.dev.push(c);
        P.newDev[c] = (P.newDev[c] || 0) + 1;
        log(s, { k: 'buyDev', p, card: c });
        break;
      }
      case 'play': {
        const c = a.card;
        need((s.phase === 'main' || s.phase === 'roll') && isCur, 'You can only play cards on your turn.');
        need(['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly'].includes(c), 'That card can\'t be played.');
        need(!s.devPlayed, 'You already played a development card this turn.');
        need(playable(s, p, c) > 0, P.dev.includes(c) ? 'Cards bought this turn can be played next turn.' : 'You don\'t have that card.');
        if (c === 'roadBuilding') need(piecesLeft(s, p).road > 0 && legalRoads(s, p).length > 0, 'No place to build a road.');
        let yop = null;
        if (c === 'yearOfPlenty') {
          yop = cleanRes(a.res);
          need(total(yop) === 2, 'Pick two resources.');
          need(has(s.bank, yop), 'The bank doesn\'t have those.');
        }
        if (c === 'monopoly') need(RES.includes(a.r), 'Pick a resource.');
        P.dev.splice(P.dev.indexOf(c), 1);
        P.devUsed++;
        s.devPlayed = true;
        log(s, { k: 'play', p, card: c });
        if (c === 'knight') {
          P.knights++;
          updateLA(s, p);
          s.resume = s.phase; s.phase = 'robber';
        } else if (c === 'roadBuilding') {
          s.freeRoads = Math.min(2, piecesLeft(s, p).road);
          s.resume = s.phase; s.phase = 'roadBuilding';
        } else if (c === 'yearOfPlenty') {
          addRes(P.res, yop); addRes(s.bank, yop, -1);
          log(s, { k: 'gain', p, res: yop, card: true });
        } else if (c === 'monopoly') {
          let n = 0;
          s.players.forEach((q, i) => { if (i === p) return; n += q.res[a.r]; q.res[a.r] = 0; });
          P.res[a.r] += n;
          log(s, { k: 'mono', p, r: a.r, n });
        }
        break;
      }
      case 'bank': {
        need(s.phase === 'main' && isCur, 'You can only trade on your turn after rolling.');
        const give = cleanRes(a.give), get = cleanRes(a.get);
        const rt = rates(s, p);
        let credits = 0;
        for (const r of RES) {
          if (give[r] && get[r]) throw err('You can\'t trade a resource for itself.');
          if (give[r] % rt[r]) throw err('Give ' + r + ' in multiples of ' + rt[r] + '.');
          credits += give[r] / rt[r];
        }
        need(credits > 0 && total(get) === credits, 'That trade doesn\'t balance with the bank.');
        need(has(P.res, give), 'You don\'t have those cards.');
        need(has(s.bank, get), 'The bank is out of that resource.');
        addRes(P.res, give, -1); addRes(s.bank, give, 1);
        addRes(P.res, get, 1); addRes(s.bank, get, -1);
        log(s, { k: 'bank', p, give, get });
        break;
      }
      case 'offer': {
        need(s.phase === 'main' && isCur, 'You can only trade on your turn after rolling.');
        const give = sanitizeTradeSide(a.give), get = sanitizeTradeSide(a.get);
        need(total(give) > 0 && total(get) > 0, 'Pick what you give and what you want.');
        for (const r of RES) if (give[r] && get[r]) throw err('You can\'t trade a resource for itself.');
        need(has(P.res, give), 'You don\'t have those cards.');
        s.trade = { id: ++s.seq, from: p, give, get, resp: {} };
        log(s, { k: 'offer', p, give, get });
        break;
      }
      case 'respond': {
        need(s.trade && s.trade.id === a.id, 'That offer is gone.');
        need(p !== s.trade.from, 'This is your own offer.');
        if (a.r === 'accept') {
          need(has(P.res, s.trade.get), 'You don\'t have the cards they want.');
          s.trade.resp[p] = 'accept';
        } else s.trade.resp[p] = 'decline';
        break;
      }
      case 'counter': {
        need(s.trade && s.trade.id === a.id, 'That offer is gone.');
        need(p !== s.trade.from, 'This is your own offer.');
        const give = sanitizeTradeSide(a.give), get = sanitizeTradeSide(a.get);
        need(total(give) > 0 && total(get) > 0, 'Pick what you give and what you want.');
        for (const r of RES) if (give[r] && get[r]) throw err('You can\'t trade a resource for itself.');
        need(has(P.res, give), 'You don\'t have those cards.');
        s.trade.resp[p] = { give, get };
        log(s, { k: 'counter', p, q: s.trade.from, give, get });
        break;
      }
      case 'confirm': {
        need(s.phase === 'main' && isCur && s.trade && s.trade.from === p && s.trade.id === a.id, 'No offer to confirm.');
        const q = a.q | 0;
        const resp = s.trade.resp[q];
        need(q !== p && q >= 0 && q < s.players.length && resp && resp !== 'decline', 'That player hasn\'t accepted.');
        const Q = s.players[q];
        let mine, theirs; // mine: what p gives, theirs: what q gives
        if (resp === 'accept') { mine = s.trade.give; theirs = s.trade.get; }
        else { mine = resp.get; theirs = resp.give; }
        need(has(P.res, mine), 'You no longer have the cards for this trade.');
        need(has(Q.res, theirs), 'They no longer have the cards for this trade.');
        addRes(P.res, mine, -1); addRes(Q.res, mine, 1);
        addRes(Q.res, theirs, -1); addRes(P.res, theirs, 1);
        log(s, { k: 'trade', p, q, give: mine, get: theirs });
        s.trade = null;
        break;
      }
      case 'cancel': {
        need(s.trade && s.trade.from === p, 'No offer to cancel.');
        s.trade = null;
        break;
      }
      case 'end': {
        need(s.phase === 'main' && isCur, 'You can\'t end your turn yet.');
        s.trade = null;
        P.newDev = {};
        s.devPlayed = false;
        const n = s.players.length;
        if (n >= 5) {
          // 5-6 players: everyone else may build (no trading, no cards) before the next turn
          const q = [];
          for (let k = 1; k < n; k++) q.push((s.cur + k) % n);
          s.special = { q };
          s.phase = 'special';
          log(s, { k: 'special', p: s.cur });
        } else nextTurn(s);
        break;
      }
      case 'pass': {
        need(s.phase === 'special' && s.special && s.special.q[0] === p, 'It isn\'t your turn to build.');
        s.special.q.shift();
        if (!s.special.q.length) { s.special = null; nextTurn(s); }
        break;
      }
      default: throw err('Unknown action.');
    }
    checkWin(s);
    return s;
  }

  function nextTurn(s) {
    s.cur = (s.cur + 1) % s.players.length;
    s.turn++;
    s.phase = 'roll';
    s.players[s.cur].newDev = {}; // cards bought before this turn (e.g. while special building) are playable now
    log(s, { k: 'turn', p: s.cur });
  }

  /* convenience: apply on a copy, return new state or throw */
  function apply(s, p, a, rng) { const n = clone(s); act(n, p, a, rng); return n; }

  return {
    addLog: log,
    RES, T2R, COST, PIECES, DEV_COUNTS, DEV_COUNTS_BIG, PIPS, BANK_START, MAPS, MAP_ORDER, mapInfo, DEFAULT_SETTINGS,
    topo, buildTopology, genBoard, newGame, act, apply, clone, total, has, addRes, emptyRes, cleanRes, shuffle,
    piecesLeft, publicVP, vp, vpCards, playable, rates, portAt, settlementOk, roadOk,
    legalSettlements, legalRoads, legalCities, legalRobberHexes, stealCandidates, discardNeeded,
    pendingActors, roadLength, setupOrder, edgeBetween, otherEnd,
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
