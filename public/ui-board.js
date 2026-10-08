/* ============================================================
   HEXSTEAD UI — helpers, icons, board renderer
   ============================================================ */
const $ = (sel, root) => (root || document).querySelector(sel);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function setHTML(el, html) { if (el && el._h !== html) { el._h = html; el.innerHTML = html; } }
const RES_NAME = { lumber: 'Lumber', brick: 'Brick', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
const DEV_NAME = { knight: 'Knight', roadBuilding: 'Road Building', yearOfPlenty: 'Year of Plenty', monopoly: 'Monopoly', vp: 'Victory Point' };
const DEV_HELP = {
  knight: 'Move the robber and rob a neighbour. Counts toward Largest Army.',
  roadBuilding: 'Build two roads for free.',
  yearOfPlenty: 'Take any two resources from the bank.',
  monopoly: 'Name a resource. Every other player gives you all of theirs.',
  vp: 'Worth 1 point. Stays hidden until you win.',
};
const TERRAIN = {
  forest: { base: '#2f6e3f', name: 'Forest' },
  hills: { base: '#b9623b', name: 'Hills' },
  pasture: { base: '#8dbd58', name: 'Pasture' },
  fields: { base: '#dfb440', name: 'Fields' },
  mountains: { base: '#7b8494', name: 'Mountains' },
  desert: { base: '#d9c48c', name: 'Desert' },
};
const RES_COLOR = { lumber: '#2f7d45', brick: '#bf5632', wool: '#93c766', grain: '#e8bf3e', ore: '#8a93a5' };

const ICON_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<radialGradient id="g-forest" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="#3f8a52"/><stop offset=".7" stop-color="#2f6e3f"/><stop offset="1" stop-color="#245733"/></radialGradient>
<radialGradient id="g-hills" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="#cf7a4f"/><stop offset=".7" stop-color="#b9623b"/><stop offset="1" stop-color="#9c4f2e"/></radialGradient>
<radialGradient id="g-pasture" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="#a4d06e"/><stop offset=".7" stop-color="#8dbd58"/><stop offset="1" stop-color="#77a648"/></radialGradient>
<radialGradient id="g-fields" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="#f0c95c"/><stop offset=".7" stop-color="#dfb440"/><stop offset="1" stop-color="#c79c2f"/></radialGradient>
<radialGradient id="g-mountains" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="#939cab"/><stop offset=".7" stop-color="#7b8494"/><stop offset="1" stop-color="#666f7e"/></radialGradient>
<radialGradient id="g-desert" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="#ead8a3"/><stop offset=".7" stop-color="#d9c48c"/><stop offset="1" stop-color="#c3ad73"/></radialGradient>
<radialGradient id="g-token" cx="45%" cy="38%" r="65%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#eadcbc"/></radialGradient>
<filter id="f-soft" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="2.5" stdDeviation="2" flood-color="#000" flood-opacity=".38"/></filter>
<filter id="f-piece" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="2.2" flood-color="#000" flood-opacity=".45"/></filter>
<symbol id="i-lumber" viewBox="0 0 24 24"><path d="M12 2.5 6 10.5h3.2L5 16.5h5.6V21h2.8v-4.5H19l-4.2-6H18z" fill="#effaf1"/></symbol>
<symbol id="i-brick" viewBox="0 0 24 24"><g fill="#ffe9dd"><rect x="2.5" y="5" width="9" height="4" rx="1"/><rect x="12.5" y="5" width="9" height="4" rx="1"/><rect x="2.5" y="10.2" width="4" height="4" rx="1"/><rect x="7.5" y="10.2" width="9" height="4" rx="1"/><rect x="17.5" y="10.2" width="4" height="4" rx="1"/><rect x="2.5" y="15.4" width="9" height="4" rx="1"/><rect x="12.5" y="15.4" width="9" height="4" rx="1"/></g></symbol>
<symbol id="i-wool" viewBox="0 0 24 24"><g fill="#fff"><circle cx="10" cy="12.5" r="4"/><circle cx="13.6" cy="10.4" r="4.1"/><circle cx="16.4" cy="13.2" r="3.7"/><circle cx="12.2" cy="15" r="3.6"/></g><ellipse cx="6" cy="11.6" rx="2.4" ry="2.9" fill="#2d3b22"/><path d="M10.5 18v3M15.5 18v3" stroke="#2d3b22" stroke-width="1.8" stroke-linecap="round"/></symbol>
<symbol id="i-grain" viewBox="0 0 24 24"><path d="M12 22V5" stroke="#6b5208" stroke-width="1.6" stroke-linecap="round"/><g fill="#fff8dc"><ellipse cx="12" cy="4.4" rx="1.8" ry="2.8"/><ellipse cx="9.6" cy="8" rx="1.7" ry="3" transform="rotate(-32 9.6 8)"/><ellipse cx="14.4" cy="8" rx="1.7" ry="3" transform="rotate(32 14.4 8)"/><ellipse cx="9.6" cy="12" rx="1.7" ry="3" transform="rotate(-32 9.6 12)"/><ellipse cx="14.4" cy="12" rx="1.7" ry="3" transform="rotate(32 14.4 12)"/><ellipse cx="9.6" cy="16" rx="1.7" ry="3" transform="rotate(-32 9.6 16)"/><ellipse cx="14.4" cy="16" rx="1.7" ry="3" transform="rotate(32 14.4 16)"/></g></symbol>
<symbol id="i-ore" viewBox="0 0 24 24"><path d="M3.5 18 7 9.5l5-3 5.5 2.5 3 7.5-4 4h-9z" fill="#eef1f6"/><path d="M7 9.5 10 14l2-7.5M10 14l-6.5 4M10 14l7.5-5M10 14l6.5 6M10 14v6" stroke="#596274" stroke-width="1.1" fill="none" stroke-linejoin="round"/></symbol>
<symbol id="i-road" viewBox="0 0 24 24"><path d="M4 20 18 4" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/><path d="M8 20 20 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".45"/></symbol>
<symbol id="i-settlement" viewBox="0 0 24 24"><path d="M4 20.5h16V10l-8-6.5L4 10z" fill="currentColor"/><rect x="10" y="14" width="4" height="6.5" fill="#0d1f2f" opacity=".55"/></symbol>
<symbol id="i-city" viewBox="0 0 24 24"><path d="M2.5 21h19V10.5h-8V7l-5-4.5L3.5 7v0z" fill="currentColor"/><path d="M2.5 21V7l6-4.5L13.5 7v14z" fill="currentColor"/><rect x="15.5" y="13" width="3" height="3" fill="#0d1f2f" opacity=".55"/><rect x="6.5" y="9" width="3" height="3" fill="#0d1f2f" opacity=".55"/></symbol>
<symbol id="i-card" viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1.9-1.1 1.8M12 17h.01" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></symbol>
<symbol id="i-cards" viewBox="0 0 24 24"><rect x="3" y="6" width="11" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 3.5h9a2 2 0 0 1 2 2V17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
<symbol id="i-trade" viewBox="0 0 24 24"><path d="M4 8h14l-4-4M20 16H6l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-end" viewBox="0 0 24 24"><path d="M5 12h12M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-die" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></symbol>
<symbol id="i-knight" viewBox="0 0 24 24"><path d="M12 2.8 19 5.6v5.6c0 4.6-3 8.3-7 9.9-4-1.6-7-5.3-7-9.9V5.6z" fill="currentColor" opacity=".9"/><path d="M12 7v9M8.5 10.5h7" stroke="#0d1f2f" stroke-width="2" stroke-linecap="round"/></symbol>
<symbol id="i-roadBuilding" viewBox="0 0 24 24"><path d="M3 19 10 5M14 19l7-14" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></symbol>
<symbol id="i-yearOfPlenty" viewBox="0 0 24 24"><path d="M12 3v18M12 7c-3-3-6-1-6 1 3 0 5 1 6 3 1-2 3-3 6-3 0-2-3-4-6-1zM12 13c-3-3-6-1-6 1 3 0 5 1 6 3 1-2 3-3 6-3 0-2-3-4-6-1z" fill="currentColor" stroke="currentColor" stroke-width=".6" stroke-linejoin="round"/></symbol>
<symbol id="i-monopoly" viewBox="0 0 24 24"><path d="M4 4h16l-6 8v6l-4 2v-8z" fill="currentColor"/></symbol>
<symbol id="i-vp" viewBox="0 0 24 24"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" fill="currentColor"/></symbol>
<symbol id="i-army" viewBox="0 0 24 24"><path d="M12 2.8 19 5.6v5.6c0 4.6-3 8.3-7 9.9-4-1.6-7-5.3-7-9.9V5.6z" fill="currentColor"/></symbol>
<symbol id="i-sound" viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
<symbol id="i-mute" viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
<symbol id="i-crown" viewBox="0 0 24 24"><path d="M3 17.5 2 7.5l5.2 4L12 4l4.8 7.5 5.2-4-1 10z" fill="currentColor"/><rect x="3" y="18.8" width="18" height="2.4" rx="1.2" fill="currentColor"/></symbol>
<symbol id="i-quill" viewBox="0 0 24 24"><path d="M4 20l1.1-4.6L15.6 4.9a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.6 18.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13.6 6.9l3.5 3.5" stroke="currentColor" stroke-width="2"/></symbol>
<symbol id="i-translate" viewBox="0 0 24 24"><path d="M3 5.5h9M7.5 3v2.5M5.2 5.5c.6 3 2.4 5.5 5.3 7M10 5.5c-.7 3.4-2.8 6-6 7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 21l4-10 4 10M14 17.4h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></symbol>
<symbol id="i-bank" viewBox="0 0 24 24"><path d="M2.5 9.5 12 3.8l9.5 5.7z" fill="currentColor"/><rect x="3.5" y="18.2" width="17" height="2.6" rx="1" fill="currentColor"/><path d="M6 11.5v5M10 11.5v5M14 11.5v5M18 11.5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></symbol>
<symbol id="i-people" viewBox="0 0 24 24"><circle cx="8.5" cy="8" r="3.3" fill="currentColor"/><path d="M2 20c.4-4 3-6.3 6.5-6.3S14.6 16 15 20z" fill="currentColor"/><circle cx="16.8" cy="8.8" r="2.8" fill="currentColor" opacity=".7"/><path d="M15.6 13.9c.4-.1.8-.1 1.2-.1 3 0 5 2 5.2 6.2h-5.2c-.1-2.4-.5-4.4-1.2-6.1z" fill="currentColor" opacity=".7"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="12" r="3" fill="currentColor"/></symbol>
<symbol id="i-smile" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1.3" fill="currentColor"/><circle cx="15" cy="10" r="1.3" fill="currentColor"/><path d="M8 14.2c1 1.6 2.4 2.4 4 2.4s3-.8 4-2.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
<symbol id="i-robber" viewBox="0 0 24 24"><path d="M6.5 21c0-6 1.5-8.5 3-9.5-1.8-1.2-1.8-6.5 2.5-6.5s4.3 5.3 2.5 6.5c1.5 1 3 3.5 3 9.5z" fill="currentColor"/></symbol>
</defs></svg>`;

function ic(id, cls) { return `<svg class="${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${id}"/></svg>`; }
function ri(r) { return `<svg class="ri ${r}" viewBox="0 0 24 24" aria-label="${RES_NAME[r]}" role="img"><use href="#i-${r}"/></svg>`; }
function resList(res, none) {
  const parts = [];
  for (const r of Engine.RES) if (res && res[r]) parts.push(`<span class="res-inline"><b>${res[r]}</b>${ri(r)}</span>`);
  return parts.length ? parts.join(' ') : (none || '<span class="note">nothing</span>');
}
function dieSVG(n, red) {
  const P = { 1: [[12, 12]], 2: [[7, 7], [17, 17]], 3: [[7, 7], [12, 12], [17, 17]], 4: [[7, 7], [17, 7], [7, 17], [17, 17]], 5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]], 6: [[7, 6.5], [17, 6.5], [7, 12], [17, 12], [7, 17.5], [17, 17.5]] }[n] || [];
  return `<svg class="die${red ? ' red' : ''}" viewBox="0 0 24 24" aria-label="${n}" role="img"><rect x="1.5" y="1.5" width="21" height="21" rx="5"/>${P.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.1"/>`).join('')}</svg>`;
}

/* deterministic pseudo-random per hex for terrain decoration */
function hrand(i, k) { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }

function terrainGlyphs(t, cx, cy, hi) {
  const out = [];
  const spots = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + hrand(hi, k) * 0.5 + hi;
    const r = 50 + hrand(hi, k + 9) * 14;
    spots.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92]);
  }
  spots.sort((a, b) => a[1] - b[1]);
  for (const [x, y] of spots) {
    const s = 0.85 + hrand(hi, x) * 0.35;
    if (t === 'forest') out.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})"><rect x="-1.6" y="4" width="3.2" height="6" fill="#4b3420"/><path d="M0-16 9 0H4l7 7H-11l7-7h-5z" fill="#1d4d2a"/><path d="M0-16 9 0H4l7 7H0z" fill="#17401f"/></g>`);
    else if (t === 'hills') out.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})"><path d="M-15 7Q-6-9 0-7T15 7z" fill="#9c4a28"/><path d="M-8 3h7M2 1h6" stroke="#d98a5f" stroke-width="2" stroke-linecap="round"/></g>`);
    else if (t === 'pasture') {
      if (hrand(hi, x + 3) < 0.45) out.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})"><ellipse cx="0" cy="0" rx="8" ry="5.5" fill="#f6f6ee"/><circle cx="-8" cy="-2" r="3" fill="#33402a"/><path d="M-3 5v3M3 5v3" stroke="#33402a" stroke-width="1.5"/></g>`);
      else out.push(`<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})" d="M-6 5Q-5-3-8-7M0 5Q0-4 1-9M6 5Q5-2 8-6" stroke="#5f8f36" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
    }
    else if (t === 'fields') out.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(-18) scale(${s.toFixed(2)})" stroke="#b5871c" stroke-width="2.4" stroke-linecap="round"><path d="M-12-5h24M-12 1h24M-12 7h24"/></g>`);
    else if (t === 'mountains') out.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(s * 1.1).toFixed(2)})"><path d="M-15 9 0-14 15 9z" fill="#596171"/><path d="M0-14 15 9H3z" fill="#4a515f"/><path d="M-5-6 0-14 5-6 2-4 0-6-2-4z" fill="#eef1f5"/></g>`);
    else if (t === 'desert') { if (hrand(hi, x) < 0.6) out.push(`<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})" d="M-16 5Q-4-7 16 4" stroke="#bc9f5d" stroke-width="3" fill="none" stroke-linecap="round"/>`); }
  }
  return out.join('');
}

function hexPoints(T, hi, k) {
  const c = T.centers[hi];
  return T.hexVerts[hi].map(v => { const p = T.verts[v]; return ((c.x + (p.x - c.x) * k) * 100).toFixed(1) + ',' + ((c.y + (p.y - c.y) * k) * 100).toFixed(1); }).join(' ');
}

const SETTLE_PATH = 'M-12 11H12V-2L0-13-12-2Z';
const SETTLE_SHADE = 'M0-13 12-2V11H0Z';
const CITY_PATH = 'M-19 13H19V-4H5V-10L-7-20-19-10Z';
const CITY_SHADE = 'M5-4H19V13H5ZM-7-20 5-10V13H-7Z';
const ROBBER_PATH = 'M-11 16C-11 5-8-1-5.5-3.5-10-7-9.5-17 0-18.5 9.5-17 10-7 5.5-3.5 8-1 11 5 11 16Z';

function axialPoints(q, r, k, S) {
  const cx = Math.sqrt(3) * (q + r / 2), cy = 1.5 * r; const pts = [];
  for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 90); pts.push(((cx + Math.cos(a) * k) * S).toFixed(1) + ',' + ((cy + Math.sin(a) * k) * S).toFixed(1)); }
  return pts.join(' ');
}
function lakeSVG(L, S) {
  const cx = Math.sqrt(3) * (L.q + L.r / 2) * S, cy = 1.5 * L.r * S;
  return `<polygon points="${axialPoints(L.q, L.r, 1.02, S)}" fill="#2f6f93" stroke="#cdb87d" stroke-width="3"/><g stroke="#8cc3dd" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"><path d="M${(cx - 30).toFixed(1)} ${(cy - 22).toFixed(1)}q10-7 20 0t20 0"/><path d="M${(cx - 14).toFixed(1)} ${(cy + 26).toFixed(1)}q10-7 20 0t20 0"/></g>`;
}
/* a small picture of a map's shape for the map picker */
const thumbCache = {};
function mapThumb(id) {
  if (thumbCache[id]) return thumbCache[id];
  let b;
  try { b = Engine.genBoard({ map: id, layout: 'balanced', players: 4 }, Math.random); } catch (e) { return ''; }
  const S = 10;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const all = b.hexes.concat(b.lakes || []);
  for (const h of all) { const x = Math.sqrt(3) * (h.q + h.r / 2), y = 1.5 * h.r; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const pad = 1.4;
  const vb = [(minX - pad) * S, (minY - pad) * S, (maxX - minX + 2 * pad) * S, (maxY - minY + 2 * pad) * S].map(n => n.toFixed(1)).join(' ');
  const shore = b.hexes.map(h => `<polygon points="${axialPoints(h.q, h.r, 1.14, S)}" fill="#e3d29d"/>`).join('');
  const land = b.hexes.map(h => `<polygon points="${axialPoints(h.q, h.r, 0.94, S)}" fill="${TERRAIN[h.t].base}"/>`).join('');
  const lakes = (b.lakes || []).map(L => `<polygon points="${axialPoints(L.q, L.r, 1.0, S)}" fill="#2f6f93"/>`).join('');
  return (thumbCache[id] = `<svg viewBox="${vb}" aria-hidden="true">${shore}${lakes}${land}</svg>`);
}

/* opts: targets {v:[],e:[],h:[]}, glow (roll sum or 0), fresh (Set of keys), colors fn */
function boardSVG(s, opts) {
  opts = opts || {};
  const T = Engine.topo(s);
  const S = 100;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of T.verts) { minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
  const pad = 0.95;
  const vb = [(minX - pad) * S, (minY - pad) * S, (maxX - minX + 2 * pad) * S, (maxY - minY + 2 * pad) * S].map(n => n.toFixed(0)).join(' ');
  const out = [];
  const colorOf = p => COLOR_HEX[s.players && s.players[p] ? s.players[p].color : 'white'] || '#ccc';
  // shoreline
  out.push('<g>');
  // shallow water around the island, then the beach
  s.board.hexes.forEach((h, hi) => out.push(`<polygon points="${hexPoints(T, hi, 1.62)}" fill="#1b5578" opacity=".32"/>`));
  s.board.hexes.forEach((h, hi) => out.push(`<polygon points="${hexPoints(T, hi, 1.36)}" fill="#22688f" opacity=".38"/>`));
  s.board.hexes.forEach((h, hi) => out.push(`<polygon points="${hexPoints(T, hi, 1.16)}" fill="#e3d29d" stroke="#f1e6bf" stroke-width="5" stroke-linejoin="round"/>`));
  s.board.hexes.forEach((h, hi) => out.push(`<polygon points="${hexPoints(T, hi, 1.07)}" fill="#cdb87d"/>`));
  for (const L of s.board.lakes || []) out.push(lakeSVG(L, S));
  out.push('</g>');
  // harbours
  for (const pt of s.board.ports) {
    const E = T.edges[pt.e];
    const a = T.verts[E.a], b = T.verts[E.b];
    const c = T.centers[E.hexes[0]];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let dx = mx - c.x, dy = my - c.y; const L = Math.hypot(dx, dy); dx /= L; dy /= L;
    const px = mx + dx * 0.56, py = my + dy * 0.56;
    for (const v of [a, b]) {
      const x1 = v.x + (px - v.x) * 0.12, y1 = v.y + (py - v.y) * 0.12;
      const x2 = v.x + (px - v.x) * 0.66, y2 = v.y + (py - v.y) * 0.66;
      out.push(`<line class="port-pier" x1="${(x1 * S).toFixed(1)}" y1="${(y1 * S).toFixed(1)}" x2="${(x2 * S).toFixed(1)}" y2="${(y2 * S).toFixed(1)}"/>`);
    }
    const X = px * S, Y = py * S;
    const any = pt.type === 'any';
    out.push(`<g filter="url(#f-soft)"><title>${any ? '3:1 harbour: trade any 3 identical cards for 1' : '2:1 ' + RES_NAME[pt.type] + ' harbour'}</title><circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="29" fill="#f3e8cf" stroke="#8b6a40" stroke-width="2"/><circle class="port-disc" cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="24" fill="${any ? '#f3e8cf' : RES_COLOR[pt.type]}"/>` +
      (any ? `<text class="port-txt" x="${X.toFixed(1)}" y="${(Y + 6.5).toFixed(1)}" font-size="19">3:1</text>`
        : `<use href="#i-${pt.type}" x="${(X - 12).toFixed(1)}" y="${(Y - 21).toFixed(1)}" width="24" height="24"/><text class="port-txt" x="${X.toFixed(1)}" y="${(Y + 17).toFixed(1)}" font-size="14">2:1</text>`) + '</g>');
  }
  // land hexes
  s.board.hexes.forEach((h, hi) => {
    const c = T.centers[hi];
    out.push(`<polygon class="hex-base" points="${hexPoints(T, hi, 0.975)}" fill="url(#g-${h.t})"><title>${TERRAIN[h.t].name}${h.n ? ' ' + h.n : ''}</title></polygon><polygon points="${hexPoints(T, hi, 0.93)}" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="2.5" pointer-events="none"/>`);
    out.push(`<g pointer-events="none">${terrainGlyphs(h.t, c.x * S, c.y * S, hi)}</g>`);
  });
  // last-roll glow
  if (opts.glow) s.board.hexes.forEach((h, hi) => { if (h.n === opts.glow) out.push(`<polygon class="hit-glow" points="${hexPoints(T, hi, 0.93)}"/>`); });
  // number tokens
  s.board.hexes.forEach((h, hi) => {
    if (!h.n) return;
    const c = T.centers[hi]; const X = c.x * S, Y = c.y * S;
    const hot = h.n === 6 || h.n === 8;
    const pips = Engine.PIPS[h.n];
    let dots = '';
    for (let i = 0; i < pips; i++) dots += `<circle class="pip" cx="${(X + (i - (pips - 1) / 2) * 6).toFixed(1)}" cy="${(Y + 16).toFixed(1)}" r="2.3"/>`;
    out.push(`<g class="tok${hot ? ' hot' : ''}${hi === s.board.robber ? ' dim' : ''}" pointer-events="none" filter="url(#f-soft)"><circle class="bg" cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="31"/><text x="${X.toFixed(1)}" y="${(Y + 8.5).toFixed(1)}" font-size="${hot ? 32 : 28}">${h.n}</text>${dots}</g>`);
  });
  // roads
  if (s.roads) s.roads.forEach((p, e) => {
    if (p < 0) return;
    const E = T.edges[e]; const a = T.verts[E.a], b = T.verts[E.b];
    const k = 0.2;
    const x1 = (a.x + (b.x - a.x) * k) * S, y1 = (a.y + (b.y - a.y) * k) * S, x2 = (b.x + (a.x - b.x) * k) * S, y2 = (b.y + (a.y - b.y) * k) * S;
    const fresh = opts.fresh && opts.fresh.has('e' + e) ? ' class="new-piece"' : '';
    out.push(`<g${fresh} filter="url(#f-piece)"><line class="road-under" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="16"/><line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${colorOf(p)}" stroke-width="10" stroke-linecap="round"/><line x1="${x1.toFixed(1)}" y1="${(y1 - 1.6).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y2 - 1.6).toFixed(1)}" stroke="rgba(255,255,255,.28)" stroke-width="2.5" stroke-linecap="round"/></g>`);
  });
  // buildings
  if (s.bld) s.bld.forEach((b, v) => {
    if (!b) return;
    const p = T.verts[v];
    const fresh = opts.fresh && opts.fresh.has('v' + v + (b.city ? 'c' : '')) ? ' new-piece' : '';
    out.push(`<g transform="translate(${(p.x * S).toFixed(1)} ${(p.y * S).toFixed(1)}) scale(${b.city ? 1.18 : 1.3})" filter="url(#f-piece)"><g class="${fresh.trim()}"><path class="piece" d="${b.city ? CITY_PATH : SETTLE_PATH}" fill="${colorOf(b.p)}"/><path d="${b.city ? CITY_SHADE : SETTLE_SHADE}" fill="rgba(0,0,0,.2)" pointer-events="none"/><path class="piece-line" d="${b.city ? CITY_PATH : SETTLE_PATH}" fill="none"/></g></g>`);
  });
  // robber
  {
    const hi = s.board.robber; const h = s.board.hexes[hi];
    const c = hi >= 0 ? T.centers[hi] : (s.board.robberSpot || { x: 0, y: 0 });
    const X = c.x * S + (h && h.n ? 44 : 0), Y = c.y * S + (h && h.n ? 4 : 0);
    out.push(`<g transform="translate(${X.toFixed(1)} ${Y.toFixed(1)}) scale(1.35)" pointer-events="none"><ellipse cx="0" cy="17" rx="14" ry="4.5" fill="rgba(0,0,0,.4)"/><path d="${ROBBER_PATH}" fill="#24242e" stroke="#cfd6de" stroke-width="1.6"/><ellipse cx="-3" cy="-12" rx="2.5" ry="3.5" fill="#55556a"/></g>`);
  }
  // interactive targets
  const tg = opts.targets || {};
  if (tg.h) for (const hi of tg.h) out.push(`<polygon class="tgt-h" data-h="${hi}" points="${hexPoints(T, hi, 0.9)}"><title>Move the robber here</title></polygon>`);
  if (tg.e) for (const e of tg.e) {
    const E = T.edges[e]; const a = T.verts[E.a], b = T.verts[E.b]; const k = 0.22;
    const c = [(a.x + (b.x - a.x) * k) * S, (a.y + (b.y - a.y) * k) * S, (b.x + (a.x - b.x) * k) * S, (b.y + (a.y - b.y) * k) * S].map(n => n.toFixed(1));
    out.push(`<line class="tgt-ehit" data-e="${e}" x1="${c[0]}" y1="${c[1]}" x2="${c[2]}" y2="${c[3]}"/><line class="tgt-e" pointer-events="none" x1="${c[0]}" y1="${c[1]}" x2="${c[2]}" y2="${c[3]}"/>`);
  }
  if (tg.v) for (const v of tg.v) {
    const p = T.verts[v];
    out.push(`<circle class="tgt-hit" data-v="${v}" cx="${(p.x * S).toFixed(1)}" cy="${(p.y * S).toFixed(1)}" r="34"/><circle class="tgt-v" pointer-events="none" cx="${(p.x * S).toFixed(1)}" cy="${(p.y * S).toFixed(1)}" r="12"/>`);
  }
  return { vb, body: out.join('') };
}
