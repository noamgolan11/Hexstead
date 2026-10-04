/* ============================================================
   HEXSTEAD SOUND — every effect and the music are synthesized
   with the Web Audio API, so there are no audio files to load.
   Two buses (effects, music) feed a master gain; each has its
   own switch and volume, plus a mute-all switch.
   ============================================================ */
const Sound = (() => {
  const KEY = 'hexstead.sound';
  const DEFAULTS = { muted: false, sfxOn: true, sfxVol: 0.7, musicOn: true, musicVol: 0.4 };
  let cfg = load();
  let ctx = null, master, sfxBus, musicBus, musicDry, reverbIn, noiseBuf = null;
  let musicOn = false, musicTimer = null, nextChordAt = 0, chordIdx = 0, waves = null;

  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { } }

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    master = ctx.createGain(); master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    musicDry = ctx.createGain(); musicDry.gain.value = 0.55; musicDry.connect(musicBus);
    const rev = ctx.createConvolver(); rev.buffer = impulse(3.4, 2.6);
    const revOut = ctx.createGain(); revOut.gain.value = 0.85;
    reverbIn = ctx.createGain(); reverbIn.connect(rev); rev.connect(revOut); revOut.connect(musicBus);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    applyGains(true);
    return ctx;
  }
  function impulse(sec, decay) {
    const rate = ctx.sampleRate, len = Math.floor(rate * sec), b = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }

  /* browsers only allow audio after the player interacts with the page */
  function unlock() {
    const c = ensure();
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => { }); // 'suspended', or 'interrupted' on iPhone after a call or app switch
    syncMusic();
  }
  function ready() { return ctx && ctx.state === 'running'; }

  function applyGains(instant) {
    if (!ctx) return;
    const t = ctx.currentTime, k = instant ? 0.02 : 0.15;
    master.gain.setTargetAtTime(cfg.muted ? 0 : 1, t, k);
    sfxBus.gain.setTargetAtTime(cfg.sfxOn ? Math.pow(cfg.sfxVol, 1.5) : 0, t, k);
    const mv = cfg.musicOn && !document.hidden ? Math.pow(cfg.musicVol, 1.5) * 0.9 * SMALL_SPEAKER : 0;
    musicBus.gain.setTargetAtTime(mv, t, instant ? 0.05 : 1.0);
  }
  function syncMusic() {
    if (!ctx) return;
    const want = cfg.musicOn && !cfg.muted;
    if (want && !musicOn) startMusic();
    else if (!want && musicOn) setTimeout(() => { if (!(cfg.musicOn && !cfg.muted)) stopMusic(); }, 3500);
    applyGains();
  }
  function get() { return Object.assign({}, cfg); }
  function set(patch) {
    Object.assign(cfg, patch);
    cfg.sfxVol = Math.max(0, Math.min(1, +cfg.sfxVol || 0));
    cfg.musicVol = Math.max(0, Math.min(1, +cfg.musicVol || 0));
    save();
    if (ctx) syncMusic();
  }
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (!document.hidden && ctx.state !== 'running') ctx.resume().catch(() => { });
    applyGains();
    if (!document.hidden && musicOn && nextChordAt < ctx.currentTime) nextChordAt = ctx.currentTime + 0.3;
  });

  /* ---------------- building blocks ---------------- */
  function tone(freq, o) {
    o = o || {};
    const t = ctx.currentTime + (o.delay || 0) + 0.005;
    const dur = o.dur || 0.2, peak = o.gain || 0.15, att = o.attack || 0.004;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + (o.slideTime || dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g);
    g.connect(o.bus || sfxBus);
    if (o.send) { const s = ctx.createGain(); s.gain.value = o.send; g.connect(s); s.connect(reverbIn); }
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(o) {
    const t = ctx.currentTime + (o.delay || 0) + 0.005;
    const dur = o.dur || 0.1;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass'; f.frequency.setValueAtTime(o.freq || 2000, t); f.Q.value = o.q || 1;
    if (o.slideTo) f.frequency.exponentialRampToValueAtTime(o.slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.1, t + (o.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  /* a bell: a few inharmonic partials with different decays */
  function bell(freq, o) {
    o = o || {};
    const g = o.gain || 0.08, d = o.delay || 0, dur = o.dur || 0.9;
    tone(freq, { gain: g, dur, delay: d, send: o.send });
    tone(freq * 2.01, { gain: g * 0.35, dur: dur * 0.6, delay: d });
    tone(freq * 3.03, { gain: g * 0.12, dur: dur * 0.35, delay: d });
  }
  function pluck(freq, o) {
    o = o || {};
    tone(freq, { type: 'triangle', gain: o.gain || 0.12, dur: o.dur || 0.35, delay: o.delay || 0, lp: 3200 });
    tone(freq * 2, { gain: (o.gain || 0.12) * 0.25, dur: (o.dur || 0.35) * 0.5, delay: o.delay || 0 });
  }
  function knock(o) {
    o = o || {};
    const d = o.delay || 0, g = o.gain || 1;
    tone(o.pitch || 190, { gain: 0.22 * g, dur: 0.12, delay: d, slideTo: (o.pitch || 190) * 0.6, slideTime: 0.1 });
    noise({ freq: o.nf || 1100, q: 1.2, gain: 0.12 * g, dur: 0.05, delay: d });
  }
  const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
  const RES_NOTE = { lumber: 72, brick: 74, wool: 76, grain: 79, ore: 81 };

  /* ---------------- effects ---------------- */
  const FX = {
    click: () => tone(1250, { gain: 0.05, dur: 0.045, slideTo: 800 }),
    step: () => tone(1500, { gain: 0.035, dur: 0.03 }),
    open: () => { tone(420, { type: 'triangle', gain: 0.05, dur: 0.16, slideTo: 720 }); noise({ filter: 'highpass', freq: 2500, gain: 0.02, dur: 0.12 }); },
    blip: () => tone(880, { gain: 0.06, dur: 0.12, slideTo: 1175 }),
    error: () => { tone(220, { type: 'square', gain: 0.05, dur: 0.14, lp: 900 }); tone(175, { type: 'square', gain: 0.05, dur: 0.2, delay: 0.12, lp: 800 }); },
    dice: () => {
      let t = 0;
      for (let i = 0; i < 6; i++) { t += 0.04 + Math.random() * 0.06; noise({ freq: 1800 + Math.random() * 2600, q: 2.5, gain: 0.14, dur: 0.035, delay: t }); tone(500 + Math.random() * 400, { gain: 0.03, dur: 0.03, delay: t }); }
      knock({ delay: t + 0.06, pitch: 140, nf: 700, gain: 0.8 });
    },
    gain: o => {
      const notes = [];
      for (const r of ['lumber', 'brick', 'wool', 'grain', 'ore']) if (o.res && o.res[r]) for (let i = 0; i < Math.min(o.res[r], 2); i++) notes.push(RES_NOTE[r]);
      if (!notes.length) notes.push(76);
      notes.slice(0, 5).forEach((n, i) => pluck(NOTE(n), { gain: 0.11, delay: i * 0.075, dur: 0.4 }));
    },
    road: o => knock({ gain: o.soft ? 0.6 : 1 }),
    settlement: o => { const g = o.soft ? 0.6 : 1; knock({ gain: g }); knock({ delay: 0.11, gain: g, pitch: 210 }); bell(NOTE(76), { gain: 0.06 * g, delay: 0.2, dur: 0.6 }); },
    city: o => { const g = o.soft ? 0.6 : 1; knock({ gain: g }); knock({ delay: 0.1, gain: g, pitch: 210 }); knock({ delay: 0.2, gain: g, pitch: 160 }); [72, 76, 79].forEach((n, i) => bell(NOTE(n), { gain: 0.05 * g, delay: 0.3 + i * 0.05, dur: 0.9 })); },
    card: () => noise({ filter: 'highpass', freq: 1200, slideTo: 5000, gain: 0.07, dur: 0.16, attack: 0.03 }),
    dev: () => [79, 83, 86, 91].forEach((n, i) => tone(NOTE(n), { gain: 0.05, dur: 0.3, delay: i * 0.05, type: 'triangle' })),
    knight: () => { tone(1240, { gain: 0.07, dur: 0.5 }); tone(1730, { gain: 0.05, dur: 0.35 }); tone(2610, { gain: 0.03, dur: 0.2 }); noise({ freq: 4000, q: 3, gain: 0.05, dur: 0.06 }); },
    robber: () => { tone(110, { type: 'sawtooth', gain: 0.07, dur: 0.7, slideTo: 78, lp: 420 }); tone(116, { type: 'sawtooth', gain: 0.05, dur: 0.7, slideTo: 82, lp: 380 }); noise({ filter: 'lowpass', freq: 300, gain: 0.05, dur: 0.6, attack: 0.1 }); },
    steal: o => { noise({ freq: 3500, slideTo: 700, q: 1.5, gain: o.me ? 0.11 : 0.06, dur: 0.22, attack: 0.02 }); if (o.me) tone(660, { gain: 0.05, dur: 0.15, delay: 0.15, slideTo: 990 }); },
    stolen: () => { noise({ freq: 3000, slideTo: 600, q: 1.5, gain: 0.1, dur: 0.24, attack: 0.02 }); tone(520, { gain: 0.06, dur: 0.25, delay: 0.12, slideTo: 330 }); },
    discard: () => { for (let i = 0; i < 3; i++) noise({ filter: 'highpass', freq: 1800, gain: 0.05, dur: 0.07, delay: i * 0.08 }); },
    coin: () => { tone(2093, { gain: 0.06, dur: 0.18 }); tone(2637, { gain: 0.05, dur: 0.25, delay: 0.07 }); },
    offer: () => bell(NOTE(84), { gain: 0.07, dur: 0.8 }),
    accepted: () => { bell(NOTE(79), { gain: 0.06, dur: 0.5 }); bell(NOTE(84), { gain: 0.06, dur: 0.7, delay: 0.12 }); },
    declined: () => tone(392, { gain: 0.05, dur: 0.22, slideTo: 330, type: 'triangle' }),
    traded: () => { tone(1568, { gain: 0.05, dur: 0.15 }); tone(2093, { gain: 0.05, dur: 0.3, delay: 0.08 }); noise({ filter: 'highpass', freq: 3000, gain: 0.03, dur: 0.1 }); },
    monopoly: () => { noise({ freq: 600, slideTo: 3000, q: 1, gain: 0.08, dur: 0.4, attack: 0.1 }); [67, 71, 74].forEach((n, i) => tone(NOTE(n), { gain: 0.05, dur: 0.35, delay: 0.3 + i * 0.06, type: 'triangle' })); },
    award: () => [72, 76, 79, 84].forEach((n, i) => tone(NOTE(n), { gain: 0.06, dur: i === 3 ? 0.7 : 0.18, delay: i * 0.09, type: 'triangle' })),
    lost: () => tone(523, { gain: 0.05, dur: 0.4, slideTo: 392, type: 'triangle' }),
    yourTurn: () => [74, 78, 81].forEach((n, i) => bell(NOTE(n), { gain: 0.07, delay: i * 0.12, dur: 0.9 })),
    special: () => [78, 81].forEach((n, i) => bell(NOTE(n), { gain: 0.05, delay: i * 0.1, dur: 0.6 })),
    alert: () => { tone(988, { gain: 0.07, dur: 0.12 }); tone(988, { gain: 0.07, dur: 0.12, delay: 0.18 }); },
    tick: () => tone(1900, { gain: 0.04, dur: 0.03 }),
    tock: () => tone(330, { gain: 0.035, dur: 0.08, type: 'triangle' }),
    chat: () => tone(660, { gain: 0.06, dur: 0.09, slideTo: 990 }),
    join: () => { tone(523, { gain: 0.05, dur: 0.12 }); tone(784, { gain: 0.05, dur: 0.2, delay: 0.08 }); },
    leave: () => { tone(784, { gain: 0.04, dur: 0.12 }); tone(523, { gain: 0.04, dur: 0.2, delay: 0.08 }); },
    start: () => [62, 66, 69, 74].forEach((n, i) => { pluck(NOTE(n), { gain: 0.1, delay: i * 0.1, dur: 0.6 }); }),
    win: () => { [72, 76, 79, 84, 88].forEach((n, i) => tone(NOTE(n), { gain: 0.07, dur: 0.25, delay: i * 0.1, type: 'triangle' })); [72, 76, 79, 84].forEach(n => bell(NOTE(n), { gain: 0.05, delay: 0.55, dur: 1.6 })); },
    lose: () => [76, 72, 69, 64].forEach((n, i) => tone(NOTE(n), { gain: 0.05, dur: 0.4, delay: i * 0.16, type: 'triangle' })),
  };
  function play(name, opts) {
    if (!cfg.sfxOn || cfg.muted || !ready() || !FX[name]) return;
    opts = opts || {};
    if (opts.delay) { setTimeout(() => play(name, Object.assign({}, opts, { delay: 0 })), opts.delay * 1000); return; }
    try { FX[name](opts); } catch (e) { /* never let sound break the game */ }
  }

  /* ---------------- music: slow chords, sparse plucks, distant waves ---------------- */
  // phones can't reproduce much below ~300 Hz, so the harmony sits around 300-800 Hz
  // (every chord tone is E4 or higher) and only the root goes low (it adds depth on laptops and headphones)
  const CHORDS = [
    { root: 38, notes: [66, 69, 73, 76, 78] },   // D maj9
    { root: 35, notes: [66, 69, 71, 74] },       // B m7
    { root: 31, notes: [67, 71, 74, 78] },       // G maj7
    { root: 33, notes: [64, 69, 71, 73] },       // A add9
  ];
  const MELODY = [74, 76, 78, 81, 83, 86, 88, 90, 93];
  const SMALL_SPEAKER = window.matchMedia && matchMedia('(pointer: coarse)').matches ? 1.4 : 1;
  const CHORD_LEN = 9;
  function startMusic() {
    if (musicOn || !ctx) return;
    musicOn = true;
    nextChordAt = ctx.currentTime + 0.4;
    scheduleMusic();
    musicTimer = setInterval(scheduleMusic, 500);
    startWaves();
  }
  function stopMusic() {
    musicOn = false;
    clearInterval(musicTimer);
    if (waves) { try { waves.stop(); } catch (e) { } waves = null; }
  }
  function scheduleMusic() {
    if (!musicOn || !ctx || document.hidden) return;
    if (nextChordAt < ctx.currentTime - 1) nextChordAt = ctx.currentTime + 0.3;
    while (nextChordAt < ctx.currentTime + 2) {
      const chord = CHORDS[chordIdx % CHORDS.length];
      padChord(chord, nextChordAt, CHORD_LEN);
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const at = nextChordAt + 1 + Math.random() * (CHORD_LEN - 2);
        const note = MELODY[Math.floor(Math.random() * MELODY.length)];
        musicNote(NOTE(note), at);
      }
      nextChordAt += CHORD_LEN;
      chordIdx++;
    }
  }
  function padChord(chord, t, len) {
    bassNote(NOTE(chord.root + 12), t, len);
    for (const n of chord.notes) {
      for (const det of [-5, 5]) {
        const o = ctx.createOscillator();
        o.type = det < 0 ? 'sine' : 'triangle';
        o.frequency.value = NOTE(n);
        o.detune.value = det;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
        const g = ctx.createGain();
        const peak = det < 0 ? 0.034 : 0.016;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 2.8);
        g.gain.setValueAtTime(peak, t + len - 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len + 3);
        o.connect(f); f.connect(g); g.connect(musicDry); g.connect(reverbIn);
        o.start(t); o.stop(t + len + 3.1);
      }
    }
  }
  function bassNote(freq, t, len) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.02, t + 2.5);
    g.gain.setValueAtTime(0.02, t + len - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 2.5);
    o.connect(g); g.connect(musicDry);
    o.start(t); o.stop(t + len + 2.6);
  }
  function musicNote(freq, t) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g); g.connect(reverbIn);
    const dry = ctx.createGain(); dry.gain.value = 0.4; g.connect(dry); dry.connect(musicDry);
    o.start(t); o.stop(t + 2.3);
  }
  function startWaves() {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.01;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const depth = ctx.createGain(); depth.gain.value = 0.01;
    lfo.connect(depth); depth.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(); lfo.start();
    waves = { stop() { src.stop(); lfo.stop(); } };
  }

  return { unlock, play, get, set, ready };
})();
