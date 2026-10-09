// Saved answers (loadSaved in api.js, 2026-09-29): Slots, Settling, Back stock and Months & totals show the last
// answer saved on this phone at once, dimmed, then the fresh one. Back stock's buttons and Months' Start and past
// months can't be tapped until the fresh answer is in. Months & totals is one request (monthsPage).
// Run: node test/browser/saved-pages.js
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const live = (slot, daysActive, remaining) => ({ box: 1, slot, slotPrice: 20, endedToday: null, lastGame: null,
  pack: { gameNumber: '1747', packNumber: String(1000000 + slot), price: 20, exposedTicket: remaining - 1, remaining,
    activationDate: '2026-08-01', lastCloseDate: '2026-09-28', daysActive, packsInBack: 0, ticketsPerPack: 30, standardPackSize: 30 } });
const game = (n, packs) => ({ gameNumber: n, price: 20, ticketsPerPack: 30, standardPackSize: 30, packsInBack: packs,
  ticketsInBack: packs * 30, valueInBack: packs * 600, liveSlots: 0, liveIn: [], endedDate: null });
const summary = (label, dollarsSold) => ({ label, status: 'active', url: 'https://example.com', ticketsSold: 10, dollarsSold,
  shipmentValue: 0, endingInventoryValue: 100, days: [{ date: `${label}-02`, ticketsSold: 10, dollarsSold, inventoryValue: 100 }] });
const monthsPage = (dollars, canStart) => ({ status: { current: '2026-09', currentUrl: 'https://example.com', next: '2026-10', canStart },
  summary: summary('2026-09', dollars), months: [{ label: '2026-09', status: 'active', url: 'u' }, { label: '2026-08', status: 'archived', url: 'u' }] });

(async () => {
  // First answers.
  let data = { listSlots: [live(1, 70, 12), live(2, 3, 30)], listBackStock: [game('1747', 3)], monthsPage: monthsPage(500, true) };
  const calls = [];
  let hold = null;   // a promise the backend waits on, to see the page before the answer arrives
  const app = await openApp({ role: 'owner', handle: async (b) => { calls.push(b.action); if (hold) await hold; return data[b.action] || {}; } });
  const { page, base } = app;
  const saved = () => page.evaluate(() => document.body.classList.contains('showing-saved'));
  const txt = (sel) => page.$eval(sel, (e) => e.innerText);

  // Nothing saved yet: pages load as before. Months & totals makes one request.
  await page.goto(base + 'slots.html'); await page.waitForFunction(() => document.querySelectorAll('#list .slot-card, #list a, #list .card').length > 0);
  assert.ok(!(await saved()));
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length === 1);
  calls.length = 0;
  await page.goto(base + 'month.html'); await page.waitForFunction(() => !document.getElementById('startBox').classList.contains('hidden'));
  assert.deepEqual(calls, ['monthsPage'], 'Months & Totals is one request');
  assert.match(await txt('#current'), /\$500/);
  assert.match(await txt('#past'), /August 2026/);
  assert.ok(!(await txt('#past')).includes('September'), 'this month is not in past months');

  // The backend now answers slowly with new numbers: each page shows the saved answer first, dimmed.
  data = { listSlots: [live(1, 71, 5), live(2, 60, 30)], listBackStock: [game('1747', 7)], monthsPage: monthsPage(900, false) };
  let release;
  const slow = () => { hold = new Promise((r) => { release = r; }); };

  slow();
  await page.goto(base + 'settling.html'); await sleep(400);
  assert.ok(await saved(), 'Settling shows the saved answer (saved by Slots)');
  assert.equal(await txt('#packCount'), '1');
  assert.equal(await page.$eval('#list', (e) => getComputedStyle(e).opacity), '0.55');
  release(); await page.waitForFunction(() => !document.body.classList.contains('showing-saved'));
  assert.equal(await txt('#packCount'), '2', 'then the fresh answer');
  assert.equal(await page.$eval('#list', (e) => getComputedStyle(e).opacity), '1');

  slow();
  await page.goto(base + 'slots.html'); await sleep(400);
  assert.ok(await saved());
  assert.match(await txt('#list'), /2 Days|60 Days/, 'Slots shows the answer Settling saved');
  release(); await page.waitForFunction(() => !document.body.classList.contains('showing-saved'));

  slow();
  await page.goto(base + 'backstock.html'); await sleep(400);
  assert.ok(await saved());
  assert.match(await txt('#stock'), /3 Packs/);
  assert.equal(await page.$eval('#stock', (e) => getComputedStyle(e).pointerEvents), 'none', 'buttons off on the saved list');
  release(); await page.waitForFunction(() => !document.body.classList.contains('showing-saved'));
  assert.match(await txt('#stock'), /7 Packs/);
  assert.equal(await page.$eval('#stock', (e) => getComputedStyle(e).pointerEvents), 'auto');

  slow();
  await page.goto(base + 'month.html'); await sleep(400);
  assert.ok(await saved());
  assert.match(await txt('#current'), /\$500/);
  assert.equal(await page.$eval('#startBox', (e) => getComputedStyle(e).pointerEvents), 'none', 'Start is off on the saved answer');
  assert.equal(await page.$eval('#pastBox', (e) => getComputedStyle(e).pointerEvents), 'none');
  release(); await page.waitForFunction(() => !document.body.classList.contains('showing-saved'));
  assert.match(await txt('#current'), /\$900/);
  assert.ok(await page.$eval('#startBox', (e) => e.classList.contains('hidden')), 'fresh answer: not the 1st, no Start');

  // No connection: the saved answer stays (dimmed, buttons off) with the reason at the top.
  hold = null;
  app.setHandle(() => { throw { code: 'network', message: 'Could not reach the server.' }; });
  await page.goto(base + 'backstock.html'); await sleep(400);
  assert.ok(await saved());
  assert.match(await txt('#stock'), /7 Packs/);
  assert.match(await txt('#loadMessage'), /Could not reach/);

  console.log('SAVED PAGES CHECKS PASS');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
