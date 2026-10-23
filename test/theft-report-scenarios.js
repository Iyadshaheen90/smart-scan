// Theft Report backend (Reports.js theftReport, owner's request 2026-10-23): every live pack's game, pack and
// unsold ticket range at its newest count (descending 000–top, ascending top–last): today's latest shift close that
// counted it, else a pack put in since the close from its activation ticket, else the last close. Plus back stock
// per game for the full report; no dollars for employees.
// Run: node test/theft-report-scenarios.js
const assert = require('assert/strict');
const { backendInVm } = require('./browser/harness');

let clock = '07:12:00';
const { ctx, addRow, call, sheets: S } = backendInVm('2026-10-23', () => clock);
const owner = { username: 'o', role: 'owner' };
const employee = { username: 'sara', role: 'employee', permissions: ['theft_report'] };

addRow('SlotConfig', { box: 1, slot_number: 1, price_per_ticket: 20 });
addRow('SlotConfig', { box: 1, slot_number: 2, price_per_ticket: 10, ticket_order: 'ascending' });
addRow('SlotConfig', { box: 1, slot_number: 3, price_per_ticket: 5 });
addRow('SlotConfig', { box: 2, slot_number: 1, price_per_ticket: 20 });
// Box 2 slot 1 is listed before box 1 in the sheet: the report still goes box 1 → 2.
addRow('SlotState', { box: 2, slot_number: 1 });
// $20 descending, top ticket 024 at last night's close: 000–024 unsold = 25 tickets.
addRow('SlotState', { box: 1, slot_number: 1, pack_key: '1747-0012345', game_number: '1747', pack_number: '0012345',
  price_per_ticket: 20, current_exposed_ticket_number: 24, activation_date: '2026-10-01', last_close_date: '2026-10-22' });
// $10 ascending (50 a pack), top ticket 010: 010–049 unsold = 40 tickets.
addRow('SlotState', { box: 1, slot_number: 2, pack_key: '1111-0000777', game_number: '1111', pack_number: '0000777',
  price_per_ticket: 10, current_exposed_ticket_number: 10, activation_date: '2026-10-10', last_close_date: '2026-10-22',
  ticket_order: 'ascending' });
addRow('SlotState', { box: 1, slot_number: 3, last_game_number: '5555' }); // empty: not in the report
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 3, tickets_in_reserve: 90 });
addRow('ReserveInventory', { game_number: '1111', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 1, tickets_in_reserve: 50 });
addRow('ReserveInventory', { game_number: '0999', price_per_ticket: 1, tickets_per_pack: 240, packs_in_reserve: 2, tickets_in_reserve: 480 });
addRow('ReserveInventory', { game_number: '5555', price_per_ticket: 5, tickets_per_pack: 80, packs_in_reserve: 0, tickets_in_reserve: 0 });
addRow('ReserveInventory', { game_number: '3333', price_per_ticket: 2, tickets_per_pack: 100, packs_in_reserve: 0, tickets_in_reserve: 0, ended_date: '2026-10-05' });
addRow('DailySummary', { close_date: '2026-10-22', total_dollars_sold: 900, closed_by: 'sara', closed_at: '2026-10-22 22:52' });
addRow('DailySummary', { close_date: '2026-10-21', total_dollars_sold: 800 });

// This morning a pack went into box 2 slot 1 before the theft was found: no close yet, from its activation ticket 029.
ctx.activatePack(owner, { box: 2, slot: 1, gameNumber: '1747', packNumber: '0055555', ticketNumber: 29 });

// ---- Live Scratchers (owner) ----
let r = call(() => ctx.theftReport(owner, {}));
assert.equal(r.full, false);
assert.equal(r.madeAt, '2026-10-23 07:12');
assert.deepEqual(r.lastClose, { date: '2026-10-22', closedAt: '10:52 PM', closedBy: 'sara' }, 'the newest close, not the last row');
assert.equal(r.back, null, 'live only: no back stock');
assert.equal(r.lastShift, null, 'no shift close today');
assert.deepEqual(r.live.lines, [
  { box: 1, slot: 1, gameNumber: '1747', packNumber: '0012345', order: 'descending', price: 20,
    fromTicket: 0, toTicket: 24, tickets: 25, dollars: 500, source: 'close' },
  { box: 1, slot: 2, gameNumber: '1111', packNumber: '0000777', order: 'ascending', price: 10,
    fromTicket: 10, toTicket: 49, tickets: 40, dollars: 400, source: 'close' },
  { box: 2, slot: 1, gameNumber: '1747', packNumber: '0055555', order: 'descending', price: 20,
    fromTicket: 0, toTicket: 29, tickets: 30, dollars: 600, source: 'activation' },
]);
assert.deepEqual({ packs: r.live.packs, tickets: r.live.tickets, dollars: r.live.dollars }, { packs: 3, tickets: 95, dollars: 1500 });

// ---- Full Inventory (owner) ----
r = call(() => ctx.theftReport(owner, { full: true }));
assert.equal(r.full, true);
assert.equal(r.live.lines.length, 3, 'live packs are in the full report too');
// 1747 had 3 in the back; this morning's pack came out of it. Games with 0 in the back and ended games are left out.
assert.deepEqual(r.back.lines, [
  { gameNumber: '0999', price: 1, ticketsPerPack: 240, packs: 2, tickets: 480, dollars: 480 },
  { gameNumber: '1111', price: 10, ticketsPerPack: 50, packs: 1, tickets: 50, dollars: 500 },
  { gameNumber: '1747', price: 20, ticketsPerPack: 30, packs: 2, tickets: 60, dollars: 1200 },
]);
assert.deepEqual({ packs: r.back.packs, tickets: r.back.tickets, dollars: r.back.dollars }, { packs: 5, tickets: 590, dollars: 2180 });

// ---- Employee: the same packs and ranges, no dollar amounts anywhere ----
r = call(() => ctx.theftReport(employee, { full: true }));
assert.ok(!JSON.stringify(r).includes('dollars'), JSON.stringify(r));
assert.equal(r.live.tickets, 95);
assert.equal(r.back.tickets, 590);
assert.deepEqual(r.live.lines[0], { box: 1, slot: 1, gameNumber: '1747', packNumber: '0012345', order: 'descending', price: 20,
  fromTicket: 0, toTicket: 24, tickets: 25, source: 'close' });

// ---- Nothing written ----
const before = JSON.stringify(S);
call(() => ctx.theftReport(owner, { full: true }));
assert.equal(JSON.stringify(S), before, 'the report changes no sheet');

// ---- After a mid-day shift close (owner 2026-10-23): each pack counted at it starts from there ----
// 3:02 PM sara closes her shift: 1-1 now at 015 (desc), 1-2 at 020 (asc), 2-1 sold out (still in its slot).
clock = '15:02:00';
ctx.submitShiftClose(employee, [
  { box: 1, slot: 1, packKey: '1747-0012345', type: 'scan', ticketNumber: 15 },
  { box: 1, slot: 2, packKey: '1111-0000777', type: 'scan', ticketNumber: 20 },
  { box: 2, slot: 1, packKey: '1747-0055555', type: 'sold_out' },
], 'shift1');
// 4 PM a $5 pack goes into 1-3 (after the shift close): from its activation ticket.
clock = '16:00:00';
ctx.activatePack(owner, { box: 1, slot: 3, gameNumber: '5555', packNumber: '0000042', ticketNumber: 79 });
clock = '18:30:00';
r = call(() => ctx.theftReport(owner, {}));
assert.deepEqual(r.lastShift, { closedAt: '3:02 PM', closedBy: 'sara' });
assert.deepEqual(r.lastClose, { date: '2026-10-22', closedAt: '10:52 PM', closedBy: 'sara' }, 'still shown');
assert.deepEqual(r.live.lines, [
  { box: 1, slot: 1, gameNumber: '1747', packNumber: '0012345', order: 'descending', price: 20, source: 'shift',
    shiftAt: '3:02 PM', shiftBy: 'sara', fromTicket: 0, toTicket: 15, tickets: 16, dollars: 320 },
  { box: 1, slot: 2, gameNumber: '1111', packNumber: '0000777', order: 'ascending', price: 10, source: 'shift',
    shiftAt: '3:02 PM', shiftBy: 'sara', fromTicket: 20, toTicket: 49, tickets: 30, dollars: 300 },
  { box: 1, slot: 3, gameNumber: '5555', packNumber: '0000042', order: 'descending', price: 5, source: 'activation',
    fromTicket: 0, toTicket: 79, tickets: 80, dollars: 400 },
  { box: 2, slot: 1, gameNumber: '1747', packNumber: '0055555', order: 'descending', price: 20, source: 'shift',
    shiftAt: '3:02 PM', shiftBy: 'sara', soldOutAt: '3:02 PM', fromTicket: null, toTicket: null, tickets: 0, dollars: 0 },
]);
assert.deepEqual({ packs: r.live.packs, tickets: r.live.tickets, dollars: r.live.dollars }, { packs: 3, tickets: 126, dollars: 1020 },
  'a pack sold out at the shift close has nothing to stop and isn\'t counted');
// A second shift close at 5 PM by the owner: 1-1 now 010; 1-3 counted for the first time. The newest one wins,
// except a sold out pack keeps the time it sold out (3:02 PM), not the later shift close that repeated it.
clock = '17:00:00';
ctx.submitShiftClose(owner, [
  { box: 1, slot: 1, packKey: '1747-0012345', type: 'scan', ticketNumber: 10 },
  { box: 1, slot: 2, packKey: '1111-0000777', type: 'scan', ticketNumber: 20 },
  { box: 1, slot: 3, packKey: '5555-0000042', type: 'scan', ticketNumber: 70 },
], 'shift2');
r = call(() => ctx.theftReport(employee, {}));
assert.deepEqual(r.lastShift, { closedAt: '5:00 PM', closedBy: 'o' });
assert.deepEqual(r.live.lines.map((l) => [l.slot, l.source, l.shiftAt, l.toTicket, l.tickets]),
  [[1, 'shift', '5:00 PM', 10, 11], [2, 'shift', '5:00 PM', 49, 30], [3, 'shift', '5:00 PM', 70, 71], [1, 'shift', '3:02 PM', null, 0]]);
assert.ok(!JSON.stringify(r).includes('dollars'), 'employee: still no dollars');
// Once today is closed, the close is newer than any shift close: back to SlotState.
addRow('DailySummary', { close_date: '2026-10-23', closed_by: 'o', closed_at: '2026-10-23 23:01' });
r = call(() => ctx.theftReport(owner, {}));
assert.equal(r.lastShift, null);
assert.deepEqual(r.lastClose, { date: '2026-10-23', closedAt: '11:01 PM', closedBy: 'o' });
assert.ok(r.live.lines.every((l) => l.source !== 'shift' && !l.soldOutAt));
S.DailySummary.rows.pop();

// ---- A sold-out pack drops off; an empty store still makes a report ----
ctx.endPack(owner, { box: 1, slot: 1, reason: 'sold_out' });
r = call(() => ctx.theftReport(owner, {}));
assert.deepEqual(r.live.lines.map((l) => `${l.box}-${l.slot}`), ['1-2', '1-3', '2-1']);

// ---- No close this month yet (morning of the 1st): last month's newest close ----
S.DailySummary.rows.splice(1);
ctx.lastCloseBeforeThisMonth = () => ({ close_date: '2026-09-30', closed_by: 'o', closed_at: '2026-09-30 22:58' });
r = call(() => ctx.theftReport(owner, {}));
assert.deepEqual(r.lastClose, { date: '2026-09-30', closedAt: '10:58 PM', closedBy: 'o' });
ctx.lastCloseBeforeThisMonth = () => undefined;
r = call(() => ctx.theftReport(owner, {}));
assert.equal(r.lastClose, null, 'no close at all');

console.log('theft report scenarios: all passed');
