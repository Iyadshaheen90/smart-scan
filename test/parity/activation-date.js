// Parity: setActivationDate (owner 2026-10-26: a slow pack the lottery activated on its own while in the back) on Sheets
// vs Supabase: owner only, a real day from a year ago to today, a slot with a pack; the days counter follows it; it can
// be set again; and that night's Close Day counts exactly as before (sales come from the tickets, not the date).
// Run: node test/parity/activation-date.js
const assert = require('assert/strict');
const { parity } = require('./harness');

(async () => {
  const p = await parity({ today: '2026-10-26' });
  try {
    await p.seed({
      slots: [{ box: 1, slot: 1, price: 20 }, { box: 1, slot: 2, price: 10 }],
      games: [{ game: '1747', price: 20, size: 30, inBack: 1 }],
      // Put in today (it replaced a sold-out pack), but the lottery activated it on its own on Sep 12.
      packs: [{ game: '1747', pack: '0012345', status: 'live', box: 1, slot: 1, price: 20, top: 29, activatedOn: '2026-10-26' }],
    });
    const days = async () => (await p.both('o', 'listSlots'))[0].pack.daysActive;
    assert.equal(await days(), 0);

    // Owner only, even for an employee with every permission.
    await p.both('e', 'setActivationDate', { box: 1, slot: 1, date: '2026-09-12' });
    await p.both('sara', 'setActivationDate', { box: 1, slot: 1, date: '2026-09-12' });
    // A real day, not after today, not more than a year ago.
    for (const date of [undefined, null, '', 'abc', '2026-9-12', '2026-02-31', '2026-13-01', 20260912, '2026-10-27', '2025-10-25']) {
      await p.both('o', 'setActivationDate', date === undefined ? { box: 1, slot: 1 } : { box: 1, slot: 1, date });
    }
    // A slot with a pack.
    await p.both('o', 'setActivationDate', { box: 1, slot: 2, date: '2026-09-12' });
    await p.both('o', 'setActivationDate', { box: 3, slot: 1, date: '2026-09-12' });

    assert.deepEqual(await p.both('o', 'setActivationDate', { box: 1, slot: 1, date: '2026-09-12' }),
      { box: 1, slot: 1, packKey: '1747-0012345', activationDate: '2026-09-12', daysActive: 44 });
    assert.equal(await days(), 44);
    assert.equal((await p.both('o', 'listSlots'))[0].pack.activationDate, '2026-09-12');
    // A year ago exactly is allowed; set again to fix a mistake.
    assert.equal((await p.both('o', 'setActivationDate', { box: '1', slot: '1', date: '2025-10-26' })).daysActive, 365);
    await p.both('o', 'setActivationDate', { box: 1, slot: 1, date: '2026-09-12' });

    // That night's close counts 5 sold, from the ticket it went in at, as before.
    await p.setClock('2026-10-26', '22:50:00');
    const close = await p.both('o', 'submitClose', { closeId: 'c1', date: '2026-10-26',
      entries: [{ box: 1, slot: 1, packKey: '1747-0012345', type: 'scan', ticketNumber: 24 }] });
    assert.equal(close.ticketsSold, 5);
    assert.equal(close.dollarsSold, 100);
    await p.setClock('2026-10-27', '09:00:00');
    assert.equal(await days(), 45);
    await p.done();
    console.log('activation date parity: match');
  } catch (e) {
    await p.done();
    throw e;
  }
})().catch((e) => { console.error(e); process.exit(1); });
