// Removing packs from a search result, against the real backend code on a fake spreadsheet: the
// sheet, the search card, the list and the totals all update. Run: node test/browser/backstock-remove.js
const assert = require('assert/strict');
const { openApp, backendInVm } = require('./harness');

const { ctx, sheets: S, addRow, call } = backendInVm('2026-09-26');
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 3, tickets_in_reserve: 90 });
addRow('ReserveInventory', { game_number: '1801', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 2, tickets_in_reserve: 100 });
addRow('SlotState', { box: 1, slot_number: 2, pack_key: '1747-1263622', game_number: '1747', pack_number: '1263622', price_per_ticket: 20, current_exposed_ticket_number: 20 });
const reserve = (g) => { const [h, ...rows] = S.ReserveInventory.rows; const r = rows.find((x) => x[0] === g); return Object.fromEntries(h.map((k, i) => [k, r[i]])); };
const owner = { username: 'o', role: 'owner' };
let answers = [];   // what to type into the next prompt() dialogs

function handle(body) {
  const fn = { listBackStock: () => ctx.listBackStock(), removeBackStock: () => ctx.removeBackStock(owner, body) }[body.action];
  return fn ? call(fn) : {};
}

(async () => {
  const app = await openApp({ role: 'owner', handle, onDialog: (d) => d.accept(answers.shift()) });
  const { page, base } = app;
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length === 2);
  const text = (sel) => page.$eval(sel, (el) => el.innerText);
  const listCard = (g) => page.$$eval('#stock .card', (cards, g) => cards.find((c) => c.innerText.includes(`Game ${g}`)).innerText, g);
  const removeFromSearch = async (packs, reason) => {
    answers = [String(packs), reason];
    await page.click('#searchResults .card button');
    await page.waitForFunction(() => document.querySelector('#searchMessage').textContent !== '');
  };
  const show = async (label) => console.log(`\n[${label}]\n search: ${JSON.stringify(await text('#searchResults'))}\n list:   ${JSON.stringify(await listCard('1747'))}\n totals: ${await text('#totals')}\n msg:    ${await text('#searchMessage')}\n sheet:  1747 packs=${reserve('1747').packs_in_reserve} tickets=${reserve('1747').tickets_in_reserve}, adjustments=${S.ReserveAdjustments.rows.length - 1}`);

  assert.equal(await text('#totals'), '5 packs · $2,800 at ticket price');   // 3×30×$20 + 2×50×$10
  await page.type('#search', '1747');
  assert.match(await text('#searchResults'), /3 packs/);

  // 1. Remove 1 pack (damaged) from the search result.
  await removeFromSearch(1, 'damaged'); await show('removed 1 of 3');
  assert.deepEqual([reserve('1747').packs_in_reserve, reserve('1747').tickets_in_reserve], [2, 60]);
  const adj = S.ReserveAdjustments.rows[1];
  assert.deepEqual(adj.slice(0, 5), ['2026-09-26', '1747', 1, 30, 'damaged']); assert.equal(adj[6], 'o');
  assert.match(await text('#searchResults'), /2 packs/); assert.match(await text('#searchResults'), /60 tickets · \$1,200/);
  assert.match(await listCard('1747'), /2 packs/);
  assert.equal(await text('#totals'), '4 packs · $2,200 at ticket price');
  assert.equal(await page.$eval('#search', (el) => el.value), '1747');            // search stays open
  assert.match(await text('#searchResults'), /On display: Box 1 · Slot 2/);       // the slot out front is untouched
  assert.equal(reserve('1801').packs_in_reserve, 2);                               // other games untouched

  // 2. Try to remove more than there are: refused, nothing changes.
  await page.$eval('#searchMessage', (el) => { el.textContent = ''; });
  await removeFromSearch(5, 'returned'); await show('tried 5 of 2');
  assert.match(await text('#searchMessage'), /only 2 packs/);
  assert.equal(reserve('1747').packs_in_reserve, 2); assert.equal(S.ReserveAdjustments.rows.length, 2);
  assert.match(await text('#searchResults'), /2 packs/);

  // 3. Remove the last 2 (returned): none in the back, Remove button gone, still shows the slot.
  await page.$eval('#searchMessage', (el) => { el.textContent = ''; });
  await removeFromSearch(2, 'returned'); await show('removed last 2');
  assert.deepEqual([reserve('1747').packs_in_reserve, reserve('1747').tickets_in_reserve], [0, 0]);
  assert.match(await text('#searchResults'), /none in the back/); assert.equal(await page.$('#searchResults .card button'), null);
  assert.match(await listCard('1747'), /none in the back/);
  assert.equal(await text('#totals'), '2 packs · $1,000 at ticket price');
  assert.equal(S.ReserveAdjustments.rows.length, 3);

  // 4. Reload: the page shows what the sheet says.
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length === 2);
  assert.equal(await text('#totals'), '2 packs · $1,000 at ticket price');
  // 5. Removing from the full list still reports at the bottom, and the search box message stays clear.
  answers = ['1', 'other']; await page.click('#stock .card button');
  await page.waitForFunction(() => document.querySelector('#stockMessage').textContent !== '');
  assert.match(await text('#stockMessage'), /Removed 1 pack of game 1801/); assert.equal(reserve('1801').packs_in_reserve, 1);
  console.log('\nREMOVE-FROM-SEARCH CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
