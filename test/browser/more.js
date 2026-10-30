// More tab redesign (owner 2026-10-29): a profile card (initials, name, role, the sign-in email on the database), then
// grouped lists — Store (owner; an employee sees it only with Ticket Order), Support, Account — then Sign Out and the
// app's version (from the phone's saved set of files). Long names never push the page sideways.
// Run: node test/browser/more.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
// Each visible group: its label and the titles of its visible rows.
const groups = (page) => page.$$eval('.group-block:not(.hidden)', (blocks) => blocks.map((b) => [
  b.querySelector('.group-label').textContent,
  ...[...b.querySelectorAll('.group-row:not(.hidden) .row-title')].map((t) => t.textContent),
]));

(async () => {
  // ---- Owner ----
  let app = await openApp({ role: 'owner', username: 'ishaheen', handle: () => ({}) });
  let { page, base } = app;
  await page.goto(base + 'more.html');
  await page.waitForSelector('.group-row');
  assert.equal(await page.$eval('#profileAvatar', (e) => e.textContent), 'IS');
  assert.equal(await page.$eval('#profileName', (e) => e.textContent), 'ishaheen');
  assert.equal(await page.$eval('#profileRole', (e) => [e.textContent, e.classList.contains('green')].join()), 'Owner,true');
  assert.equal(await page.$eval('#profileEmail', (e) => e.classList.contains('hidden')), true, 'no email on Sheets');
  assert.deepEqual(await groups(page), [
    ['Store', 'Manage Employees', 'Retailer Number', 'Ticket Order'],
    ['Support', 'Help & FAQ', 'Scanner Test', 'About Smart Scan'],
    ['Account', 'Change My Password'],
  ]);
  // Hairline dividers only between visible rows: none above a group's first row.
  const borders = await page.$$eval('.group-block:not(.hidden) .group', (gs) => gs.map((g) => [...g.querySelectorAll('.group-row:not(.hidden) .row-text')]
    .map((t) => getComputedStyle(t).borderTopStyle)));
  assert.deepEqual(borders, [['none', 'solid', 'solid'], ['none', 'solid', 'solid'], ['none']]);
  assert.equal(await page.$eval('#signOut', (e) => e.textContent.trim()), 'Sign Out');
  assert.ok(await noSideScroll(page));
  // The version: the newest saved set of files ("smart-scan-v47" → "Version 47"); older sets and other caches don't count.
  // The page is given a fixed list (the real service worker may or may not have saved its set yet).
  await page.evaluateOnNewDocument(() => {
    CacheStorage.prototype.keys = async () => ['smart-scan-v9', 'smart-scan-v12', 'other', `smart-scan-v${'x'}`];
  });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('appVersion').classList.contains('hidden'));
  assert.equal(await page.$eval('#appVersion', (e) => e.textContent), 'Smart Scan · Version 12');
  await shot(page, 'more-owner');
  await app.close();

  // ---- Employee without permissions: no Store group ----
  app = await openApp({ role: 'employee', username: 'sabas', permissions: [], handle: () => ({}) });
  ({ page, base } = app);
  await page.goto(base + 'more.html');
  await page.waitForSelector('.group-row');
  assert.equal(await page.$eval('#profileRole', (e) => [e.textContent, e.classList.contains('green')].join()), 'Employee,false');
  assert.deepEqual(await groups(page), [
    ['Support', 'Help & FAQ', 'Scanner Test', 'About Smart Scan'],
    ['Account', 'Change My Password'],
  ]);
  await shot(page, 'more-employee');
  await app.close();

  // ---- Employee with Ticket Order: the Store group with only that row ----
  app = await openApp({ role: 'employee', username: 'sam', permissions: ['ticket_order'], handle: () => ({}) });
  ({ page, base } = app);
  await page.goto(base + 'more.html');
  await page.waitForSelector('.group-row');
  assert.deepEqual((await groups(page))[0], ['Store', 'Ticket Order']);
  await app.close();

  // ---- A very long username and an email (the database's session): cut with … , never wider than the phone ----
  app = await openApp({ role: 'owner', username: 'averyveryverylongusername.withmore', handle: () => ({}) });
  ({ page, base } = app);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('smartScanSession'));
    localStorage.setItem('smartScanSession', JSON.stringify({ ...s, email: 'a.very.long.email.address.for.testing@example-store.com' }));
  });
  await page.goto(base + 'more.html');
  await page.waitForSelector('.group-row');
  assert.equal(await page.$eval('#profileEmail', (e) => [e.classList.contains('hidden'), e.textContent].join()), 'false,a.very.long.email.address.for.testing@example-store.com');
  assert.ok(await noSideScroll(page), 'long name and email fit');
  const fits = await page.$eval('#profile', (p) => p.getBoundingClientRect().right <= window.innerWidth);
  assert.ok(fits, 'profile card inside the screen');
  await sleep(50);
  await shot(page, 'more-long-name');
  await app.close();

  console.log('more: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
