// Back pills. Home back pill (owner's request 2026-10-04): Slots, Settling, Full pack sales and Shift Closure have a
// "Home" pill (back to index.html) for the owner, level with the name pill. Employees open Slots from the
// tab bar, so their Slots page has no pill.
// Rule (owner 2026-10-13): on every page with a back pill, found by itself, with short and long usernames, the name pill
// stays top right on the pill's row and the pill's text shows whole (smaller if needed), with no sideways scroll.
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

  // Long back pill text next to a long username (owner 2026-10-13): the name pill stays top right on the same row,
  // and the back pill's text gets smaller instead of being cut off.
  const longHandle = (b) => (b.action === 'listShipments' || b.action === 'listReturns' ? { packs: 0, dollars: 0, lines: [] }
    : b.action === 'reportsPage' ? { monthDollars: 0, shipments: { packs: 0, dollars: 0 }, returns: { packs: 0, dollars: 0 } } : handle(b));
  // Every page with a back pill is checked, found by itself (owner's rule 2026-10-13: a new back pill must never move the
  // name pill). Pages that change their pill from the address get those addresses too: ?date= on a report (its script sets
  // backLabel), and the slot page opened from Settling.
  const fs = require('fs'); const path = require('path');
  const SRC = path.join(__dirname, '..', '..', 'src');
  const pillPages = [];
  for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.html')).sort()) {
    const html = fs.readFileSync(path.join(SRC, file), 'utf8');
    if (!/data-back=/.test(html)) continue;
    if (file === 'activate.html') pillPages.push('activate.html?box=1&slot=1', 'activate.html?box=1&slot=1&from=settling');
    else pillPages.push(file);
    if (/backLabel:/.test(html)) pillPages.push(`${file}?date=2026-10-06`);
  }
  assert.ok(pillPages.length >= 9, pillPages.join(' '));
  for (const username of ['o', 'ishaheen', 'route66owner']) {
    app = await openApp({ role: 'owner', username, handle: longHandle });
    for (const url of pillPages) {
      await app.page.goto(app.base + url); await sleep(300);
      const r = await app.page.evaluate(() => {
        const box = (sel) => document.querySelector(sel).getBoundingClientRect();
        const back = box('.app-header .back'), user = box('.user-pill'), label = document.querySelector('.back-label');
        return { right: Math.round(window.innerWidth - user.right), level: Math.abs((back.top + back.bottom) / 2 - (user.top + user.bottom) / 2) <= 1,
          apart: back.right <= user.left, whole: label.scrollWidth <= label.clientWidth, noSideScroll: document.documentElement.scrollWidth <= window.innerWidth };
      });
      assert.deepEqual(r, { right: 20, level: true, apart: true, whole: true, noSideScroll: true }, `${username} ${url}`);
      if (process.env.SHOTS && url.includes('shipments.html?')) await app.page.screenshot({ path: `${process.env.SHOTS}/pill-long-${username}.png`, clip: { x: 0, y: 0, width: 390, height: 160 } });
    }
    await app.close();
  }

  app = await openApp({ role: 'employee', handle });
  await app.page.goto(app.base + 'slots.html'); await sleep(300);
  assert.equal(await pill(app.page), null);
  await app.close();
  console.log('HOME PILL CHECKS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
