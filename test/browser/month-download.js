// Months & Totals on the database backend (no spreadsheets, no month to start): every month has a Download Month
// button that makes an Excel file (Summary, one tab per day, Shipments, Back Stock Out) and hands it to the share sheet,
// or downloads it where files can't be shared. The Sheets backend keeps Open Spreadsheet and Start Month.
// Run: node test/browser/month-download.js   (needs the internet for SheetJS on the CDN)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const day = (date, tickets, dollars, inventory, extra = {}) => ({ date, ticketsSold: tickets, dollarsSold: dollars, inventoryValue: inventory, ...extra });
const summary = { label: '2026-10', status: 'active', url: null, days: [day('2026-10-22', 10, 200, 4000), day('2026-10-23', 48, 825, 3800)],
  ticketsSold: 58, dollarsSold: 1025, shipmentValue: 1200, fullPacks: { count: 1, dollars: 600 }, endingInventoryValue: 3800 };
const page = { status: { current: '2026-10', currentUrl: null, next: null, canStart: false }, summary,
  months: [{ label: '2026-10', status: 'active', url: null }, { label: '2026-09', status: 'archived', url: null }] };
const workbook = { storeName: 'Route 66 Liquor', summary,
  days: [
    { ...day('2026-10-22', 10, 200, 4000), closed: true, closedBy: 'o', closedAt: '10:50 PM', lines: [
      { box: 1, slot: 1, gameNumber: '1747', packNumber: '0012345', price: 20, startTicket: 29, endTicket: 19, ticketsSold: 10, dollars: 200, type: 'close', by: 'o' }] },
    { ...day('2026-10-23', 48, 825, 3800), closed: true, closedBy: 'o', closedAt: '10:50 PM', lines: [
      { box: 1, slot: 1, gameNumber: '1747', packNumber: '0012345', price: 20, startTicket: 19, endTicket: 10, ticketsSold: 9, dollars: 180, type: 'close', by: 'o' },
      { box: null, slot: null, gameNumber: '1747', packNumber: '0000500', price: 20, startTicket: 29, endTicket: null, ticketsSold: 30, dollars: 600, type: 'full_pack', by: 'o' },
      { box: 1, slot: 2, gameNumber: '5555', packNumber: '0000042', price: 5, startTicket: 79, endTicket: 70, ticketsSold: 9, dollars: 45, type: 'returned', by: 'o' }] }],
  shipments: [{ date: '2026-10-23', gameNumber: '1747', packs: 2, price: 20, ticketsPerPack: 30, dollars: 1200, addedByHand: false }],
  returns: [{ date: '2026-10-23', gameNumber: '5555', packs: 1, tickets: 80, reason: 'returned', notes: '', by: 'o' }] };

(async () => {
  const calls = [];
  const app = await openApp({ role: 'owner', handle: (b) => {
    calls.push(b);
    if (b.action === 'monthsPage') return page;
    if (b.action === 'monthWorkbook') return workbook;
    return {};
  } });
  const { page: tab, base } = app;
  await tab.goto(base + 'month.html');
  await tab.waitForSelector('button.download-month');
  // No Start box, no "You can start" line, no spreadsheet links; the intro says how months work now.
  assert.equal(await tab.$eval('#startBox', (e) => e.classList.contains('hidden')), true);
  assert.equal(await tab.$eval('#notYet', (e) => e.classList.contains('hidden')), true);
  assert.equal(await tab.$('a[target="_blank"]'), null);
  assert.match(await tab.$eval('#intro', (e) => e.textContent), /Download any month as an Excel file/);
  assert.deepEqual(await tab.$$eval('button.download-month', (bs) => bs.map((b) => [b.textContent, b.dataset.month])),
    [['Download Month', '2026-10'], ['Download Month', '2026-09']]);
  if (process.env.SHOTS) await tab.screenshot({ path: `${process.env.SHOTS}/month-download.png`, fullPage: true });

  // Download: the file goes to the share sheet; open it and check what's inside.
  await tab.evaluate(() => {
    navigator.canShare = (d) => Boolean(d.files);
    navigator.share = async (d) => { window.shared = { name: d.files[0].name, type: d.files[0].type, bytes: [...new Uint8Array(await d.files[0].arrayBuffer())] }; };
  });
  await tab.click('button.download-month[data-month="2026-10"]');
  await tab.waitForFunction(() => window.shared, { timeout: 30000 });
  assert.deepEqual(calls.filter((c) => c.action === 'monthWorkbook').map((c) => c.label), ['2026-10']);
  const opened = await tab.evaluate(() => {
    const book = XLSX.read(new Uint8Array(window.shared.bytes), { type: 'array', cellNF: true });
    const rows = (name) => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null });
    return { name: window.shared.name, type: window.shared.type, sheets: book.SheetNames, summary: rows('Summary'),
      day: rows('Fri, Oct 23'), shipments: rows('Shipments'), out: rows('Back Stock Out'),
      moneyFormat: book.Sheets['Summary'].C5.z };
  });
  assert.equal(opened.name, 'Route 66 Liquor October 2026.xlsx');
  assert.equal(opened.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.deepEqual(opened.sheets, ['Summary', 'Thu, Oct 22', 'Fri, Oct 23', 'Shipments', 'Back Stock Out']);
  assert.deepEqual(opened.summary.slice(0, 2).map((r) => r[0]), ['Route 66 Liquor', 'Scratchers · October 2026']);
  assert.deepEqual(opened.summary[4], ['Thu, Oct 22', 10, 200, 4000, 'o', '10:50 PM']);
  assert.deepEqual(opened.summary[6], ['Total', 58, 1025, 3800, null, null]);
  assert.equal(opened.moneyFormat, '"$"#,##0.00');
  assert.deepEqual(opened.day[2], ['#', 'Box', 'Slot', 'Game', 'Pack', 'Ticket Price', 'Start Ticket', 'End Ticket', 'Tickets Sold', 'Sales', 'Type', 'By']);
  assert.deepEqual(opened.day.slice(3).map((r) => [r[0], r[3], r[8], r[9], r[10]]),
    [[1, '1747', 9, 180, 'Close'], [2, '1747', 30, 600, 'Full Pack'], [3, '5555', 9, 45, 'Returned'], [null, null, 48, 825, null]]);
  assert.deepEqual(opened.shipments[1], ['2026-10-23', '1747', 2, 20, 30, 1200, null]);
  assert.deepEqual(opened.out[1], ['2026-10-23', '5555', 1, 80, 'returned', null, 'o']);

  // A computer that can't share files: it downloads instead.
  await tab.evaluate(() => {
    navigator.canShare = () => false;
    window.downloaded = null;
    HTMLAnchorElement.prototype.click = function () { window.downloaded = this.download; };
  });
  await tab.click('button.download-month[data-month="2026-09"]');
  await tab.waitForFunction(() => window.downloaded);
  assert.equal(await tab.evaluate(() => window.downloaded), 'Route 66 Liquor September 2026.xlsx');
  await app.close();
  console.log('Download Month: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
