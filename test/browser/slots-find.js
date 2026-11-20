// Slots: Find a Slot (owner 2026-11-20). The floating magnifier opens a full-screen search over the loaded slots:
// by game (starts with), pack number, or game + pack together; every box; empty slots by their last game; Cancel closes.
// Run: node test/browser/slots-find.js   (SHOT=/path/prefix to save screenshots)
const assert = require('assert/strict');
const { openApp } = require('./harness');

const live = (box, slot, game, pack, remaining, lastCloseDate) => ({ box, slot, slotPrice: 20, endedToday: null, lastGame: null,
  pack: { gameNumber: game, packNumber: pack, price: 20, exposedTicket: remaining - 1, remaining, order: 'descending',
    activationDate: '2026-11-01', lastCloseDate, daysActive: 19, packsInBack: 2, ticketsPerPack: 30, standardPackSize: 30 } });
const slots = [
  live(1, 4, '1747', '0000004', 12, '2026-11-19'),
  live(1, 9, '1747', '0000011', 22, '2026-11-19'),
  live(1, 12, '1802', '0004321', 5, null),
  live(2, 17, '2222', '0000019', 30, '2026-11-19'),
  { box: 2, slot: 18, slotPrice: 10, slotOrder: 'descending', pack: null, endedToday: null, lastGame: { gameNumber: '1747', packsInBack: 0 } },
];

const results = (page) => page.$$eval('#findResults .card', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
const type = async (page, text) => { await page.$eval('#findInput', (el) => { el.value = ''; }); await page.type('#findInput', text); };
const hidden = (page, sel) => page.$eval(sel, (el) => el.classList.contains('hidden'));

(async () => {
  let app = await openApp({ role: 'owner', handle: (body) => (body.action === 'listSlots' ? slots : {}) });
  const { page } = app;
  await page.goto(app.base + 'slots.html'); await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 3);
  assert.equal(await hidden(page, '#findFab'), false);
  assert.equal(await hidden(page, '#findPanel'), true);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-slots.png` });

  await page.click('#findFab');
  assert.equal(await hidden(page, '#findPanel'), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'findInput');
  assert.match(await page.$eval('#findHint', (el) => el.textContent), /Type a game number/);

  // A game: both live slots and the empty slot whose last game it was, across boxes.
  await type(page, '1747');
  let r = await results(page); console.log('1747 →', JSON.stringify(r));
  assert.equal(r.length, 3);
  assert.match(r[0], /^Box 1 · Slot 4 12 Left 1747-0000004 · top ticket 011 As of the Nov 19 close · 2 in back$/);
  assert.match(r[2], /^Box 2 · Slot 18 Out of Stock Last game here: 1747 · 0 in back$/);
  assert.equal(await page.$eval('#findSum', (el) => el.textContent), '3 Slots · 34 Left');
  assert.equal(await page.$eval('#findResults .card', (el) => el.getAttribute('href')), 'activate.html?box=1&slot=4');
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-find.png` });

  // A pack number alone, the game + pack with a dash, and a game never in a slot.
  await type(page, '4321'); r = await results(page); assert.equal(r.length, 1); assert.match(r[0], /Slot 12 5 Left/);
  assert.match(r[0], /Since it was put in/);
  await type(page, '2222-0000019'); r = await results(page); assert.equal(r.length, 1); assert.match(r[0], /Box 2 · Slot 17 30 Left/);
  await type(page, '9999'); r = await results(page); assert.equal(r.length, 0);
  assert.equal(await page.$eval('#findHint', (el) => el.textContent), 'No slot has 9999.');
  assert.equal(await page.$eval('#findSum', (el) => el.textContent), '');

  // Cancel closes it; opening again starts empty. Escape closes too.
  await page.click('#findCancel'); assert.equal(await hidden(page, '#findPanel'), true);
  await page.click('#findFab'); assert.equal(await page.$eval('#findInput', (el) => el.value), '');
  await page.keyboard.press('Escape'); assert.equal(await hidden(page, '#findPanel'), true);
  await app.close();

  // An employee who can't open slots: same results, plain cards (no link), no dollars on them.
  app = await openApp({ role: 'employee', permissions: [], handle: (body) => (body.action === 'listSlots' ? slots : {}) });
  await app.page.goto(app.base + 'slots.html'); await app.page.waitForFunction(() => document.querySelectorAll('#list .card').length === 3);
  await app.page.click('#findFab'); await type(app.page, '1747');
  r = await results(app.page); assert.equal(r.length, 3); assert.ok(r.every((t) => !t.includes('$')));
  assert.equal(await app.page.$$eval('#findResults a.card', (els) => els.length), 0);
  await app.close();

  // No slots: no button.
  app = await openApp({ role: 'owner', handle: (body) => (body.action === 'listSlots' ? [] : {}) });
  await app.page.goto(app.base + 'slots.html'); await app.page.waitForFunction(() => document.getElementById('summary').textContent !== '');
  assert.equal(await hidden(app.page, '#findFab'), true);
  await app.close();
  console.log('SLOTS FIND CHECKS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
