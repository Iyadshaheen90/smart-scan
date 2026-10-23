// Parity: listSlots (Slots page, Close Day, slot page) on Sheets vs Supabase. Run: node test/parity/list-slots.js
const { parity } = require('./harness');

(async () => {
  const p = await parity({ today: '2026-10-23' });
  try {
    await p.seed({
      slots: [
        { box: 1, slot: 1, price: 20 },
        { box: 1, slot: 2, price: 10, order: 'ascending' },
        { box: 1, slot: 3, price: 5, lastGame: '5555' },   // empty, 3 packs of its last game in the back
        { box: 1, slot: 4, price: 2, lastGame: '3333' },   // empty, its last game has ended: no hint
        { box: 1, slot: 5, price: 30, lastGame: '7777' },  // emptied today (sold out): endedToday
        { box: 2, slot: 1, price: 20 },                    // a pack put in today, never closed
        { box: 2, slot: 2, price: 1 },                     // a $1 game with none left in the back
        { box: 2, slot: 3, price: 3 },                     // empty, nothing known
      ],
      games: [
        { game: '1747', price: 20, size: 30, inBack: 2 },
        { game: '1111', price: 10, size: 50, inBack: 0 },
        { game: '5555', price: 5, size: 80, inBack: 3 },
        { game: '3333', price: 2, size: 100, inBack: 0, endedOn: '2026-10-05' },
        { game: '7777', price: 30, size: 30, inBack: 1 },
        { game: '0999', price: 1, size: 240, inBack: 0 },
      ],
      packs: [
        { game: '1747', pack: '0012345', status: 'live', box: 1, slot: 1, price: 20, top: 24, activatedOn: '2026-09-01', lastCloseOn: '2026-10-22' },
        { game: '1111', pack: '0000777', status: 'live', box: 1, slot: 2, price: 10, top: 10, order: 'ascending',
          activatedOn: '2026-10-10', lastCloseOn: '2026-10-22' },
        { game: '1747', pack: '0055555', status: 'live', box: 2, slot: 1, price: 20, top: 29, activatedOn: '2026-10-23' },
        { game: '0999', pack: '0000001', status: 'live', box: 2, slot: 2, price: 1, top: 200, activatedOn: '2026-10-20', lastCloseOn: '2026-10-22' },
        { game: '7777', pack: '0000042', status: 'sold_out', box: 1, slot: 5, price: 30, activatedOn: '2026-10-01',
          endedOn: '2026-10-23', endReason: 'sold_out' },
        { game: '7777', pack: '0000041', status: 'returned', box: 1, slot: 5, price: 30, activatedOn: '2026-09-01',
          endedOn: '2026-10-01', endReason: 'returned', remainingAtEnd: 5 },
      ],
    });
    const slots = await p.both('o', 'listSlots');
    await p.both('e', 'listSlots');
    if (slots[0].pack.remaining !== 25 || slots[1].pack.remaining !== 40) {
      throw new Error(`unexpected answer key: ${JSON.stringify(slots)}`);
    }
    console.log(`listSlots parity: ${slots.length} slots match`);
  } finally {
    await p.done();
  }
})().catch((e) => { console.error(e); process.exit(1); });
