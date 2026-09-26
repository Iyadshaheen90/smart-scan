// "Game ended" on Back stock, against the real backend code on a fake spreadsheet: only a game with
// nothing left can be ended; Bring back, a delivery or a slot activation brings it back.
// Run: node test/browser/backstock-game-ended.js
const assert = require('assert/strict');
const { openApp, backendInVm } = require('./harness');

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
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length === 3);
  const text = (sel) => page.$eval(sel, (el) => el.innerText);
  const listGames = () => page.$$eval('#stock .card strong', (els) => els.map((e) => e.textContent.slice(5, 9)));
  const buttonsIn = (sel) => page.$$eval(`${sel} button`, (els) => els.map((e) => e.textContent));
  const search = async (q) => { await page.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); }); if (q) await page.type('#search', q); };
  const waitMsg = (sel) => page.waitForFunction((sel) => document.querySelector(sel).textContent !== '', {}, sel);
  const ended = (g) => { const [h, ...rows] = S.ReserveInventory.rows; const i = h.indexOf('ended_date'); return i < 0 ? '' : rows.find((r) => r[0] === g)[i]; };

  // Only the game with nothing left (1718: 0 packs, no slot) offers Game ended.
  await search('1718'); assert.deepEqual(await buttonsIn('#searchResults'), ['Game ended…']);
  await search('1801'); assert.deepEqual(await buttonsIn('#searchResults'), ['Remove packs…']);
  await search('1747'); assert.deepEqual(await buttonsIn('#searchResults'), ['Remove packs…']);
  assert.equal(await page.$eval('#endedBox', (el) => el.classList.contains('hidden')), true);
  const totalsBefore = await text('#totals');

  // 1. End 1718 from the search.
  await search('1718'); await page.click('#searchResults .card button'); await waitMsg('#searchMessage');
  console.log('ended msg:', await text('#searchMessage'));
  console.log('search now:', JSON.stringify(await text('#searchResults')));
  assert.equal(ended('1718'), '2026-09-26'); assert.ok(S.ReserveInventory.rows[0].includes('ended_date'));
  assert.deepEqual(await listGames(), ['1747', '1801']);
  assert.equal(await text('#endedTitle'), 'Ended games (1)'); assert.equal(await page.$eval('#endedBox', (el) => el.classList.contains('hidden')), false);
  assert.match(await text('#searchResults'), /ended 2026-09-26/); assert.deepEqual(await buttonsIn('#searchResults'), ['Bring back']);
  assert.equal(await text('#totals'), totalsBefore);

  // 2. Bring it back from the search.
  await page.click('#searchResults .card button'); await page.waitForFunction(() => /back in back stock/.test(document.querySelector('#searchMessage').textContent));
  assert.equal(ended('1718'), ''); assert.deepEqual(await listGames(), ['1718', '1747', '1801']);
  assert.equal(await page.$eval('#endedBox', (el) => el.classList.contains('hidden')), true);

  // 3. End it again, then a delivery of it brings it back with its price remembered.
  await page.click('#searchResults .card button'); await page.waitForFunction(() => /marked ended/.test(document.querySelector('#searchMessage').textContent));
  await search('');
  await page.type('#typed', '1718'); await page.click('#typedForm button');
  console.log('shipment line:', JSON.stringify(await text('#lines')));
  assert.match(await text('#lines'), /Marked ended on 2026-09-26\. Saving brings it back/);
  await page.type('#lines input.packs', '2'); await page.click('#saveBtn'); await waitMsg('#saveMessage');
  console.log('saved:', await text('#saveMessage'));
  assert.equal(ended('1718'), ''); assert.deepEqual(await listGames(), ['1718', '1747', '1801']);
  await search('1718'); assert.match(await text('#searchResults'), /2 packs/);

  // 4. A game still in a slot never offers Game ended, even with the back empty; the server refuses it too.
  answers = ['3', 'returned']; await search('1747'); await page.click('#searchResults .card button'); await waitMsg('#searchMessage');
  assert.match(await text('#searchResults'), /none in the back/); assert.deepEqual(await buttonsIn('#searchResults'), []);
  assert.throws(() => ctx.endGame('1747'), /still in box 1, slot 2/);

  // 5. Bring back from the Ended games list at the bottom.
  await search('1718'); answers = ['2', 'returned']; await page.click('#searchResults .card button');
  await page.waitForFunction(() => /Removed 2/.test(document.querySelector('#searchMessage').textContent));
  await page.click('#searchResults .card button'); await page.waitForFunction(() => /marked ended/.test(document.querySelector('#searchMessage').textContent));
  await page.$eval('#endedBox', (el) => { el.open = true; }); await page.click('#ended .card button');
  await page.waitForFunction(() => /back in back stock/.test(document.querySelector('#stockMessage').textContent));
  assert.equal(ended('1718'), '');
  console.log('\nGAME ENDED CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
