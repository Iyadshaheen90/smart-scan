// Service worker: lets Smart Scan open from the phone's home screen and still load on a bad connection.
// Pages and scripts come from the network first, so a new deploy shows up on the next load; the saved
// copy is only used when the network fails. The scanner library (a pinned version on the CDN) is kept
// after its first download so the camera starts faster. Backend requests (POSTs) are never touched.
// Offline, each page comes from the copy saved the last time it loaded, which can be older than the
// deploy (or older than the api.js beside it). So bump CACHE on every deploy that changes a page or
// script: the phone then sees a new service worker and downloads the whole list below at once.
const CACHE = 'smart-scan-v11';
const SHELL = [
  'index.html', 'login.html', 'close.html', 'slots.html', 'activate.html', 'backstock.html', 'month.html',
  'users.html', 'account.html', 'more.html', 'settling.html', 'full-packs.html', 'shifts.html', 'raw-scanner.html', 'style.css', 'config.js', 'api.js', 'barcode.js', 'scanner.js', 'icons.js', 'nav.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's own 10-minute copy, so the files saved are the new deploy's.
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(SHELL.map((file) => new Request(file, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    event.respondWith(fetch(req)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
        return res.clone();
      })
      // activate.html?box=1&slot=2 is saved as activate.html, so ignore the query when offline.
      .catch(() => caches.match(req, { ignoreSearch: true })));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
      return res.clone();
    })));
  }
});
