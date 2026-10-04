// Service worker offline copies (2026-10-04): installing sw.js saves every page and script at once, so with no
// connection a page and the api.js beside it are from the same deploy. Offline, Slots shows the error with Try again.
// Real service worker here (the other browser tests bypass it). Run: node test/browser/sw-offline.js
const assert = require('assert/strict');
const puppeteer = require('puppeteer-core');
const http = require('http'); const fs = require('fs'); const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'src');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 900 });
  try {
    await page.goto(base + 'login.html');
    await page.evaluate(() => localStorage.setItem('smartScanSession', JSON.stringify({ token: 't', username: 'o', role: 'owner', expiresAt: '2099-01-01' })));
    await page.goto(base + 'login.html');
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Every file in the list is saved, without opening the pages.
    const saved = await page.evaluate(async () => {
      const cache = await caches.open((await caches.keys())[0]);
      const text = async (f) => (await cache.match(f)) ? (await cache.match(f)).text() : '';
      return { slots: await text('slots.html'), api: await text('api.js'), month: await text('month.html') };
    });
    assert.match(saved.slots, /showLoadError/);
    assert.match(saved.api, /function showLoadError/);
    assert.match(saved.month, /showLoadError/);

    // Offline: Slots opens from the saved copy and offers Try again.
    await page.setOfflineMode(true);
    await page.goto(base + 'slots.html');
    await page.waitForFunction(() => document.querySelector('#message button.try-again'), { timeout: 15000 });
    console.log('SW OFFLINE CHECKS PASS');
  } finally {
    await browser.close(); server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
