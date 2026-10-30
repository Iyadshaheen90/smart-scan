// Reports tab (owner 2026-10-13): the tab opens reports.html, which lists Months & Totals, Shipments Received and
// Returned Packs with this month's numbers; each report has a ‹ Reports pill back to the list. Shipments Received and
// Returned Packs show one card per line (combined same-day lines, tags, stats) and their totals.
// Real backend code on an in-memory sheet. Run: node test/browser/reports.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const { openApp, backendInVm, sleep } = require('./harness');

const { ctx, sheets: S, addRow, call } = backendInVm('2026-10-06');
const owner = { username: 'o', role: 'owner' };
addRow('SlotConfig', { box: 1, slot_number: 5, price_per_ticket: 20 });
addRow('SlotState', { box: 1, slot_number: 5 });
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 2, tickets_in_reserve: 60 });
addRow('ReserveInventory', { game_number: '1111', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 3, tickets_in_reserve: 150 });
addRow('DailySummary', { close_date: '2026-10-05', total_dollars_sold: 1234 });

function handle(b) {
  const fn = {
    reportsPage: () => ctx.reportsPage(),
    listShipments: () => ctx.listShipments(),
    listReturns: () => ctx.listReturns(),
    monthsPage: () => ({ status: { current: '2026-10', next: '2026-11', canStart: false }, summary: { label: '2026-10', status: 'active', days: [], ticketsSold: 0, dollarsSold: 1234, shipmentValue: 0, fullPacks: { count: 0, dollars: 0 }, endingInventoryValue: null }, months: [] }),
  }[b.action];
  return fn ? call(fn) : {};
}
const text = (page, sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
const cards = (page) => page.$$eval('#list .card', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
const loaded = (page) => page.waitForFunction(() => !document.body.classList.contains('showing-saved') && document.querySelector('#list, #returnNums') && !/…/.test(document.body.innerText));
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });

(async () => {
  const app = await openApp({ role: 'owner', handle });
  const { page, base } = app;

  // Empty month.
  await page.goto(base + 'reports.html'); await loaded(page);
  assert.match(await text(page, 'a[href="month.html"]'), /Months & Totals \$1,234 Sold$/);
  assert.match(await text(page, 'a[href="shipments.html"]'), /Shipments Received 0 Packs · \$0$/);
  assert.match(await text(page, 'a[href="returns.html"]'), /Returned Packs 0 Packs · \$0$/);
  await page.goto(base + 'shipments.html'); await loaded(page);
  assert.match(await text(page, '#list'), /No shipments received this month yet\./);
  await page.goto(base + 'returns.html'); await loaded(page);
  assert.match(await text(page, '#list'), /No packs returned this month yet\./);

  // Shipments: 2 packs of 1747 on Oct 5; today 1 + 2 more of 1747 (one line of 3) and 1 of 1111 by hand.
  ctx.saveBackStock(owner, 'shipment', [{ gameNumber: '1747', packs: 2 }]);
  S.Shipments.rows.at(-1)[0] = '2026-10-05';
  ctx.saveBackStock(owner, 'shipment', [{ gameNumber: '1747', packs: 1 }]);
  ctx.saveBackStock(owner, 'shipment', [{ gameNumber: '1747', packs: 2 }]);
  ctx.adjustBackStock(owner, { gameNumber: '1111', change: 1 });
  // Returns: a slot pack returned with 21 tickets left; 2 sealed packs of 1111 from the back.
  ctx.activatePack(owner, { box: 1, slot: 5, gameNumber: '1747', packNumber: '0000001', ticketNumber: 29 });
  ctx.endPack(owner, { box: 1, slot: 5, reason: 'returned', ticketNumber: 20 });
  ctx.removeBackStock(owner, { gameNumber: '1111', packs: 2, reason: 'returned' });

  // The Reports tab opens the list.
  await page.goto(base + 'index.html'); await sleep(200);
  assert.equal(await page.$eval('nav.tabbar a[data-tab="reports"]', (a) => a.getAttribute('href')), 'reports.html');
  await page.goto(base + 'reports.html'); await loaded(page);
  assert.equal(await page.$eval('nav.tabbar a.active', (a) => a.dataset.tab), 'reports');
  assert.equal(await page.$('.app-header .back'), null); // a tab: no back pill
  assert.match(await text(page, 'a[href="shipments.html"]'), /6 Packs · \$3,500$/);
  assert.match(await text(page, 'a[href="returns.html"]'), /3 Packs · \$1,420$/);
  await shot(page, 'reports');

  // Shipments Received: one card per day; a day opens its games numbered 1 to N in a table.
  const rows = (page) => page.$$eval('.report-table tr', (trs) => trs.map((tr) => [...tr.cells].map((td) => td.innerText.replace(/\s+/g, ' ').trim())));
  const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await Promise.all([page.waitForNavigation(), page.click('a[href="shipments.html"]')]); await loaded(page);
  assert.equal(await text(page, '#packCount'), '6 Packs');
  assert.equal(await text(page, '#dollarCount'), '$3,500');
  let c = await cards(page);
  assert.deepEqual(c, ['Tue, Oct 6 $2,300 2 Games · 4 Packs', 'Mon, Oct 5 $1,200 1 Game · 2 Packs']);
  assert.equal(await page.$$eval('#list a.card svg', (els) => els.length), 2); // chevron on each day
  await shot(page, 'shipments');
  assert.equal(await text(page, '.app-header .back'), 'Reports');
  await Promise.all([page.waitForNavigation(), page.click('#list a.card')]); await loaded(page);
  assert.ok(page.url().endsWith('shipments.html?date=2026-10-06'));
  assert.equal(await text(page, '#dayTitle'), 'Tue, Oct 6');
  assert.equal(await text(page, '#packCount'), '4 Packs'); assert.equal(await text(page, '#packLabel'), 'Packs This Day');
  assert.equal(await text(page, '#dollarCount'), '$2,300');
  assert.deepEqual(await rows(page), [
    ['#', 'Game', 'Packs', 'Ticket Price', 'Pack Size', 'Total Value'],
    ['1', '1111 Added by Hand', '1', '$10', '50', '$500'],
    ['2', '1747', '3', '$20', '30', '$1,800'],
    ['', 'Total', '4', '', '', '$2,300'],
  ]);
  assert.ok(await noSideScroll(page));
  await shot(page, 'shipments-day');
  // Its pill goes back to Shipments Received, which still has the Reports pill.
  assert.equal(await text(page, '.app-header .back'), 'Shipments Received');
  await Promise.all([page.waitForNavigation(), page.click('.app-header .back')]);
  assert.ok(page.url().endsWith('/shipments.html'));
  await loaded(page);
  await Promise.all([page.waitForNavigation(), page.click('.app-header .back')]);
  assert.ok(page.url().endsWith('reports.html'));
  // A day with nothing (e.g. an old link).
  await page.goto(base + 'shipments.html?date=2026-10-01'); await loaded(page);
  assert.match(await text(page, '#list'), /Nothing received on this day\./);

  // Returned Packs: same, with slot returns (tickets) and sealed packs from the back.
  await page.goto(base + 'returns.html'); await loaded(page);
  assert.equal(await text(page, '#packCount'), '3 Packs');
  assert.equal(await text(page, '#dollarCount'), '$1,420');
  c = await cards(page);
  assert.deepEqual(c, ['Tue, Oct 6 $1,420 2 Games · 3 Packs']);
  assert.equal(await text(page, '.app-header .back'), 'Reports');
  await shot(page, 'returns');
  await Promise.all([page.waitForNavigation(), page.click('#list a.card')]); await loaded(page);
  assert.ok(page.url().endsWith('returns.html?date=2026-10-06'));
  assert.deepEqual(await rows(page), [
    ['#', 'Game', 'Returned', 'Ticket Price', 'Pack Size', 'Total Value'],
    ['1', '1111 From the Back', '2 packs', '$10', '50', '$1,000'],
    ['2', '1747 Pack 0000001 · Box 1 Slot 5', '21 tickets', '$20', '30', '$420'],
    ['', 'Total', '3 packs', '', '', '$1,420'],
  ]);
  assert.ok(await noSideScroll(page));
  await shot(page, 'returns-day');
  assert.equal(await text(page, '.app-header .back'), 'Returned Packs');
  await Promise.all([page.waitForNavigation(), page.click('.app-header .back')]);
  assert.ok(page.url().endsWith('/returns.html'));

  // Months & Totals has the pill too, and the Reports tab stays lit.
  await page.goto(base + 'month.html'); await sleep(400);
  assert.equal(await page.$eval('.app-header .back', (a) => a.getAttribute('href')), 'reports.html');
  assert.equal(await page.$eval('nav.tabbar a.active', (a) => a.dataset.tab), 'reports');

  // Numbers never cut off, even huge ones.
  for (const url of ['reports.html', 'shipments.html', 'returns.html', 'shipments.html?date=2026-10-06', 'returns.html?date=2026-10-06']) {
    await page.goto(base + url); await loaded(page);
    const clipped = await page.$$eval('.fit', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    assert.deepEqual(clipped, [], url);
  }
  console.log('REPORTS CHECKS PASS');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
