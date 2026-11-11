// One phone on the database before the cutover (owner 2026-11-10, the side-by-side week): More → Try the Database
// (owner on Sheets; anyone on a switched phone sees Use Sheets Again), the confirm pop-up, Sign In by email with the
// way back, the amber Database chip in every header and on the version line, the pages' saved answers cleared (drafts
// kept), refused while a close waits to be sent, gone at the cutover or without a database, and an invite link opened
// in a browser still on Sheets switching it first. Database requests are answered here: nothing reaches the real one.
// Run: node test/browser/phone-switch.js
const assert = require('assert/strict');
const fs = require('fs'); const path = require('path');
const { openApp, sleep } = require('./harness');

const CONFIG = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'config.js'), 'utf8');
const DB_URL = CONFIG.match(/SUPABASE_URL = '([^']+)'/)[1];
assert.ok(DB_URL.startsWith('https://'), 'config.js has the database address');
const KEY = 'smartScanPhoneBackend';

// Every request to the database is answered here (the real project is never called).
const dbRequests = [];
const intercept = async (req) => {
  if (!req.url().startsWith(DB_URL)) return false;
  dbRequests.push(req.url().slice(DB_URL.length));
  if (req.method() === 'OPTIONS') {
    req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  } else {
    req.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ complete: true }) });
  }
  return true;
};
const sheetsCalls = [];
const handle = (body) => { sheetsCalls.push(body.action); return {}; };

const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim()).catch(() => null);
const visible = (page, sel) => page.$eval(sel, (el) => { for (let x = el; x; x = x.parentElement) { if (getComputedStyle(x).display === 'none') return false; } return true; }).catch(() => false);
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
// Taps like a finger after scrolling it into view (the floating tab bar covers the bottom of a long page).
const tap = (page, sel) => page.$eval(sel, (el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
const go = async (page, url) => { await page.goto(url); await sleep(300); };
const dbSession = (role, username) => ({ backend: 'supabase', accessToken: 'a', refreshToken: 'r', accessExpiresAt: Date.now() + 3600e3,
  email: `${username}@test.invalid`, storeId: 's', storeName: 'Route 66 Liquor', username, role, permissions: [], expiresAt: '2099-01-01' });

(async () => {
  // ---- Owner on Sheets: Try the Database ----
  let app = await openApp({ role: 'owner', handle, intercept });
  let { page, base } = app;
  await page.evaluate(() => {
    localStorage.setItem('smartScanSaved:o:listSlots', '{"x":1}');
    localStorage.setItem('smartScanOwnerHome:o', '{"x":1}');
    localStorage.setItem('smartScanCloseDraft:o', '{"entries":[]}');
  });
  await go(page, `${base}more.html`);
  assert.ok(await visible(page, '#switchBlock'), 'owner on Sheets sees the Database Move group');
  assert.equal(await text(page, '#switchTitle'), 'Try the Database');
  assert.equal(await text(page, '#switchSub'), 'This phone only, until Dec 1');
  assert.equal(await page.$('.db-chip'), null, 'no Database chip on Sheets');
  await page.screenshot({ path: '/tmp/phone-switch-more-sheets.png', fullPage: true });

  // Cancel changes nothing.
  await tap(page, '#switchRow');
  assert.ok(await visible(page, '#switchDialog'), 'the pop-up opens');
  assert.match(await text(page, '#switchText'), /practice until Dec 1/);
  await tap(page, '#switchCancel');
  assert.ok(!(await visible(page, '#switchDialog')));
  assert.equal(await stored(page, KEY), null);

  // A close still waiting to be sent: refused, nothing switched.
  await page.evaluate(() => localStorage.setItem('smartScanPendingClose', '{"closeId":"c1"}'));
  await tap(page, '#switchRow');
  await tap(page, '#switchGo');
  await sleep(300);
  assert.match(await text(page, '#switchError'), /still waiting to be sent/);
  assert.equal(await stored(page, KEY), null, 'not switched while a close waits');
  assert.ok(await stored(page, 'smartScanSession'), 'still signed in');
  await page.evaluate(() => localStorage.removeItem('smartScanPendingClose'));

  // Switch: signed out of Sheets (logout sent), saved answers gone, drafts kept, Sign In asks for the email.
  sheetsCalls.length = 0;
  await tap(page, '#switchGo');
  await page.waitForFunction(() => location.pathname.endsWith('login.html'));
  await sleep(300);
  assert.equal(await stored(page, KEY), 'database');
  assert.equal(await stored(page, 'smartScanSession'), null, 'signed out');
  assert.ok(sheetsCalls.includes('logout'), 'the Sheets session is ended');
  assert.equal(await stored(page, 'smartScanSaved:o:listSlots'), null, 'saved answers cleared');
  assert.equal(await stored(page, 'smartScanOwnerHome:o'), null, 'saved home cleared');
  assert.ok(await stored(page, 'smartScanCloseDraft:o'), 'close draft kept');
  assert.equal(await text(page, 'label[for="username"]'), 'Email');
  assert.ok(await visible(page, '#switchLine'), 'Sign In shows the way back');
  assert.ok(await visible(page, '#forgotLine'), 'Forgot Password on the database');
  await page.screenshot({ path: '/tmp/phone-switch-login.png', fullPage: true });

  // Signed in on the database: the chip on every header, the version line, and Use Sheets Again.
  await page.evaluate((s) => localStorage.setItem('smartScanSession', JSON.stringify(s)), dbSession('owner', 'o'));
  await go(page, `${base}more.html`);
  assert.equal(await text(page, '.app-header .db-chip'), 'Database');
  assert.equal(await text(page, '#switchTitle'), 'Use Sheets Again');
  await page.waitForFunction(() => !document.getElementById('appVersion').classList.contains('hidden'), { timeout: 3000 }).catch(() => {});
  const version = await text(page, '#appVersion');
  if (version) assert.match(version, / · Database$/);
  assert.ok(await visible(page, '#storeInfoRow'), 'database-only rows show on a switched phone');
  assert.ok(dbRequests.some((u) => u.includes('/rest/v1/rpc/store_info')), 'More asked the database, not Sheets');
  await page.screenshot({ path: '/tmp/phone-switch-more-db.png', fullPage: true });
  await go(page, `${base}slots.html`);
  assert.equal(await text(page, '.app-header .db-chip'), 'Database', 'chip on Slots');
  const chipBox = await page.$eval('.app-header .db-chip', (el) => { const r = el.getBoundingClientRect(); return { right: r.right, w: r.width }; });
  assert.ok(chipBox.right <= 390 && chipBox.w > 40, `chip fits on the phone: ${JSON.stringify(chipBox)}`);
  await page.screenshot({ path: '/tmp/phone-switch-slots-db.png' });

  // An employee (the test account) on the switched phone can switch back too.
  await page.evaluate((s) => localStorage.setItem('smartScanSession', JSON.stringify(s)), dbSession('employee', 'test'));
  await go(page, `${base}more.html`);
  assert.ok(await visible(page, '#switchBlock'), 'employee on a switched phone sees Use Sheets Again');
  await tap(page, '#switchRow');
  await tap(page, '#switchGo');
  await page.waitForFunction(() => location.pathname.endsWith('login.html'));
  await sleep(300);
  assert.equal(await stored(page, KEY), null, 'back on Sheets');
  assert.equal(await text(page, 'label[for="username"]'), 'Username');
  assert.ok(!(await visible(page, '#switchLine')));

  // Sign In's way back (before anyone can sign in on the database).
  await page.evaluate((k) => localStorage.setItem(k, 'database'), KEY);
  await go(page, `${base}login.html`);
  await tap(page, '#useSheets');
  await page.waitForFunction((k) => localStorage.getItem(k) === null, {}, KEY);
  await sleep(300);
  assert.equal(await text(page, 'label[for="username"]'), 'Username');

  // An invite link opened in a browser still on Sheets: switches it, then shows the form with the link's tokens.
  await go(page, `${base}set-password.html#access_token=at&refresh_token=rt&expires_in=3600&type=invite`);
  await page.waitForFunction(() => !document.getElementById('form').classList.contains('hidden'), { timeout: 4000 });
  assert.equal(await stored(page, KEY), 'database', 'the link switched this browser');
  assert.match(await text(page, '#intro'), /Welcome to Smart Scan/);
  // Without a link it doesn't switch anything.
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await go(page, `${base}set-password.html`);
  assert.equal(await stored(page, KEY), null);
  await app.close();

  // ---- An employee on Sheets never sees it ----
  app = await openApp({ role: 'employee', handle, intercept });
  await go(app.page, `${app.base}more.html`);
  assert.ok(!(await visible(app.page, '#switchBlock')), 'employee on Sheets: no switch');
  await app.close();

  // ---- At the cutover (BACKEND 'supabase') the switch is forgotten and not offered ----
  const cutover = CONFIG.replace("const BACKEND = 'sheets';", "const BACKEND = 'supabase';");
  assert.notEqual(cutover, CONFIG);
  app = await openApp({ role: 'owner', handle, intercept, configJs: cutover, signedIn: false });
  await app.page.evaluate((s, k) => { localStorage.setItem('smartScanSession', JSON.stringify(s)); localStorage.setItem(k, 'database'); }, dbSession('owner', 'o'), KEY);
  await go(app.page, `${app.base}more.html`);
  assert.equal(await stored(app.page, KEY), null, 'forgotten at the cutover (a rollback puts every phone back)');
  assert.ok(!(await visible(app.page, '#switchBlock')), 'not offered after the cutover');
  assert.equal(await app.page.$('.db-chip'), null, 'no chip after the cutover');
  await app.close();

  // ---- No database set up: not offered ----
  const noDb = CONFIG.replace(/const SUPABASE_URL = '[^']*';/, "const SUPABASE_URL = '';");
  app = await openApp({ role: 'owner', handle, intercept, configJs: noDb });
  await go(app.page, `${app.base}more.html`);
  assert.ok(!(await visible(app.page, '#switchBlock')), 'not offered without a database');
  await app.close();

  console.log('Phone switch: Try the Database / Use Sheets Again, chip, Sign In, pending close, cutover, invite link — OK');
})().catch((e) => { console.error(e); process.exit(1); });
