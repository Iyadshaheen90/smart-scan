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
  Utilities: { formatDate: (d, tz, fmt) => tz === 'UTC' ? d.toISOString().slice(0, 10) : fmt === 'yyyy-MM-dd HH:mm' ? `${globalThis.TODAY} 22:52` : fmt === 'yyyy-MM-dd HH:mm:ss' ? `${globalThis.TODAY} 12:00:00` : globalThis.TODAY },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) } };
vm.createContext(ctx);
for (const f of ['Schema.js', 'Sheets.js', 'Months.js', 'Setup.js', 'Auth.js', 'Slots.js', 'Close.js', 'Backstock.js', 'FullPacks.js', 'Shifts.js', 'Home.js', 'Permissions.js', 'Users.js']) {
  vm.runInContext(fs.readFileSync(`${dir}/${f}`, 'utf8'), ctx);
}
const run = (code) => vm.runInContext(code, ctx);
const code = (fn) => { try { fn(); } catch (e) { return e.code || e.message; } return 'none'; };
const tabs = (id) => google.SpreadsheetApp.openById(id).tabs;
const col = (sheet, name) => sheet.rows.slice(1).map((r) => r[sheet.rows[0].indexOf(name)]);
Object.assign(ctx, { owner: { username: 'o', role: 'owner' }, emp: { username: 'e', role: 'employee' } });

// September's spreadsheet: three slots, back stock of three games, an owner signed in. It was made before
// shift closes existed, so it has no ShiftCloses / ShiftCloseLog tabs.
const MONTHLY_TABS = run('MONTHLY_TABS');
const sep = google.add('Smart Scan — 2026-09', fakeSpreadsheet('sep', Object.fromEntries(
  Object.entries(MONTHLY_TABS).filter(([n]) => !n.startsWith('Shift')).map(([n, h]) => [n, fakeSheet(h)]))));
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
run(`endPack(owner, { box: 1, slot: 1, reason: 'sold_out' })`);
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
assert.deepEqual({ ...r.moved }, { Shipments: 0, ReserveAdjustments: 1, DailyCloseLog: 3, DailySummary: 1, PackHistory: 0, ShiftCloses: 0, ShiftCloseLog: 0 });
const octId = run('getCurrentMonth()').spreadsheetId;
assert.equal(r.url, `https://docs.google.com/spreadsheets/d/${octId}/edit`);
assert.equal(google.files[octId].name, 'Smart Scan — 2026-10');
assert.deepEqual(col(control.tabs.Months, 'status'), ['archived', 'active']);
const oct = tabs(octId);
// September never had the shift tabs; October's spreadsheet gets them (empty).
assert.equal(sep.tabs.ShiftCloses, undefined);
assert.equal(JSON.stringify(oct.ShiftCloses.rows), JSON.stringify([MONTHLY_TABS.ShiftCloses]));
assert.equal(JSON.stringify(oct.ShiftCloseLog.rows), JSON.stringify([MONTHLY_TABS.ShiftCloseLog]));
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
// Owner home right after starting October: October's sales so far and its last close (Oct 1).
let home = run('ownerHome(owner)');
assert.equal(home.month.current, '2026-10'); assert.equal(home.month.canStart, false);
assert.equal(home.closed, null); assert.equal(home.lastClose.date, '2026-10-01');
assert.equal(home.monthDollars, run(`monthSummary('2026-10')`).dollarsSold);
assert.equal(home.slots.length, 3);
assert.equal(home.backValue, run('listBackStock()').reduce((sum, g) => sum + g.valueInBack, 0));
assert.ok(home.backValue > 0);
console.log('late October start: moved 5 October rows out of September, store carried over — OK');

// A month sheet without the shift tabs (like September's when shift closes went live): reading sees no shift
// closes, and the first shift close creates both tabs.
delete oct.ShiftCloses; delete oct.ShiftCloseLog;
assert.equal(run('shiftStatus(emp)').since, null); assert.equal(run('ownerHome(owner)').shifts.count, 0);
{
  const st = run('shiftStatus(emp)');
  const e = JSON.stringify(st.slots.filter((x) => x.pack).map((x) => ({ box: x.box, slot: x.slot,
    packKey: `${x.pack.gameNumber}-${x.pack.packNumber}`, type: 'scan', ticketNumber: x.pack.exposedTicket - 1 })));
  const shift = run(`submitShiftClose(emp, ${e}, 'oct-shift', '2026-10-02')`);
  assert.equal(shift.ticketsSold, 2); assert.equal(shift.closedBy, 'e');
  assert.equal(oct.ShiftCloses.rows.length, 2); assert.equal(oct.ShiftCloseLog.rows.length, 3);
  run(`deleteShiftClose(owner, { shiftId: 'oct-shift' })`); assert.equal(oct.ShiftCloses.rows.length, 1);
}
console.log('shift close in a month sheet made before shift closes: tabs created on first use — OK');

// Oct 2 close, reopened: slot 2 goes back to its Oct 1 close, which was logged in September's sheet.
run(`submitClose(emp, ${entries({ 2: 30, 3: 70 })})`);
run('reopenClose()');
assert.equal(slot(2).pack.exposedTicket, 35); assert.equal(slot(2).pack.lastCloseDate, '2026-10-01');
run(`submitClose(emp, ${entries({ 2: 30, 3: 70 })})`);

// Oct 2: the owner moves the month spreadsheets into their "Smart Scan Monthly Sheets" folder (2026-10-01).
// Nothing found yet: a clear error and nothing moved. A look-alike name doesn't count; any capitals do.
const folderOf = (id) => google.files[id].folder;
google.addFolder('decoy', 'Old Monthly Sheets');
assert.match(code(() => run('moveMonthsToFolder()')), /No Drive folder named "Smart Scan Monthly Sheets"/);
assert.equal(folderOf('sep'), 'root'); assert.equal(google.props.MONTHS_FOLDER_ID, undefined);
const monthsBefore = JSON.stringify(run(`monthSummary('2026-10')`));
google.addFolder('monthly', 'smart scan monthly sheets');
run('moveMonthsToFolder()');
assert.equal(folderOf('sep'), 'monthly'); assert.equal(folderOf(octId), 'monthly');
assert.equal(folderOf('control'), 'root', 'Control stays where it is');
assert.equal(google.props.MONTHS_FOLDER_ID, 'monthly');
// The app still finds both months (by id), and running it again changes nothing.
assert.equal(run('getCurrentMonth()').spreadsheetId, octId);
assert.equal(JSON.stringify(run(`monthSummary('2026-10')`)), monthsBefore);
assert.ok(run(`monthSummary('2026-09')`).dollarsSold > 0);
assert.equal(run('listSlots()').length, 3);
run('moveMonthsToFolder()');
assert.equal(folderOf('sep'), 'monthly'); assert.equal(folderOf(octId), 'monthly');
// Two folders with the name: refused, so it can't guess.
google.addFolder('twin', 'Smart Scan Monthly Sheets');
assert.match(code(() => run('moveMonthsToFolder()')), /2 Drive folders are named/);
google.folders.twin.trashed = true;
console.log('month spreadsheets moved into Smart Scan Monthly Sheets, app unaffected — OK');

// Nov 1: a copy left by a failed attempt is thrown away and a fresh one registered, in the months folder.
globalThis.TODAY = '2026-11-01';
google.add('Smart Scan — 2026-11', fakeSpreadsheet('leftover', {}), 'monthly');
r = run(`startNewMonth({ label: '2026-11' })`);
assert.equal(google.files.leftover.trashed, true);
assert.equal(folderOf(run('getCurrentMonth()').spreadsheetId), 'monthly');
assert.deepEqual(col(control.tabs.Months, 'status'), ['archived', 'archived', 'active']);
assert.deepEqual({ ...r.moved }, { Shipments: 0, ReserveAdjustments: 0, DailyCloseLog: 0, DailySummary: 0, PackHistory: 0, ShiftCloses: 0, ShiftCloseLog: 0 });
const nov = tabs(run('getCurrentMonth()').spreadsheetId);
assert.equal(nov.DailyCloseLog.rows.length, 1);

// Undoing a sold-out across the boundary keeps the pack's Oct 2 close, so its activation can't be undone.
run(`endPack(owner, { box: 1, slot: 2, reason: 'sold_out' })`);
run(`undoEndPack(owner, { box: 1, slot: 2 })`);
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
const page = run('monthsPage()');
assert.equal(page.status.current, '2026-11'); assert.equal(page.summary.label, '2026-11');
assert.deepEqual([...page.months].map((m) => m.label), ['2026-11', '2026-10', '2026-09']);
console.log('monthly totals pass');

// Owner home with no close yet this month (November's was reopened): last month's last close.
home = run('ownerHome(owner)');
assert.equal(home.month.current, '2026-11'); assert.equal(home.monthDollars, 0);
assert.equal(home.lastClose.date, '2026-10-02'); assert.equal(home.today, '2026-11-01');
console.log('owner home pass');

// Full pack sales: listed per month (a new month starts with an empty list); back stock carries over.
{
  const g = run('listBackStock()').find((x) => x.packsInBack > 0);
  r = run(`sellFullPack(owner, { gameNumber: '${g.gameNumber}', packNumber: '7777777' })`);
  assert.equal(r.after, g.packsInBack - 1);
  assert.deepEqual({ ...run(`monthSummary('2026-11')`).fullPacks }, { count: 1, dollars: g.price * g.ticketsPerPack });
  assert.deepEqual({ ...run('ownerHome(owner)').fullPacks }, { count: 1, dollars: g.price * g.ticketsPerPack });
  assert.equal(run(`monthSummary('2026-10')`).fullPacks.count, 0);
  // A shift close in November (its sheet has the tabs), then December starts with an empty list.
  const shiftEntries = JSON.stringify(run('shiftStatus(emp)').slots.filter((x) => x.pack)
    .map((x) => ({ box: x.box, slot: x.slot, packKey: `${x.pack.gameNumber}-${x.pack.packNumber}`, type: 'scan', ticketNumber: x.pack.exposedTicket })));
  run(`submitShiftClose(emp, ${shiftEntries}, 'nov-shift', '2026-11-01')`);
  assert.equal(run('ownerHome(owner)').shifts.count, 1); assert.equal(run('ownerHome(owner)').shifts.last.closedBy, 'e');
  globalThis.TODAY = '2026-12-01';
  run(`startNewMonth({ label: '2026-12' })`);
  assert.equal(run('listShiftCloses(owner)').count, 0); assert.equal(run('ownerHome(owner)').shifts.count, 0);
  assert.equal(nov.ShiftCloses.rows.length, 2);
  assert.equal(run('listFullPackSales()').count, 0); assert.equal(run('ownerHome(owner)').fullPacks.count, 0);
  assert.equal(run('listBackStock()').find((x) => x.gameNumber === g.gameNumber).packsInBack, g.packsInBack - 1);
  assert.equal(run(`monthSummary('2026-11')`).fullPacks.count, 1);
  console.log('full packs per month pass');
}

// If the months folder is ever deleted, new months go next to Control again instead of failing.
google.folders.monthly.trashed = true;
assert.equal(run('monthsFolder(getControlSpreadsheet())').getId(), 'root');
delete google.folders.monthly;
assert.equal(run('monthsFolder(getControlSpreadsheet())').getId(), 'root');
console.log('months folder gone: falls back to the Control folder — OK');

// Employee permissions in a month sheet made before Users.permissions existed: the column is added on the
// first save, the owner can't be given any, and the next sign-in check reads them.
{
  const users = run('monthSheet("Users")');
  const at = users.rows[0].indexOf('permissions');
  users.rows.forEach((r) => r.splice(at, 1));
  users.rows.push(['e', 'hash', 'salt', 'employee', true, '2026-10-01']);
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(run('listUsers()')).find((u) => u.username === 'e').permissions, []);
  assert.equal(code(() => run(`setUserPermissions('e', ['load_packs', 'fly'])`)), 'bad_request');
  assert.equal(code(() => run(`setUserPermissions('o', ['load_packs'])`)), 'bad_request');
  const list = plain(run(`setUserPermissions('E', ['full_pack_sale', 'load_packs'])`));
  assert.deepEqual(list.find((u) => u.username === 'e').permissions, ['load_packs', 'full_pack_sale']);
  assert.equal(list.find((u) => u.username === 'o').permissions.length, 5);
  assert.deepEqual(plain(run('permissionsOf(findUser("e"))')), ['load_packs', 'full_pack_sale']);
  assert.deepEqual(plain(run(`setUserPermissions('e', [])`)).find((u) => u.username === 'e').permissions, []);
  console.log('employee permissions saved in an older month sheet — OK');
}
