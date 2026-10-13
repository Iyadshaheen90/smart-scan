// Reports tab backend (Reports.js): Shipments Received and Returned Packs lists, and the Reports page totals.
// Rows are made by the real actions (shipment scan-in, Manage packs +/−, slot Returned, undo) on an in-memory sheet.
// Run: node test/reports-scenarios.js
const assert = require('assert/strict');
const { backendInVm } = require('./browser/harness');

const { ctx, sheets: S, addRow, call } = backendInVm('2026-10-06');
const owner = { username: 'o', role: 'owner' };
for (let slot = 1; slot <= 3; slot++) {
  addRow('SlotConfig', { box: 1, slot_number: slot, price_per_ticket: 20 });
  addRow('SlotState', { box: 1, slot_number: slot });
}
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 4, tickets_in_reserve: 120 });
addRow('ReserveInventory', { game_number: '1111', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 2, tickets_in_reserve: 100 });
// Moves the last row of a tab to another day (the fake "today" is fixed).
const redate = (tab, column, date) => { const rows = S[tab].rows; rows.at(-1)[rows[0].indexOf(column)] = date; };

// ---- Shipments Received ----
let r = call(() => ctx.listShipments());
assert.deepEqual(r, { packs: 0, dollars: 0, lines: [] });
// Oct 5: 2 packs of 1747 scanned in.
ctx.saveBackStock(owner, 'shipment', [{ gameNumber: '1747', packs: 2 }]);
redate('Shipments', 'shipment_date', '2026-10-05');
// Oct 6: 1747 scanned in twice (1, then 2 more) -> one line of 3; 1111 added by hand with Manage packs +;
// a new game 4242 ($5, 80 a pack).
ctx.saveBackStock(owner, 'shipment', [{ gameNumber: '1747', packs: 1 }]);
ctx.saveBackStock(owner, 'shipment', [{ gameNumber: '1747', packs: 2 }]);
ctx.adjustBackStock(owner, { gameNumber: '1111', change: 1 });
ctx.saveBackStock(owner, 'shipment', [{ gameNumber: '4242', packs: 1, gamePrice: 5 }]);
// Scanned and hand-added packs of one game on one day stay apart.
ctx.adjustBackStock(owner, { gameNumber: '1747', change: 1 });
r = call(() => ctx.listShipments());
assert.deepEqual(r.lines, [
  { date: '2026-10-06', gameNumber: '1111', packs: 1, price: 10, ticketsPerPack: 50, dollars: 500, addedByHand: true },
  { date: '2026-10-06', gameNumber: '1747', packs: 3, price: 20, ticketsPerPack: 30, dollars: 1800, addedByHand: false },
  { date: '2026-10-06', gameNumber: '1747', packs: 1, price: 20, ticketsPerPack: 30, dollars: 600, addedByHand: true },
  { date: '2026-10-06', gameNumber: '4242', packs: 1, price: 5, ticketsPerPack: 80, dollars: 400, addedByHand: false },
  { date: '2026-10-05', gameNumber: '1747', packs: 2, price: 20, ticketsPerPack: 30, dollars: 1200, addedByHand: false },
]);
assert.equal(r.packs, 8); assert.equal(r.dollars, 4500);
// The same total as Months & totals "Shipments in" (tickets_received × price of every row).
const shipmentValue = ctx.readTable(S.Shipments).reduce((sum, s) => sum + s.tickets_received * s.price_per_ticket, 0);
assert.equal(r.dollars, shipmentValue);
// A count, or Manage packs −, is not a shipment.
ctx.saveBackStock(owner, 'count', [{ gameNumber: '4242', packs: 1 }]);
ctx.adjustBackStock(owner, { gameNumber: '4242', change: -1 });
assert.equal(call(() => ctx.listShipments()).packs, 8);
console.log('shipments report scenarios pass');

// ---- Returned Packs ----
assert.deepEqual(call(() => ctx.listReturns()), { packs: 0, dollars: 0, lines: [] });
// Slot 1: pack returned with top ticket 20 -> 21 tickets go back ($420).
ctx.activatePack(owner, { box: 1, slot: 1, gameNumber: '1747', packNumber: '0000001', ticketNumber: 29 });
ctx.endPack(owner, { box: 1, slot: 1, reason: 'returned', ticketNumber: 20 });
// Slot 2: returned, then undone (marked by mistake) -> not listed.
ctx.activatePack(owner, { box: 1, slot: 2, gameNumber: '1747', packNumber: '0000002', ticketNumber: 29 });
ctx.endPack(owner, { box: 1, slot: 2, reason: 'returned', ticketNumber: 10 });
ctx.undoEndPack(owner, { box: 1, slot: 2 });
// Slot 3: sold out -> not a return.
ctx.activatePack(owner, { box: 1, slot: 3, gameNumber: '1747', packNumber: '0000003', ticketNumber: 29 });
ctx.endPack(owner, { box: 1, slot: 3, reason: 'sold_out' });
// Back stock: 1111 returned twice today (1 + 1 -> one line of 2, $1,000), 1747 once on Oct 5, one 1747 damaged (left out).
ctx.removeBackStock(owner, { gameNumber: '1111', packs: 1, reason: 'returned' });
ctx.removeBackStock(owner, { gameNumber: '1111', packs: 1, reason: 'returned' });
ctx.removeBackStock(owner, { gameNumber: '1747', packs: 1, reason: 'returned' });
redate('ReserveAdjustments', 'adjustment_date', '2026-10-05');
ctx.removeBackStock(owner, { gameNumber: '1747', packs: 1, reason: 'damaged' });
r = call(() => ctx.listReturns());
assert.deepEqual(r.lines, [
  { date: '2026-10-06', kind: 'back', gameNumber: '1111', packs: 2, price: 10, ticketsPerPack: 50, dollars: 1000 },
  { date: '2026-10-06', kind: 'slot', gameNumber: '1747', packNumber: '0000001', box: 1, slot: 1, packs: 1,
    ticketsReturned: 21, price: 20, ticketsPerPack: 30, dollars: 420 },
  { date: '2026-10-05', kind: 'back', gameNumber: '1747', packs: 1, price: 20, ticketsPerPack: 30, dollars: 600 },
]);
assert.equal(r.packs, 4); assert.equal(r.dollars, 2020);
console.log('returns report scenarios pass');

// ---- Reports page: one request, the month's sold $ and both reports' totals ----
addRow('DailySummary', { close_date: '2026-10-05', total_dollars_sold: 700 });
addRow('DailySummary', { close_date: '2026-10-06', total_dollars_sold: 1250 });
assert.deepEqual(call(() => ctx.reportsPage()), {
  monthDollars: 1950, shipments: { packs: 8, dollars: 4500 }, returns: { packs: 4, dollars: 2020 },
});
console.log('reports page scenarios pass');
