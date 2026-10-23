// Parity: shift closes on Sheets vs Supabase. Every refusal, an employee's shift close (scan + sold out), their second
// try, a resend, packs ended / sold whole / put in between shifts, a second employee's shift close (the earlier sold out
// filled in, the ended packs counted from the first shift's tickets), deleting a shift close, and none after Close Day.
// After every step: Close shift (employee and owner), Shift Closure (owner), the employee home (closeStatus).
// Run: node test/parity/shifts.js
const assert = require('assert/strict');
const { parity } = require('./harness');

(async () => {
  const p = await parity({ today: '2026-10-23', time: '09:00:00' });
  let steps = 0;
  const step = async (who, action, req = {}) => {
    const answer = await p.both(who, action, req);
    await p.both('e', 'shiftStatus');
    await p.both('o', 'shiftStatus');
    await p.both('o', 'listShiftCloses');
    await p.both('e', 'closeStatus');
    steps += 1;
    return answer;
  };
  const at = (time) => p.setClock('2026-10-23', time);
  try {
    await p.seed({
      slots: [{ box: 1, slot: 1, price: 20 }, { box: 1, slot: 2, price: 10, order: 'ascending' }, { box: 1, slot: 3, price: 5 }, { box: 1, slot: 4, price: 20 }],
      games: [{ game: '1747', price: 20, size: 30, inBack: 2 }, { game: '1111', price: 10, size: 50, inBack: 0 }, { game: '5555', price: 5, size: 80, inBack: 3 }],
      packs: [
        { game: '1747', pack: '0012345', status: 'live', box: 1, slot: 1, price: 20, top: 24, activatedOn: '2026-10-01', lastCloseOn: '2026-10-22' },
        { game: '1111', pack: '0000777', status: 'live', box: 1, slot: 2, price: 10, top: 10, order: 'ascending', activatedOn: '2026-10-10', lastCloseOn: '2026-10-22' },
        { game: '5555', pack: '0000042', status: 'live', box: 1, slot: 3, price: 5, top: 79, activatedOn: '2026-10-20', lastCloseOn: '2026-10-22' },
      ],
      closes: [{ date: '2026-10-22', tickets: 10, dollars: 200, liveSlots: 3, inventory: 4000, closedBy: 'o', closedAt: '2026-10-22 22:50' }],
    });
    const e = (box, slot, packKey, extra) => ({ box, slot, packKey, ...extra });
    const good = [e(1, 1, '1747-0012345', { type: 'scan', ticketNumber: 20 }), e(1, 2, '1111-0000777', { type: 'scan', ticketNumber: 15 }),
      e(1, 3, '5555-0000042', { type: 'sold_out' })];

    await at('13:00:00');
    await step('e', 'submitShiftClose', {});
    await step('e', 'submitShiftClose', { entries: good.slice(0, 2) });
    await step('e', 'submitShiftClose', { entries: [good[0], { ...good[1], packKey: '1111-0000000' }, good[2]] });
    await step('e', 'submitShiftClose', { entries: [good[0], good[1], { ...good[2], type: 'none' }] });
    await step('e', 'submitShiftClose', { entries: [{ ...good[0], ticketNumber: 25 }, good[1], good[2]] });
    await step('e', 'submitShiftClose', { entries: [good[0], { ...good[1], ticketNumber: 9 }, good[2]] });     // ascending: below the start
    await step('e', 'submitShiftClose', { entries: [...good, e(1, 4, 'x', { type: 'scan', ticketNumber: 1 })] });
    await step('e', 'submitShiftClose', { entries: good, date: '2026-10-22' });
    let r = await step('e', 'submitShiftClose', { entries: good, shiftId: 's1', date: '2026-10-23' });
    assert.equal(r.ticketsSold, 4 + 5 + 80);
    assert.equal('dollarsSold' in r, false);
    await at('13:10:00');
    await step('e', 'submitShiftClose', { entries: good, shiftId: 's1-again' });                                // one a day
    r = await step('e', 'submitShiftClose', { entries: good, shiftId: 's1' });                                   // resent
    assert.equal(r.alreadySent, true);

    // ---- Between shifts ----
    await at('13:30:00');
    await step('o', 'endPack', { box: 1, slot: 1, reason: 'returned', ticketNumber: 18 });
    await at('14:00:00');
    await step('o', 'sellFullPack', { gameNumber: '1747', packNumber: '0099999' });
    await at('14:10:00');
    await step('o', 'activatePack', { box: 1, slot: 4, gameNumber: '1747', packNumber: '0000300', ticketNumber: 29 });

    // ---- Second shift close: 1-3 filled in as sold out earlier; the return and the full pack count in it ----
    await at('15:02:00');
    r = await step('sara', 'submitShiftClose', { entries: [e(1, 2, '1111-0000777', { type: 'scan', ticketNumber: 20 }),
      e(1, 4, '1747-0000300', { type: 'scan', ticketNumber: 25 })] });
    assert.equal(r.ticketsSold, 5 + 4 + 2 + 30);
    await at('15:30:00');
    r = await step('o', 'submitShiftClose', { entries: [e(1, 2, '1111-0000777', { type: 'scan', ticketNumber: 20 }),
      e(1, 4, '1747-0000300', { type: 'sold_out' })], shiftId: 'owner-1' });                                     // owner: no limit, sees $
    assert.equal(r.dollarsSold, 26 * 20);

    // ---- Deleting ----
    await step('sara', 'deleteShiftClose', { shiftId: 's1' });                                                 // owner only
    await step('o', 'deleteShiftClose', { shiftId: 'nope' });
    await step('o', 'deleteShiftClose', { shiftId: 's1' });
    await at('16:00:00');
    await step('e', 'submitShiftClose', { entries: [e(1, 1, 'x', { type: 'scan', ticketNumber: 1 })], shiftId: 's2' }); // 1-1 is empty now

    // ---- After Close Day ----
    await at('22:50:00');
    await step('o', 'submitClose', { entries: [e(1, 2, '1111-0000777', { type: 'scan', ticketNumber: 30 }), e(1, 3, '5555-0000042', { type: 'sold_out' }),
      e(1, 4, '1747-0000300', { type: 'scan', ticketNumber: 10 })], closeId: 'c-23' });
    await step('o', 'submitShiftClose', { entries: [], shiftId: 'late' });
    console.log(`shift close parity: ${steps} steps match (with Close shift, Shift Closure and the employee home after each)`);
  } finally {
    await p.done();
  }
})().catch((e) => { console.error(e); process.exit(1); });
