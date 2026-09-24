// Runs the Apps Script backend (Schema, Sheets, Slots, Close, Backstock) against an in-memory fake
// spreadsheet and walks through real store scenarios. Run with: node test/backend-scenarios.js
// Scenarios build on each other in order. TODAY is the fake "today" (script time zone).
globalThis.TODAY = '2026-09-24';
const fs = require('fs'); const vm = require('vm'); const path = require('path'); const assert = require('assert/strict');
const dir = process.argv[2] || path.join(__dirname, '..', 'src', 'apps-script');
function fakeSheet(headers, old) {
  const rows = [(old || headers).slice()];
  const width = () => rows[0].length;
  return {
    rows,
    getDataRange: () => ({ getValues: () => rows.map((r) => Array.from({ length: width() }, (_, i) => r[i] ?? '')) }),
    getLastRow: () => rows.length, getLastColumn: () => width(),
    getRange: (r, c, nr, nc) => nr ? {
      getValues: () => [rows[0].slice(c - 1, c - 1 + nc)],
      setValues([v]) { v.forEach((x, i) => { rows[0][c - 1 + i] = x; }); return this; },
      setFontWeight() { return this; },
    } : {
      setNumberFormat() { return this; },
      setValue(v) { (rows[r - 1] ||= []); rows[r - 1][c - 1] = v; return this; },
    },
    deleteRow: (r) => rows.splice(r - 1, 1),
  };
}
const ctx = { console, Utilities: { formatDate: (d, tz) => tz === 'UTC' ? d.toISOString().slice(0, 10) : globalThis.TODAY }, Session: { getScriptTimeZone: () => 'x' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) } };
vm.createContext(ctx);
for (const f of ['Schema.js', 'Sheets.js', 'Slots.js', 'Close.js', 'Backstock.js']) vm.runInContext(fs.readFileSync(`${dir}/${f}`, 'utf8'), ctx);
vm.runInContext(`class ApiError extends Error { constructor(c, m) { super(m); this.code = c; } }
  const sheets = {}; for (const [n, h] of Object.entries(MONTHLY_TABS)) sheets[n] = fakeSheetFn(h, n === 'SlotState' ? h.slice(0, 10) : null);
  function monthSheet(n) { return sheets[n]; }`, Object.assign(ctx, { fakeSheetFn: fakeSheet }));
const S = vm.runInContext('sheets', ctx);
S.SlotConfig.rows.push([1, 1, 20], [1, 2, 10]);
S.SlotState.rows.push([1, 1], [1, 2]);
S.ReserveInventory.rows.push(['1747', 20, 30, 3, 90]);
const owner = { username: 'o', role: 'owner' }, emp = { username: 'e', role: 'employee' };
const run = (code) => vm.runInContext(code, Object.assign(ctx, { owner, emp }));
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'none'; };

let r = run(`activatePack(emp, { box: 1, slot: 1, gameNumber: '1747', packNumber: '1263622', ticketNumber: 29 })`);
assert.equal(r.packsInBack, 2); assert.equal(S.ReserveInventory.rows[1][4], 60);
let slots = run('listSlots()'); assert.equal(slots[0].pack.remaining, 30); assert.equal(slots[0].pack.packsInBack, 2); assert.equal(slots[1].pack, null);
// same pack elsewhere, occupied slot, price mismatch
assert.equal(code(() => run(`activatePack(emp, { box: 1, slot: 2, gameNumber: '1747', packNumber: '1263622', ticketNumber: 29 })`)), 'pack_in_use');
assert.equal(code(() => run(`activatePack(emp, { box: 1, slot: 1, gameNumber: '1747', packNumber: '1263623', ticketNumber: 29 })`)), 'slot_occupied');
assert.equal(code(() => run(`activatePack(emp, { box: 1, slot: 2, gameNumber: '1747', packNumber: '1263623', ticketNumber: 29 })`)), 'price_mismatch');
assert.equal(code(() => run(`activatePack(owner, { box: 1, slot: 2, gameNumber: '1747', packNumber: '1263623', ticketNumber: 29 })`)), 'price_mismatch');
assert.equal(code(() => run(`activatePack(emp, { box: 1, slot: 2, gameNumber: '1111', packNumber: '1263623', ticketNumber: 29 })`)), 'unknown_game');
assert.equal(code(() => run(`activatePack(owner, { box: 1, slot: 2, gameNumber: '1111', packNumber: '0000001', ticketNumber: 59 })`)), 'unknown_game');
r = run(`activatePack(owner, { box: 1, slot: 2, gameNumber: '1111', packNumber: '0000001', ticketNumber: 59, gamePrice: 10, ticketsPerPack: 60 })`);
assert.equal(r.packsInBack, 0); assert.equal(r.backWasEmpty, true);
// replace slot 1: returned with top ticket 20 -> 9 sold today, 21 going back
assert.equal(code(() => run(`activatePack(emp, { box: 1, slot: 1, gameNumber: '1747', packNumber: '1263623', ticketNumber: 29, oldPackEnd: 'returned', oldPackTicket: '' })`)), 'bad_ticket');
r = run(`activatePack(emp, { box: 1, slot: 1, gameNumber: '1747', packNumber: '1263623', ticketNumber: 29, oldPackEnd: 'returned', oldPackTicket: 20 })`);
assert.deepEqual({ ...r.oldPack }, { packKey: '1747-1263622', reason: 'returned', ticketsSoldToday: 9, remainingReturned: 21 });
assert.equal(r.packsInBack, 1);
assert.equal(code(() => run(`activatePack(emp, { box: 1, slot: 2, gameNumber: '1747', packNumber: '1263622', ticketNumber: 29 })`)), 'pack_ended');
// empty slot 2 as sold out
r = run(`endPack(emp, { box: 1, slot: 2, reason: 'sold_out' })`);
assert.equal(r.ticketsSoldToday, 60);
slots = run('listSlots()'); assert.equal(slots[1].pack, null); assert.equal(slots[0].pack.packNumber, '1263623');
const hist = S.PackHistory.rows.slice(1); assert.equal(hist.length, 2);
assert.equal(hist[0][8], 9); // returned pack: 30 - 21 sold total
assert.equal(S.DailyCloseLog.rows.length, 3);

// the reported mistake: $10 pack of game 2222 into $20 slot 1 (now empty after... use slot 2, empty, $10 -> make it $20 first)
S.SlotConfig.rows.push([2, 6, 20], [2, 10, 10]); S.SlotState.rows.push([2, 6], [2, 10]);
S.ReserveInventory.rows.push(['2222', 10, 50, 2, 100]);
assert.equal(code(() => run(`setSlotPrice({ box: 2, slot: 6, price: 0 })`)), 'bad_price');
r = run(`activatePack(owner, { box: 2, slot: 6, gameNumber: '2222', packNumber: '5555555', ticketNumber: 49, overridePrice: true })`);
assert.equal(r.packsInBack, 1);
assert.ok(S.SlotState.rows[0].includes('took_from_reserve'));
assert.equal(code(() => run(`activatePack(owner, { box: 2, slot: 10, gameNumber: '2222', packNumber: '5555555', ticketNumber: 49 })`)), 'pack_in_use');
r = run(`undoActivation(emp, { box: 2, slot: 6 })`);
assert.deepEqual({ ...r }, { packKey: '2222-5555555', gameNumber: '2222', returnedToBack: true, packsInBack: 2, slotPrice: 20 });
slots = run('listSlots()');
assert.equal(slots.find((s) => s.box === 2 && s.slot === 6).slotPrice, 20);
assert.equal(slots.find((s) => s.box === 2 && s.slot === 6).pack, null);
r = run(`activatePack(emp, { box: 2, slot: 10, gameNumber: '2222', packNumber: '5555555', ticketNumber: 49 })`);
assert.equal(r.packsInBack, 1);
// undo when back was empty doesn't invent a pack; old rows without the new columns don't either
r = run(`undoActivation(emp, { box: 1, slot: 1 })`);
assert.equal(r.returnedToBack, true); // 1747 had 1 pack when 1263623 went in
assert.equal(code(() => run(`undoActivation(emp, { box: 1, slot: 1 })`)), 'slot_empty');
r = run(`activatePack(owner, { box: 1, slot: 2, gameNumber: '1111', packNumber: '0000002', ticketNumber: 59 })`);
r = run(`undoActivation(emp, { box: 1, slot: 2 })`);
assert.equal(r.returnedToBack, false); assert.equal(r.packsInBack, 0);
// setSlotPrice fixes a slot directly
r = run(`setSlotPrice({ box: 2, slot: 6, price: 30 })`); assert.equal(r.slotPrice, 30);
S.SlotState.rows.push([3, 1]); S.SlotConfig.rows.push([3, 1, 10]);
run(`activatePack(owner, { box: 3, slot: 1, gameNumber: '2222', packNumber: '5555556', ticketNumber: 49 })`);
assert.equal(code(() => run(`endPack(emp, { box: 3, slot: 1, reason: 'returned', ticketNumber: 10 })`)), 'forbidden');
r = run(`endPack(emp, { box: 3, slot: 1, reason: 'sold_out' })`); assert.equal(r.ticketsSoldToday, 50);
// undo the sold out just done in box 3 slot 1
let ls = run('listSlots()').find((x) => x.box === 3);
assert.deepEqual({ ...ls.endedToday }, { packKey: '2222-5555556', reason: 'sold_out' });
const logRows = S.DailyCloseLog.rows.length, histRows = S.PackHistory.rows.length;
r = run(`undoEndPack({ box: 3, slot: 1 })`);
assert.equal(r.exposedTicket, 49);
assert.equal(S.DailyCloseLog.rows.length, logRows - 1); assert.equal(S.PackHistory.rows.length, histRows - 1);
ls = run('listSlots()').find((x) => x.box === 3);
assert.equal(ls.pack.packNumber, '5555556'); assert.equal(ls.pack.remaining, 50); assert.equal(ls.endedToday, null);
assert.equal(code(() => run(`undoEndPack({ box: 3, slot: 1 })`)), 'slot_occupied');
// returned then replaced: must undo activation first
r = run(`activatePack(owner, { box: 3, slot: 1, gameNumber: '2222', packNumber: '5555557', ticketNumber: 49, oldPackEnd: 'returned', oldPackTicket: 40 })`);
assert.equal(code(() => run(`undoEndPack({ box: 3, slot: 1 })`)), 'slot_occupied');
run(`undoActivation(owner, { box: 3, slot: 1 })`);
r = run(`undoEndPack({ box: 3, slot: 1 })`); assert.equal(r.reason, 'returned'); assert.equal(r.exposedTicket, 49);
assert.equal(code(() => run(`undoEndPack({ box: 2, slot: 6 })`)), 'nothing_to_undo');
S.DailySummary.rows.push(['2026-09-24']);
run(`endPack(emp, { box: 3, slot: 1, reason: 'sold_out' })`); // after today's close: counts toward tomorrow
assert.equal(code(() => run(`undoEndPack({ box: 3, slot: 1 })`)), 'none');
// swap: box 2 slot 10 (2222 pack, $10) <-> box 2 slot 6 (empty, $30)
const at = (b, n) => run('listSlots()').find((x) => x.box === b && x.slot === n);
const before10 = at(2, 10);
r = run(`swapSlots({ box: 2, slot: 10, toBox: 2, toSlot: 6 })`);
assert.equal(r.to.packKey, '2222-5555555'); assert.equal(r.from.packKey, null);
assert.deepEqual(at(2, 6).pack, before10.pack); assert.equal(at(2, 6).slotPrice, 10);
assert.equal(at(2, 10).pack, null); assert.equal(at(2, 10).slotPrice, 30);
// swap two live packs across boxes, then back
run(`activatePack(owner, { box: 2, slot: 10, gameNumber: '9999', packNumber: '0000009', ticketNumber: 9, gamePrice: 30, ticketsPerPack: 10 })`);
const a6 = at(2, 6), a10 = at(2, 10);
run(`swapSlots({ box: 2, slot: 6, toBox: 2, toSlot: 10 })`);
assert.equal(at(2, 6).pack.packNumber, '0000009'); assert.equal(at(2, 6).slotPrice, 30); assert.equal(at(2, 10).pack.packNumber, '5555555');
run(`swapSlots({ box: 2, slot: 6, toBox: 2, toSlot: 10 })`);
assert.deepEqual(at(2, 6), a6); assert.deepEqual(at(2, 10), a10);
// formula column untouched
const hdr = S.SlotState.rows[0]; const rc = hdr.indexOf('remaining_count');
assert.ok(S.SlotState.rows.slice(1).every((row) => row[rc] === undefined || row[rc] === ''));
assert.equal(code(() => run(`swapSlots({ box: 2, slot: 6, toBox: 2, toSlot: 6 })`)), 'bad_request');
assert.equal(code(() => run(`swapSlots({ box: 2, slot: 6, toBox: 9, toSlot: 6 })`)), 'no_slot');

// ---- Close Day ---- fresh day state: clear the fake summary added earlier
S.DailySummary.rows.splice(1);
let st = run('closeStatus(emp)'); assert.equal(st.closed, null);
const live = st.slots.filter((x) => x.pack);
const entry = (x, extra) => ({ box: x.box, slot: x.slot, packKey: `${x.pack.gameNumber}-${x.pack.packNumber}`, ...extra });
// incomplete
assert.equal(code(() => run(`submitClose(emp, ${JSON.stringify(live.slice(1).map((x) => entry(x, { type: 'no_sales' })))})`)), 'incomplete');
// ticket above top
const bad = live.map((x, i) => entry(x, i === 0 ? { type: 'scan', ticketNumber: x.pack.exposedTicket + 1 } : { type: 'no_sales' }));
assert.equal(code(() => run(`submitClose(emp, ${JSON.stringify(bad)})`)), 'bad_ticket');
// wrong pack
const stale = live.map((x) => entry(x, { type: 'no_sales' })); stale[0].packKey = '0000-0000000';
assert.equal(code(() => run(`submitClose(emp, ${JSON.stringify(stale)})`)), 'slots_changed');
const logBefore = S.DailyCloseLog.rows.length;
assert.equal(S.DailyCloseLog.rows.length, logBefore); // nothing written by failed attempts
// good close: first slot sells 5, second sold out, rest no sales
const good = live.map((x, i) => entry(x, i === 0 ? { type: 'scan', ticketNumber: x.pack.exposedTicket - 5 } : i === 1 ? { type: 'sold_out' } : { type: 'no_sales' }));
const soldOutRemaining = live[1].pack.remaining;
const priorToday = S.DailyCloseLog.rows.slice(1).filter((r) => r[0] === '2026-09-24').reduce((a, r) => a + r[6], 0);
r = run(`submitClose(emp, ${JSON.stringify(good)})`);
assert.equal(r.ticketsSold, priorToday + 5 + soldOutRemaining); assert.equal(r.dollarsSold, undefined);
assert.equal(code(() => run(`submitClose(emp, ${JSON.stringify(good)})`)), 'already_closed');
st = run('closeStatus(owner)'); assert.ok(st.closed.dollarsSold >= 0); assert.ok(st.closed.inventoryValue > 0);
let s0 = st.slots.find((x) => x.box === live[0].box && x.slot === live[0].slot);
assert.equal(s0.pack.exposedTicket, live[0].pack.exposedTicket - 5); assert.equal(s0.pack.lastCloseDate, '2026-09-24');
assert.equal(code(() => run(`undoActivation(owner, { box: ${live[0].box}, slot: ${live[0].slot} })`)), 'already_closed');
// can't undo the sold out done in the close
assert.equal(code(() => run(`undoEndPack({ box: ${live[1].box}, slot: ${live[1].slot} })`)), 'already_closed');
// sold out after close goes to tomorrow, and can be undone
r = run(`endPack(emp, { box: ${live[0].box}, slot: ${live[0].slot}, reason: 'sold_out' })`);
assert.equal(S.DailyCloseLog.rows[S.DailyCloseLog.rows.length - 1][0], '2026-09-25');
run(`undoEndPack({ box: ${live[0].box}, slot: ${live[0].slot} })`);
// reopen restores tickets; swap after close is followed by pack
const other = st.slots.find((x) => !x.pack && !(x.box === live[1].box && x.slot === live[1].slot));
run(`swapSlots({ box: ${live[0].box}, slot: ${live[0].slot}, toBox: ${other.box}, toSlot: ${other.slot} })`);
r = run('reopenClose()'); assert.equal(r.slotsRestored, live.length - 1);
st = run('closeStatus(owner)'); assert.equal(st.closed, null);
const moved = st.slots.find((x) => x.box === other.box && x.slot === other.slot);
assert.equal(moved.pack.exposedTicket, live[0].pack.exposedTicket); assert.equal(moved.pack.lastCloseDate, live[0].pack.lastCloseDate);
assert.equal(code(() => run('reopenClose()')), 'not_closed');

// pack sizes
r = run(`activatePack(owner, { box: 3, slot: 1, gameNumber: '4444', packNumber: '0000044', ticketNumber: 79, gamePrice: 5, ticketsPerPack: '', overridePrice: true, oldPackEnd: 'sold_out' })`);
let p3 = run('listSlots()').find((x) => x.box === 3).pack;
assert.equal(p3.ticketsPerPack, 80); assert.equal(p3.standardPackSize, 80);
assert.equal(code(() => run(`setPackSize({ gameNumber: '4444', ticketsPerPack: 50 })`)), 'bad_size');
assert.equal(code(() => run(`setPackSize({ gameNumber: '4445', ticketsPerPack: 50 })`)), 'unknown_game');
r = run(`setPackSize({ gameNumber: '4444', ticketsPerPack: 100 })`); assert.equal(r.ticketsPerPack, 100);
assert.equal(run('listSlots()').find((x) => x.box === 3).pack.ticketsPerPack, 100);

// ---- Scenario: night close marks a pack sold out; next morning owner activates; next night closes it ----
S.DailySummary.rows.splice(1);
globalThis.TODAY = '2026-09-25';
let day1 = run('closeStatus(emp)'); assert.equal(day1.closed, null);
let live1 = day1.slots.filter((x) => x.pack);
const target = live1[0];
r = run(`submitClose(emp, ${JSON.stringify(live1.map((x, i) => ({ box: x.box, slot: x.slot, packKey: `${x.pack.gameNumber}-${x.pack.packNumber}`, type: i === 0 ? 'sold_out' : 'no_sales' })))})`);
assert.equal(run('listSlots()').find((x) => x.box === target.box && x.slot === target.slot).pack, null);
globalThis.TODAY = '2026-09-26';
S.ReserveInventory.rows.push(['6060', target.slotPrice, 30, 4, 120]);
r = run(`activatePack(owner, { box: ${target.box}, slot: ${target.slot}, gameNumber: '6060', packNumber: '0606060', ticketNumber: 29 })`);
assert.equal(r.packsInBack, 3);
let day2 = run('closeStatus(emp)'); assert.equal(day2.closed, null);
let live2 = day2.slots.filter((x) => x.pack);
const fresh = live2.find((x) => x.box === target.box && x.slot === target.slot);
assert.equal(fresh.pack.packNumber, '0606060'); assert.equal(fresh.pack.exposedTicket, 29);
r = run(`submitClose(emp, ${JSON.stringify(live2.map((x) => ({ box: x.box, slot: x.slot, packKey: `${x.pack.gameNumber}-${x.pack.packNumber}`, ...(x === fresh ? { type: 'scan', ticketNumber: 21 } : { type: 'no_sales' }) })))})`);
assert.equal(r.ticketsSold, 8);
const row = S.DailyCloseLog.rows[S.DailyCloseLog.rows.length - live2.length + live2.indexOf(fresh)];
const H = S.DailyCloseLog.rows[0];
assert.equal(row[H.indexOf('pack_key')], '6060-0606060'); assert.equal(row[H.indexOf('tickets_sold')], 8);
assert.equal(row[H.indexOf('late_activation')], true); assert.equal(row[H.indexOf('close_date')], '2026-09-26');
console.log('overnight sold-out -> morning activation -> night close: OK (8 sold, flagged as activated that day)');

// ---- Scenario: morning sold out + same-game replacement by owner, sales all day, employee close ----
globalThis.TODAY = '2026-09-27';
// fresh, isolated sheets for exact numbers
for (const n of ['SlotConfig', 'SlotState', 'ReserveInventory', 'DailyCloseLog', 'DailySummary', 'PackHistory']) S[n].rows.splice(1);
S.SlotConfig.rows.push([1, 1, 20], [1, 2, 10]);
S.SlotState.rows.push([1, 1], [1, 2]);
S.ReserveInventory.rows.push(['1747', 20, 30, 3, 90], ['1111', 10, 50, 2, 100]);
run(`activatePack(owner, { box: 1, slot: 1, gameNumber: '1747', packNumber: '0000001', ticketNumber: 29 })`); // back 1747: 2
run(`activatePack(owner, { box: 1, slot: 2, gameNumber: '1111', packNumber: '0000001', ticketNumber: 49 })`); // back 1111: 1
// yesterday's close put pack 1747-0000001 at ticket 4 (5 left) — simulate
S.SlotState.rows[1][S.SlotState.rows[0].indexOf('current_exposed_ticket_number')] = 4;
S.SlotState.rows[1][S.SlotState.rows[0].indexOf('last_close_date')] = '2026-09-26';
globalThis.TODAY = '2026-09-28';
// morning: pack sells its last 5, owner marks sold out and activates next 1747 pack
r = run(`activatePack(owner, { box: 1, slot: 1, gameNumber: '1747', packNumber: '0000002', ticketNumber: 29, oldPackEnd: 'sold_out' })`);
assert.equal(r.oldPack.ticketsSoldToday, 5); assert.equal(r.packsInBack, 1);
// night: employee closes. New 1747 pack now at 19 (10 sold), 1111 pack at 44 (5 sold)
r = run(`submitClose(emp, [
  { box: 1, slot: 1, packKey: '1747-0000002', type: 'scan', ticketNumber: 19 },
  { box: 1, slot: 2, packKey: '1111-0000001', type: 'scan', ticketNumber: 44 }])`);
assert.equal(r.ticketsSold, 5 + 10 + 5);
const own = run('closeStatus(owner)').closed;
assert.equal(own.dollarsSold, 5 * 20 + 10 * 20 + 5 * 10);           // $350
// inventory: live 1747 20 left * $20 + live 1111 45 left * $10 + back 1747 1 pack (30) * $20 + back 1111 1 pack (50) * $10
assert.equal(own.inventoryValue, 20 * 20 + 45 * 10 + 30 * 20 + 50 * 10); // $1950
const R = S.ReserveInventory.rows; assert.deepEqual(R[1], ['1747', 20, 30, 1, 30]); assert.deepEqual(R[2], ['1111', 10, 50, 1, 50]);
console.log(`sold-out + replacement day: ${r.ticketsSold} tickets, $${own.dollarsSold}, inventory $${own.inventoryValue} — OK`);

// ---- Back stock ----
for (const n of ['ReserveInventory', 'Shipments', 'ReserveAdjustments']) S[n].rows.splice(1);
S.ReserveInventory.rows.push(['1747', 20, 30, 1, 30]);
// validation happens before any write
assert.equal(code(() => run(`saveBackStock(owner, 'shipment', [{ gameNumber: '1747', packs: 5 }, { gameNumber: '2001', packs: 3 }])`)), 'unknown_game');
assert.equal(S.ReserveInventory.rows[1][3], 1); assert.equal(S.Shipments.rows.length, 1);
assert.equal(code(() => run(`saveBackStock(owner, 'shipment', [{ gameNumber: '1747', packs: 0 }])`)), 'bad_count');
assert.equal(code(() => run(`saveBackStock(owner, 'shipment', [{ gameNumber: '1747', packs: 1 }, { gameNumber: '1747', packs: 2 }])`)), 'bad_request');
r = run(`saveBackStock(owner, 'shipment', [{ gameNumber: '1747', packs: 5 }, { gameNumber: '2001', packs: 3, gamePrice: 1, ticketsPerPack: '' }, { gameNumber: '2002', packs: 2, gamePrice: 5 }], 'Sept delivery')`);
let bs = Object.fromEntries(r.backStock.map((g) => [g.gameNumber, g]));
assert.equal(bs['1747'].packsInBack, 6); assert.equal(bs['1747'].ticketsInBack, 180); assert.equal(bs['1747'].valueInBack, 3600);
assert.equal(bs['2001'].ticketsPerPack, 240); assert.equal(bs['2001'].ticketsInBack, 720);
assert.equal(bs['2002'].ticketsPerPack, 80);
assert.equal(S.Shipments.rows.length, 4); assert.equal(S.Shipments.rows[2][5], 720);
assert.equal(r.backStock[0].gameNumber, '1747'); // sorted by price, highest first
// count: 1747 found 4 (2 missing), 2001 found 5 (2 extra), 2002 unchanged
r = run(`saveBackStock(owner, 'count', [{ gameNumber: '1747', packs: 4 }, { gameNumber: '2001', packs: 5 }, { gameNumber: '2002', packs: 2 }])`);
assert.equal(JSON.stringify(r.results.map((x) => [x.before, x.after])), '[[6,4],[3,5],[2,2]]');
assert.equal(S.ReserveAdjustments.rows.length, 3);
assert.equal(S.ReserveAdjustments.rows[1][2], 2); assert.equal(S.ReserveAdjustments.rows[2][2], -2); assert.equal(S.ReserveAdjustments.rows[2][3], -480);
// remove
assert.equal(code(() => run(`removeBackStock(owner, { gameNumber: '1747', packs: 5, reason: 'damaged' })`)), 'bad_count');
assert.equal(code(() => run(`removeBackStock(owner, { gameNumber: '1747', packs: 1, reason: 'lost' })`)), 'bad_request');
bs = run(`removeBackStock(owner, { gameNumber: '1747', packs: 1, reason: 'damaged', notes: 'wet' })`);
assert.equal(bs.find((g) => g.gameNumber === '1747').packsInBack, 3);
// activating then takes from these counts
S.SlotConfig.rows.push([4, 1, 1]); S.SlotState.rows.push([4, 1]);
r = run(`activatePack(owner, { box: 4, slot: 1, gameNumber: '2001', packNumber: '0000009', ticketNumber: 239 })`);
assert.equal(r.packsInBack, 4); assert.equal(r.backWasEmpty, false);
console.log('back stock scenarios pass');
console.log('all slot, close and pack-size scenarios pass');
