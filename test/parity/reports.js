// Parity: the Reports tab and the Theft Report on Sheets vs Supabase. Shipments (scanned, added by hand, both on one
// day), returns (from a slot, sealed from the back), the Reports numbers, and the Theft Report (live and full, owner and
// employee without $) before and after shift closes (ranges from the newest count, a pack sold out at a shift close),
// a pack put in since, and after Close Day. After every step: the three reports and both Theft Reports.
// Run: node test/parity/reports.js
const assert = require('assert/strict');
const { parity } = require('./harness');

(async () => {
  const p = await parity({ today: '2026-10-23', time: '08:00:00' });
  let steps = 0;
  const step = async (who, action, req = {}) => {
    const answer = await p.both(who, action, req);
    await p.both('o', 'listShipments');
    await p.both('o', 'listReturns');
    await p.both('o', 'reportsPage');
    await p.both('o', 'theftReport', { full: true });
    await p.both('sara', 'theftReport', {});
    steps += 1;
    return answer;
  };
  const at = (time) => p.setClock('2026-10-23', time);
  try {
    await p.seed({
      slots: [{ box: 1, slot: 1, price: 20 }, { box: 1, slot: 2, price: 10, order: 'ascending' }, { box: 1, slot: 3, price: 5 }, { box: 1, slot: 4, price: 20 }],
      games: [{ game: '1747', price: 20, size: 30, inBack: 2 }, { game: '1111', price: 10, size: 50, inBack: 1 }, { game: '5555', price: 5, size: 80, inBack: 3 },
        { game: '3333', price: 2, size: 100, inBack: 0, endedOn: '2026-10-05' }],
      packs: [
        { game: '1747', pack: '0012345', status: 'live', box: 1, slot: 1, price: 20, top: 24, activatedOn: '2026-10-01', lastCloseOn: '2026-10-22' },
        { game: '1111', pack: '0000777', status: 'live', box: 1, slot: 2, price: 10, top: 10, order: 'ascending', activatedOn: '2026-10-10', lastCloseOn: '2026-10-22' },
        { game: '5555', pack: '0000042', status: 'live', box: 1, slot: 3, price: 5, top: 79, activatedOn: '2026-10-20', lastCloseOn: '2026-10-22' },
        { game: '1747', pack: '0000009', status: 'returned', box: 1, slot: 4, price: 20, activatedOn: '2026-10-01', endedOn: '2026-10-05',
          endReason: 'returned', remainingAtEnd: 12 },
      ],
      closes: [{ date: '2026-10-21', tickets: 5, dollars: 100, liveSlots: 3, inventory: 4100 },
        { date: '2026-10-22', tickets: 10, dollars: 200, liveSlots: 3, inventory: 4000, closedBy: 'o', closedAt: '2026-10-22 22:50' }],
    });

    await step('e', 'theftReport', {});                                                     // no permission
    await step('loader', 'listShipments');                                                  // owner only
    let r = await step('o', 'theftReport', {});
    assert.equal(r.back, null);
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '1747', packs: 2 }, { gameNumber: '4242', packs: 1, gamePrice: 10 }] });
    await step('o', 'adjustBackStock', { gameNumber: '1747', change: 1 });                  // added by hand, same day
    await step('o', 'adjustBackStock', { gameNumber: '5555', change: 2 });                  // by hand first …
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '5555', packs: 1 }] }); // … then scanned
    await step('o', 'removeBackStock', { gameNumber: '5555', packs: 2, reason: 'returned' });
    await step('o', 'removeBackStock', { gameNumber: '5555', packs: 1, reason: 'returned' }); // same game, same day: one line
    await step('o', 'removeBackStock', { gameNumber: '1111', packs: 1, reason: 'damaged' });  // not a return
    await at('09:00:00');
    await step('o', 'endPack', { box: 1, slot: 1, reason: 'returned', ticketNumber: 20 });
    await step('o', 'activatePack', { box: 1, slot: 1, gameNumber: '1747', packNumber: '0000300', ticketNumber: 29 }); // put in since the close

    // ---- Shift closes: ranges from the newest count; 1-3 sold out at the first ----
    await at('13:00:00');
    await step('sara', 'submitShiftClose', { entries: [
      { box: 1, slot: 1, packKey: '1747-0000300', type: 'scan', ticketNumber: 25 },
      { box: 1, slot: 2, packKey: '1111-0000777', type: 'scan', ticketNumber: 20 },
      { box: 1, slot: 3, packKey: '5555-0000042', type: 'sold_out' }], shiftId: 's1' });
    await at('17:00:00');
    r = await step('o', 'submitShiftClose', { entries: [
      { box: 1, slot: 1, packKey: '1747-0000300', type: 'scan', ticketNumber: 15 },
      { box: 1, slot: 2, packKey: '1111-0000777', type: 'scan', ticketNumber: 30 }], shiftId: 's2' });
    r = await p.both('o', 'theftReport', { full: 1 });
    assert.deepEqual(r.live.lines.map((l) => [l.slot, l.source, l.fromTicket, l.toTicket, l.soldOutAt || null]),
      [[1, 'shift', 0, 15, null], [2, 'shift', 30, 49, null], [3, 'shift', null, null, '1:00 PM']]);

    // ---- After Close Day: back to the close ----
    await at('22:50:00');
    await step('o', 'submitClose', { entries: [
      { box: 1, slot: 1, packKey: '1747-0000300', type: 'scan', ticketNumber: 10 },
      { box: 1, slot: 2, packKey: '1111-0000777', type: 'scan', ticketNumber: 35 },
      { box: 1, slot: 3, packKey: '5555-0000042', type: 'sold_out' }], closeId: 'c-23' });
    console.log(`reports + Theft Report parity: ${steps} steps match (with all three reports and both Theft Reports after each)`);
  } finally {
    await p.done();
  }
})().catch((e) => { console.error(e); process.exit(1); });
