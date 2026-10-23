// Parity: back stock and full pack sales on Sheets vs Supabase. Shipments (new games too), Manage Stock counts,
// removing with a reason, the Manage packs dialog, Game ended / Bring back, selling a full pack (employee: no $),
// its undo, and a sale after the close (counts tomorrow, can't be undone once that day closes... today's can't).
// After every step: Back stock (owner, and an employee without $), Slots, Full pack sales, Close Day.
// Run: node test/parity/back-stock.js
const assert = require('assert/strict');
const { parity } = require('./harness');

(async () => {
  const p = await parity({ today: '2026-10-23', time: '10:00:00' });
  let steps = 0;
  const step = async (who, action, req = {}) => {
    const answer = await p.both(who, action, req);
    await p.both('o', 'listBackStock');
    await p.both('sara', 'listBackStock');
    await p.both('o', 'listSlots');
    await p.both('o', 'listFullPackSales');
    await p.both('o', 'closeStatus');
    steps += 1;
    return answer;
  };
  try {
    await p.seed({
      slots: [{ box: 1, slot: 1, price: 20 }, { box: 1, slot: 2, price: 5 }],
      games: [
        { game: '1747', price: 20, size: 30, inBack: 4 },
        { game: '5555', price: 5, size: 80, inBack: 5 },
        { game: '3333', price: 2, size: 100, inBack: 0 },
        { game: '7777', price: 30, size: 30, inBack: 0, endedOn: '2026-10-05' },
      ],
      packs: [{ game: '1747', pack: '0012345', status: 'live', box: 1, slot: 1, price: 20, top: 24, activatedOn: '2026-10-01', lastCloseOn: '2026-10-22' }],
      closes: [{ date: '2026-10-22', tickets: 10, dollars: 200, liveSlots: 1, inventory: 4000, closedBy: 'o', closedAt: '2026-10-22 22:50' }],
    });

    // ---- Who may look ----
    await step('e', 'listBackStock');
    await step('loader', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '1747', packs: 1 }] });

    // ---- Shipment received and its refusals ----
    await step('o', 'saveBackStock', { mode: 'move', lines: [] });
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [] });
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '17', packs: 1 }] });
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '1747', packs: 1 }, { gameNumber: '1747', packs: 2 }] });
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '1747', packs: 0 }] });
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '4242', packs: 2 }] });
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '4242', packs: 2, gamePrice: 10, ticketsPerPack: 'x' }] });
    let r = await step('sara', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '1747', packs: 2 }, { gameNumber: '4242', packs: 2, gamePrice: 10 }],
      notes: 'Tuesday delivery' });
    assert.deepEqual(r.results, [{ gameNumber: '1747', before: 4, after: 6 }, { gameNumber: '4242', before: 0, after: 2 }]);
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '7777', packs: 1 }] });      // ended game is back

    // ---- Manage Stock count ----
    await step('o', 'saveBackStock', { mode: 'count', lines: [{ gameNumber: '1747', packs: -1 }] });
    r = await step('sara', 'saveBackStock', { mode: 'count', lines: [{ gameNumber: '1747', packs: 5 }, { gameNumber: '5555', packs: '5' }, { gameNumber: '3333', packs: 3 }] });
    assert.deepEqual(r.results.map((x) => x.after), [5, 5, 3]);

    // ---- Remove with a reason, and the Manage packs dialog ----
    await step('o', 'removeBackStock', { gameNumber: '5555', packs: 1, reason: 'lost' });
    await step('o', 'removeBackStock', { gameNumber: '5555', packs: 0, reason: 'damaged' });
    await step('o', 'removeBackStock', { gameNumber: '9999', packs: 1, reason: 'damaged' });
    await step('o', 'removeBackStock', { gameNumber: '5555', packs: 9, reason: 'damaged' });
    await step('o', 'removeBackStock', { gameNumber: '5555', packs: 2, reason: 'expired', notes: 'old game' });
    await step('sara', 'removeBackStock', { gameNumber: '5555', packs: 1, reason: 'stolen' });                // owner only
    await step('o', 'adjustBackStock', { gameNumber: '5555', change: 0 });
    await step('o', 'adjustBackStock', { gameNumber: '9999', change: 1 });
    await step('o', 'adjustBackStock', { gameNumber: '5555', change: -9 });
    await step('o', 'adjustBackStock', { gameNumber: '5555', change: 2 });
    await step('o', 'adjustBackStock', { gameNumber: '5555', change: -1 });

    // ---- Game ended / Bring back ----
    await step('o', 'endGame', { gameNumber: '9999' });
    await step('o', 'endGame', { gameNumber: '5555' });                                   // still in the back
    await step('o', 'removeBackStock', { gameNumber: '3333', packs: 3, reason: 'returned' });
    await step('o', 'endGame', { gameNumber: '3333' });
    await step('o', 'endGame', { gameNumber: '3333' });                                   // already ended
    await step('o', 'adjustBackStock', { gameNumber: '3333', change: 1 });                // ended: bring it back first
    await step('o', 'bringBackGame', { gameNumber: '3333' });
    await step('o', 'bringBackGame', { gameNumber: '3333' });                             // not ended now
    await step('o', 'saveBackStock', { mode: 'count', lines: [{ gameNumber: '1747', packs: 0 }] });
    await step('o', 'endGame', { gameNumber: '1747' });                                   // still in box 1, slot 1

    // ---- Full pack sales ----
    await step('o', 'sellFullPack', { gameNumber: '55', packNumber: '1' });
    await step('o', 'sellFullPack', { gameNumber: '9999', packNumber: '0000001' });
    await step('o', 'sellFullPack', { gameNumber: '1747', packNumber: '0000001' });       // none in the back
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '1747', packs: 1 }] });
    await step('o', 'sellFullPack', { gameNumber: '1747', packNumber: '0012345' });       // that one is in a slot
    r = await step('sara', 'sellFullPack', { gameNumber: '5555', packNumber: '0000500' }); // employee: no $
    assert.equal('dollars' in r, false);
    await step('o', 'sellFullPack', { gameNumber: '5555', packNumber: '0000500' });       // already sold
    await step('o', 'sellFullPack', { gameNumber: '4242', packNumber: '0000600' });
    await step('loader', 'undoFullPackSale', { packKey: '4242-0000600' });                // owner only
    await step('o', 'undoFullPackSale', { packKey: '4242-0000600' });
    await step('o', 'undoFullPackSale', { packKey: '4242-0000600' });                     // nothing to undo now

    // ---- Close Day, then a sale after it (counts tomorrow) ----
    await p.setClock('2026-10-23', '22:50:00');
    await step('o', 'submitClose', { entries: [{ box: 1, slot: 1, packKey: '1747-0012345', type: 'scan', ticketNumber: 20 }], closeId: 'c-23' });
    await step('o', 'undoFullPackSale', { packKey: '5555-0000500' });                     // its day is closed
    await p.setClock('2026-10-23', '23:05:00');
    await step('o', 'sellFullPack', { gameNumber: '4242', packNumber: '0000601' });       // dated the 24th, can still be undone
    console.log(`back stock + full packs parity: ${steps} steps match (with Back stock, Slots, Full packs and Close Day after each)`);
  } finally {
    await p.done();
  }
})().catch((e) => { console.error(e); process.exit(1); });
