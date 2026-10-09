// Ticket order (descending / ascending per slot) against the real backend code on a fake spreadsheet.
// Run with: node test/ticket-order-scenarios.js
globalThis.TODAY = '2026-10-08';
const fs = require('fs'); const vm = require('vm'); const path = require('path'); const assert = require('assert/strict');
const dir = path.join(__dirname, '..', 'src', 'apps-script');
const { fakeSheet } = require('./fakes');
const ctx = { console, Utilities: { formatDate: (d, tz, fmt) => tz === 'UTC' ? d.toISOString().slice(0, 10) : fmt === 'yyyy-MM-dd HH:mm' ? `${globalThis.TODAY} 22:52` : fmt === 'yyyy-MM-dd HH:mm:ss' ? `${globalThis.TODAY} ${globalThis.CLOCK || '12:00:00'}` : globalThis.TODAY }, Session: { getScriptTimeZone: () => 'x' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) } };
vm.createContext(ctx);
for (const f of ['Schema.js', 'Sheets.js', 'Tickets.js', 'Slots.js', 'Close.js', 'Backstock.js', 'FullPacks.js', 'Shifts.js', 'Permissions.js', 'WebApp.js']) vm.runInContext(fs.readFileSync(`${dir}/${f}`, 'utf8'), ctx);
// SlotConfig, SlotState and PackHistory as they were before ticket_order existed (an old month sheet).
const OLD = { SlotConfig: 3, SlotState: 13, PackHistory: 12 };
vm.runInContext(`class ApiError extends Error { constructor(c, m) { super(m); this.code = c; } }
  const sheets = {}; for (const [n, h] of Object.entries(MONTHLY_TABS)) sheets[n] = fakeSheetFn(h, OLD[n] ? h.slice(0, OLD[n]) : null, 100);
  function monthSheet(n) { return sheets[n]; }`, Object.assign(ctx, { fakeSheetFn: fakeSheet, OLD }));
const S = vm.runInContext('sheets', ctx);
for (let slot = 1; slot <= 4; slot++) { S.SlotConfig.rows.push([1, slot, 20]); S.SlotState.rows.push([1, slot]); }
S.ReserveInventory.rows.push(['1747', 20, 30, 10, 300]);
const owner = { username: 'o', role: 'owner' };
const emp = { username: 'e', role: 'employee', permissions: [] };
const orderer = { username: 'e', role: 'employee', permissions: ['ticket_order'] };
const run = (code) => vm.runInContext(code, Object.assign(ctx, { owner, emp, orderer }));
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'none'; };
const at = (slot) => run('listSlots()').find((s) => s.slot === slot);
const activate = (slot, pack, ticket) => run(`activatePack(owner, { box: 1, slot: ${slot}, gameNumber: '1747', packNumber: '${pack}', ticketNumber: ${ticket} })`);
const key = (s) => `${s.pack.gameNumber}-${s.pack.packNumber}`;
const closeAll = (tickets, id) => run(`submitClose(emp, ${JSON.stringify(run('listSlots()').filter((s) => s.pack).map((s) => ({
  box: 1, slot: s.slot, packKey: key(s), ...(tickets[s.slot] === 'sold_out' ? { type: 'sold_out' } : { type: 'scan', ticketNumber: tickets[s.slot] ?? s.pack.exposedTicket }) })))}, '${id}')`);

// An old sheet reads as descending everywhere.
assert.equal(at(1).slotOrder, 'descending');
activate(1, '0000001', 29);
assert.equal(at(1).pack.order, 'descending'); assert.equal(at(1).pack.remaining, 30);

// Setting the order: only while the slot is empty, and only with the permission.
assert.equal(code(() => run(`setSlotOrder(owner, { box: 1, slot: 1, order: 'ascending' })`)), 'slot_occupied');
assert.equal(code(() => run(`setSlotOrder(emp, { box: 1, slot: 2, order: 'ascending' })`)), 'forbidden');
assert.equal(code(() => run(`setSlotOrder(owner, { box: 1, slot: 2, order: 'sideways' })`)), 'bad_request');
assert.equal(run(`setSlotOrder(orderer, { box: 1, slot: 2, order: 'ascending' })`).slotOrder, 'ascending');
assert.equal(at(2).slotOrder, 'ascending'); assert.equal(at(2).pack, null);
// The router lets an employee with the permission in.
assert.equal(run(`SIGNED_IN_ACTIONS.setSlotOrder.allow.some((p) => can(orderer, p))`), true);
assert.equal(run(`SIGNED_IN_ACTIONS.setAllSlotsOrder.allow.some((p) => can(emp, p))`), false);

// Ascending pack: 000 → 30 left.
activate(2, '0000002', 0);
assert.equal(at(2).pack.order, 'ascending'); assert.equal(at(2).pack.remaining, 30);
assert.equal(code(() => activate(3, '0000003', 30)), 'bad_ticket'); // no ticket 030 in a 30-ticket pack

// Close at 005 (ascending) and 024 (descending): 5 sold each, 25 left each.
let r = closeAll({ 1: 24, 2: 5 }, 'c1');
assert.equal(r.ticketsSold, 10);
assert.equal(at(2).pack.remaining, 25); assert.equal(at(1).pack.remaining, 25);
const log = (slot) => run(`readTable(monthSheet('DailyCloseLog'))`).filter((x) => Number(x.slot_number) === slot).pop();
assert.equal(log(2).tickets_sold, 5); assert.equal(log(2).remaining_after_close, 25);
// Inventory value counts the ascending pack's 25 left: (25 + 25) × $20 + back stock.
assert.equal(run(`readTable(monthSheet('DailySummary'))`)[0].total_inventory_value, 50 * 20 + 8 * 30 * 20);

// Next day: an ascending ticket below the last top ticket was already sold.
globalThis.TODAY = '2026-10-09';
assert.equal(code(() => closeAll({ 1: 24, 2: 3 }, 'c2')), 'bad_ticket');
try { closeAll({ 1: 24, 2: 3 }, 'c2'); } catch (e) { assert.match(e.message, /below the last top ticket \(5\)/); }
assert.equal(code(() => closeAll({ 1: 25, 2: 5 }, 'c2')), 'bad_ticket'); // descending: above is sold

// Shift close: 005 → 012 = 7 sold (the shift's start for the next shift close is 012: 18 left).
globalThis.CLOCK = '13:00:00';
r = run(`submitShiftClose(emp, ${JSON.stringify([{ box: 1, slot: 1, packKey: '1747-0000001', type: 'scan', ticketNumber: 24 },
  { box: 1, slot: 2, packKey: '1747-0000002', type: 'scan', ticketNumber: 12 }])}, 's1')`);
assert.equal(r.ticketsSold, 7);
assert.equal(run(`shiftStatus(owner)`).slots.find((s) => s.slot === 2).pack.remaining, 18);
assert.equal(code(() => run(`submitShiftClose(owner, ${JSON.stringify([{ box: 1, slot: 1, packKey: '1747-0000001', type: 'scan', ticketNumber: 24 },
  { box: 1, slot: 2, packKey: '1747-0000002', type: 'scan', ticketNumber: 10 }])}, 'sx')`)), 'bad_ticket');

// Returned at 015: 005..014 sold since the last close (10), 015..029 go back (15). Refused below the last top ticket.
globalThis.CLOCK = '14:00:00';
assert.equal(code(() => run(`endPack(owner, { box: 1, slot: 2, reason: 'returned', ticketNumber: 4 })`)), 'bad_ticket');
assert.equal(code(() => run(`endPack(owner, { box: 1, slot: 2, reason: 'returned', ticketNumber: 30 })`)), 'bad_ticket');
r = run(`endPack(owner, { box: 1, slot: 2, reason: 'returned', ticketNumber: 15 })`);
assert.deepEqual({ ...r }, { packKey: '1747-0000002', reason: 'returned', ticketsSoldToday: 10, remainingReturned: 15 });
const hist = run(`readTable(monthSheet('PackHistory'))`).pop();
assert.equal(hist.ticket_order, 'ascending'); assert.equal(hist.final_tickets_sold_total, 15);
// The next shift close counts the return from the first shift's ticket: 012 → 015 = 3.
globalThis.CLOCK = '15:00:00';
r = run(`submitShiftClose(owner, ${JSON.stringify([{ box: 1, slot: 1, packKey: '1747-0000001', type: 'scan', ticketNumber: 24 }])}, 's2')`);
assert.equal(r.ticketsSold, 3);

// Put back (undo) keeps it ascending even after the empty slot was switched to descending.
run(`setSlotOrder(owner, { box: 1, slot: 2, order: 'descending' })`);
run(`undoEndPack(owner, { box: 1, slot: 2 })`);
assert.equal(at(2).pack.order, 'ascending'); assert.equal(at(2).pack.exposedTicket, 5); assert.equal(at(2).pack.remaining, 25);
assert.equal(at(2).slotOrder, 'descending');

// Sold out at a shift close counts every ticket left the pack's way, from today's first shift close's 012: 012..029 = 18.
globalThis.CLOCK = '16:00:00';
r = run(`submitShiftClose(owner, ${JSON.stringify([{ box: 1, slot: 1, packKey: '1747-0000001', type: 'scan', ticketNumber: 24 },
  { box: 1, slot: 2, packKey: '1747-0000002', type: 'sold_out' }])}, 's3')`);
assert.equal(r.ticketsSold, 18);

// Sold out from the last ticket showing (029, ascending): 1 sold.
globalThis.TODAY = '2026-10-10';
closeAll({ 1: 24, 2: 29 }, 'c3');
assert.equal(at(2).pack.remaining, 1);
r = run(`endPack(owner, { box: 1, slot: 2, reason: 'sold_out' })`);
assert.equal(r.ticketsSoldToday, 1);
assert.equal(run(`readTable(monthSheet('PackHistory'))`).pop().final_tickets_sold_total, 30);
// The slot is descending now, so its next pack is too.
activate(2, '0000004', 29);
assert.equal(at(2).pack.order, 'descending');

// Swap: the pack keeps its order and the slots' settings trade places with their prices.
run(`setSlotOrder(owner, { box: 1, slot: 3, order: 'ascending' })`);
activate(3, '0000005', 0);
run(`swapSlots({ box: 1, slot: 3, toBox: 1, toSlot: 4 })`);
assert.equal(at(4).pack.order, 'ascending'); assert.equal(at(4).slotOrder, 'ascending');
assert.equal(at(3).pack, null); assert.equal(at(3).slotOrder, 'descending');
run(`swapSlots({ box: 1, slot: 3, toBox: 1, toSlot: 4 })`);
assert.equal(at(3).pack.order, 'ascending'); assert.equal(at(3).slotOrder, 'ascending');

// Pack size check works the same for an ascending pack (its top ticket must fit).
assert.equal(code(() => run(`setPackSize({ gameNumber: '1747', ticketsPerPack: 20 })`)), 'bad_size');

// Set all slots: empty ones switch now; slots whose pack counts the other way switch when it ends.
assert.equal(code(() => run(`setAllSlotsOrder(emp, { order: 'ascending' })`)), 'forbidden');
r = run(`setAllSlotsOrder(orderer, { order: 'ascending' })`);
assert.deepEqual({ ...r }, { order: 'ascending', slots: 4, nowSlots: 2, waitingSlots: 2 }); // slots 1, 2 are descending packs
assert.deepEqual([...run('listSlots()').map((s) => s.slotOrder)], ['ascending', 'ascending', 'ascending', 'ascending']);
assert.equal(at(1).pack.order, 'descending'); assert.equal(at(1).pack.remaining, 25);
run(`endPack(owner, { box: 1, slot: 1, reason: 'sold_out' })`);
activate(1, '0000006', 0);
assert.equal(at(1).pack.order, 'ascending');
r = run(`setAllSlotsOrder(owner, { order: 'descending' })`);
assert.deepEqual({ ...r }, { order: 'descending', slots: 4, nowSlots: 2, waitingSlots: 2 }); // slots 1, 3 hold ascending packs

console.log('ticket order scenarios pass');
