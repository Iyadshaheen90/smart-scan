// The move from the sheets, end to end on made-up data: September and October run on the real Sheets code (fake
// spreadsheets, Start New Month in between), then exportMonth hands each month over, the months rebuilt from that export
// must answer like the originals, scripts/import-map.js turns them into rows, and scripts/import-compare.js imports them
// into a throwaway test store on smart-scan-dev and checks every read the pages use answers the same on both sides at
// the same moment. Needs the Supabase CLI signed in and linked (CLAUDE.md "Supabase").
// Run: node test/import-check.js
const assert = require('assert/strict');
const { buildImport } = require('../scripts/import-map');
const { sheetsVm, compareOnDev, noSheets, plain } = require('../scripts/import-compare');
const { fakeSheet, fakeSpreadsheet } = require('./fakes');

// ---------- Sheets: two months of a small store ----------

// The store's clock: a minute later each step, so logged times run in order.
const CLOCK = { today: '2026-09-28', minute: 9 * 60 };
const at = (today, hhmm) => { CLOCK.today = today; const [h, m] = hhmm.split(':').map(Number); CLOCK.minute = h * 60 + m; };
const sheets = sheetsVm(CLOCK);
const { ctx, google, control } = sheets;
const run = (code) => { CLOCK.minute += 1; return sheets.run(code); };
const MONTHLY_TABS = sheets.tabs;

const ALL = ['load_packs', 'return_packs', 'receive_shipments', 'count_stock', 'full_pack_sale', 'ticket_order', 'theft_report'];
const PEOPLE = { o: { role: 'owner', permissions: [] }, e: { role: 'employee', permissions: ['load_packs'] },
  sara: { role: 'employee', permissions: ALL }, gone: { role: 'employee', permissions: [], active: false } };
Object.assign(ctx, Object.fromEntries(Object.entries(PEOPLE).map(([u, p]) => [u, { username: u, ...p }])));

const sep = google.add('Smart Scan — 2026-09', fakeSpreadsheet('sep', Object.fromEntries(
  Object.entries(MONTHLY_TABS).map(([n, h]) => [n, fakeSheet(h, null, 500)]))));
for (const [u, p] of Object.entries(PEOPLE)) {
  sep.tabs.Users.rows.push([u, 'hash', 'salt', p.role, p.active !== false, '2026-09-22', p.permissions.join(',')]);
}
sep.tabs.SlotConfig.rows.push([1, 1, 20, ''], [1, 2, 10, ''], [1, 3, 5, ''], [1, 4, 5, '']);
sep.tabs.SlotState.rows.push([1, 1], [1, 2], [1, 3], [1, 4]);
sep.tabs.ReserveInventory.rows.push(['1747', 20, 30, 3, 90, ''], ['1111', 10, 50, 3, 150, ''], ['5555', 5, 80, 2, 160, ''],
  ['9999', 5, 80, 1, 80, '']);
control.tabs.Months.appendRow(['2026-09', 'sep', '2026-09-22', 'active']);

const slotOf = (n) => run('listSlots()').find((x) => x.box === 1 && x.slot === n);
const entries = (tickets) => JSON.stringify(Object.entries(tickets).map(([s, t]) => {
  const x = slotOf(Number(s));
  return { box: 1, slot: Number(s), packKey: `${x.pack.gameNumber}-${x.pack.packNumber}`, type: t === 'out' ? 'sold_out' : 'scan',
    ...(t === 'out' ? {} : { ticketNumber: t }) };
}));
const activate = (who, s, game, pack, t) => run(`activatePack(${who}, ${JSON.stringify({ box: 1, slot: s, gameNumber: game, packNumber: pack, ticketNumber: t, overridePrice: true })})`);
let closes = 0;
const close = (who, tickets) => run(`submitClose(${who}, ${entries(tickets)}, 'close-${++closes}')`);
const shift = (who, id, tickets) => run(`submitShiftClose(${who}, ${entries(tickets)}, '${id}', '${CLOCK.today}')`);

at('2026-09-28', '09:00');
activate('o', 1, '1747', '0000001', 29);
activate('sara', 2, '1111', '0000001', 49);
at('2026-09-28', '22:50'); close('e', { 1: 25, 2: 45 });

at('2026-09-29', '10:00');
run(`saveBackStock(sara, 'shipment', [{ gameNumber: '5555', packs: 1 }, { gameNumber: '4242', packs: 2, gamePrice: 2, ticketsPerPack: 100 }], 'Tuesday delivery')`);
run(`sellFullPack(sara, { gameNumber: '9999', packNumber: '0000007' })`);
at('2026-09-29', '16:00'); shift('e', 'shift-1', { 1: 22, 2: 44 });
at('2026-09-29', '22:45'); close('e', { 1: 20, 2: 40 });
at('2026-09-29', '22:55');
run(`endPack(o, { box: 1, slot: 1, reason: 'sold_out' })`);
activate('o', 3, '5555', '0000001', 79);
run(`removeBackStock(o, { gameNumber: '1111', packs: 1, reason: 'damaged' })`);

at('2026-09-30', '11:00');
run(`endPack(sara, { box: 1, slot: 2, reason: 'returned', ticketNumber: 38 })`);
activate('sara', 2, '1111', '0000002', 49);
run(`setSlotOrder(sara, { box: 1, slot: 4, order: 'ascending' })`);
activate('o', 4, '4242', '0000003', 0);
at('2026-09-30', '22:40'); close('sara', { 2: 47, 3: 70, 4: 10 });

// October 1: nobody has started October, so the day is closed in September's sheet; Oct 2 the owner starts it and
// everything dated October moves across.
at('2026-10-01', '22:30'); close('e', { 2: 45, 3: 65, 4: 20 });
at('2026-10-02', '08:00');
run(`startNewMonth({ label: '2026-10' })`);
at('2026-10-02', '12:00');
run(`saveBackStock(sara, 'shipment', [{ gameNumber: '1747', packs: 2 }], '')`);
activate('o', 1, '1747', '0000009', 29);
run(`endGame('9999')`);
at('2026-10-02', '17:00'); shift('sara', 'shift-2', { 1: 27, 2: 44, 3: 60, 4: 25 });
at('2026-10-02', '22:50'); close('e', { 1: 24, 2: 40, 3: 'out', 4: 30 });
at('2026-10-03', '10:00');
run(`sellFullPack(sara, { gameNumber: '1747', packNumber: '0000010' })`);
activate('o', 3, '5555', '0000002', 79);
at('2026-10-03', '12:00');

// ---------- Export, map ----------
const exported = plain(sheets.run('exportMonth()'));
const months = exported.months.map((m) => plain(sheets.run(`exportMonth('${m.label}')`)));
assert.deepEqual(months.map((m) => m.label), ['2026-09', '2026-10']);
const { rows, problems } = buildImport(months, Object.keys(PEOPLE).map((u) => ({ username: u, email: `${u}@example.com` })));
assert.deepEqual(problems, [], 'nothing the database can\'t take');
assert.equal(rows.people.length, 4);
assert.equal(rows.packs.filter((p) => p.status === 'live').length, 4);
assert.deepEqual(rows.packs.filter((p) => p.status !== 'live').map((p) => `${p.game}-${p.pack} ${p.status}`).sort(),
  ['1111-0000001 returned', '1747-0000001 sold_out', '1747-0000010 full_pack_sale', '5555-0000001 sold_out', '9999-0000007 full_pack_sale']);

// The months rebuilt from the export alone (what `import-sheets.js check` does with the real ones) answer every read
// the same as the spreadsheets they came from: the export loses nothing the pages show.
const rebuilt = sheetsVm(CLOCK, months);
const READS = ['listSlots()', 'closeStatus(o)', 'closeStatus(e)', 'shiftStatus(e)', 'ownerHome(o)', 'monthsPage()', 'listMonths()',
  "monthSummary('2026-09')", "monthSummary('2026-10')", 'reportsPage()', 'listShipments()', 'listReturns()', 'listBackStock()',
  'listFullPackSales()', 'listShiftCloses(o)', 'theftReport(o, {})'];
Object.assign(rebuilt.ctx, Object.fromEntries(Object.entries(PEOPLE).map(([u, p]) => [u, { username: u, ...p }])));
for (const read of READS) assert.deepEqual(noSheets(plain(rebuilt.run(read))), noSheets(plain(sheets.run(read))), `rebuilt: ${read}`);

// ---------- The database: the import, and every read against the rebuilt months ----------
(async () => {
  const now = `${CLOCK.today} ${rebuilt.nowParts().H}:${rebuilt.nowParts().m}:00`;
  const { checked, counts } = await compareOnDev(rows, rebuilt, now);
  assert.deepEqual(counts, { members: 4, slots: 4, games: rows.games.length, packs: rows.packs.length,
    closeEntries: rows.closeEntries.length, dailyCloses: 5, shiftCloses: 2, shiftEntries: rows.shiftEntries.length,
    shipments: 3, adjustments: rows.adjustments.length });
  console.log(`import check: ${rows.packs.length} packs, ${rows.closeEntries.length} close lines, ${READS.length} reads the same after the export, ${checked} the same on the database — OK`);
})().catch((e) => { console.error(e); process.exit(1); });
