// Full pack sales page (owner): this month's packs sold whole from the back (count, $) and one card per sale with
// the day, game, pack, ticket price, pack size and value; Undo while that day isn't closed; Sell a full pack opens
// Back stock in Full pack sale mode. Runs the real backend on an in-memory sheet.
// Run: node test/browser/full-packs.js   (SHOT=file saves a screenshot)
const assert = require('assert/strict');
const { openApp, backendInVm, sleep } = require('./harness');

const { ctx, sheets: S, addRow, call } = backendInVm('2026-10-05');
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 3, tickets_in_reserve: 90 });
addRow('ReserveInventory', { game_number: '1111', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 1, tickets_in_reserve: 50 });
const owner = { username: 'o', role: 'owner' };
ctx.sellFullPack(owner, { gameNumber: '1747', packNumber: '0000001' });
ctx.sellFullPack(owner, { gameNumber: '1111', packNumber: '0000009' });
const packs = (g) => S.ReserveInventory.rows.find((x) => x[0] === g)[3];

function handle(body) {
  const fn = {
    listFullPackSales: () => ctx.listFullPackSales(),
    undoFullPackSale: () => ctx.undoFullPackSale(body),
  }[body.action];
  return fn ? call(fn) : {};
}

(async () => {
  const app = await openApp({ role: 'owner', handle });
  const { page, base } = app;
  const cards = () => page.$$eval('#list .card', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
  await page.goto(base + 'full-packs.html'); await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 2);
  assert.equal(await page.$eval('#packCount', (el) => el.textContent), '2 packs');
  assert.equal(await page.$eval('#dollarCount', (el) => el.textContent), '$1,100');
  let c = await cards();
  // newest first; every useful detail on the card
  assert.match(c[0], /Mon, Oct 5/); assert.match(c[0], /Game 1111 · Pack 0000009/);
  assert.match(c[0], /\$10 Ticket price/); assert.match(c[0], /50 Pack size/); assert.match(c[0], /\$500 Total value/);
  assert.match(c[1], /Game 1747 · Pack 0000001/); assert.match(c[1], /\$600/);
  assert.equal(await page.$eval('a.button.primary', (a) => a.getAttribute('href')), 'backstock.html?mode=fullpack');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  // Undo puts the pack back in the back and drops it from the list.
  assert.equal(packs('1111'), 0);
  await page.click('#list .card button');
  await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 1);
  assert.equal(packs('1111'), 1);
  assert.match(await page.$eval('#message', (el) => el.textContent), /game 1111 has 1 pack in the back again/);
  assert.equal(await page.$eval('#dollarCount', (el) => el.textContent), '$600');

  // After that day's close: no Undo.
  addRow('DailySummary', { close_date: '2026-10-05', total_dollars_sold: 600 });
  await page.reload(); await page.waitForFunction(() => !document.body.classList.contains('showing-saved'));
  await sleep(100);
  assert.equal(await page.$$eval('#list .card button', (els) => els.length), 0);

  // Empty month.
  S.DailyCloseLog.rows.splice(1);
  await page.reload(); await page.waitForFunction(() => !document.body.classList.contains('showing-saved'));
  await page.waitForFunction(() => document.getElementById('list').innerText.includes('No full packs sold this month yet.'));
  assert.equal(await page.$eval('#packCount', (el) => el.textContent), '0 packs');
  console.log('FULL PACKS PAGE CHECKS PASS');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
