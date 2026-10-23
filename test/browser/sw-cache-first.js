// Pages open from the phone's saved copy (owner approved 2026-10-14; built 2026-10-23). With a real service worker:
// - a page opens even when the server never answers (no waiting on the network);
// - a deploy (new CACHE in sw.js) is downloaded as a whole in the background, with ?v=<CACHE> so a CDN copy can't
//   be used; the page open while it downloads is still the old one, the next page opened is the new one, and its
//   api.js is from the same deploy; the old saved set is deleted;
// - the app coming back to the front looks for a deploy too (api.js calls registration.update()).
// Run: node test/browser/sw-cache-first.js
const assert = require('assert/strict');
const puppeteer = require('puppeteer-core');
const http = require('http'); const fs = require('fs'); const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'src');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A pretend deploy: replaced file contents, by path.
let deploy = {};
let hang = false;
const log = [];

(async () => {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
    log.push(req.url);
    if (hang && name !== 'sw.js') return; // never answers
    const file = path.join(ROOT, name);
    if (!(name in deploy) && (!fs.existsSync(file) || fs.statSync(file).isDirectory())) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(name in deploy ? deploy[name] : fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 900 });
  const keys = () => page.evaluate(() => caches.keys());
  try {
    await page.goto(base + 'login.html');
    await page.evaluate(() => navigator.serviceWorker.ready);
    const firstCache = (await keys())[0];
    assert.match(firstCache, /^smart-scan-v\d+$/);
    // Every file was fetched once for the saved set, with ?v=<CACHE>.
    assert.ok(log.includes(`/api.js?v=${firstCache}`), log.join(' '));

    // Opened again: from the saved copy, the page itself isn't asked for.
    log.length = 0;
    await page.goto(base + 'login.html');
    assert.ok(!log.some((u) => u.startsWith('/login.html') || u.startsWith('/api.js')), log.join(' '));
    // Even when the server never answers.
    hang = true;
    await page.goto(base + 'more.html?x=1', { timeout: 5000 });
    assert.ok(await page.evaluate(() => Boolean(document.querySelector('header.app-header'))));
    hang = false;

    // A deploy: login.html and api.js change, and sw.js gets a new CACHE.
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace(/const CACHE = '[^']+'/, "const CACHE = 'smart-scan-test-2'");
    deploy = {
      'sw.js': sw,
      'login.html': fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8').replace('</body>', '<div id="deployMark">v2</div></body>'),
      'api.js': `${fs.readFileSync(path.join(ROOT, 'api.js'), 'utf8')}\nconst DEPLOY_MARK = 'v2';\n`,
    };
    log.length = 0;
    // The first page opened after it is still the old set (and sees the new sw.js).
    await page.goto(base + 'login.html');
    assert.equal(await page.$('#deployMark'), null, 'old page while the new set downloads');
    await page.waitForFunction(async () => (await caches.keys()).join() === 'smart-scan-test-2', { timeout: 15000 });
    assert.ok(log.includes('/api.js?v=smart-scan-test-2') && log.includes('/login.html?v=smart-scan-test-2'), log.join(' '));
    // The next page is the new one, with the api.js of the same deploy; the old set is gone.
    await page.goto(base + 'login.html');
    assert.equal(await page.$eval('#deployMark', (el) => el.textContent), 'v2');
    assert.equal(await page.evaluate(() => typeof DEPLOY_MARK !== 'undefined' && DEPLOY_MARK), 'v2');
    assert.deepEqual(await keys(), ['smart-scan-test-2']);

    // Coming back to the front looks for a deploy (no page opened).
    deploy['sw.js'] = sw.replace("const CACHE = 'smart-scan-test-2'", "const CACHE = 'smart-scan-test-3'");
    log.length = 0;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(async () => (await caches.keys()).join() === 'smart-scan-test-3', { timeout: 15000 });
    assert.ok(log.some((u) => u.startsWith('/sw.js')), log.join(' '));
    console.log('SW CACHE FIRST CHECKS PASS');
  } finally {
    await browser.close(); server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
