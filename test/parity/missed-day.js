// Parity: a missed day (owner 2026-10-26) on Sheets vs Supabase.
// Close Yesterday: offered the next morning (closeStatus.closeYesterday) until 12:00 PM, by anyone; recorded under
// yesterday with yesterday's sold outs and full pack sales; a pack marked sold out in it ended yesterday; refused once
// something changed today, after noon, or when already closed; the owner reopens it on the same terms. And a day
// nobody closed at all: the next close counts its sold outs. Full pack Undo stops once any close counted the sale.
// Run: node test/parity/missed-day.js
const assert = require('assert/strict');
const { parity } = require('./harness');

const scan = (box, slot, packKey, ticketNumber) => ({ box, slot, packKey, type: 'scan', ticketNumber });
const soldOut = (box, slot, packKey) => ({ box, slot, packKey, type: 'sold_out' });
const put = (box, slot, game, pack, ticket) => ({ box, slot, gameNumber: game, packNumber: pack, ticketNumber: ticket });

(async () => {
  const p = await parity({ today: '2026-10-26', time: '15:00:00' });
  try {
    await p.seed({
      slots: [{ box: 1, slot: 1, price: 20 }, { box: 1, slot: 2, price: 10 }, { box: 1, slot: 3, price: 5 }, { box: 1, slot: 4, price: 5 }],
      games: [{ game: '1747', price: 20, size: 30, inBack: 2 }, { game: '1111', price: 10, size: 50, inBack: 1 },
        { game: '5555', price: 5, size: 80, inBack: 2 }],
      packs: [
        { game: '1747', pack: '0000001', status: 'live', box: 1, slot: 1, price: 20, top: 20, activatedOn: '2026-10-01', lastCloseOn: '2026-10-25' },
        { game: '1111', pack: '0000001', status: 'live', box: 1, slot: 2, price: 10, top: 40, activatedOn: '2026-10-01', lastCloseOn: '2026-10-25' },
        { game: '5555', pack: '0000001', status: 'live', box: 1, slot: 3, price: 5, top: 50, activatedOn: '2026-10-01', lastCloseOn: '2026-10-25' },
      ],
      closes: [{ date: '2026-10-25', tickets: 10, dollars: 200, liveSlots: 3, inventory: 4000, closedBy: 'o', closedAt: '2026-10-25 22:50' }],
    });
    const status = async (who = 'o') => (await p.both(who, 'closeStatus')).closeYesterday;

    // ---- Monday Oct 26: a pack sells out and a full pack is sold, then nobody closes ----
    assert.equal(await status(), null, 'Sunday was closed');
    await p.both('o', 'endPack', { box: 1, slot: 3, reason: 'sold_out' });                    // 51 × $5
    await p.both('o', 'sellFullPack', { gameNumber: '1747', packNumber: '0000009' });          // 30 × $20

    // ---- Tuesday 9:00: Close Yesterday is offered to everyone ----
    await p.setClock('2026-10-27', '09:00:00');
    assert.deepEqual(await status(), { date: '2026-10-26', until: '12:00 PM', blocked: null });
    assert.deepEqual(await status('e'), { date: '2026-10-26', until: '12:00 PM', blocked: null });
    assert.equal((await p.both('o', 'listFullPackSales')).sales[0].canUndo, true, 'no close has counted it yet');
    // Refused: scanned for the wrong day; incomplete.
    await p.both('e', 'submitClose', { closeId: 'late0', date: '2026-10-27', late: true, entries: [scan(1, 1, '1747-0000001', 15), scan(1, 2, '1111-0000001', 30)] });
    await p.both('e', 'submitClose', { closeId: 'late0', date: '2026-10-26', late: true, entries: [scan(1, 1, '1747-0000001', 15)] });
    // An employee closes yesterday: Monday's scans + its sold out + its full pack sale.
    let r = await p.both('e', 'submitClose', { closeId: 'late1', date: '2026-10-26', late: true,
      entries: [scan(1, 1, '1747-0000001', 15), scan(1, 2, '1111-0000001', 30)] });
    assert.deepEqual([r.date, r.ticketsSold, r.closedBy, r.closedLate, 'dollarsSold' in r], ['2026-10-26', 96, 'e', true, false]);
    await p.both('e', 'submitClose', { closeId: 'late1', date: '2026-10-26', late: true, entries: [] });   // resent: the saved one
    await p.both('e', 'submitClose', { closeId: 'late2', date: '2026-10-26', late: true, entries: [] });   // already closed
    const closed = await status();
    assert.deepEqual([closed.date, closed.closed.dollarsSold, closed.closed.closedLate], ['2026-10-26', 100 + 100 + 255 + 600, true]);
    await status('e');
    assert.equal((await p.both('o', 'listFullPackSales')).sales[0].canUndo, false);
    await p.both('o', 'undoFullPackSale', { packKey: '1747-0000009' });                        // counted now
    // Reopen: owner only, only yesterday's late close or today's.
    await p.both('e', 'reopenClose', { date: '2026-10-26' });
    await p.both('o', 'reopenClose', { date: '2026-10-25' });
    await p.both('o', 'reopenClose', {});                                                       // today isn't closed
    r = await p.both('o', 'reopenClose', { date: '2026-10-26' });
    assert.deepEqual(r, { reopened: '2026-10-26', slotsRestored: 2 });
    assert.deepEqual(await status(), { date: '2026-10-26', until: '12:00 PM', blocked: null });
    // Closed again, 1-2 marked sold out in it: it sold out yesterday.
    r = await p.both('o', 'submitClose', { closeId: 'late3', date: '2026-10-26', late: true,
      entries: [scan(1, 1, '1747-0000001', 15), soldOut(1, 2, '1111-0000001')] });
    assert.equal(r.ticketsSold, 5 + 41 + 51 + 30);
    const slots = await p.both('o', 'listSlots');
    assert.deepEqual([slots[1].pack, slots[1].endedToday], [null, null], 'ended yesterday, not today');
    // Now packs go in (after the late close), and tonight's close counts only today.
    await p.setClock('2026-10-27', '10:00:00');
    await p.both('o', 'activatePack', put(1, 2, '1111', '0000002', 49));
    assert.equal((await status()).closed.closedLate, true);
    await p.setClock('2026-10-27', '22:50:00');
    assert.equal(await status(), null, 'after noon');
    await p.both('o', 'reopenClose', { date: '2026-10-26' });                                  // too late now
    r = await p.both('o', 'submitClose', { closeId: 'c27', date: '2026-10-27',
      entries: [scan(1, 1, '1747-0000001', 12), scan(1, 2, '1111-0000002', 45)] });
    assert.deepEqual([r.ticketsSold, r.dollarsSold, 'closedLate' in r], [3 + 4, 60 + 40, false]);

    // ---- Wednesday Oct 28 nobody closes; Thursday after noon it's too late, and the night close counts Wednesday ----
    await p.setClock('2026-10-28', '14:00:00');
    await p.both('o', 'endPack', { box: 1, slot: 1, reason: 'sold_out' });                    // 13 × $20, logged Wednesday
    await p.setClock('2026-10-29', '12:30:00');
    assert.equal(await status(), null);
    await p.both('o', 'submitClose', { closeId: 'late4', date: '2026-10-28', late: true, entries: [scan(1, 2, '1111-0000002', 40)] });
    await p.setClock('2026-10-29', '22:50:00');
    r = await p.both('o', 'submitClose', { closeId: 'c29', date: '2026-10-29', entries: [scan(1, 2, '1111-0000002', 40)] });
    assert.deepEqual([r.ticketsSold, r.dollarsSold], [13 + 5, 260 + 50], "Wednesday's sold out counted Thursday");

    // ---- Thursday was closed on time: Friday morning offers nothing, and it can't be reopened ----
    await p.setClock('2026-10-30', '09:00:00');
    assert.equal(await status(), null);
    await p.both('o', 'reopenClose', { date: '2026-10-29' });

    // ---- Friday Oct 30 nobody closes; Saturday morning something changed first ----
    await p.setClock('2026-10-31', '08:30:00');
    await p.both('o', 'endPack', { box: 1, slot: 2, reason: 'returned', ticketNumber: 38 });
    assert.match((await status()).blocked, /^A pack was already sold out, returned or sold whole today, so yesterday can't be closed now\./);
    await p.both('e', 'submitClose', { closeId: 'late5', date: '2026-10-30', late: true, entries: [] });
    await p.both('o', 'activatePack', put(1, 4, '5555', '0000002', 79));
    assert.match((await status('e')).blocked, /^A pack was already put in a slot today/);

    await p.done();
    console.log('missed day parity: match');
  } catch (e) {
    await p.done();
    throw e;
  }
})().catch((e) => { console.error(e); process.exit(1); });
