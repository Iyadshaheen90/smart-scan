// Back Stock list (owner 2026-11-11): grouped by price, highest first, one row per game; games with none in the back
// folded under None in the Back (Order More when still live in a slot); Find a Game filters the list itself.
// Run: node test/browser/backstock-search.js
const assert = require('assert/strict');
const { openApp, tapGameRow, rowText } = require('./harness');

const g = (n, price, packs, liveIn, endedDate = null) => ({ gameNumber: n, price, ticketsPerPack: 30, standardPackSize: 30, packsInBack: packs,
  ticketsInBack: packs * 30, valueInBack: packs * 30 * price, liveSlots: liveIn.length, liveIn, endedDate });
const stock = [g('1747', 20, 3, [{ box: 1, slot: 2 }, { box: 2, slot: 5 }]), g('1718', 20, 0, [{ box: 1, slot: 1 }]), g('1801', 10, 2, []),
  g('1650', 30, 1, [{ box: 1, slot: 9 }]), g('1760', 20, 4, []), g('1622', 5, 0, []), g('1587', 5, 0, [], '2026-10-02')];

(async () => {
  const app = await openApp({ role: 'owner', handle: (body) => (body.action === 'listBackStock' ? stock : {}) });
  const { page, base } = app;
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stock .stock-row').length === 4);
  const text = (sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
  const rows = (sel) => page.$$eval(`${sel} .stock-row`, (r) => r.map((x) => x.dataset.game || x.innerText.slice(0, 4)));
  const shown = (sel) => page.$eval(sel, (el) => !el.classList.contains('hidden'));
  const search = async (q) => { await page.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); }); if (q) await page.type('#search', q); };

  // Opens on the list (Backstock), the camera view hidden and not started.
  assert.equal(await text('#viewSwitch .active'), 'Backstock');
  assert.equal(await shown('#scanView'), false);
  assert.equal(await page.$eval('#video', (v) => Boolean(v.srcObject)), false, 'no camera on the list');

  // A: by price, highest first, each with its packs and value; newest game first inside a price.
  assert.deepEqual(await page.$$eval('#stock .stock-price-head', (h) => h.map((x) => x.innerText.replace(/\s+/g, ' '))),
    ['$30 1 pack · $900', '$20 7 packs · $4,200', '$10 2 packs · $600']);
  assert.deepEqual(await rows('#stock'), ['1650', '1760', '1747', '1801']);
  // B: one row each.
  assert.equal(await rowText(page, '1747'), '1747 3 Packs 2 Live $1,800');
  assert.equal(await rowText(page, '1801'), '1801 2 Packs Not Live $600');
  // C: none in the back, folded; Order More (live in a slot) first; ended games folded on their own.
  assert.equal(await page.$eval('#emptyBox', (d) => d.open), false);
  assert.equal(await text('#emptyBox summary'), 'None in the Back (2) 1 to Order');
  assert.deepEqual(await rows('#empty'), ['1718', '1622']);
  await page.click('#emptyBox summary');
  assert.equal(await rowText(page, '1718'), '1718 1 Live Order More');
  assert.equal(await rowText(page, '1622'), '1622 Not Live');
  await page.click('#emptyBox summary');
  assert.equal(await text('#endedTitle'), 'Ended Games (1)');
  assert.equal(await text('#totals'), '10 packs · $5,700 at ticket price');

  // The pop-up has what the row has no room for.
  await tapGameRow(page, '1747');
  assert.equal(await text('#packInfo'), '90 tickets · $1,800 · 30 per pack');
  assert.equal(await text('#packWhere'), 'On display: Box 1 · Slot 2, Box 2 · Slot 5');
  await page.click('#packCancel');

  // D: one search, one list. Folded lists open when they hold a match.
  await search('17');
  assert.deepEqual(await rows('#stock'), ['1760', '1747']);
  assert.deepEqual(await rows('#empty'), ['1718']);
  assert.equal(await page.$eval('#emptyBox', (d) => d.open), true);
  assert.equal(await shown('#endedBox'), false);
  await search('1587');
  assert.deepEqual(await rows('#stock'), []); assert.equal(await shown('#emptyBox'), false);
  assert.equal(await page.$eval('#endedBox', (d) => d.open), true); assert.match(await text('#ended'), /Ended 2026-10-02/);
  await search('1747-1263622-4-075'); assert.deepEqual(await rows('#stock'), ['1747']);   // a ticket number finds its game
  await search('9999'); assert.equal(await shown('#searchNone'), true); assert.match(await text('#searchNone'), /Game 9999 isn't in back stock/);
  await search('99'); assert.match(await text('#searchNone'), /No game number has 99 in it/);
  await search(''); assert.equal(await shown('#searchNone'), false);
  assert.deepEqual(await rows('#stock'), ['1650', '1760', '1747', '1801']);
  assert.equal(await page.$eval('#emptyBox', (d) => d.open), false, 'back to how the owner left it');

  // Scan starts the camera; back to the list shuts it.
  await page.click('#viewSwitch button[data-view="scan"]');
  await page.waitForFunction(() => Boolean(document.getElementById('video').srcObject));
  assert.equal(await shown('#stockView'), false);
  await page.click('#viewSwitch button[data-view="stock"]');
  // (Switched back while the camera was still opening: it shuts once open.)
  await page.waitForFunction(() => !document.getElementById('video').srcObject, { timeout: 5000 });
  // Scan again: it reopens.
  await page.click('#viewSwitch button[data-view="scan"]');
  await page.waitForFunction(() => Boolean(document.getElementById('video').srcObject), { timeout: 5000 });
  console.log('BACKSTOCK LIST + SEARCH CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
