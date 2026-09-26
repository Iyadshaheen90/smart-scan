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
// (default: accept).
async function openApp({ role = 'owner', username = role === 'owner' ? 'o' : 'e', handle, onDialog }) {
  const server = http.createServer((req, res) => {
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
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
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
  await page.evaluate((session) => {
    localStorage.clear();
    localStorage.setItem('smartScanSession', JSON.stringify(session));
  }, { token: 't', username, role, expiresAt: '2099-01-01' });

  return { page, base, close: async () => { await browser.close(); server.close(); } };
}

// The real backend (src/apps-script) on an in-memory spreadsheet, for tests that should run the
// server code too. ctx holds its functions (ctx.listBackStock() …); addRow(tab, { column: value }).
function backendInVm(today) {
  const ctx = { console, Utilities: { formatDate: (d, tz) => (tz === 'UTC' ? d.toISOString().slice(0, 10) : today) },
    Session: { getScriptTimeZone: () => 'x' }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    fakeSheetFn: fakeSheet };
  vm.createContext(ctx);
  for (const f of ['Schema.js', 'Sheets.js', 'Slots.js', 'Close.js', 'Backstock.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8'), ctx);
  }
  vm.runInContext(`class ApiError extends Error { constructor(c, m) { super(m); this.code = c; } }
    const sheets = {}; for (const [n, h] of Object.entries(MONTHLY_TABS)) sheets[n] = fakeSheetFn(h);
    function monthSheet(n) { return sheets[n]; }`, ctx);
  const sheets = vm.runInContext('sheets', ctx);
  const addRow = (tab, obj) => sheets[tab].rows.push(sheets[tab].rows[0].map((h) => (h in obj ? obj[h] : '')));
  // Results come back as plain JSON, as they would over the network.
  const call = (fn) => JSON.parse(JSON.stringify(fn()));
  return { ctx, sheets, addRow, call };
}

module.exports = { openApp, backendInVm, ABORT, sleep };
