// The Remove packs dialog (− count +, reason buttons, Cancel / Remove), against the real backend code on
// a fake spreadsheet: the sheet, the search card, the list and the totals all update.
// Run: node test/browser/backstock-remove.js   (SHOT=dir also saves a screenshot of the dialog)
const assert = require('assert/strict');
const path = require('path');
const { openApp, backendInVm, removeInDialog } = require('./harness');

const { ctx, sheets: S, addRow, call } = backendInVm('2026-09-26');
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 3, tickets_in_reserve: 90 });
addRow('ReserveInventory', { game_number: '1801', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 2, tickets_in_reserve: 100 });
addRow('SlotState', { box: 1, slot_number: 2, pack_key: '1747-1263622', game_number: '1747', pack_number: '1263622', price_per_ticket: 20, current_exposed_ticket_number: 20 });
const reserve = (g) => { const [h, ...rows] = S.ReserveInventory.rows; const r = rows.find((x) => x[0] === g); return Object.fromEntries(h.map((k, i) => [k, r[i]])); };
const lastAdjustment = () => S.ReserveAdjustments.rows[S.ReserveAdjustments.rows.length - 1];
const owner = { username: 'o', role: 'owner' };
let calls = 0;

function handle(body) {
  const fn = {
    listBackStock: () => ctx.listBackStock(),
    removeBackStock: () => { calls += 1; return ctx.removeBackStock(owner, body); },
  }[body.action];
  return fn ? call(fn) : {};
}

(async () => {
  const app = await openApp({ role: 'owner', handle });
  const { page, base } = app;
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length === 2);
  const text = (sel) => page.$eval(sel, (el) => el.innerText);
  const open = () => page.$eval('#removeDialog', (el) => !el.classList.contains('hidden'));
  const disabled = (sel) => page.$eval(sel, (b) => b.disabled);
  const listCard = (g) => page.$$eval('#stock .card', (cards, g) => cards.find((c) => c.innerText.includes(`Game ${g}`)).innerText, g);
  const openRemove = (sel, g) => page.$$eval(`${sel} .card`, (cards, g) =>
    [...cards.find((c) => c.innerText.includes(`Game ${g}`)).querySelectorAll('button')].find((b) => b.textContent === 'Remove packs…').click(), g);
  const waitMsg = (sel) => page.waitForFunction((sel) => document.querySelector(sel).textContent !== '', {}, sel);
  const clearMsg = (sel) => page.$eval(sel, (el) => { el.textContent = ''; });

  assert.equal(await text('#totals'), '5 packs · $2,800 at ticket price');   // 3×30×$20 + 2×50×$10
  await page.type('#search', '1747');
  assert.match(await text('#searchResults'), /3 packs/);

  // 1. The dialog: starts at 1 pack, every reason is a button, Remove waits for a reason, Cancel is red, Remove green.
  await openRemove('#searchResults', '1747');
  assert.equal(await open(), true);
  assert.equal(await text('#removeTitle'), 'Game 1747 · $20');
  assert.equal(await text('#removeCount'), '1'); assert.equal(await text('#removeLeft'), '3 in the back now · 2 left after');
  assert.deepEqual(await page.$$eval('#removeReasons button', (b) => b.map((x) => x.textContent)), ['Returned', 'Game expired', 'Damaged', 'Stolen', 'Other']);
  assert.equal(await disabled('#removeSave'), true); assert.equal(await text('#removeSave'), 'Pick a reason');
  assert.equal(await disabled('#removeMinus'), true);   // never below 1
  const x = (sel) => page.$eval(sel, (el) => el.getBoundingClientRect().left);
  assert.ok(await x('#removeCancel') < await x('#removeSave'));
  const bg = (sel) => page.$eval(sel, (el) => getComputedStyle(el).backgroundColor);
  assert.equal(await bg('#removeCancel'), 'rgb(198, 40, 40)'); assert.equal(await bg('#removeSave'), 'rgb(31, 122, 77)');
  // + stops at what's in the back
  await page.click('#removePlus'); await page.click('#removePlus'); await page.click('#removePlus');
  assert.equal(await text('#removeCount'), '3'); assert.equal(await disabled('#removePlus'), true);
  await page.click('#removeReasons button[data-reason="game expired"]');
  assert.equal(await text('#removeSave'), 'Remove 3');
  assert.deepEqual(await page.$$eval('#removeReasons button.active', (b) => b.map((x) => x.textContent)), ['Game expired']);
  if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, 'remove-dialog.png') });

  // 2. Cancel: nothing sent, nothing changed; opening again starts fresh.
  await page.click('#removeCancel');
  assert.equal(await open(), false); assert.equal(calls, 0); assert.equal(reserve('1747').packs_in_reserve, 3);
  await openRemove('#searchResults', '1747');
  assert.equal(await text('#removeCount'), '1'); assert.equal(await disabled('#removeSave'), true);
  await page.click('#removeCancel');

  // 3. Remove 1 pack (damaged) from the search result.
  await openRemove('#searchResults', '1747'); await removeInDialog(page, 1, 'damaged'); await waitMsg('#searchMessage');
  assert.equal(await open(), false);
  assert.match(await text('#searchMessage'), /Removed 1 pack of game 1747 \(damaged\)/);
  assert.deepEqual([reserve('1747').packs_in_reserve, reserve('1747').tickets_in_reserve], [2, 60]);
  assert.deepEqual(lastAdjustment().slice(0, 5), ['2026-09-26', '1747', 1, 30, 'damaged']); assert.equal(lastAdjustment()[6], 'o');
  assert.match(await text('#searchResults'), /2 packs/); assert.match(await text('#searchResults'), /60 tickets · \$1,200/);
  assert.match(await listCard('1747'), /2 packs/);
  assert.equal(await text('#totals'), '4 packs · $2,200 at ticket price');
  assert.equal(await page.$eval('#search', (el) => el.value), '1747');            // search stays open
  assert.match(await text('#searchResults'), /On display: Box 1 · Slot 2/);       // the slot out front is untouched
  assert.equal(reserve('1801').packs_in_reserve, 2);                               // other games untouched

  // 4. Remove the last 2 (game expired): none in the back, only Add pack left, still shows the slot.
  await clearMsg('#searchMessage');
  await openRemove('#searchResults', '1747'); await removeInDialog(page, 2, 'game expired'); await waitMsg('#searchMessage');
  assert.deepEqual([reserve('1747').packs_in_reserve, reserve('1747').tickets_in_reserve], [0, 0]);
  assert.deepEqual(lastAdjustment().slice(1, 5), ['1747', 2, 60, 'game expired']);
  assert.match(await text('#searchResults'), /none in the back/);
  assert.deepEqual(await page.$$eval('#searchResults .card button', (b) => b.map((x) => x.textContent)), ['Add pack']);
  assert.match(await listCard('1747'), /none in the back/);
  assert.equal(await text('#totals'), '2 packs · $1,000 at ticket price');
  assert.equal(S.ReserveAdjustments.rows.length, 3);

  // 5. A refusal from the server (the back changed meanwhile) closes the dialog and shows why; nothing changes.
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length === 2);
  assert.equal(await text('#totals'), '2 packs · $1,000 at ticket price');         // reload shows the sheet
  await openRemove('#stock', '1801'); await page.click('#removePlus');             // 2 of 2
  ctx.removeBackStock(owner, { gameNumber: '1801', packs: 1, reason: 'other' });   // someone else took one
  await page.click('#removeReasons button[data-reason="returned"]'); await page.click('#removeSave'); await waitMsg('#stockMessage');
  assert.equal(await open(), false); assert.match(await text('#stockMessage'), /only 1 pack of game 1801/);
  assert.equal(reserve('1801').packs_in_reserve, 1);

  // 6. From the full list it reports at the bottom, and the search box message stays clear.
  await clearMsg('#stockMessage');
  await openRemove('#stock', '1801'); await removeInDialog(page, 1, 'stolen'); await waitMsg('#stockMessage');
  assert.match(await text('#stockMessage'), /Removed 1 pack of game 1801 \(stolen\)/); assert.equal(reserve('1801').packs_in_reserve, 0);
  assert.equal(await text('#searchMessage'), '');
  console.log('REMOVE PACKS DIALOG CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
