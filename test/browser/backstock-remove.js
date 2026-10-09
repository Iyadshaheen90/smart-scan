// Removing packs with the Manage packs dialog (− then Save, then a reason button removes them), against the real backend code on
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
  const visible = (sel) => page.$eval(sel, (el) => !el.classList.contains('hidden'));
  const open = () => page.$eval('#packDialog', (el) => !el.classList.contains('hidden'));
  const disabled = (sel) => page.$eval(sel, (b) => b.disabled);
  const listCard = (g) => page.$$eval('#stock .card', (cards, g) => cards.find((c) => c.innerText.includes(`Game ${g}`)).innerText, g);
  const openRemove = (sel, g) => page.$$eval(`${sel} .card`, (cards, g) =>
    [...cards.find((c) => c.innerText.includes(`Game ${g}`)).querySelectorAll('button')].find((b) => b.textContent === 'Manage Packs').click(), g);
  const waitMsg = (sel) => page.waitForFunction((sel) => document.querySelector(sel).textContent !== '', {}, sel);
  const clearMsg = (sel) => page.$eval(sel, (el) => { el.textContent = ''; });

  assert.equal(await text('#totals'), '5 packs · $2,800 at ticket price');   // 3×30×$20 + 2×50×$10
  await page.type('#search', '1747');
  assert.match(await text('#searchResults'), /3 Packs/);

  // 1. − then Save shows the "why" step (reason buttons, red Cancel, Back); nothing is sent yet.
  await openRemove('#searchResults', '1747');
  assert.equal(await open(), true);
  assert.equal(await text('#packTitle'), 'Game 1747 · $20');
  assert.equal(await text('#packCount'), '3');
  await page.click('#packMinus'); await page.click('#packMinus'); await page.click('#packSave');
  assert.equal(await visible('#packReasonStep'), true); assert.equal(await visible('#packCountStep'), false);
  assert.equal(await text('#packReasonTitle'), 'Remove 2 Packs (3 → 1 in the Back). Why?');
  assert.deepEqual(await page.$$eval('#removeReasons button', (b) => b.map((x) => x.textContent)), ['Returned', 'Game Expired', 'Damaged', 'Stolen', 'Other']);
  const bg = (sel) => page.$eval(sel, (el) => getComputedStyle(el).backgroundColor);
  assert.equal(await bg('#reasonCancel'), 'rgb(198, 40, 40)');
  assert.equal(calls, 0); assert.equal(reserve('1747').packs_in_reserve, 3);
  if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, 'remove-reason.png') });

  // 2. Back returns to the count as it was; Cancel from the why step closes with nothing changed.
  await page.click('#reasonBack');
  assert.equal(await visible('#packCountStep'), true); assert.equal(await text('#packCount'), '1');
  await page.click('#packSave'); await page.click('#reasonCancel');
  assert.equal(await open(), false); assert.equal(calls, 0); assert.equal(reserve('1747').packs_in_reserve, 3);
  await openRemove('#searchResults', '1747');
  assert.equal(await text('#packCount'), '3'); assert.equal(await visible('#packCountStep'), true);
  await page.click('#packCancel');

  // 3. Remove 1 pack (damaged) from the search result.
  await openRemove('#searchResults', '1747'); await removeInDialog(page, 1, 'damaged'); await waitMsg('#searchMessage');
  assert.equal(await open(), false);
  assert.match(await text('#searchMessage'), /Removed 1 pack of game 1747 \(damaged\)/);
  assert.deepEqual([reserve('1747').packs_in_reserve, reserve('1747').tickets_in_reserve], [2, 60]);
  assert.deepEqual(lastAdjustment().slice(0, 5), ['2026-09-26', '1747', 1, 30, 'damaged']); assert.equal(lastAdjustment()[6], 'o');
  assert.match(await text('#searchResults'), /2 Packs/); assert.match(await text('#searchResults'), /60 tickets · \$1,200/);
  assert.match(await listCard('1747'), /2 Packs/);
  assert.equal(await text('#totals'), '4 packs · $2,200 at ticket price');
  assert.equal(await page.$eval('#search', (el) => el.value), '1747');            // search stays open
  assert.match(await text('#searchResults'), /On display: Box 1 · Slot 2/);       // the slot out front is untouched
  assert.equal(reserve('1801').packs_in_reserve, 2);                               // other games untouched

  // 4. Remove the last 2 (game expired): none in the back, only Manage packs left, still shows the slot.
  await clearMsg('#searchMessage');
  await openRemove('#searchResults', '1747'); await removeInDialog(page, 2, 'game expired'); await waitMsg('#searchMessage');
  assert.deepEqual([reserve('1747').packs_in_reserve, reserve('1747').tickets_in_reserve], [0, 0]);
  assert.deepEqual(lastAdjustment().slice(1, 5), ['1747', 2, 60, 'game expired']);
  assert.match(await text('#searchResults'), /None in the Back/);
  assert.deepEqual(await page.$$eval('#searchResults .card button', (b) => b.map((x) => x.textContent)), ['Manage Packs']);
  assert.match(await listCard('1747'), /None in the Back/);
  assert.equal(await text('#totals'), '2 packs · $1,000 at ticket price');
  assert.equal(S.ReserveAdjustments.rows.length, 3);

  // 5. A refusal from the server (the back changed meanwhile) closes the dialog and shows why; nothing changes.
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length === 2);
  assert.equal(await text('#totals'), '2 packs · $1,000 at ticket price');         // reload shows the sheet
  await openRemove('#stock', '1801');
  await page.click('#packMinus'); await page.click('#packMinus'); await page.click('#packSave');   // remove 2 of 2
  ctx.removeBackStock(owner, { gameNumber: '1801', packs: 1, reason: 'other' });   // someone else took one
  await page.click('#removeReasons button[data-reason="returned"]'); await waitMsg('#stockMessage');
  assert.equal(await open(), false); assert.match(await text('#stockMessage'), /only 1 pack of game 1801/);
  assert.equal(reserve('1801').packs_in_reserve, 1);

  // 6. From the full list it reports at the bottom, and the search box message stays clear.
  await clearMsg('#stockMessage');
  await openRemove('#stock', '1801'); await removeInDialog(page, 1, 'stolen'); await waitMsg('#stockMessage');
  assert.match(await text('#stockMessage'), /Removed 1 pack of game 1801 \(stolen\)/); assert.equal(reserve('1801').packs_in_reserve, 0);
  assert.equal(await text('#searchMessage'), '');
  console.log('MANAGE PACKS (REMOVE) CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
