// Parity: a day at the counter on Sheets vs Supabase. Putting packs in (from the back, a new game, a price change),
// the mistakes and their undos, ending packs, swapping, slot settings, Close Day (every refusal, a sold out at the
// close, a resend, the wrong day), a pack ended after the close (counts tomorrow), and reopening the close.
// After every step, Slots and Close Day (owner and employee) must match too. Run: node test/parity/slots-close-day.js
const assert = require('assert/strict');
const { parity } = require('./harness');

(async () => {
  const p = await parity({ today: '2026-10-23', time: '09:00:00' });
  let steps = 0;
  // One step, then the screens it changes.
  const step = async (who, action, req = {}) => {
    const answer = await p.both(who, action, req);
    await p.both('o', 'listSlots');
    await p.both('o', 'closeStatus');
    await p.both('e', 'closeStatus');
    steps += 1;
    return answer;
  };
  try {
    await p.seed({
      slots: [
        { box: 1, slot: 1, price: 20 },
        { box: 1, slot: 2, price: 10, order: 'ascending' },
        { box: 1, slot: 3, price: 5, lastGame: '5555' },
        { box: 1, slot: 4, price: 20 },
      ],
      games: [
        { game: '1747', price: 20, size: 30, inBack: 2 },
        { game: '1111', price: 10, size: 50, inBack: 1 },
        { game: '5555', price: 5, size: 80, inBack: 3 },
        { game: '3333', price: 2, size: 100, inBack: 0, endedOn: '2026-10-05' },
      ],
      packs: [
        { game: '1747', pack: '0012345', status: 'live', box: 1, slot: 1, price: 20, top: 24, activatedOn: '2026-09-20', lastCloseOn: '2026-10-22' },
        { game: '1111', pack: '0000777', status: 'live', box: 1, slot: 2, price: 10, top: 10, order: 'ascending',
          activatedOn: '2026-10-10', lastCloseOn: '2026-10-22' },
      ],
      closes: [{ date: '2026-10-22', tickets: 40, dollars: 800, liveSlots: 2, inventory: 3000, closedBy: 'sara', closedAt: '2026-10-22 22:52' }],
    });
    const put = (box, slot, game, pack, ticket, extra = {}) => ({ box, slot, gameNumber: game, packNumber: pack, ticketNumber: ticket, ...extra });

    // ---- Putting packs in ----
    await step('e', 'activatePack', put(1, 3, '5555', '0000100', 79));                 // no Load packs
    await step('o', 'activatePack', put(1, 3, '555', '0000100', 79));                  // not a ticket
    await step('o', 'activatePack', put(9, 9, '5555', '0000100', 79));                 // no such slot
    let r = await step('o', 'activatePack', put(1, 3, '5555', '0000100', 79));         // from the back: 3 -> 2
    assert.equal(r.packsInBack, 2);
    await step('o', 'activatePack', put(1, 4, '5555', '0000100', 70));                 // already live in 1-3
    await step('o', 'activatePack', put(1, 4, '1747', '0000200', 29));
    await step('o', 'activatePack', put(1, 4, '1747', '0000201', 29));                // slot occupied: sold out or returned?
    r = await step('loader', 'undoActivation', { box: 1, slot: 4 });                   // wrong slot: back in the back
    assert.equal(r.returnedToBack, true);
    await step('o', 'activatePack', put(1, 4, '5555', '0000101', 79));                 // $5 game in a $20 slot: confirm
    await step('o', 'activatePack', put(1, 4, '5555', '0000101', 79, { overridePrice: true }));
    r = await step('o', 'undoActivation', { box: 1, slot: 4 });                        // slot back to $20
    assert.equal(r.slotPrice, 20);
    await step('o', 'activatePack', put(1, 4, '4242', '0000001', 29));                 // new game: price needed
    await step('o', 'activatePack', put(1, 4, '4242', '0000001', 29, { gamePrice: 20 }));
    await step('o', 'activatePack', put(1, 4, '1111', '0000002', 60, { oldPackEnd: 'sold_out' })); // 60 can't be in a 50-ticket pack
    await step('o', 'activatePack', put(1, 4, '3333', '0000003', 99, { oldPackEnd: 'sold_out', overridePrice: true })); // ended game is back
    await step('o', 'undoActivation', { box: 1, slot: 4 });
    await step('o', 'undoActivation', { box: 1, slot: 4 });                            // empty now

    // ---- Ending packs and undoing ----
    await step('e', 'endPack', { box: 1, slot: 1, reason: 'returned', ticketNumber: 20 });
    await step('loader', 'endPack', { box: 1, slot: 1, reason: 'gone' });
    await step('loader', 'endPack', { box: 1, slot: 1, reason: 'returned', ticketNumber: 30 }); // above the top ticket
    r = await step('loader', 'endPack', { box: 1, slot: 1, reason: 'returned', ticketNumber: 20 });
    assert.deepEqual(r, { packKey: '1747-0012345', reason: 'returned', ticketsSoldToday: 4, remainingReturned: 21 });
    await step('loader', 'endPack', { box: 1, slot: 1, reason: 'sold_out' });             // empty
    await step('loader', 'undoEndPack', { box: 1, slot: 1 });
    await step('o', 'undoEndPack', { box: 1, slot: 1 });                                  // in it now
    await step('o', 'endPack', { box: 1, slot: 2, reason: 'returned', ticketNumber: 5 }); // ascending: below the top
    await step('o', 'endPack', { box: 1, slot: 2, reason: 'returned', ticketNumber: 40 });

    // ---- Settings and swaps ----
    await step('o', 'setSlotOrder', { box: 1, slot: 1, order: 'ascending' });            // occupied
    await step('e', 'setSlotOrder', { box: 1, slot: 4, order: 'ascending' });
    await step('sara', 'setSlotOrder', { box: 1, slot: 4, order: 'sideways' });
    await step('sara', 'setSlotOrder', { box: 1, slot: 4, order: 'ascending' });
    r = await step('sara', 'setAllSlotsOrder', { order: 'descending' });
    assert.equal(r.waitingSlots, 0);
    await step('o', 'setSlotPrice', { box: 1, slot: 4, price: 0 });
    await step('o', 'setSlotPrice', { box: 2, slot: 4, price: 5 });
    await step('o', 'setSlotPrice', { box: 1, slot: 4, price: '5' });
    await step('sara', 'setSlotPrice', { box: 1, slot: 4, price: 5 });                   // owner only
    await step('o', 'swapSlots', { box: 1, slot: 1, toBox: 1, toSlot: 1 });
    await step('o', 'swapSlots', { box: 1, slot: 1, toBox: 1, toSlot: 2 });              // move into the empty slot
    await step('o', 'swapSlots', { box: 1, slot: 3, toBox: 1, toSlot: 2 });              // two live packs
    await step('o', 'swapSlots', { box: 1, slot: 3, toBox: 1, toSlot: 2 });              // and back
    await step('o', 'setPackSize', { gameNumber: '1747', ticketsPerPack: 20 });         // pack on ticket 24
    await step('o', 'setPackSize', { gameNumber: '9999', ticketsPerPack: 20 });
    await step('o', 'setPackSize', { gameNumber: '5555', ticketsPerPack: 'x' });
    await step('o', 'setPackSize', { gameNumber: '5555', ticketsPerPack: 100 });

    // ---- Close Day at 10:50 PM ----
    await p.setClock('2026-10-23', '22:50:00');
    const live = (await p.both('o', 'listSlots')).filter((s) => s.pack);
    const entry = (s, extra) => ({ box: s.box, slot: s.slot, packKey: `${s.pack.gameNumber}-${s.pack.packNumber}`, ...extra });
    const [a, b] = live;
    await step('e', 'submitClose', {});
    await step('e', 'submitClose', { entries: [entry(a, { type: 'scan', ticketNumber: a.pack.exposedTicket - 3 })] }); // b missing
    await step('e', 'submitClose', { entries: [entry(a, { type: 'scan', ticketNumber: a.pack.exposedTicket + 1 }), entry(b, { type: 'sold_out' })] });
    await step('e', 'submitClose', { entries: [entry(a, { type: 'scan', ticketNumber: 1, packKey: '9999-0000000' }), entry(b, { type: 'sold_out' })] });
    await step('e', 'submitClose', { entries: [entry(a, { type: 'scan', ticketNumber: 1 }), entry(b, { type: 'skip' })] });
    await step('e', 'submitClose', { entries: [entry(a, { type: 'scan', ticketNumber: 1 }), entry(b, { type: 'sold_out' }), { box: 1, slot: 4, packKey: 'x', type: 'scan' }] });
    await step('e', 'submitClose', { entries: [entry(a, { type: 'scan', ticketNumber: 1 }), entry(b, { type: 'sold_out' })], date: '2026-10-22' });
    r = await step('e', 'submitClose', { entries: [entry(a, { type: 'scan', ticketNumber: String(a.pack.exposedTicket - 5) }), entry(b, { type: 'sold_out' })],
      closeId: 'close-1', date: '2026-10-23' });
    assert.equal(r.closedBy, 'e');
    r = await step('e', 'submitClose', { entries: [], closeId: 'close-1' });          // resent: the saved close
    assert.equal(r.alreadySent, true);
    await step('o', 'submitClose', { entries: [], closeId: 'close-2' });              // already closed

    // ---- After the close: a pack ended now counts tomorrow; reopening restores the top tickets ----
    await p.setClock('2026-10-23', '23:10:00');
    await step('o', 'endPack', { box: a.box, slot: a.slot, reason: 'sold_out' });
    await step('o', 'undoEndPack', { box: a.box, slot: a.slot });                         // its day (tomorrow) isn't closed
    await step('e', 'reopenClose', {});
    r = await step('o', 'reopenClose', {});
    assert.deepEqual(r, { reopened: '2026-10-23', slotsRestored: 1 });
    await step('o', 'reopenClose', {});                                                  // not closed now
    console.log(`slots + Close Day parity: ${steps} steps match (with Slots and Close Day after each)`);
  } finally {
    await p.done();
  }
})().catch((e) => { console.error(e); process.exit(1); });
