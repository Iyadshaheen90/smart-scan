// Shipment Received (owner 2026-11-11): one scan per pack adds it to "This Shipment" (here typed ticket numbers, the
// same path as a scan). A second pack of a game adds to its line; the same pack twice is caught; a typed game number
// adds a pack without a number; − takes the last one off; a new game picks its price on the line; one Receive saves it
// all (real backend code on a fake sheet), with the pack numbers sent along. The list is kept on the phone until then,
// and Manage Stock keeps its own list. A refused pack (the database already has it) is marked red; tapping it takes it off.
// Run: node test/browser/backstock-shipment.js   (SHOT=dir also saves screenshots)
const assert = require('assert/strict');
const path = require('path');
const { openApp, backendInVm, tapUseThisNumber, showScan, sleep } = require('./harness');

const { ctx, sheets: S, addRow, call } = backendInVm('2026-09-28');
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 2, tickets_in_reserve: 60 });
addRow('ReserveInventory', { game_number: '1650', price_per_ticket: 5, tickets_per_pack: 60, packs_in_reserve: 0, tickets_in_reserve: 0, ended_date: '2026-09-20' });
const reserve = (g) => { const [h, ...rows] = S.ReserveInventory.rows; const r = rows.find((x) => x[0] === g); return r && Object.fromEntries(h.map((k, i) => [k, r[i]])); };
const owner = { username: 'o', role: 'owner' };
const sent = [];

function handle(body) {
  const fn = {
    listBackStock: () => ctx.listBackStock(),
    saveBackStock: () => { sent.push(body); return ctx.saveBackStock(owner, body.mode, body.lines, body.notes); },
  }[body.action];
  return fn ? call(fn) : {};
}

(async () => {
  const app = await openApp({ role: 'owner', handle });
  const { page, base } = app;
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stock .stock-row').length === 1);
  await showScan(page);
  const text = (sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
  const shown = (sel) => page.$eval(sel, (el) => !el.classList.contains('hidden'));
  const enter = async (t) => { await page.$eval('#typed', (el) => { el.value = ''; }); await page.type('#typed', t); await tapUseThisNumber(page); };
  const lineText = (g) => page.$eval(`.ship-line[data-game="${g}"]`, (el) => el.innerText.replace(/\s+/g, ' ').trim());
  const games = () => page.$$eval('.ship-line', (r) => r.map((x) => x.dataset.game));
  const shot = async (name) => { if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, name), fullPage: true }); };

  assert.equal(await text('#modeSwitch .active'), 'Shipment Received');
  assert.equal(await text('#typedBtn'), 'Add Pack');
  // Before the first scan: This Shipment says what to do; no Receive yet.
  assert.equal(await shown('#shipArea'), true); assert.equal(await shown('#receiveBar'), false);
  assert.equal(await text('#shipList'), 'Scan a ticket from every pack in the box. Each pack shows up here as you scan. Tap Receive when they\'re all on the list.');
  assert.equal(await text('#shipSum'), '');
  await shot('shipment-empty.png');

  // 1. One ticket per pack: each adds a pack, no pop-up. Newest game first.
  await enter('1747-1263622-4-075');
  assert.match(await text('#flash'), /Pack 1747-1263622 added\./);
  assert.equal(await lineText('1747'), '1747 $20 · 30 per pack − 1 Pack 1263622');
  await enter('1801-0000101-1-010');
  assert.match(await text('#flash'), /New game: pick its price below/);
  await enter('1747-1263699-4-075');
  assert.match(await text('#flash'), /Pack 1747-1263699 added · 2 packs of this game\./);
  assert.deepEqual(await games(), ['1747', '1801']);
  assert.equal(await lineText('1747'), '1747 $20 · 30 per pack − 2 Packs 1263622 1263699');

  // 2. The same pack again is caught and not counted.
  await enter('1747-1263622-4-070');
  assert.match(await text('#flash'), /Pack 1747-1263622 is already on this shipment\./);
  assert.equal(await page.$eval('#flash', (e) => e.className), 'message error');
  assert.match(await lineText('1747'), /2 Packs/);

  // 3. A typed game number: a pack without a number. − takes the last pack off.
  await enter('1747');
  assert.equal(await lineText('1747'), '1747 $20 · 30 per pack − 3 Packs 1263622 1263699 Typed');
  await page.click('.ship-line[data-game="1747"] .ship-minus');
  assert.match(await lineText('1747'), /2 Packs 1263622 1263699$/);

  // 4. The new game waits for its price; Receive waits too. A price chip fills the usual pack size.
  assert.equal(await text('#shipSum'), '3 Packs · 2 Games');
  assert.equal(await text('#receiveBtn'), 'Pick a Price for 1 New Game');
  assert.equal(await page.$eval('#receiveBtn', (b) => b.disabled), true);
  await page.evaluate(() => [...document.querySelectorAll('.ship-line[data-game="1801"] .choice-chips button')].find((b) => b.textContent === '$10').click());
  assert.equal(await page.$eval('.ship-line[data-game="1801"] input', (i) => i.value), '50');
  assert.equal(await text('#receiveBtn'), 'Receive 3 Packs');
  assert.equal(await text('#shipSum'), '3 Packs · 2 Games · $1,700');   // 2×30×$20 + 50×$10
  // The receive bar sits above the tab bar, not over it.
  const bar = await page.$eval('#receiveBar', (b) => b.getBoundingClientRect().bottom);
  const tabs = await page.$eval('.tabbar', (t) => t.getBoundingClientRect().top);
  assert.ok(bar <= tabs, `bar ${bar} above tab bar ${tabs}`);
  await shot('shipment-list.png');

  // 5. Kept on the phone: a reload opens on Scan with the list as it was. Manage Stock keeps its own list.
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.ship-line').length === 2);
  assert.equal(await text('#viewSwitch .active'), 'Scan');
  await page.click('#modeSwitch button[data-mode="count"]');
  assert.equal(await shown('#shipArea'), false); assert.equal(await shown('#receiveBar'), false);
  await enter('1747');
  assert.equal(await page.$eval('#lines', (el) => el.children.length), 1);
  await page.click('#modeSwitch button[data-mode="shipment"]');
  assert.deepEqual(await games(), ['1747', '1801']);
  assert.equal(await page.$eval('#lines', (el) => el.children.length), 0);

  // 6. Receive: one request with the pack numbers; the sheet counts the packs; a done card; the list is empty again.
  await page.type('#notes', 'inv 77');
  await page.click('#receiveBtn');
  await page.waitForFunction(() => !document.getElementById('shipDone').classList.contains('hidden'));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].lines, [
    { gameNumber: '1747', packs: 2, packNumbers: ['1263622', '1263699'] },
    { gameNumber: '1801', packs: 1, packNumbers: ['0000101'], gamePrice: '10', ticketsPerPack: '50' }]);
  assert.equal(sent[0].notes, 'inv 77');
  assert.equal(reserve('1747').packs_in_reserve, 4);
  assert.deepEqual([reserve('1801').price_per_ticket, reserve('1801').tickets_per_pack, reserve('1801').packs_in_reserve].map(Number), [10, 50, 1]);
  assert.match(await text('#shipDone'), /^Shipment Received 3 packs · 2 games · \$1,700 added to back stock\./);
  assert.match(await text('#shipDone'), /1747 \+2 2 → 4 in the back/);
  assert.equal(await shown('#shipArea'), false); assert.equal(await shown('#receiveBar'), false);
  assert.equal(await page.$eval('#notes', (n) => n.value), '');
  assert.equal(await text('#totals'), '5 packs · $2,900 at ticket price');
  await shot('shipment-done.png');
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#stock .stock-row').length === 2);
  assert.equal(await page.$$eval('.ship-line', (r) => r.length), 0, 'the received list is gone from the phone');

  // 7. An ended game: receiving it brings it back.
  await showScan(page);
  await enter('1650-0000007-1-010');
  assert.match(await text('#flash'), /marked ended; receiving it brings it back/);
  await page.click('#receiveBtn');
  await page.waitForFunction(() => !document.getElementById('shipDone').classList.contains('hidden'));
  assert.equal(reserve('1650').ended_date, ''); assert.equal(reserve('1650').packs_in_reserve, 1);
  await page.click('#shipDone button');
  assert.equal(await shown('#shipDone'), false);
  assert.equal(await shown('#shipArea'), true); assert.match(await text('#shipList'), /^Scan a ticket from every pack/);

  // 8. Refused (the database already has a pack): nothing saved, the pack is red; tapping it takes it off.
  app.setHandle((b) => {
    if (b.action !== 'saveBackStock') return handle(b);
    throw Object.assign(new Error('Pack 1747-1263622 is already in the back (received 2026-09-28).'), { code: 'pack_used' });
  });
  await enter('1747-1263622-4-075'); await enter('1747-1263700-4-075');
  await page.click('#receiveBtn');
  await page.waitForFunction(() => document.getElementById('shipMessage').textContent !== '');
  assert.equal(await text('#shipMessage'), 'Pack 1747-1263622 is already in the back (received 2026-09-28). Tap the red pack to take it off, then Receive again.');
  assert.equal(await page.$eval('.ship-line[data-game="1747"]', (l) => l.classList.contains('refused')), true);
  await page.click('button.ship-pk.refused');
  assert.equal(await lineText('1747'), '1747 $20 · 30 per pack − 1 Pack 1263700');
  assert.equal(await text('#shipMessage'), '');

  // 9. Clear List asks first, then empties the shipment.
  await page.click('#clearBtn');
  assert.match(await text('#shipList'), /^Scan a ticket from every pack/); assert.equal(await shown('#receiveBar'), false);

  // 9b. Other: a price outside the eight (a $50 game) is typed with its pack size, and is received.
  app.setHandle(handle);
  await enter('1900-0000201-1-010');
  const chipTap = (label) => page.evaluate((l) => [...document.querySelectorAll('.ship-line[data-game="1900"] .choice-chips button')].find((b) => b.textContent === l).click(), label);
  const val = (sel) => page.$eval(`.ship-line[data-game="1900"] ${sel}`, (i) => i.value);
  const typeIn = async (sel, v) => { await page.$eval(`.ship-line[data-game="1900"] ${sel}`, (i) => { i.value = ''; }); await page.type(`.ship-line[data-game="1900"] ${sel}`, v); };
  assert.equal(await page.$$eval('.ship-line[data-game="1900"] .choice-chips button', (b) => b.map((x) => x.textContent).join(' ')), '$1 $2 $3 $5 $10 $20 $30 $40 Other');
  await chipTap('Other');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('other-price')), true, 'Other opens the price box');
  assert.equal(await text('#receiveBtn'), 'Pick a Price for 1 New Game');
  await typeIn('input.other-price', '5');                    // one of the eight: the usual size fills in…
  assert.equal(await val('input.other-size'), '80');
  await typeIn('input.other-price', '50');                   // …and follows the price while untouched
  assert.equal(await val('input.other-size'), '');
  assert.equal(await page.$eval('#receiveBtn', (b) => b.disabled), true);
  await typeIn('input.other-size', '20');
  await typeIn('input.other-price', '50');                   // a typed size stays
  assert.equal(await val('input.other-size'), '20');
  assert.equal(await text('#receiveBtn'), 'Receive 1 Pack');
  assert.equal(await text('#shipSum'), '1 Pack · 1 Game · $1,000');
  assert.equal(await text('.ship-line[data-game="1900"] .ship-new-label'), 'Ticket Price');
  await shot('shipment-other.png');
  if (process.env.SHOT) {   // the line as the phone shows it (the Receive bar is fixed, so a full-page shot covers it)
    await page.$eval('.ship-line[data-game="1900"]', (l) => l.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(process.env.SHOT, 'shipment-other-phone.png') });
  }
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.ship-line').length === 1);
  assert.equal(await text('.ship-line[data-game="1900"] .choice-chips .active'), 'Other', 'kept on the phone');
  assert.deepEqual([await val('input.other-price'), await val('input.other-size')], ['50', '20']);
  await chipTap('$30');                                      // a chip leaves Other
  assert.equal(await page.$$eval('.ship-line[data-game="1900"] input.other-price', (i) => i.length), 0);
  assert.equal(await val('input.other-size'), '30');
  await chipTap('Other');                                    // back to Other starts empty
  assert.deepEqual([await val('input.other-price'), await val('input.other-size')], ['', '']);
  await typeIn('input.other-price', '50'); await typeIn('input.other-size', '20');
  sent.length = 0;
  await page.click('#receiveBtn');
  await page.waitForFunction(() => !document.getElementById('shipDone').classList.contains('hidden'));
  assert.deepEqual(sent[0].lines, [{ gameNumber: '1900', packs: 1, packNumbers: ['0000201'], gamePrice: '50', ticketsPerPack: '20' }]);
  assert.deepEqual([reserve('1900').price_per_ticket, reserve('1900').tickets_per_pack, reserve('1900').packs_in_reserve].map(Number), [50, 20, 1]);
  await page.click('#shipDone button');

  // 10. A scan while the finger is still on Press and Hold: the list changes after the lift.
  await page.$eval('#holdBtn', (b) => b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true })));
  await page.$eval('#typed', (el) => { el.value = '1747-1263701-4-075'; });
  await page.$eval('#typedForm', (f) => f.requestSubmit());
  await sleep(300);
  assert.equal(await page.$$eval('.ship-line', (r) => r.length), 0, 'waits for the lift');
  assert.equal(await shown('#shipArea'), true);
  await page.$eval('#holdBtn', (b) => b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));
  await page.waitForFunction(() => document.querySelectorAll('.ship-line').length === 1);
  console.log('SHIPMENT RECEIVED CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
