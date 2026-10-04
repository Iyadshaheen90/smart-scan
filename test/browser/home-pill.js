// Home back pill (owner's request 2026-10-04): Slots, Settling, Full pack sales and Shift Closure have a
// "Home" pill (back to index.html) for the owner, level with the name pill. Employees open Slots from the
// tab bar, so their Slots page has no pill.
// Run: node test/browser/home-pill.js   (SHOTS=dir also saves screenshots)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const handle = (b) => {
  if (b.action === 'listSlots') return [];
  if (b.action === 'listFullPackSales') return { sales: [], count: 0, dollars: 0 };
  if (b.action === 'listShiftCloses') return { days: [] };
  return { today: '2026-10-04', closed: null, slots: [] };
};
const pill = (page) => page.evaluate(() => {
  const a = document.querySelector('.app-header .back');
  if (!a) return null;
  const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  return { text: a.textContent.trim(), href: a.getAttribute('href'), tall: a.getBoundingClientRect().height >= 44,
    level: Math.abs(mid(a) - mid(document.querySelector('.user-pill'))) <= 1 };
});

(async () => {
  let app = await openApp({ role: 'owner', handle });
  for (const url of ['slots.html', 'settling.html', 'full-packs.html', 'shifts.html']) {
    await app.page.goto(app.base + url); await sleep(300);
    assert.deepEqual(await pill(app.page), { text: 'Home', href: 'index.html', tall: true, level: true }, url);
    if (process.env.SHOTS) await app.page.screenshot({ path: `${process.env.SHOTS}/pill-${url.replace('.html', '')}.png`, clip: { x: 0, y: 0, width: 390, height: 200 } });
  }
  // Tapping it goes home.
  await Promise.all([app.page.waitForNavigation(), app.page.click('.app-header .back')]);
  assert.ok(app.page.url().endsWith('index.html'));
  await app.close();

  app = await openApp({ role: 'employee', handle });
  await app.page.goto(app.base + 'slots.html'); await sleep(300);
  assert.equal(await pill(app.page), null);
  await app.close();
  console.log('HOME PILL CHECKS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
