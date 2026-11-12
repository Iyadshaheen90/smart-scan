// "Game ended" on Back stock, against the real backend code on a fake spreadsheet: only a game with
// nothing left can be ended (Game Ended… in the Manage Packs pop-up); Bring back, a delivery or a slot activation
// brings it back.
// Run: node test/browser/backstock-game-ended.js
const assert = require('assert/strict');
const { openApp, backendInVm, removeInDialog, tapGameRow, rowText, showScan, tapUseThisNumber } = require('./harness');

const { ctx, sheets: S, addRow, call } = backendInVm('2026-09-26');
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 3, tickets_in_reserve: 90 });
addRow('ReserveInventory', { game_number: '1801', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 2, tickets_in_reserve: 100 });
addRow('ReserveInventory', { game_number: '1718', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 0, tickets_in_reserve: 0 });
S.ReserveInventory.rows[0].pop();   // a month sheet made before ended_date existed
addRow('SlotState', { box: 1, slot_number: 2, pack_key: '1747-1263622', game_number: '1747', pack_number: '1263622', price_per_ticket: 20, current_exposed_ticket_number: 20 });
const owner = { username: 'o', role: 'owner' };
let answers = [];   // what to type into the next prompt() dialogs

function handle(body) {
  const fn = {
    listBackStock: () => ctx.listBackStock(),
    removeBackStock: () => ctx.removeBackStock(owner, body),
    endGame: () => ctx.endGame(body.gameNumber),
    bringBackGame: () => ctx.bringBackGame(body.gameNumber),
    saveBackStock: () => ctx.saveBackStock(owner, body.mode, body.lines, body.notes),
  }[body.action];
  return fn ? call(fn) : {};
}

(async () => {
  const app = await openApp({ role: 'owner', handle, onDialog: (d) => d.accept(answers.shift()) });
  const { page, base } = app;
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stockView .stock-row').length === 3);
  const text = (sel) => page.$eval(sel, (el) => el.innerText);
  // Games on the list: with packs, then under None in the Back.
  const listGames = () => page.$$eval('#stock .stock-row, #empty .stock-row', (els) => els.map((e) => e.dataset.game));
  const search = async (q) => { await page.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); }); if (q) await page.type('#search', q); };
  const msg = (re) => page.waitForFunction((re) => new RegExp(re).test(document.querySelector('#stockMessage').textContent), {}, re.source);
  const endShown = () => page.$eval('#packEnd', (b) => !b.classList.contains('hidden'));
  const endedRows = () => page.$$eval('#ended .stock-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  const ended = (g) => { const [h, ...rows] = S.ReserveInventory.rows; const i = h.indexOf('ended_date'); return i < 0 ? '' : rows.find((r) => r[0] === g)[i]; };

  // Only the game with nothing left (1718: 0 packs, no slot) offers Game Ended… in its pop-up.
  assert.deepEqual(await listGames(), ['1747', '1801', '1718']);
  for (const [g, shown] of [['1718', true], ['1801', false], ['1747', false]]) {
    await tapGameRow(page, g); assert.equal(await endShown(), shown, g); await page.click('#packCancel');
  }
  assert.equal(await page.$eval('#endedBox', (el) => el.classList.contains('hidden')), true);
  const totalsBefore = await text('#totals');

  // 1. End 1718 from its pop-up (found by search).
  await search('1718'); await tapGameRow(page, '1718'); await page.click('#packEnd'); await msg(/marked ended/);
  assert.equal(await page.$eval('#packDialog', (d) => d.classList.contains('hidden')), true);
  assert.equal(ended('1718'), '2026-09-26'); assert.ok(S.ReserveInventory.rows[0].includes('ended_date'));
  assert.equal(await text('#endedTitle'), 'Ended Games (1)');
  assert.equal(await page.$eval('#endedBox', (el) => !el.classList.contains('hidden') && el.open), true, 'open: it holds what is searched');
  assert.deepEqual(await endedRows(), ['1718 $20 · Ended 2026-09-26 Bring Back']);
  assert.equal(await text('#totals'), totalsBefore);
  await search(''); assert.deepEqual(await listGames(), ['1747', '1801']);
  assert.equal(await page.$eval('#endedBox', (el) => el.open), false, 'folded when not searching');

  // 2. Bring it back from the Ended Games list.
  await page.$eval('#endedBox', (el) => { el.open = true; }); await page.click('#ended button');
  await msg(/back in back stock/);
  assert.equal(ended('1718'), ''); assert.deepEqual(await listGames(), ['1747', '1801', '1718']);
  assert.equal(await page.$eval('#endedBox', (el) => el.classList.contains('hidden')), true);

  // 3. End it again, then a delivery of it (Scan) brings it back with its price remembered.
  await tapGameRow(page, '1718'); await page.click('#packEnd'); await msg(/marked ended/);
  await showScan(page);
  await page.type('#typed', '1718'); await tapUseThisNumber(page);
  assert.match(await text('#shipInfo'), /Marked ended on 2026-09-26\. Saving brings it back/);
  await page.click('#shipPlus'); await page.click('#shipSave');
  await page.waitForFunction(() => /2 packs received/.test(document.querySelector('#flash').textContent));
  await page.click('#viewSwitch button[data-view="stock"]');
  assert.equal(ended('1718'), ''); assert.deepEqual(await listGames(), ['1747', '1718', '1801']);
  assert.equal(await rowText(page, '1718'), '1718 2 Packs Not Live $1,200');

  // 4. A game still in a slot never offers Game Ended, even with the back empty; the server refuses it too.
  await tapGameRow(page, '1747'); await removeInDialog(page, 3, 'returned'); await msg(/Removed 3/);
  assert.equal(await rowText(page, '1747'), '1747 1 Live Order More');
  await tapGameRow(page, '1747'); assert.equal(await endShown(), false); await page.click('#packCancel');
  assert.throws(() => ctx.endGame('1747'), /still in box 1, slot 2/);
  console.log('\nGAME ENDED CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
