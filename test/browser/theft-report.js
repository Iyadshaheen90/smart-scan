// Theft Report (owner's request 2026-10-23): a card on Reports opens theft-report.html; pick Live Scratchers or Full
// Inventory, Make Report, and it lists each pack's game, pack and unsold ticket range at the last close (plus back stock
// for Full Inventory), with Share (text) and Print / Save PDF. Employees with the Theft Report permission get it from
// their home, without dollar amounts; without it they're sent home.
// Real backend code on an in-memory sheet. Run: node test/browser/theft-report.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const { openApp, backendInVm, sleep } = require('./harness');

const { ctx, addRow, call } = backendInVm('2026-10-23', () => '07:12:00');
addRow('SlotConfig', { box: 1, slot_number: 1, price_per_ticket: 20 });
addRow('SlotConfig', { box: 1, slot_number: 2, price_per_ticket: 10, ticket_order: 'ascending' });
addRow('SlotState', { box: 1, slot_number: 1, pack_key: '1747-0012345', game_number: '1747', pack_number: '0012345',
  price_per_ticket: 20, current_exposed_ticket_number: 24, activation_date: '2026-10-01', last_close_date: '2026-10-22' });
addRow('SlotState', { box: 1, slot_number: 2, pack_key: '1111-0000777', game_number: '1111', pack_number: '0000777',
  price_per_ticket: 10, current_exposed_ticket_number: 10, activation_date: '2026-10-10', last_close_date: '',
  ticket_order: 'ascending' });
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 2, tickets_in_reserve: 60 });
addRow('ReserveInventory', { game_number: '1111', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 0, tickets_in_reserve: 0 });
addRow('DailySummary', { close_date: '2026-10-22', closed_by: 'sara', closed_at: '2026-10-22 22:52' });

let failNext = false;
const handler = (user) => (b) => {
  if (b.action === 'theftReport') {
    if (failNext) { failNext = false; const e = new Error('No connection. Check the Wi-Fi and try again.'); e.code = 'network'; throw e; }
    return call(() => ctx.theftReport(user, b));
  }
  if (b.action === 'reportsPage') return { monthDollars: 0, shipments: { packs: 0, dollars: 0 }, returns: { packs: 0, dollars: 0 } };
  if (b.action === 'closeStatus') return { today: '2026-10-23', closed: null, slots: [], permissions: user.permissions || [] };
  return {};
};
const text = (page, sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
const shown = (page, sel) => page.$eval(sel, (el) => !el.classList.contains('hidden') && el.offsetParent !== null);
const rows = (page, sel) => page.$$eval(`${sel} .report-table tr`, (trs) => trs.map((tr) => [...tr.cells].map((td) => td.innerText.replace(/\s+/g, ' ').trim())));
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
const made = (page) => page.waitForFunction(() => !document.getElementById('report').classList.contains('hidden'));

(async () => {
  // ---- Owner ----
  let app = await openApp({ role: 'owner', handle: handler({ username: 'o', role: 'owner' }) });
  let { page, base } = app;
  await page.goto(base + 'reports.html'); await sleep(300);
  assert.match(await text(page, 'a[href="theft-report.html"]'), /Theft Report Packs and Tickets to Stop/);
  await Promise.all([page.waitForNavigation(), page.click('a[href="theft-report.html"]')]);
  assert.equal(await text(page, '.app-header .back'), 'Reports');
  // Live Scratchers is chosen at first; nothing is asked for until Make Report.
  assert.equal(await page.$eval('input[name="kind"]:checked', (i) => i.value), 'live');
  assert.equal(await shown(page, '#report'), false);
  await shot(page, 'theft-choice');

  await page.click('#makeBtn'); await made(page);
  assert.equal(await text(page, '#storeName'), 'ROUTE 66 LIQUOR');
  assert.equal(await text(page, '#reportTitle'), 'Theft Report · Live Scratchers');
  assert.equal(await text(page, '#madeAt'), 'Made Fri, Oct 23, 2026, 7:12 AM');
  assert.equal(await text(page, '#sinceClose'), 'Since Last Close: Thu, Oct 22, 2026, 10:52 PM by sara');
  assert.equal(await text(page, '#totals'), '2 Packs 65 Unsold Tickets $900 Total Value');
  assert.deepEqual(await rows(page, '#liveList'), [
    ['#', 'Game / Pack', 'Unsold Tickets', 'Left', 'Value'],
    ['1', '1747 0012345 Box 1 · Slot 1', '000–024', '25', '$500'],
    ['2', '1111 0000777 Box 1 · Slot 2 · Put In Since Close', '010–049', '40', '$400'],
    ['', 'Total', '', '65', '$900'],
  ]);
  assert.equal(await shown(page, '#backSection'), false, 'live only: no back stock');
  assert.ok(await noSideScroll(page), 'fits a phone');
  await shot(page, 'theft-live');

  // Share sends the report as text.
  await page.evaluate(() => { navigator.share = async (d) => { window.shared = d; }; });
  await page.click('#shareBtn'); await sleep(100);
  const shared = await page.evaluate(() => window.shared);
  assert.equal(shared.title, 'Theft Report');
  assert.equal(shared.text, [
    'THEFT REPORT · LIVE SCRATCHERS', 'Route 66 Liquor', 'Made Fri, Oct 23, 2026, 7:12 AM',
    'Since Last Close: Thu, Oct 22, 2026, 10:52 PM by sara', '',
    'LIVE PACKS IN SLOTS (2 packs)',
    '1. Game 1747 · Pack 0012345 · Tickets 000–024 (25 unsold) · $500',
    '2. Game 1111 · Pack 0000777 · Tickets 010–049 (40 unsold) · $400',
    'Total: 2 packs · 65 tickets · $900',
  ].join('\n'));
  // No share sheet (a computer): copied instead.
  await page.evaluate(() => { delete navigator.share; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    navigator.clipboard.writeText = async (t) => { window.copied = t; }; });
  await page.click('#shareBtn'); await sleep(100);
  assert.match(await page.evaluate(() => window.copied), /^THEFT REPORT · LIVE SCRATCHERS/);
  assert.match(await text(page, '#shareMessage'), /Copied\./);

  // Print / Save PDF on a phone (owner 2026-10-23: the home-screen app ignores window.print()): a PDF file goes to the
  // share sheet, which has Print and Save to Files.
  await page.evaluate(() => {
    window.print = () => { window.printed = true; };
    navigator.canShare = (d) => Boolean(d.files);
    // (The copy test above made navigator.share a fixed undefined, so it's redefined rather than assigned.)
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => {
      const f = d.files[0];
      const bytes = new Uint8Array(await f.arrayBuffer());
      window.sharedPdf = { name: f.name, type: f.type, title: d.title, text: String.fromCharCode(...bytes) };
    } });
  });
  await page.click('#printBtn'); await sleep(200);
  const pdf = await page.evaluate(() => window.sharedPdf);
  assert.equal(await page.evaluate(() => window.printed), undefined, 'no window.print when the PDF can be shared');
  assert.deepEqual([pdf.name, pdf.type, pdf.title], ['Theft Report 2026-10-23.pdf', 'application/pdf', 'Theft Report']);
  assert.match(pdf.text, /^%PDF-1\.4/);
  assert.match(pdf.text, /%%EOF\n$/);
  // WinAnsi bytes: · = \xB7, – = \x96.
  for (const part of ['(ROUTE 66 LIQUOR)', '(Theft Report \xB7 Live Scratchers)', '(Made Fri, Oct 23, 2026, 7:12 AM)',
    '(0012345)', '(000\x96024)', '(010\x96049)', '(Put in since close)', '($900)', '(2 Packs \xB7 65 Unsold Tickets \xB7 $900 Total Value)',
    '(Theft Report \xB7 Route 66 Liquor \xB7 Page 1 of 1)']) assert.ok(pdf.text.includes(part), part);
  assert.ok(!pdf.text.includes('Back Stock'), 'live only');
  // The xref table points at each object.
  const xrefAt = Number(pdf.text.match(/startxref\n(\d+)/)[1]);
  assert.ok(pdf.text.startsWith('xref', xrefAt));
  for (const [, at] of pdf.text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)) assert.match(pdf.text.slice(Number(at)), /^\d+ 0 obj/);
  if (process.env.SHOTS) require('fs').writeFileSync(`${process.env.SHOTS}/theft-live.pdf`, Buffer.from(pdf.text, 'latin1'));

  // A computer that can't share files: the browser's print, showing only the report (no header, tab bar, choices or buttons).
  await page.evaluate(() => { navigator.canShare = () => false; });
  await page.click('#printBtn');
  assert.equal(await page.evaluate(() => window.printed), true);
  await page.emulateMediaType('print');
  const hidden = await page.evaluate(() => ['.app-header', '.tabbar', '#makeBtn', '#shareBtn', '.radio-list']
    .map((s) => document.querySelector(s).getClientRects().length === 0));
  assert.deepEqual(hidden, [true, true, true, true, true]);
  assert.equal(await page.evaluate(() => document.getElementById('liveList').getClientRects().length > 0), true, 'the report prints');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
  await page.emulateMediaType('screen');

  // Choosing the other kind hides the report made for the first one; Full Inventory adds back stock.
  await page.click('label.radio-card:nth-child(2)');
  assert.equal(await shown(page, '#report'), false);
  await page.click('#makeBtn'); await made(page);
  assert.equal(await text(page, '#reportTitle'), 'Theft Report · Full Inventory');
  assert.equal(await text(page, '#totals'), '4 Packs 125 Unsold Tickets $2,100 Total Value');
  assert.match(await text(page, '#backSection'), /Pack numbers for back stock aren't tracked yet/);
  assert.deepEqual(await rows(page, '#backList'), [
    ['#', 'Game', 'Packs', 'Tickets', 'Value'],
    ['1', '1747 $20 · 30 a Pack', '2', '60', '$1,200'],
    ['', 'Total', '2', '60', '$1,200'],
  ]);
  assert.ok(await noSideScroll(page));
  await shot(page, 'theft-full');
  await page.evaluate(() => { navigator.canShare = (d) => Boolean(d.files); });
  await page.click('#printBtn'); await sleep(200);
  const full = await page.evaluate(() => window.sharedPdf.text);
  for (const part of ['(Theft Report \xB7 Full Inventory)', '(Back Stock)', '(Pack Size)', '($1,200)', '(4 Packs \xB7 125 Unsold Tickets \xB7 $2,100 Total Value)'])
    assert.ok(full.includes(part), part);
  if (process.env.SHOTS) require('fs').writeFileSync(`${process.env.SHOTS}/theft-full.pdf`, Buffer.from(full, 'latin1'));

  // No connection: the reason and Try again at the top, no report; Try again makes it.
  failNext = true;
  await page.click('#makeBtn'); await sleep(300);
  assert.equal(await shown(page, '#report'), false);
  assert.match(await text(page, '#loadMessage'), /No connection/);
  await page.click('#loadMessage .try-again'); await made(page);
  assert.equal(await text(page, '#loadMessage'), '');
  await app.close();

  // ---- Employee with Theft Report: from home, back pill Home, no dollar amounts ----
  const sara = { username: 'sara', role: 'employee', permissions: ['theft_report'] };
  app = await openApp({ role: 'employee', username: 'sara', permissions: ['theft_report'], handle: handler(sara) });
  ({ page, base } = app);
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => !document.getElementById('extraActions').classList.contains('hidden'));
  await Promise.all([page.waitForNavigation(), page.click('#extraActions a[href="theft-report.html"]')]);
  assert.equal(await text(page, '.app-header .back'), 'Home');
  await page.click('label.radio-card:nth-child(2)');
  await page.click('#makeBtn'); await made(page);
  assert.equal(await text(page, '#totals'), '4 Packs 125 Unsold Tickets');
  assert.deepEqual((await rows(page, '#liveList'))[0], ['#', 'Game / Pack', 'Unsold Tickets', 'Left']);
  assert.deepEqual((await rows(page, '#backList'))[0], ['#', 'Game', 'Packs', 'Tickets']);
  const body = await page.evaluate(() => document.body.innerText.replace(/\$20 · 30 a Pack|\$10 · 50 a Pack/g, ''));
  assert.ok(!/\$\d/.test(body), `no dollar amounts\n${body}`);
  await page.evaluate(() => { navigator.share = async (d) => { window.shared = d; }; });
  await page.click('#shareBtn'); await sleep(100);
  assert.ok(!/\$/.test(await page.evaluate(() => window.shared.text)), 'shared text has no $');
  await shot(page, 'theft-employee');
  await app.close();

  // ---- Employee without it: sent home ----
  app = await openApp({ role: 'employee', permissions: ['load_packs'], handle: handler({ username: 'e', role: 'employee' }) });
  await app.page.goto(app.base + 'theft-report.html');
  await app.page.waitForFunction(() => location.pathname.endsWith('index.html'));
  await app.close();

  // A full store (48 live packs, 30 games in the back) runs onto more pages; each page repeats the table's head row.
  const big = { full: true, madeAt: '2026-10-23 07:12', lastClose: { date: '2026-10-22' },
    live: { lines: Array.from({ length: 48 }, (_, i) => ({ box: 1 + Math.floor(i / 24), slot: 1 + (i % 24), gameNumber: String(1700 + i),
      packNumber: String(1000000 + i), order: 'descending', price: 20, fromTicket: 0, toTicket: 29, tickets: 30, dollars: 600, newSinceClose: false })),
    packs: 48, tickets: 1440, dollars: 28800 },
    back: { lines: Array.from({ length: 30 }, (_, i) => ({ gameNumber: String(1800 + i), price: 10, ticketsPerPack: 50, packs: 2, tickets: 100, dollars: 1000 })),
      packs: 60, tickets: 3000, dollars: 30000 } };
  app = await openApp({ role: 'owner', handle: (b) => (b.action === 'theftReport' ? big : {}) });
  ({ page, base } = app);
  await page.goto(base + 'theft-report.html');
  await page.click('label.radio-card:nth-child(2)');
  await page.click('#makeBtn'); await made(page);
  await page.evaluate(() => {
    navigator.canShare = (d) => Boolean(d.files);
    navigator.share = async (d) => { window.sharedPdf = String.fromCharCode(...new Uint8Array(await d.files[0].arrayBuffer())); };
  });
  await page.click('#printBtn'); await sleep(300);
  const bigPdf = await page.evaluate(() => window.sharedPdf);
  const pages = Number(bigPdf.match(/\/Count (\d+)/)[1]);
  assert.ok(pages >= 3, `${pages} pages`);
  assert.ok(bigPdf.includes(`(Theft Report \xB7 Route 66 Liquor \xB7 Page ${pages} of ${pages})`));
  assert.equal((bigPdf.match(/\(Unsold Tickets\)/g) || []).length >= 2, true, 'head row repeated on the next page');
  for (const n of ['(1747)', '(1000047)', '(1829)', '($28,800)', '($30,000)']) assert.ok(bigPdf.includes(n), n);
  if (process.env.SHOTS) require('fs').writeFileSync(`${process.env.SHOTS}/theft-big.pdf`, Buffer.from(bigPdf, 'latin1'));
  await app.close();

  console.log('theft report page: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
