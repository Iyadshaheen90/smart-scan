// Shared setup for the browser tests: serves src/ locally, opens the pages in headless Chrome at
// phone size, signs in, and answers the app's backend calls with `handle` instead of the live Apps
// Script, so nothing touches the store's real spreadsheet.
// Needs Google Chrome and puppeteer-core (see CLAUDE.md, "Test and deploy").
const puppeteer = require('puppeteer-core');
const http = require('http'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const { fakeSheet } = require('../fakes');

const ROOT = path.join(__dirname, '..', '..', 'src');
const API_URL = fs.readFileSync(`${ROOT}/config.js`, 'utf8').match(/https:[^'"]+/)[0];
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// `handle` returns this to act like the phone has no connection.
const ABORT = Symbol('abort');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// handle(body) gets the request ({ action, ...params }) and returns the response data, throws
// { code, message } for an error answer, or returns ABORT. onDialog answers alert/confirm/prompt
// (default: accept). setHandle swaps in a different handle for later requests.
// For the database backend (test/browser/db-sign-in.js): configJs is served instead of config.js, signedIn: false
// starts signed out, and intercept(req) may answer any other request itself (returns true when it did).
async function openApp({ role = 'owner', username = role === 'owner' ? 'o' : 'e', permissions, handle, onDialog, configJs,
  signedIn = true, intercept, splash = false }) {
  const server = http.createServer((req, res) => {
    if (configJs && req.url.split('?')[0] === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(configJs);
    }
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 900 });
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('dialog', (d) => (onDialog ? onDialog(d) : d.accept()));
  await page.setBypassServiceWorker(true);
  if (!splash) await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem('smartScanSplash', '1'); } catch (e) {} });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    if (intercept && await intercept(req)) return;
    if (!req.url().startsWith(API_URL)) return req.continue();
    let out;
    try {
      const data = await handle(JSON.parse(req.postData()));
      if (data === ABORT) return req.abort();
      out = { ok: true, data: data === undefined ? {} : data };
    } catch (e) {
      out = { ok: false, code: e.code || 'server_error', error: e.message };
    }
    // The page fetches the backend cross-origin, so the answer needs CORS like Apps Script sends.
    req.respond({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify(out) });
  });

  await page.goto(base + 'login.html');
  if (signedIn) await page.evaluate((session) => {
    localStorage.clear();
    localStorage.setItem('smartScanSession', JSON.stringify(session));
  }, { token: 't', username, role, permissions, expiresAt: '2099-01-01' });

  return { page, base, setHandle: (h) => { handle = h; }, close: async () => { await browser.close(); server.close(); } };
}

// The real backend (src/apps-script) on an in-memory spreadsheet, for tests that should run the
// server code too. ctx holds its functions (ctx.listBackStock() …); addRow(tab, { column: value }).
function backendInVm(today, clock = () => '12:00:00') {
  const ctx = { console, Utilities: { formatDate: (d, tz, fmt) => (tz === 'UTC' ? d.toISOString().slice(0, 10)
    : fmt === 'yyyy-MM-dd HH:mm:ss' ? `${today} ${clock()}` : fmt === 'yyyy-MM-dd HH:mm' ? `${today} ${clock().slice(0, 5)}` : today) },
    Session: { getScriptTimeZone: () => 'x' }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: (() => { const props = {}; return { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) }; })(),
    fakeSheetFn: fakeSheet };
  vm.createContext(ctx);
  for (const f of ['Schema.js', 'Sheets.js', 'Tickets.js', 'Slots.js', 'Close.js', 'Backstock.js', 'FullPacks.js', 'Shifts.js', 'Permissions.js', 'Reports.js', 'Store.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8'), ctx);
  }
  vm.runInContext(`class ApiError extends Error { constructor(c, m) { super(m); this.code = c; } }
    const sheets = {}; for (const [n, h] of Object.entries(MONTHLY_TABS)) sheets[n] = fakeSheetFn(h);
    function monthSheet(n) { return sheets[n]; }
    function getCurrentMonth() { return { label: todayLabel().slice(0, 7) }; }`, ctx);
  const sheets = vm.runInContext('sheets', ctx);
  const addRow = (tab, obj) => sheets[tab].rows.push(sheets[tab].rows[0].map((h) => (h in obj ? obj[h] : '')));
  // Results come back as plain JSON, as they would over the network.
  const call = (fn) => JSON.parse(JSON.stringify(fn()));
  return { ctx, sheets, addRow, call };
}

// In the open Manage packs dialog: − `packs` times, Save, then tap the reason (which removes them).
async function removeInDialog(page, packs, reason) {
  await page.waitForFunction(() => !document.querySelector('#packDialog').classList.contains('hidden'));
  for (let i = 0; i < packs; i += 1) await page.click('#packMinus');
  await page.click('#packSave');
  await page.click(`#removeReasons button[data-reason="${reason}"]`);
}

module.exports = { openApp, backendInVm, removeInDialog, ABORT, sleep };
