// Back stock "Find a game": typing a game number shows packs in the back and where it's on display.
// Run: node test/browser/backstock-search.js
const assert = require('assert/strict');
const { openApp } = require('./harness');

const g = (n, price, packs, liveIn) => ({ gameNumber: n, price, ticketsPerPack: 30, standardPackSize: 30, packsInBack: packs,
  ticketsInBack: packs * 30, valueInBack: packs * 30 * price, liveSlots: liveIn.length, liveIn, endedDate: null });
const stock = [g('1747', 20, 3, [{ box: 1, slot: 2 }, { box: 2, slot: 5 }]), g('1718', 20, 0, [{ box: 1, slot: 1 }]), g('1801', 10, 2, [])];

(async () => {
  const app = await openApp({ role: 'owner', handle: (body) => (body.action === 'listBackStock' ? stock : {}) });
  const { page, base } = app;
  await page.goto(base + 'backstock.html'); await page.waitForFunction(() => document.querySelectorAll('#stock .card').length === 3);
  const results = () => page.$eval('#searchResults', (el) => el.innerText);
  const search = async (q) => { await page.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); }); await page.type('#search', q); return results(); };
  let r = await search('1747'); console.log('1747 →', JSON.stringify(r)); assert.match(r, /3 packs/); assert.match(r, /Box 1 · Slot 2, Box 2 · Slot 5/);
  r = await search('17'); assert.equal((await page.$$('#searchResults .card')).length, 2);
  r = await search('1718'); console.log('1718 →', JSON.stringify(r)); assert.match(r, /none in the back/);
  r = await search('1801'); assert.match(r, /Not in any slot/);
  r = await search('9999'); console.log('9999 →', JSON.stringify(r)); assert.match(r, /isn't in back stock/);
  r = await search('1747-1263622-4-075'); assert.match(r, /Game 1747/);
  r = await search(''); assert.equal(r, '');
  console.log('SEARCH CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
