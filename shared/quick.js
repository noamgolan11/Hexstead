/* ============================================================
   HEXSTEAD QUICK CHAT — emotes and ready-made phrases.
   Phrases travel as ids, so every reader sees them in their own
   language without a translator. Shared by server and browser.
   ============================================================ */
const Quick = (() => {
  const EMOTES = ['👍', '😂', '😮', '😢', '😡', '🔥', '🎉', '👏', '🤝', '😴', '💀', '🙏'];
  const LANGS = ['en', 'he', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'it'];
  // [en, he, es, fr, de, pt, ru, ar, it]
  const PHRASES = {
    glhf: ['Good luck, have fun!', 'בהצלחה, תהנו!', '¡Suerte y a divertirse!', 'Bonne chance, amusez-vous bien !', 'Viel Glück und viel Spaß!', 'Boa sorte e divirtam-se!', 'Удачи и приятной игры!', 'بالتوفيق واستمتعوا!', 'Buona fortuna e buon divertimento!'],
    nice: ['Nice move!', 'מהלך יפה!', '¡Buena jugada!', 'Joli coup !', 'Guter Zug!', 'Boa jogada!', 'Отличный ход!', 'حركة رائعة!', 'Bella mossa!'],
    trade: ['Want to trade?', 'רוצים להחליף?', '¿Cambiamos?', 'On échange ?', 'Tauschen?', 'Quer trocar?', 'Поменяемся?', 'هل نتبادل؟', 'Scambiamo?'],
    deal: ['Deal!', 'עסקה!', '¡Trato hecho!', 'Marché conclu !', 'Abgemacht!', 'Fechado!', 'Договорились!', 'اتفقنا!', 'Affare fatto!'],
    nothanks: ['No thanks', 'לא תודה', 'No, gracias', 'Non merci', 'Nein, danke', 'Não, obrigado', 'Нет, спасибо', 'لا، شكرًا', 'No, grazie'],
    thanks: ['Thanks!', 'תודה!', '¡Gracias!', 'Merci !', 'Danke!', 'Obrigado!', 'Спасибо!', 'شكرًا!', 'Grazie!'],
    norob: ['Please don’t rob me!', 'בבקשה אל תשדדו אותי!', '¡No me robes, por favor!', 'Ne me volez pas, s’il vous plaît !', 'Bitte raubt mich nicht aus!', 'Por favor, não me roubem!', 'Только не грабьте меня!', 'أرجوكم لا تسرقوني!', 'Non derubatemi, per favore!'],
    yourturn: ['Your turn!', 'התור שלך!', '¡Te toca!', 'À toi de jouer !', 'Du bist dran!', 'Sua vez!', 'Твой ход!', 'دورك!', 'Tocca a te!'],
    oops: ['Oops!', 'אופס!', '¡Uy!', 'Oups !', 'Hoppla!', 'Opa!', 'Упс!', 'عفوًا!', 'Ops!'],
    sorry: ['Sorry!', 'סליחה!', '¡Perdón!', 'Désolé !', 'Entschuldigung!', 'Desculpa!', 'Извини!', 'عذرًا!', 'Scusa!'],
    brb: ['Be right back', 'עוד רגע אחזור', 'Ahora vuelvo', 'Je reviens tout de suite', 'Bin gleich zurück', 'Já volto', 'Сейчас вернусь', 'سأعود حالًا', 'Torno subito'],
    gg: ['Good game!', 'משחק טוב!', '¡Buena partida!', 'Bonne partie !', 'Gutes Spiel!', 'Bom jogo!', 'Хорошая игра!', 'لعبة جيدة!', 'Bella partita!'],
    need: ['Anyone have', 'למישהו יש', '¿Alguien tiene', 'Quelqu’un a du', 'Hat jemand', 'Alguém tem', 'У кого есть', 'هل لدى أحد', 'Qualcuno ha'],
  };
  const ORDER = ['glhf', 'nice', 'trade', 'deal', 'nothanks', 'thanks', 'norob', 'yourturn', 'oops', 'sorry', 'brb', 'gg'];
  const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];

  function lang(code) { const l = String(code || 'en').slice(0, 2).toLowerCase(); return LANGS.includes(l) ? l : 'en'; }
  // the words of a phrase in a language; "need" is followed by a resource picture where it's shown
  function text(q, l) { const p = PHRASES[q]; return p ? p[LANGS.indexOf(lang(l))] || p[0] : ''; }
  // check what a player sent; returns the parts to keep, or null
  function clean(a) {
    if (!a) return null;
    if (typeof a.e === 'string' && EMOTES.includes(a.e)) return { e: a.e };
    if (typeof a.q === 'string' && Object.prototype.hasOwnProperty.call(PHRASES, a.q)) {
      if (a.q === 'need') return RES.includes(a.r) ? { q: 'need', r: a.r } : null;
      return { q: a.q };
    }
    return null;
  }

  /* Bots sometimes react to what happens to them, like people do. Returns [{ p, e }] for bot seats. */
  function reactions(prev, next, rng) {
    const out = [];
    if (!prev || !next || !next.log) return out;
    const last = prev.log.length ? prev.log[prev.log.length - 1].id : 0;
    const bot = i => next.players[i] && next.players[i].bot;
    const pick = list => list[Math.floor(rng() * list.length)];
    for (const e of next.log) {
      if (!(e.id > last)) continue;
      if (e.k === 'steal' && bot(e.q) && rng() < 0.3) out.push({ p: e.q, e: pick(['😡', '😢', '😮']) });
      else if (e.k === 'trade') { const b = [e.p, e.q].filter(bot); if (b.length && rng() < 0.3) out.push({ p: pick(b), e: '🤝' }); }
      else if ((e.k === 'lr' || e.k === 'la') && bot(e.p) && rng() < 0.35) out.push({ p: e.p, e: '🔥' });
      else if (e.k === 'mono' && rng() < 0.5) { const victims = next.players.map((_, i) => i).filter(i => i !== e.p && bot(i)); if (victims.length) out.push({ p: pick(victims), e: pick(['😡', '😮', '💀']) }); }
      else if (e.k === 'win') {
        if (bot(e.p)) out.push({ p: e.p, e: '🎉' });
        next.players.forEach((_, i) => { if (i !== e.p && bot(i) && rng() < 0.4) out.push({ p: i, e: '👏' }); });
      }
    }
    return out;
  }
  return { EMOTES, PHRASES, ORDER, LANGS, lang, text, clean, reactions };
})();
if (typeof module !== 'undefined') module.exports = Quick;
