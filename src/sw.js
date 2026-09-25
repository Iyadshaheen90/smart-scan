// Service worker: lets Smart Scan open from the phone's home screen and still load on a bad connection.
// Pages and scripts come from the network first, so a new deploy shows up on the next load; the saved
// copy is only used when the network fails. The scanner library (a pinned version on the CDN) is kept
// after its first download so the camera starts faster. Backend requests (POSTs) are never touched.
// Bump CACHE when the list below changes.
const CACHE = 'smart-scan-v2';
const SHELL = [
  'index.html', 'login.html', 'close.html', 'slots.html', 'activate.html', 'backstock.html', 'month.html',
  'users.html', 'account.html', 'raw-scanner.html', 'style.css', 'config.js', 'api.js', 'barcode.js', 'scanner.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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
