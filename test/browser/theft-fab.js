// Home's floating Theft Report button (owner 2026-10-23): a big red circle at the bottom right, just above the tab bar,
// for the owner and employees with Theft Report (it comes and goes with the permission). Tapping it opens the Theft
// Report; scrolled to the bottom, it never covers the page's last row. Home only.
// Run: node test/browser/theft-fab.js   (SHOTS=dir also saves screenshots)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const slots = [{ box: 1, slot: 1, slotPrice: 20, pack: null }];
const home = { today: '2026-10-23', closed: null, slots, month: { current: '2026-10', next: '2026-11', canStart: false },
  monthDollars: 1234, lastClose: { date: '2026-10-22', ticketsSold: 40, dollarsSold: 800 }, backValue: 5000,
  fullPacks: { count: 0, dollars: 0 }, shifts: { count: 0, last: null } };
const button = (page) => page.evaluate(() => {
  const fab = document.getElementById('theftFab');
  if (!fab || fab.classList.contains('hidden') || !fab.getClientRects().length) return null;
  const r = fab.getBoundingClientRect();
  const bar = document.querySelector('nav.tabbar').getBoundingClientRect();
  const color = getComputedStyle(fab).backgroundColor;
  const iconColor = getComputedStyle(fab.querySelector('svg')).color;
  return { href: fab.getAttribute('href'), round: getComputedStyle(fab).borderRadius === '50%', size: Math.round(r.width),
    aboveBar: r.bottom <= bar.top - 4, rightGap: Math.round(window.innerWidth - r.right), color, iconColor, icon: Boolean(fab.querySelector('svg')) };
});

(async () => {
  // ---- Owner ----
  let app = await openApp({ role: 'owner', handle: (b) => (b.action === 'ownerHome' ? home : {}) });
  let { page, base } = app;
  await page.goto(base + 'index.html'); await sleep(400);
  assert.deepEqual(await button(page), { href: 'theft-report.html', round: true, size: 64, aboveBar: true, rightGap: 16,
    color: 'rgb(198, 40, 40)', iconColor: 'rgb(0, 0, 0)', icon: true });
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/theft-fab-owner.png` });
  // Scrolled to the bottom, the last row (Manage Employees) sits above the button.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(200);
  const clear = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('a.list-card, .tile-card, .tile-wide')].filter((el) => el.offsetParent);
    const last = rows[rows.length - 1].getBoundingClientRect();
    return last.bottom <= document.getElementById('theftFab').getBoundingClientRect().top;
  });
  assert.ok(clear, 'the button covers the last row');
  await Promise.all([page.waitForNavigation(), page.click('#theftFab')]);
  assert.ok(page.url().endsWith('theft-report.html'));
  // Not on the other pages.
  await page.goto(base + 'reports.html'); await sleep(200);
  assert.equal(await page.$('#theftFab'), null);
  // A wide screen: it stays at the right of the page's column, not the screen's edge.
  await page.setViewport({ width: 1000, height: 800 });
  await page.goto(base + 'index.html'); await sleep(300);
  assert.equal((await button(page)).rightGap, (1000 - 480) / 2 + 16);
  await app.close();

  // ---- Employees: only with Theft Report, and it follows the permission when the owner changes it ----
  let perms = ['theft_report'];
  app = await openApp({ role: 'employee', permissions: [], handle: (b) => (b.action === 'closeStatus'
    ? { today: '2026-10-23', closed: null, myShiftToday: null, slots, permissions: perms } : {}) });
  ({ page, base } = app);
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => !document.getElementById('theftFab').classList.contains('hidden'));
  assert.equal((await button(page)).aboveBar, true);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/theft-fab-employee.png` });
  perms = ['load_packs'];
  await page.reload();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('smartScanSession')).permissions.join() === 'load_packs');
  await sleep(100);
  assert.equal(await button(page), null, 'gone without the permission');
  assert.equal(await page.evaluate(() => document.body.classList.contains('has-fab')), false);
  await app.close();

  console.log('theft report button: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
