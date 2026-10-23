// Parity: the owner's home and Months & Totals on Sheets vs Supabase, through a day (shipment, full pack, a return,
// shift close, Close Day). On purpose different (normalized away): the database has no spreadsheets (url / currentUrl
// null) and no month to start (next null, canStart false). Also checks monthWorkbook (the Excel download's data) against
// the same day. Run: node test/parity/months-home.js
const assert = require('assert/strict');
const { parity } = require('./harness');

// Drops what the database does differently on purpose: spreadsheet links and starting months.
function noSheets(answer) {
  const walk = (x) => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      return Object.fromEntries(Object.entries(x).filter(([k]) => !['url', 'currentUrl', 'next', 'canStart'].includes(k)).map(([k, v]) => [k, walk(v)]));
    }
    return x;
  };
  return walk(answer);
}

(async () => {
  const p = await parity({ today: '2026-10-23', time: '09:00:00' });
  let steps = 0;
  const step = async (who, action, req = {}) => {
    const answer = await p.both(who, action, req, noSheets);
    await p.both('o', 'ownerHome', {}, noSheets);
    await p.both('o', 'monthsPage', {}, noSheets);
    await p.both('o', 'monthSummary', { label: '2026-10' }, noSheets);
    await p.both('o', 'listMonths', {}, noSheets);
    steps += 1;
    return answer;
  };
  const at = (time) => p.setClock('2026-10-23', time);
  try {
    await p.seed({
      slots: [{ box: 1, slot: 1, price: 20 }, { box: 1, slot: 2, price: 5 }],
      games: [{ game: '1747', price: 20, size: 30, inBack: 2 }, { game: '5555', price: 5, size: 80, inBack: 1 }],
      packs: [
        { game: '1747', pack: '0012345', status: 'live', box: 1, slot: 1, price: 20, top: 24, activatedOn: '2026-10-01', lastCloseOn: '2026-10-22' },
        { game: '5555', pack: '0000042', status: 'live', box: 1, slot: 2, price: 5, top: 79, activatedOn: '2026-10-20', lastCloseOn: '2026-10-22' },
      ],
      closes: [{ date: '2026-10-21', tickets: 5, dollars: 100, liveSlots: 2, inventory: 4100 },
        { date: '2026-10-22', tickets: 10, dollars: 200, liveSlots: 2, inventory: 4000, closedBy: 'o', closedAt: '2026-10-22 22:50' }],
    });
    await step('e', 'ownerHome');
    await step('o', 'monthStatus');
    await step('o', 'saveBackStock', { mode: 'shipment', lines: [{ gameNumber: '1747', packs: 2 }] });
    await at('11:00:00');
    await step('o', 'sellFullPack', { gameNumber: '1747', packNumber: '0000500' });
    await at('12:00:00');
    await step('o', 'endPack', { box: 1, slot: 2, reason: 'returned', ticketNumber: 70 });
    await at('15:00:00');
    await step('sara', 'submitShiftClose', { entries: [{ box: 1, slot: 1, packKey: '1747-0012345', type: 'scan', ticketNumber: 20 }], shiftId: 's1' });
    await at('22:50:00');
    const r = await step('o', 'submitClose', { entries: [{ box: 1, slot: 1, packKey: '1747-0012345', type: 'scan', ticketNumber: 15 }], closeId: 'c-23' });
    assert.equal(r.dollarsSold, 9 * 20 + 600 + 9 * 5);

    // ---- The Excel download's data: the day's lines add up to its Close Day ----
    const book = (await p.db.call('o', 'monthWorkbook', { label: '2026-10' })).data;
    const summary = await p.both('o', 'monthSummary', { label: '2026-10' }, noSheets);
    assert.deepEqual(noSheets(book.summary), noSheets(summary));
    const day = book.days.find((d) => d.date === '2026-10-23');
    assert.equal(day.closed, true);
    assert.equal(day.closedAt, '10:50 PM');
    assert.deepEqual(day.lines.map((l) => [l.type, l.box, l.ticketsSold]), [['close', 1, 9], ['full_pack', null, 30], ['returned', 1, 9]]);
    assert.equal(day.lines.reduce((s, l) => s + Number(l.dollars), 0), Number(day.dollarsSold));
    assert.equal(book.shipments.length, 1);
    assert.equal((await p.db.call('o', 'monthWorkbook', { label: '2026-09' })).code, 'no_month');
    assert.equal((await p.db.call('e', 'monthWorkbook', { label: '2026-10' })).code, 'forbidden');
    console.log(`owner home + months parity: ${steps} steps match; Excel data adds up`);
  } finally {
    await p.done();
  }
})().catch((e) => { console.error(e); process.exit(1); });
