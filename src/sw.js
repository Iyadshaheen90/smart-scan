// Service worker: lets Smart Scan open from the phone's home screen, instantly and with no connection.
//
// Pages and scripts come straight from the copy saved on the phone (owner approved 2026-10-14: every page switch
// waited on the network before). A deploy reaches the phone as a whole: each CACHE value is one saved set of every
// file below, downloaded together when the phone sees a new sw.js, so a page and its api.js always come from the
// same deploy. The phone checks sw.js each time a page opens (and when the app comes back to the front, api.js), and
// the new set is used from the next page opened once it's downloaded ("a deploy shows from the 2nd page").
// So bump CACHE on every deploy that changes a file here: without it the phone keeps the old files.
// test/sw-version.js fails until CACHE is bumped after any change.
// The scanner library (a pinned version on the CDN) is kept after its first download. Backend requests (POSTs)
// are never touched.
const CACHE = 'smart-scan-v27';
const SHELL = [
  'index.html', 'login.html', 'close.html', 'slots.html', 'activate.html', 'backstock.html', 'month.html',
  'users.html', 'account.html', 'more.html', 'settling.html', 'full-packs.html', 'shifts.html', 'reports.html', 'shipments.html', 'returns.html', 'theft-report.html', 'set-password.html', 'raw-scanner.html', 'style.css', 'config.js', 'api.js', 'barcode.js', 'scanner.js', 'icons.js', 'nav.js', 'pdf.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  // ?v= makes GitHub's CDN hand over this deploy's file, not a copy it kept from before (it keys by the whole
  // address); cache: 'reload' skips the phone's own copy. Saved under the plain name the pages ask for.
  // If any file fails, nothing is saved and the old set stays in use until the next try.
  event.waitUntil(Promise.all(SHELL.map((file) => fetch(new Request(`${file}?v=${CACHE}`, { cache: 'reload' }))
    .then((res) => {
      if (!res.ok) throw new Error(`${file}: ${res.status}`);
      return [file, res];
    })))
    .then((files) => caches.open(CACHE).then((cache) => Promise.all(files.map(([file, res]) => cache.put(file, res)))))
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
    // The saved copy at once (activate.html?box=1&slot=2 is saved as activate.html, so the query is ignored).
    // A file not saved yet (the very first open, or one not in SHELL) comes from the network and is kept.
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(req, { ignoreSearch: true }).then((hit) => hit
      || fetch(req).then((res) => {
        if (res.ok && !url.search) cache.put(req, res.clone());
        return res;
      }))));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
      return res.clone();
    })));
  }
});
