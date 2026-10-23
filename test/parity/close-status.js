// Parity: closeStatus (Close Day, employee home) on Sheets vs Supabase: not closed, then closed (owner sees $, employees
// don't; "Submitted at … by …"). Run: node test/parity/close-status.js
const { parity } = require('./harness');

const state = (closes) => ({
  slots: [{ box: 1, slot: 1, price: 20 }, { box: 1, slot: 2, price: 5, lastGame: '5555' }],
  games: [{ game: '1747', price: 20, size: 30, inBack: 1 }, { game: '5555', price: 5, size: 80, inBack: 2 }],
  packs: [{ game: '1747', pack: '0012345', status: 'live', box: 1, slot: 1, price: 20, top: 24, activatedOn: '2026-10-01', lastCloseOn: '2026-10-22' }],
  closes,
});

(async () => {
  const p = await parity({ today: '2026-10-23', time: '15:00:00' });
  try {
    const yesterday = { date: '2026-10-22', tickets: 40, dollars: 800, liveSlots: 1, inventory: 2300, closedBy: 'sara', closedAt: '2026-10-22 22:52' };
    await p.seed(state([yesterday]));
    for (const who of ['o', 'e', 'loader', 'sara']) await p.both(who, 'closeStatus');
    // Closed today at 10:58 PM by the owner.
    await p.seed(state([yesterday, { date: '2026-10-23', tickets: 12, dollars: 240, liveSlots: 1, inventory: 2060,
      closeId: 'c-1', closedBy: 'o', closedAt: '2026-10-23 22:58' }]));
    const owner = await p.both('o', 'closeStatus');
    const employee = await p.both('e', 'closeStatus');
    if (owner.closed.closedAt !== '10:58 PM' || owner.closed.dollarsSold !== 240 || 'dollarsSold' in employee.closed) {
      throw new Error(`unexpected answer key: ${JSON.stringify({ owner: owner.closed, employee: employee.closed })}`);
    }
    // A close from before closed_by/closed_at were kept: no "Submitted at" line.
    await p.seed(state([{ date: '2026-10-23', tickets: 12, dollars: 240, liveSlots: 1, inventory: 2060 }]));
    await p.both('o', 'closeStatus');
    console.log('closeStatus parity: match');
  } finally {
    await p.done();
  }
})().catch((e) => { console.error(e); process.exit(1); });
