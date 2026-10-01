// Settling page (owner, 2026-09-29): live packs at 50+ days, longest first, with location, game/pack,
// days, ticket price, tickets left and value; amber 50–59, red 60+. A pack that sold out or was returned
// is no longer in listSlots, so it drops off. Employees are sent home.
// Run: node test/browser/settling.js   (SHOTS=dir also saves a screenshot)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const live = (box, slot, daysActive, price, remaining) => ({ box, slot, slotPrice: price, endedToday: null, lastGame: null,
  pack: { gameNumber: String(1700 + slot), packNumber: String(1000000 + slot), price, exposedTicket: remaining - 1, remaining,
    activationDate: '2026-08-01', lastCloseDate: '2026-09-28', daysActive, packsInBack: 0, ticketsPerPack: 30, standardPackSize: 30 } });
let slots = [live(1, 1, 0, 20, 30), live(1, 2, 49, 10, 50), live(1, 3, 50, 5, 12), live(2, 4, 62, 30, 7),
  live(2, 5, 75, 1, 200), live(2, 6, null, 20, 5), { box: 2, slot: 7, slotPrice: 10, pack: null, endedToday: null, lastGame: null }];

const cards = (page) => page.$$eval('#list .settle-card', (els) => els.map((c) => ({
  href: c.getAttribute('href'), where: c.querySelector('.slot-num').textContent, chip: c.querySelector('.chip').textContent,
  red: c.querySelector('.chip').classList.contains('red'), text: c.innerText,
})));

(async () => {
  let app = await openApp({ role: 'owner', handle: (b) => (b.action === 'listSlots' ? slots : {}) });
  await app.page.goto(app.base + 'settling.html');
  await app.page.waitForFunction(() => document.getElementById('packCount').textContent !== '…');
  let c = await cards(app.page);
  console.log(JSON.stringify(c.map((x) => [x.where, x.chip, x.red])));
  assert.deepEqual(c.map((x) => x.where), ['Box 2 · Slot 5', 'Box 2 · Slot 4', 'Box 1 · Slot 3']);
  assert.deepEqual(c.map((x) => x.chip), ['75 days', '62 days', '50 days']);
  assert.deepEqual(c.map((x) => x.red), [true, true, false]);
  assert.equal(c[1].href, 'activate.html?box=2&slot=4&from=settling');
  for (const bit of ['Game 1704 · Pack 1000004', '$30', '7', '$210', 'Activated Aug 1', 'Sep 28 close']) assert.ok(c[1].text.includes(bit), bit);
  assert.equal(await app.page.$eval('#packCount', (e) => e.textContent), '3');
  assert.equal(await app.page.$eval('#ticketCount', (e) => e.textContent), '219');            // 200 + 7 + 12
  assert.equal(await app.page.$eval('#dollarCount', (e) => e.textContent), '$470');          // 200×1 + 7×30 + 12×5
  if (process.env.SHOTS) await app.page.screenshot({ path: `${process.env.SHOTS}/settling.png`, fullPage: true });

  // A slot opened from Settling goes back to Settling; opened from Slots, back to Slots (that box).
  const backLinks = async (url) => {
    await app.page.goto(app.base + url); await sleep(300);
    return app.page.evaluate(() => ['back', 'doneBtn'].map((id) => [document.getElementById(id).textContent.trim(), document.getElementById(id).getAttribute('href')]));
  };
  assert.deepEqual(await backLinks('activate.html?box=2&slot=4&from=settling'), [['Settling', 'settling.html'], ['Back to settling', 'settling.html']]);
  // The back pill is big enough to tap easily (44px tall).
  assert.ok(await app.page.$eval('#back', (a) => a.getBoundingClientRect().height >= 44));
  // Level with the name pill (same top row, same middle).
  assert.ok(await app.page.evaluate(() => {
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    return Math.abs(mid(document.getElementById('back')) - mid(document.querySelector('.user-pill'))) <= 1;
  }), 'back pill level with the name pill');
  if (process.env.SHOTS) await app.page.screenshot({ path: `${process.env.SHOTS}/slot-back.png`, clip: { x: 0, y: 0, width: 390, height: 200 } });
  assert.deepEqual(await backLinks('activate.html?box=2&slot=4'), [['Slots', 'slots.html?box=2'], ['Back to slots', 'slots.html?box=2']]);
  await app.page.goto(app.base + 'settling.html');
  await app.page.waitForFunction(() => document.getElementById('packCount').textContent !== '…');

  // Slot 4 sold out and slot 5 was returned: they're no longer live, so they leave the list.
  slots = slots.filter((s) => s.slot !== 4 && s.slot !== 5);
  await app.page.reload();
  await app.page.waitForFunction(() => document.getElementById('packCount').textContent !== '…');
  c = await cards(app.page);
  assert.deepEqual(c.map((x) => x.where), ['Box 1 · Slot 3']);
  assert.equal(await app.page.$eval('#dollarCount', (e) => e.textContent), '$60');

  // None left.
  slots = slots.filter((s) => s.slot !== 3);
  await app.page.reload(); await sleep(400);
  assert.equal((await cards(app.page)).length, 0);
  assert.ok((await app.page.$eval('#list', (e) => e.textContent)).includes('No pack has been live 50 days'));
  await app.close();

  // Employees can't open it.
  app = await openApp({ role: 'employee', handle: (b) => (b.action === 'listSlots' ? slots : { today: '2026-09-28', closed: null, slots }) });
  await app.page.goto(app.base + 'settling.html'); await sleep(400);
  assert.ok(app.page.url().endsWith('index.html'));
  await app.close();
  console.log('SETTLING CHECKS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
