// Parity: reopening a close after a pack it counted has ended (found in the 2026-11-12 review). The pack stays ended
// and keeps its close line, so its sales for the day are counted again at the re-close instead of being in no close.
// Also: a pack ended after the close, then un-ended after the reopen, is closed twice that day and a second reopen
// puts it back on its first ticket. Sheets vs Supabase (migration 0027).
// Run: node test/parity/reopen-ended.js
const assert = require('assert/strict');
const { parity } = require('./harness');

(async () => {
  const p = await parity({ today: '2026-10-26', time: '22:00:00' });
  try {
    const seed = () => p.seed({
      slots: [{ box: 1, slot: 1, price: 5 }, { box: 1, slot: 2, price: 5 }],
      games: [{ game: '1234', price: 5, size: 80, inBack: 0 }],
      // 51 tickets ($255) left in the first pack, 21 ($105) in the second.
      packs: [{ game: '1234', pack: '0000001', status: 'live', box: 1, slot: 1, price: 5, top: 50, activatedOn: '2026-10-20', lastCloseOn: '2026-10-25' },
        { game: '1234', pack: '0000002', status: 'live', box: 1, slot: 2, price: 5, top: 20, activatedOn: '2026-10-20', lastCloseOn: '2026-10-25' }],
      closes: [{ date: '2026-10-25', tickets: 0, dollars: 0, liveSlots: 2, inventory: 360 }],
    });
    const scan = (slot, pack, ticketNumber) => ({ box: 1, slot, packKey: `1234-000000${pack}`, type: 'scan', ticketNumber });
    const top = async (slot) => (await p.both('o', 'listSlots'))[slot - 1].pack.exposedTicket;

    // ---- The pack sells out after the close; the close is reopened and done again ----
    await seed();
    let r = await p.both('o', 'submitClose', { closeId: 'a1', date: '2026-10-26', entries: [scan(1, 1, 40), scan(2, 2, 18)] });
    assert.equal(r.ticketsSold, 12);
    await p.both('o', 'endPack', { box: 1, slot: 1, reason: 'sold_out' });               // counts tomorrow: 41 tickets
    r = await p.both('o', 'reopenClose', {});
    assert.deepEqual(r, { reopened: '2026-10-26', slotsRestored: 1 });                   // only the pack still in a slot
    assert.equal(await top(2), 20);
    r = await p.both('o', 'submitClose', { closeId: 'a2', date: '2026-10-26', entries: [scan(2, 2, 17)] });
    assert.equal(r.ticketsSold, 13);                                                     // 10 kept from the ended pack + 3
    assert.equal(r.dollarsSold, 65);
    await p.setClock('2026-10-27', '22:00:00');
    r = await p.both('o', 'submitClose', { closeId: 'a3', date: '2026-10-27', entries: [scan(2, 2, 17)] });
    assert.equal(r.ticketsSold, 41);                                                     // 10 + 41 = the pack's 51
    assert.equal(r.dollarsSold, 205);

    // ---- Ended after the close, reopened, un-ended, closed again, reopened again ----
    await p.setClock('2026-10-26', '22:00:00');
    await seed();
    await p.both('o', 'submitClose', { closeId: 'b1', date: '2026-10-26', entries: [scan(1, 1, 40), scan(2, 2, 18)] });
    await p.both('o', 'endPack', { box: 1, slot: 1, reason: 'sold_out' });
    await p.both('o', 'reopenClose', {});
    await p.both('o', 'undoEndPack', { box: 1, slot: 1 });                               // live again on ticket 40
    assert.equal(await top(1), 40);
    r = await p.both('o', 'submitClose', { closeId: 'b2', date: '2026-10-26', entries: [scan(1, 1, 38), scan(2, 2, 18)] });
    assert.equal(r.ticketsSold, 14);                                                     // 10 + 2 + 2
    r = await p.both('o', 'reopenClose', {});
    assert.deepEqual(r, { reopened: '2026-10-26', slotsRestored: 3 });
    assert.equal(await top(1), 50);                                                      // back before both close lines
    assert.equal(await top(2), 20);
    r = await p.both('o', 'submitClose', { closeId: 'b3', date: '2026-10-26', entries: [scan(1, 1, 38), scan(2, 2, 18)] });
    assert.equal(r.ticketsSold, 14);
    await p.done();
    console.log('reopen after an ended pack parity: match');
  } catch (e) {
    await p.done();
    throw e;
  }
})().catch((e) => { console.error(e); process.exit(1); });
