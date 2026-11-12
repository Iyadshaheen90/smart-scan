// The Manage packs dialog, adding packs (+ / − then Save or Cancel), against the real backend code on a fake spreadsheet:
// Cancel changes nothing; Save updates the sheet, the list (one row per game, tap = the dialog) and the totals.
// Run: node test/browser/backstock-add-pack.js   (SHOT=dir also saves screenshots of the dialog)
const assert = require('assert/strict');
const path = require('path');
const { openApp, backendInVm, tapGameRow, rowText } = require('./harness');

const { ctx, sheets: S, addRow, call } = backendInVm('2026-09-27');
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 3, tickets_in_reserve: 90 });
addRow('ReserveInventory', { game_number: '1801', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 2, tickets_in_reserve: 100 });
const reserve = (g) => { const [h, ...rows] = S.ReserveInventory.rows; const r = rows.find((x) => x[0] === g); return Object.fromEntries(h.map((k, i) => [k, r[i]])); };
const owner = { username: 'o', role: 'owner' };
let calls = 0;

function handle(body) {
  const fn = {
    listBackStock: () => ctx.listBackStock(),
    adjustBackStock: () => { calls += 1; return ctx.adjustBackStock(owner, body); },
    removeBackStock: () => { calls += 1; return ctx.removeBackStock(owner, body); },
  }[body.action];
  return fn ? call(fn) : {};
}

(async () => {
  const app = await openApp({ role: 'owner', handle });
  const { page, base } = app;
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stock .stock-row').length === 2);
  const text = (sel) => page.$eval(sel, (el) => el.innerText);
  const open = () => page.$eval('#packDialog', (el) => !el.classList.contains('hidden'));
  const addPackOn = (g) => tapGameRow(page, g);
  const shot = async (name) => { if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, name) }); };

  assert.equal(await text('#totals'), '5 packs · $2,800 at ticket price');   // 3×30×$20 + 2×50×$10
  // Grouped by price, highest first: $20 then $10.
  assert.deepEqual(await page.$$eval('#stock .stock-price', (e) => e.map((x) => x.textContent)), ['$20', '$10']);
  assert.equal(await rowText(page, '1747'), '1747 3 Packs Not Live $1,800');

  // 1. The dialog shows the packs in the back now, in the middle, with − left and + right.
  await addPackOn('1747');
  assert.equal(await open(), true);
  assert.equal(await text('#packTitle'), 'Game 1747 · $20');
  assert.equal(await text('#packInfo'), '90 tickets · $1,800 · 30 per pack');
  assert.equal(await text('#packWhere'), 'Not in any slot now');
  assert.equal(await page.$eval('#packEnd', (b) => b.classList.contains('hidden')), true, 'packs in the back: no Game Ended');
  assert.equal(await text('#packCount'), '3');
  const x = (sel) => page.$eval(sel, (el) => el.getBoundingClientRect().left);
  assert.ok(await x('#packMinus') < await x('#packCount') && await x('#packCount') < await x('#packPlus'));
  assert.ok(await x('#packCancel') < await x('#packSave'));
  const bg = (sel) => page.$eval(sel, (el) => getComputedStyle(el).backgroundColor);
  assert.equal(await bg('#packCancel'), 'rgb(198, 40, 40)');   // red
  assert.equal(await bg('#packSave'), 'rgb(47, 158, 103)');     // green

  // 2. + and − change the number; Cancel closes with nothing saved.
  await page.click('#packPlus'); await page.click('#packPlus'); await page.click('#packPlus');
  assert.equal(await text('#packCount'), '6'); assert.match(await text('#packChange'), /\+3 packs \(was 3\)/);
  await page.click('#packMinus');
  assert.equal(await text('#packCount'), '5');
  await shot('add-pack-dialog.png');
  await page.click('#packCancel');
  assert.equal(await open(), false);
  assert.equal(calls, 0); assert.equal(reserve('1747').packs_in_reserve, 3);
  assert.equal(S.Shipments.rows.length, 1); assert.equal(await text('#totals'), '5 packs · $2,800 at ticket price');

  // 3. Opening again starts from what's in the back (the cancelled +2 is gone). +2, Save.
  await addPackOn('1747');
  assert.equal(await text('#packCount'), '3');
  await page.click('#packPlus'); await page.click('#packPlus'); await page.click('#packSave');
  await page.waitForFunction(() => document.querySelector('#stockMessage').textContent !== '');
  assert.equal(await open(), false);
  assert.match(await text('#stockMessage'), /Game 1747: 3 → 5 packs in the back/);
  assert.deepEqual([reserve('1747').packs_in_reserve, reserve('1747').tickets_in_reserve], [5, 150]);
  assert.deepEqual(S.Shipments.rows[1].slice(0, 9), ['2026-09-27', '1747', 20, 30, 2, 60, 'add pack', '', 'o']);
  assert.equal(await rowText(page, '1747'), '1747 5 Packs Not Live $3,000');
  assert.equal(await text('#totals'), '7 packs · $4,000 at ticket price');

  // 4. Found by search, − down to 0 (− then stops), Save asks why and sends nothing; the reason removes them.
  await page.type('#search', '1801');
  assert.deepEqual(await page.$$eval('#stock .stock-row', (r) => r.map((x) => x.dataset.game)), ['1801']);
  await addPackOn('1801');
  await page.click('#packMinus'); await page.click('#packMinus');
  assert.equal(await text('#packCount'), '0'); assert.equal(await page.$eval('#packMinus', (b) => b.disabled), true);
  await page.click('#packMinus'); assert.equal(await text('#packCount'), '0');
  const sent = calls;
  await page.click('#packSave');
  assert.equal(await open(), true); assert.equal(calls, sent); assert.equal(reserve('1801').packs_in_reserve, 2);
  await page.click('#removeReasons button[data-reason="returned"]');
  await page.waitForFunction(() => document.querySelector('#stockMessage').textContent !== '');
  assert.match(await text('#stockMessage'), /Removed 2 packs of game 1801 \(returned\): 2 → 0 in the back/);
  assert.deepEqual([reserve('1801').packs_in_reserve, reserve('1801').tickets_in_reserve], [0, 0]);
  assert.deepEqual(S.ReserveAdjustments.rows[1].slice(0, 7), ['2026-09-27', '1801', 2, 100, 'returned', '', 'o']);
  // Now under None in the Back, which opens while it holds what's searched.
  assert.equal(await text('#emptyTitle'), 'None in the Back (1)');
  assert.equal(await page.$eval('#emptyBox', (d) => d.open), true);
  assert.equal(await page.$eval('#empty', (e) => e.querySelectorAll('.stock-row').length), 1);
  assert.equal(await rowText(page, '1801'), '1801 Not Live');
  assert.equal(await text('#totals'), '5 packs · $3,000 at ticket price');

  // 5. A game with none in the back still opens Manage packs (with Game ended… under it); + then Save brings it up.
  await addPackOn('1801');
  assert.equal(await page.$eval('#packEnd', (b) => b.classList.contains('hidden')), false);
  await page.click('#packPlus'); await page.click('#packSave');
  await page.waitForFunction(() => /0 → 1 pack in/.test(document.querySelector('#stockMessage').textContent));
  assert.equal(reserve('1801').packs_in_reserve, 1);
  assert.equal(await page.$eval('#emptyBox', (d) => d.classList.contains('hidden')), true);
  assert.equal(await rowText(page, '1801'), '1801 1 Pack Not Live $500');

  // 6. Save with no change just closes; nothing is sent.
  const before = calls;
  await page.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); });
  await addPackOn('1747'); await page.click('#packPlus'); await page.click('#packMinus'); await page.click('#packSave');
  assert.equal(await open(), false); assert.equal(calls, before);

  // 7. Reload: the page shows what the sheet says.
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#stock .stock-row').length === 2);
  assert.equal(await text('#totals'), '6 packs · $3,500 at ticket price');
  console.log('MANAGE PACKS (ADD) CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
