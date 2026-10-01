// Full pack sale (Back stock, owner): a scanned (here: typed) ticket of a sealed pack opens a pop-up with the game,
// pack, value and "Back: 2 → 1"; Sell takes one pack off the back and logs the sale. ?mode=fullpack opens this mode.
// A game with none in the back is refused before any pop-up; a bare game number is refused (pack number needed).
// Run: node test/browser/backstock-fullpack.js   (SHOT=dir also saves screenshots)
const assert = require('assert/strict');
const path = require('path');
const { openApp, backendInVm } = require('./harness');

const { ctx, sheets: S, addRow, call } = backendInVm('2026-10-05');
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 2, tickets_in_reserve: 60 });
addRow('ReserveInventory', { game_number: '1111', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 0, tickets_in_reserve: 0 });
const packs = (g) => S.ReserveInventory.rows.find((x) => x[0] === g)[3];
const owner = { username: 'o', role: 'owner' };
let sells = 0;

function handle(body) {
  const fn = {
    listBackStock: () => ctx.listBackStock(),
    sellFullPack: () => { sells += 1; return ctx.sellFullPack(owner, body); },
  }[body.action];
  return fn ? call(fn) : {};
}

(async () => {
  const app = await openApp({ role: 'owner', handle });
  const { page, base } = app;
  const text = (sel) => page.$eval(sel, (el) => el.innerText);
  const open = () => page.$eval('#sellDialog', (el) => !el.classList.contains('hidden'));
  const enter = async (t) => { await page.type('#typed', t); await page.click('#typedForm button'); };
  const shot = async (name) => { if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, name) }); };

  // 1. Opened from the Full pack sales page: already in Full pack sale mode.
  await page.goto(base + 'backstock.html?mode=fullpack'); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length >= 1);
  assert.equal(await text('#modeSwitch .active'), 'Full pack sale');
  assert.match(await text('#modeHint'), /whole sealed pack/);

  // 2. A bare game number isn't enough.
  await enter('1747');
  assert.equal(await open(), false); assert.match(await text('#flash'), /whole ticket number/);
  await page.$eval('#typed', (el) => { el.value = ''; });

  // 3. A game with none in the back: refused, no pop-up, nothing sent.
  await enter('1111-0000001-0-010');
  assert.equal(await open(), false); assert.match(await text('#flash'), /No packs of game 1111/); assert.equal(sells, 0);

  // 4. A ticket of a sealed pack: pop-up shows what's sold and what's left in the back. Cancel sells nothing.
  await enter('1747-1263622-4-075');
  assert.equal(await open(), true);
  assert.equal(await text('#sellPack'), 'Game 1747 · Pack 1263622');
  assert.equal(await text('#sellValue'), '$600');
  assert.equal(await text('#sellMath'), '$20 × 30 tickets');
  assert.equal(await text('#sellBack'), 'Back: 2 → 1');
  const x = (sel) => page.$eval(sel, (el) => el.getBoundingClientRect().left);
  assert.ok(await x('#sellCancel') < await x('#sellSave'));
  await shot('fullpack-dialog.png');
  await page.click('#sellCancel');
  assert.equal(await open(), false); assert.equal(sells, 0); assert.equal(packs('1747'), 2);

  // 5. Sell: one pack off the back at once; the list redraws; the sale is logged.
  await enter('1747-1263622-4-075');
  await page.click('#sellSave');
  await page.waitForFunction(() => document.getElementById('sellDialog').classList.contains('hidden'));
  assert.equal(sells, 1); assert.equal(packs('1747'), 1);
  assert.match(await text('#flash'), /Sold full pack 1747-1263622 for \$600\. Game 1747: 2 → 1 in the back\./);
  assert.match(await text('#stock'), /1 pack/);
  assert.equal(call(() => ctx.listFullPackSales()).count, 1);

  // 6. The same pack again: the server refuses, shown in the message.
  await enter('1747-1263622-4-075');
  await page.click('#sellSave');
  await page.waitForFunction(() => document.getElementById('sellDialog').classList.contains('hidden'));
  assert.match(await text('#flash'), /already sold out, returned or sold as a full pack/); assert.equal(packs('1747'), 1);

  // 7. Switching modes needs no confirm; the shipment/count list is hidden while selling full packs.
  await page.click('#modeSwitch button[data-mode="count"]');
  await enter('1747');
  assert.equal(await page.$eval('#lines', (el) => el.children.length), 1);
  await page.click('#modeSwitch button[data-mode="fullpack"]');
  assert.equal(await page.$eval('#lines', (el) => el.children.length), 0);
  assert.equal(await page.$eval('#saveArea', (el) => el.classList.contains('hidden')), true);
  // and a reload (no ?mode) goes back to the saved count list, never to a full pack draft
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length >= 1);
  assert.equal(await text('#modeSwitch .active'), 'Count the back');
  await shot('fullpack-modes.png');

  console.log('BACK STOCK FULL PACK CHECKS PASS');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
