// Runs Start New Month end to end against fake Drive/Sheets (see fakes.js): a late start that moves
// October's rows out of September, a double tap, reopening and undoing across the month boundary,
// and a retry after a failed attempt. Run with: node test/new-month-scenarios.js
globalThis.TODAY = '2026-09-29';
const fs = require('fs'); const vm = require('vm'); const path = require('path'); const assert = require('assert/strict');
const { fakeSheet, fakeSpreadsheet, fakeGoogle } = require('./fakes');
const dir = path.join(__dirname, '..', 'src', 'apps-script');

const control = fakeSpreadsheet('control', { Months: fakeSheet(['month_label', 'spreadsheet_id', 'created_date', 'status']) });
const google = fakeGoogle(control);
const ctx = { console, ...google, Session: { getScriptTimeZone: () => 'x' },
  Utilities: { formatDate: (d, tz) => tz === 'UTC' ? d.toISOString().slice(0, 10) : globalThis.TODAY },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) } };
vm.createContext(ctx);
for (const f of ['Schema.js', 'Sheets.js', 'Months.js', 'Setup.js', 'Auth.js', 'Slots.js', 'Close.js', 'Backstock.js']) {
  vm.runInContext(fs.readFileSync(`${dir}/${f}`, 'utf8'), ctx);
}
const run = (code) => vm.runInContext(code, ctx);
const code = (fn) => { try { fn(); } catch (e) { return e.code || e.message; } return 'none'; };
const tabs = (id) => google.SpreadsheetApp.openById(id).tabs;
const col = (sheet, name) => sheet.rows.slice(1).map((r) => r[sheet.rows[0].indexOf(name)]);
Object.assign(ctx, { owner: { username: 'o', role: 'owner' }, emp: { username: 'e', role: 'employee' } });

// September's spreadsheet: three slots, back stock of three games, an owner signed in.
const MONTHLY_TABS = run('MONTHLY_TABS');
const sep = google.add('Smart Scan — 2026-09', fakeSpreadsheet('sep', Object.fromEntries(
  Object.entries(MONTHLY_TABS).map(([n, h]) => [n, fakeSheet(h)]))));
sep.tabs.Users.rows.push(['o', 'hash', 'salt', 'owner', true, '2026-09-22']);
sep.tabs.Sessions.rows.push(['tokenhash', 'o', '2026-09-29', '2099-01-01']);
sep.tabs.SlotConfig.rows.push([1, 1, 20], [1, 2, 10], [1, 3, 5]);
sep.tabs.SlotState.rows.push([1, 1], [1, 2], [1, 3]);
sep.tabs.ReserveInventory.rows.push(['1747', 20, 30, 3, 90], ['1111', 10, 50, 2, 100], ['5555', 5, 80, 2, 160]);
control.tabs.Months.appendRow(['2026-09', 'sep', new Date(), 'active']);

const entries = (tickets) => JSON.stringify(Object.entries(tickets).map(([slot, t]) => {
  const s = run('listSlots()').find((x) => x.box === 1 && x.slot === Number(slot));
  return { box: 1, slot: Number(slot), packKey: `${s.pack.gameNumber}-${s.pack.packNumber}`, type: 'scan', ticketNumber: t };
}));
const slot = (n) => run('listSlots()').find((x) => x.box === 1 && x.slot === n);

// Sep 29-30: two packs go in and are closed twice; a shipment arrives.
run(`activatePack(owner, { box: 1, slot: 1, gameNumber: '1747', packNumber: '0000001', ticketNumber: 29 })`);
run(`activatePack(owner, { box: 1, slot: 2, gameNumber: '1111', packNumber: '0000001', ticketNumber: 49 })`);
run(`submitClose(emp, ${entries({ 1: 25, 2: 45 })})`);
globalThis.TODAY = '2026-09-30';
assert.deepEqual({ ...run('monthStatus()') }, { current: '2026-09', currentUrl: 'https://docs.google.com/spreadsheets/d/sep/edit', next: '2026-10', canStart: false });
assert.equal(code(() => run(`startNewMonth({ label: '2026-10' })`)), 'too_early');
run(`saveBackStock(owner, 'shipment', [{ gameNumber: '5555', packs: 1 }])`);
run(`submitClose(emp, ${entries({ 1: 20, 2: 40 })})`);
// After the Sep 30 close: slot 1 sells out (counts toward Oct 1), a new pack goes in slot 3.
run(`endPack(emp, { box: 1, slot: 1, reason: 'sold_out' })`);
run(`activatePack(owner, { box: 1, slot: 3, gameNumber: '5555', packNumber: '0000001', ticketNumber: 79 })`);

// Oct 1: nobody starts October, so the day is closed (and back stock adjusted) in September's sheet.
globalThis.TODAY = '2026-10-01';
let r = run(`submitClose(emp, ${entries({ 2: 35, 3: 70 })})`);
assert.equal(r.ticketsSold, 21 + 5 + 9);
run(`removeBackStock(owner, { gameNumber: '1111', packs: 1, reason: 'damaged' })`);

// Oct 2: the owner starts October. Everything dated October moves into the new spreadsheet.
globalThis.TODAY = '2026-10-02';
assert.equal(run('monthStatus()').canStart, true);
assert.equal(code(() => run(`startNewMonth({ label: '2026-11' })`)), 'bad_request');
r = run(`startNewMonth({ label: '2026-10' })`);
assert.equal(r.label, '2026-10'); assert.equal(r.previous, '2026-09');
assert.deepEqual({ ...r.moved }, { Shipments: 0, ReserveAdjustments: 1, DailyCloseLog: 3, DailySummary: 1, PackHistory: 0 });
const octId = run('getCurrentMonth()').spreadsheetId;
assert.equal(r.url, `https://docs.google.com/spreadsheets/d/${octId}/edit`);
assert.equal(google.files[octId].name, 'Smart Scan — 2026-10');
assert.deepEqual(col(control.tabs.Months, 'status'), ['archived', 'active']);
const oct = tabs(octId);
// What's in the store carried over exactly; logs hold only October.
for (const t of ['Users', 'Sessions', 'SlotConfig', 'SlotState', 'ReserveInventory']) assert.deepEqual(oct[t].rows, sep.tabs[t].rows, t);
assert.deepEqual([...new Set(col(oct.DailyCloseLog, 'close_date'))], ['2026-10-01']);
assert.deepEqual(col(oct.DailySummary, 'close_date'), ['2026-10-01']);
assert.equal(oct.Shipments.rows.length, 1); assert.equal(oct.PackHistory.rows.length, 1); assert.equal(oct.ReserveAdjustments.rows.length, 2);
// September keeps only September.
assert.deepEqual([...new Set(col(sep.tabs.DailyCloseLog, 'close_date'))], ['2026-09-29', '2026-09-30']);
assert.deepEqual(col(sep.tabs.DailySummary, 'close_date'), ['2026-09-29', '2026-09-30']);
assert.equal(sep.tabs.Shipments.rows.length, 2); assert.equal(sep.tabs.PackHistory.rows.length, 2); assert.equal(sep.tabs.ReserveAdjustments.rows.length, 1);
// A second tap is refused, and September can't be restarted.
assert.equal(code(() => run(`startNewMonth({ label: '2026-10' })`)), 'already_started');
assert.equal(code(() => run(`startNewMonth({ label: '2026-09' })`)), 'already_started');
assert.equal(run('monthStatus()').next, '2026-11');
console.log('late October start: moved 5 October rows out of September, store carried over — OK');

// Oct 2 close, reopened: slot 2 goes back to its Oct 1 close, which was logged in September's sheet.
run(`submitClose(emp, ${entries({ 2: 30, 3: 70 })})`);
run('reopenClose()');
assert.equal(slot(2).pack.exposedTicket, 35); assert.equal(slot(2).pack.lastCloseDate, '2026-10-01');
run(`submitClose(emp, ${entries({ 2: 30, 3: 70 })})`);

// Nov 1: a copy left by a failed attempt is thrown away and a fresh one registered.
globalThis.TODAY = '2026-11-01';
google.add('Smart Scan — 2026-11', fakeSpreadsheet('leftover', {}));
r = run(`startNewMonth({ label: '2026-11' })`);
assert.equal(google.files.leftover.trashed, true);
assert.deepEqual(col(control.tabs.Months, 'status'), ['archived', 'archived', 'active']);
assert.deepEqual({ ...r.moved }, { Shipments: 0, ReserveAdjustments: 0, DailyCloseLog: 0, DailySummary: 0, PackHistory: 0 });
const nov = tabs(run('getCurrentMonth()').spreadsheetId);
assert.equal(nov.DailyCloseLog.rows.length, 1);

// Undoing a sold-out across the boundary keeps the pack's Oct 2 close, so its activation can't be undone.
run(`endPack(emp, { box: 1, slot: 2, reason: 'sold_out' })`);
run(`undoEndPack({ box: 1, slot: 2 })`);
assert.equal(slot(2).pack.lastCloseDate, '2026-10-02'); assert.equal(slot(2).pack.exposedTicket, 30);
assert.equal(code(() => run(`undoActivation(owner, { box: 1, slot: 2 })`)), 'already_closed');
// Same for reopening November's first close.
run(`submitClose(emp, ${entries({ 2: 28, 3: 60 })})`);
run('reopenClose()');
assert.equal(slot(3).pack.lastCloseDate, '2026-10-02'); assert.equal(slot(3).pack.exposedTicket, 70);
console.log('undo and reopen across months keep the last close date — OK');

// Tabs grow past their last row when appending, and can be emptied completely.
const small = fakeSheet(['a'], null, 3);
for (let i = 0; i < 5; i++) run('appendObject').call(null, small, { a: `x${i}` });
assert.deepEqual(col(small, 'a'), ['x0', 'x1', 'x2', 'x3', 'x4']);
assert.equal(run('deleteRowsWhere').call(null, small, () => true), 5); assert.equal(small.rows.length, 1);
console.log('all new-month scenarios pass');

// Monthly totals come from each month's own DailySummary rows.
assert.deepEqual([...run('listMonths()')].map((m) => `${m.label} ${m.status}`), ['2026-11 active', '2026-10 archived', '2026-09 archived']);
const septTotals = run(`monthSummary('2026-09')`);
assert.deepEqual([...septTotals.days].map((d) => d.date), ['2026-09-29', '2026-09-30']);
assert.equal(septTotals.ticketsSold, (29 - 25 + 49 - 45) + (25 - 20 + 45 - 40));
assert.equal(septTotals.dollarsSold, 4 * 20 + 4 * 10 + 5 * 20 + 5 * 10);
assert.equal(septTotals.shipmentValue, 80 * 5);
assert.equal(septTotals.endingInventoryValue, septTotals.days[1].inventoryValue);
const octTotals = run(`monthSummary('2026-10')`);
assert.deepEqual([...octTotals.days].map((d) => d.date), ['2026-10-01', '2026-10-02']);
assert.equal(octTotals.ticketsSold, 35 + 5);
assert.equal(run(`monthSummary('2026-11')`).endingInventoryValue, null); // reopened, so no closed day yet
assert.equal(code(() => run(`monthSummary('2025-01')`)), 'no_month');
console.log('monthly totals pass');
