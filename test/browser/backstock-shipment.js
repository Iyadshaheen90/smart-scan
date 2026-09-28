// Shipment received: a scanned (here: typed) game opens a pop-up starting at 1 pack received; + / − (stops at 0,
// Save greyed out there); Save adds the packs to the back at once as a delivery. Also a new game and an ended game.
// Run: node test/browser/backstock-shipment.js   (SHOT=dir also saves screenshots of the pop-up)
const assert = require('assert/strict');
const path = require('path');
const { openApp, backendInVm } = require('./harness');

const { ctx, sheets: S, addRow, call } = backendInVm('2026-09-28');
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 2, tickets_in_reserve: 60 });
addRow('ReserveInventory', { game_number: '1650', price_per_ticket: 5, tickets_per_pack: 60, packs_in_reserve: 0, tickets_in_reserve: 0, ended_date: '2026-09-20' });
const reserve = (g) => { const [h, ...rows] = S.ReserveInventory.rows; const r = rows.find((x) => x[0] === g); return r && Object.fromEntries(h.map((k, i) => [k, r[i]])); };
const shipment = (i) => { const [h, ...rows] = S.Shipments.rows; return Object.fromEntries(h.map((k, j) => [k, rows[i][j]])); };
const owner = { username: 'o', role: 'owner' };
let calls = 0;

function handle(body) {
  const fn = {
    listBackStock: () => ctx.listBackStock(),
    saveBackStock: () => { calls += 1; return ctx.saveBackStock(owner, body.mode, body.lines, body.notes); },
  }[body.action];
  return fn ? call(fn) : {};
}

(async () => {
  const app = await openApp({ role: 'owner', handle });
  const { page, base } = app;
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length === 1);
  const text = (sel) => page.$eval(sel, (el) => el.innerText);
  const open = () => page.$eval('#shipDialog', (el) => !el.classList.contains('hidden'));
  const disabled = (sel) => page.$eval(sel, (b) => b.disabled);
  const enter = async (game) => { await page.type('#typed', game); await page.click('#typedForm button'); };
  const shot = async (name) => { if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, name) }); };

  assert.match(await page.$eval('#modeSwitch .active', (b) => b.textContent), /Shipment received/);

  // 1. A known game: pop-up starts at 1, − left and + right, red Cancel left of green Save.
  await enter('1747');
  assert.equal(await open(), true);
  assert.equal(await text('#shipTitle'), 'Game 1747 · $20');
  assert.equal(await text('#shipCount'), '1');
  assert.equal(await text('#shipChange'), 'Back will have 3 (now 2)');
  assert.equal(await page.$eval('#shipNewGame', (el) => el.classList.contains('hidden')), true);
  const x = (sel) => page.$eval(sel, (el) => el.getBoundingClientRect().left);
  assert.ok(await x('#shipMinus') < await x('#shipCount') && await x('#shipCount') < await x('#shipPlus'));
  assert.ok(await x('#shipCancel') < await x('#shipSave'));
  const bg = (sel) => page.$eval(sel, (el) => getComputedStyle(el).backgroundColor);
  assert.equal(await bg('#shipCancel'), 'rgb(198, 40, 40)');
  assert.equal(await bg('#shipSave'), 'rgb(31, 122, 77)');
  assert.equal(await page.$eval('#lines', (el) => el.children.length), 0);   // nothing goes on a list

  // 2. − stops at 0 and greys out Save; Cancel saves nothing.
  await page.click('#shipMinus');
  assert.equal(await text('#shipCount'), '0'); assert.equal(await text('#shipChange'), 'No packs received');
  assert.equal(await disabled('#shipMinus'), true); assert.equal(await disabled('#shipSave'), true);
  await page.click('#shipMinus'); assert.equal(await text('#shipCount'), '0');
  await page.click('#shipCancel');
  assert.equal(await open(), false); assert.equal(calls, 0); assert.equal(reserve('1747').packs_in_reserve, 2);

  // 3. Again: starts at 1 again; + + → 3, Save adds 3 to the 2 in the back, as a delivery.
  await enter('1747');
  assert.equal(await text('#shipCount'), '1');
  await page.click('#shipPlus'); await page.click('#shipPlus');
  assert.equal(await text('#shipCount'), '3'); assert.equal(await text('#shipChange'), 'Back will have 5 (now 2)');
  await shot('shipment-dialog.png');
  await page.click('#shipSave');
  await page.waitForFunction(() => document.querySelector('#shipDialog').classList.contains('hidden'));
  assert.match(await text('#flash'), /Game 1747: 3 packs received, 2 → 5 in the back/);
  assert.deepEqual([reserve('1747').packs_in_reserve, reserve('1747').tickets_in_reserve], [5, 150]);
  const s = shipment(0);
  assert.deepEqual([s.game_number, s.packs_received, s.tickets_received, s.source, s.performed_by], ['1747', 3, 90, 'delivery', 'o']);
  assert.equal(await text('#totals'), '5 packs · $3,000 at ticket price');

  // 4. A new game: price and pack size first (Save greyed until then); $10 fills in 50 per pack.
  await enter('1900');
  assert.equal(await text('#shipTitle'), 'Game 1900 · new');
  assert.equal(await page.$eval('#shipNewGame', (el) => el.classList.contains('hidden')), false);
  assert.equal(await disabled('#shipSave'), true);
  await page.type('#shipPrice', '10');
  assert.equal(await page.$eval('#shipSize', (el) => el.value), '50');
  assert.equal(await disabled('#shipSave'), false);
  await shot('shipment-new-game.png');
  await page.click('#shipSave');
  await page.waitForFunction(() => /Game 1900/.test(document.querySelector('#flash').textContent));
  assert.match(await text('#flash'), /1 pack received, 0 → 1 in the back/);
  assert.deepEqual([reserve('1900').price_per_ticket, reserve('1900').tickets_per_pack, reserve('1900').packs_in_reserve].map(Number), [10, 50, 1]);

  // 5. An ended game: the pop-up says so, and receiving it brings it back.
  await enter('1650');
  assert.match(await text('#shipInfo'), /Marked ended on 2026-09-20\. Saving brings it back/);
  await page.click('#shipSave');
  await page.waitForFunction(() => /Game 1650/.test(document.querySelector('#flash').textContent));
  assert.equal(reserve('1650').ended_date, '');
  assert.equal(reserve('1650').packs_in_reserve, 1);
  assert.equal(await page.$eval('#endedBox', (el) => el.classList.contains('hidden')), true);

  // 6. Count the back still uses the list.
  await page.click('#modeSwitch button[data-mode="count"]');
  await enter('1747');
  assert.equal(await open(), false);
  assert.equal(await page.$eval('#lines', (el) => el.children.length), 1);

  // 7. Reload: the page shows what the sheet says.
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length === 3);
  assert.equal(await text('#totals'), '7 packs · $3,800 at ticket price');   // 5×30×$20 + 50×$10 + 60×$5
  console.log('SHIPMENT RECEIVED DIALOG CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
