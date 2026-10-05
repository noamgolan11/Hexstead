/* ============================================================
   HEXSTEAD EMOTES — tap an emote or a quick phrase and it pops up
   big beside your name for everyone (phrases also go in the chat,
   in each reader's own language).
   ============================================================ */
const Emotes = (() => {
  const st = { key: null, n: 0 };
  const myLang = () => Quick.lang(navigator.language);
  const muted = () => { try { return localStorage.getItem('hexstead.muteEmotes') === '1'; } catch (e) { return false; } };
  function setMuted(v) { try { localStorage.setItem('hexstead.muteEmotes', v ? '1' : '0'); } catch (e) { } }

  // the words of a quick phrase for this reader
  function phraseHTML(q, r) {
    if (q === 'need') return `${esc(Quick.text('need', myLang()))} ${r ? ri(r) : ''}?`;
    return esc(Quick.text(q, myLang()));
  }
  function canEmote(d) {
    const me = myUid();
    return !!(d && (d.seats || []).some(s => !s.bot && s.uid === me));
  }

  /* ---------- the picker ---------- */
  function open(btn) {
    close();
    const pop = document.createElement('div');
    pop.id = 'emotePop';
    pop.className = 'emote-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Emotes and quick chat');
    pop.innerHTML = `<div class="emote-grid">${Quick.EMOTES.map(e => `<button data-act="emote" data-e="${e}" aria-label="Send ${e}">${e}</button>`).join('')}</div>
      <div class="emote-phrases">${Quick.ORDER.map(q => `<button data-act="qchat" data-q="${q}" dir="auto">${phraseHTML(q)}</button>`).join('')}</div>
      <div class="emote-need"><span dir="auto">${esc(Quick.text('need', myLang()))}…?</span>${Engine.RES.map(r => `<button data-act="qchat" data-q="need" data-r="${r}" aria-label="${esc(Quick.text('need', 'en'))} ${RES_NAME[r].toLowerCase()}?">${ri(r)}</button>`).join('')}</div>
      <label class="switch emote-mute"><input type="checkbox" id="emoteMute" ${muted() ? 'checked' : ''}> <span>Hide other players' emotes</span></label>`;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = Math.min(innerWidth - w - 8, Math.max(8, r.right - w));
    let y = r.top - h - 8;
    if (y < 8) y = Math.min(innerHeight - h - 8, r.bottom + 8);
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    pop.querySelector('#emoteMute').onchange = e => { setMuted(e.target.checked); toast(e.target.checked ? 'Other players\' emotes are hidden.' : 'Emotes are back on.'); };
    app.ui.emotesOpen = true;
  }
  function close() { const p = document.getElementById('emotePop'); if (p) p.remove(); app.ui.emotesOpen = false; }
  function toggle(btn) { if (document.getElementById('emotePop')) close(); else open(btn); }
  function sendEmote(x) { close(); send(Object.assign({ t: 'emote' }, x)); }

  /* ---------- the pop-ups ---------- */
  function who(d, x) {
    const s = d.game;
    if (s) {
      const i = x.p != null ? x.p : s.players.findIndex(p => !p.bot && p.uid === x.uid);
      if (i >= 0) return { i, name: x.uid === myUid() ? 'You' : pName(s, i), color: COLOR_HEX[s.players[i].color] };
    }
    const si = (d.seats || []).findIndex(p => !p.bot && p.uid === x.uid);
    return { seat: si, name: x.uid === myUid() ? 'You' : uidName(d, x.uid), color: uidColor(d, x.uid) };
  }
  function anchor(d, w) {
    const vis = r => r && r.width && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    if (w.i != null) {
      const row = document.querySelector(`#players .pl:nth-child(${w.i + 1})`);
      const r = row && row.getBoundingClientRect();
      if (vis(r) && r.left > 150) return { x: r.left - 10, y: r.top + r.height / 2, side: 'left' }; // computer: beside the name
      if (vis(r)) return { x: r.right - 64, y: r.top + r.height / 2, side: 'left', inRow: true }; // phone: the list is full width, so over the row
      const b = document.getElementById('boardWrap');
      const br = b && b.getBoundingClientRect();
      if (br && br.width && br.bottom > 120 && br.top < innerHeight - 120) return { x: br.left + br.width / 2, y: Math.min(Math.max(br.top, 0) + 150, innerHeight - 120), side: 'center' };
    }
    if (w.seat != null && w.seat >= 0) {
      const card = document.querySelector(`#lobbySeats .seat:nth-child(${w.seat + 1})`);
      const r = card && card.getBoundingClientRect();
      if (vis(r)) return { x: r.left + r.width / 2, y: r.top + 10, side: 'top' };
    }
    return { x: innerWidth / 2, y: innerHeight / 3, side: 'center' };
  }
  const live = {};
  function bubble(d, x) {
    const w = who(d, x);
    const a = anchor(d, w);
    const key = w.i != null ? 'p' + w.i : 's' + w.seat;
    if (live[key]) live[key].remove();
    const el = document.createElement('div');
    el.className = 'emote-bubble ' + a.side + (x.e ? ' big' : ' words');
    el.style.left = a.x + 'px'; el.style.top = a.y + 'px';
    el.style.setProperty('--pc', w.color || '#ccc');
    el.innerHTML = `${a.side === 'left' && !a.inRow ? '' : `<span class="eb-name">${esc(w.name)}</span>`}<span class="eb-body" dir="auto">${x.e ? x.e : phraseHTML(x.q, x.r)}</span>`;
    (document.getElementById('fx') || document.body).appendChild(el);
    // keep the whole pop-up on screen, whatever the screen size
    const bw = el.offsetWidth, bh = el.offsetHeight;
    let left = a.x - (a.side === 'left' ? bw : bw / 2);
    let top = a.y - (a.side === 'top' ? bh : bh / 2);
    left = Math.max(6, Math.min(innerWidth - bw - 6, left));
    top = Math.max(6, Math.min(innerHeight - bh - 6, top));
    el.style.left = left + 'px'; el.style.top = top + 'px';
    el.classList.add('placed');
    live[key] = el;
    setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); if (live[key] === el) delete live[key]; }, 400); }, x.e ? 2600 : 3400);
  }
  function run(d) {
    if (!d) return;
    const list = d.emotes || [];
    const key = d.code + ':' + (d.createdAt || 0);
    const top = list.length ? list[list.length - 1].n : 0;
    if (st.status !== d.status) { st.status = d.status; for (const k of Object.keys(live)) { live[k].remove(); delete live[k]; } } // the screen changed: old pop-ups would point at nothing
    if (st.key !== key) { st.key = key; st.n = top; return; } // just arrived: don't replay old ones
    if (top < st.n) { st.n = top; return; }
    const fresh = list.filter(x => x.n > st.n);
    st.n = top;
    if (!fresh.length || document.hidden) return;
    let played = false;
    requestAnimationFrame(() => {
      for (const x of fresh.slice(-4)) {
        const mine = x.uid && x.uid === myUid();
        if (muted() && !mine) continue;
        bubble(d, x);
        if (!played) { played = true; Sound.play('blip'); }
      }
    });
  }
  return { toggle, close, sendEmote, run, phraseHTML, canEmote };
})();
