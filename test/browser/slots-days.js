// Slots: days since activation in yellow under "N left" (owner only), and a mark from day 50.
// Run: node test/browser/slots-days.js
const assert = require('assert/strict');
const { openApp } = require('./harness');

const live = (slot, daysActive) => ({ box: 1, slot, slotPrice: 20, endedToday: null, lastGame: null,
  pack: { gameNumber: '1747', packNumber: String(1000000 + slot), price: 20, exposedTicket: 9, remaining: 10,
    activationDate: '2026-08-01', lastCloseDate: null, daysActive, packsInBack: 2, ticketsPerPack: 30, standardPackSize: 30 } });
const slots = [live(1, 0), live(2, 1), live(3, 49), live(4, 50), live(5, 75), live(6, null),
  { box: 1, slot: 7, slotPrice: 10, pack: null, endedToday: null, lastGame: null }];

const cards = (page) => page.$$eval('#list .card', (els) => els.map((el) => ({
  days: el.querySelector('.tag.days') ? el.querySelector('.tag.days').textContent : null,
  mark: Boolean(el.querySelector('.old-mark')),
  left: el.querySelector('.tag').textContent,
})));

(async () => {
  let app = await openApp({ role: 'owner', handle: (body) => (body.action === 'listSlots' ? slots : {}) });
  await app.page.goto(app.base + 'slots.html'); await app.page.waitForFunction(() => document.querySelectorAll('#list .card').length === 7);
  let c = await cards(app.page); console.log('owner →', JSON.stringify(c.map((x) => [x.days, x.mark])));
  assert.deepEqual(c.map((x) => x.days), ['Activated today', '1 day', '49 days', '50 days', '75 days', null, null]);
  assert.deepEqual(c.map((x) => x.mark), [false, false, false, true, true, false, false]);
  assert.equal(c[0].left, '10 left'); assert.equal(c[6].left, 'Out of stock');
  await app.close();

  app = await openApp({ role: 'employee', handle: (body) => (body.action === 'listSlots' ? slots : {}) });
  await app.page.goto(app.base + 'slots.html'); await app.page.waitForFunction(() => document.querySelectorAll('#list .card').length === 7);
  c = await cards(app.page);
  assert.ok(c.every((x) => x.days === null && !x.mark)); assert.equal(c[4].left, '10 left');
  console.log('SLOTS DAYS CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
