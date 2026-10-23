// Theft Report backend (Reports.js theftReport, owner's request 2026-10-23): every live pack's game, pack and
// unsold ticket range at the last close (descending 000–top, ascending top–last, a pack put in since the close
// from its activation ticket), plus back stock per game for the full report; no dollars for employees.
// Run: node test/theft-report-scenarios.js
const assert = require('assert/strict');
const { backendInVm } = require('./browser/harness');

const { ctx, addRow, call, sheets: S } = backendInVm('2026-10-23', () => '07:12:00');
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
assert.deepEqual(r.live.lines, [
  { box: 1, slot: 1, gameNumber: '1747', packNumber: '0012345', order: 'descending', price: 20,
    fromTicket: 0, toTicket: 24, tickets: 25, dollars: 500, newSinceClose: false },
  { box: 1, slot: 2, gameNumber: '1111', packNumber: '0000777', order: 'ascending', price: 10,
    fromTicket: 10, toTicket: 49, tickets: 40, dollars: 400, newSinceClose: false },
  { box: 2, slot: 1, gameNumber: '1747', packNumber: '0055555', order: 'descending', price: 20,
    fromTicket: 0, toTicket: 29, tickets: 30, dollars: 600, newSinceClose: true },
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
  fromTicket: 0, toTicket: 24, tickets: 25, newSinceClose: false });

// ---- Nothing written ----
const before = JSON.stringify(S);
call(() => ctx.theftReport(owner, { full: true }));
assert.equal(JSON.stringify(S), before, 'the report changes no sheet');

// ---- A sold-out pack drops off; an empty store still makes a report ----
ctx.endPack(owner, { box: 1, slot: 1, reason: 'sold_out' });
r = call(() => ctx.theftReport(owner, {}));
assert.deepEqual(r.live.lines.map((l) => `${l.box}-${l.slot}`), ['1-2', '2-1']);

// ---- No close this month yet (morning of the 1st): last month's newest close ----
S.DailySummary.rows.splice(1);
ctx.lastCloseBeforeThisMonth = () => ({ close_date: '2026-09-30', closed_by: 'o', closed_at: '2026-09-30 22:58' });
r = call(() => ctx.theftReport(owner, {}));
assert.deepEqual(r.lastClose, { date: '2026-09-30', closedAt: '10:58 PM', closedBy: 'o' });
ctx.lastCloseBeforeThisMonth = () => undefined;
r = call(() => ctx.theftReport(owner, {}));
assert.equal(r.lastClose, null, 'no close at all');

console.log('theft report scenarios: all passed');
