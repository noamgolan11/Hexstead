/* Hexstead service worker: lets the installed app open, and practice games run, without a connection.
   Always tries the network first, so an update shows up straight away; the saved copy is only a fallback. */
const CACHE = 'hexstead-files';
const CORE = ['/', '/style.css', '/engine.js', '/bot.js', '/quick.js', '/net.js', '/audio.js', '/ui-board.js', '/fx.js', '/emotes.js', '/ui.js', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png',
  '/fonts/barlow-semi-condensed-latin-400-normal.woff2', '/fonts/barlow-semi-condensed-latin-500-normal.woff2', '/fonts/barlow-semi-condensed-latin-600-normal.woff2',
  '/fonts/barlow-semi-condensed-latin-700-normal.woff2', '/fonts/barlow-semi-condensed-latin-800-normal.woff2', '/fonts/im-fell-english-sc-latin-400-normal.woff2'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => { }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname === '/ws' || url.pathname === '/healthz') return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(url.pathname === '/index.html' ? '/' : req, copy)).catch(() => { }); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : undefined)).then(hit => hit || new Response('Offline', { status: 503 })))
  );
});
