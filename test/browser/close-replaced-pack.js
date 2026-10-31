// A pack sold out mid-day and a new pack (a different game) put in the same slot (owner 2026-10-31), with the
// top tickets typed as 3 digits: nothing is lost and each pack is counted on its own.
// 2 PM shift close (old pack) → 4 PM old pack marked sold out + new game activated in the slot → 6 PM shift close
// (new pack from its activation ticket) → Close Day. Also: a Close Day draft typed for the old pack before the swap is
// dropped for that slot (never applied to the new pack), and the new pack refuses a number above its activation ticket.
// Real backend code on an in-memory sheet. Run: node test/browser/close-replaced-pack.js
const assert = require('assert/strict');
const { openApp, typeTop, backendInVm, sleep } = require('./harness');

let clock = '14:00:00';
const { ctx, sheets: S, addRow, call } = backendInVm('2026-11-10', () => clock);
const slotRow = (slot, game, pack, ticket) => ({ box: 1, slot_number: slot, pack_key: `${game}-${pack}`, game_number: game,
  pack_number: pack, price_per_ticket: 20, current_exposed_ticket_number: ticket, activation_date: '2026-11-01', last_close_date: '2026-11-09' });
for (const slot of [1, 2]) addRow('SlotConfig', { box: 1, slot_number: slot, price_per_ticket: 20 });
addRow('SlotState', slotRow(1, '1747', '0000001', 40));
addRow('SlotState', slotRow(2, '1111', '0000001', 45));
for (const game of ['1747', '1111', '2222']) {
  addRow('ReserveInventory', { game_number: game, price_per_ticket: 20, tickets_per_pack: 50, packs_in_reserve: 2, tickets_in_reserve: 100 });
}

const users = { owner: { username: 'o', role: 'owner' }, employee: { username: 'e', role: 'employee' } };
const handler = (user) => (b) => {
  const run = {
    shiftStatus: () => ctx.shiftStatus(user),
    submitShiftClose: () => ctx.submitShiftClose(user, b.entries, b.shiftId, b.date),
    closeStatus: () => ctx.closeStatus(user),
    submitClose: () => ctx.submitClose(user, b.entries, b.closeId, b.date, b.late === true),
  }[b.action];
  return run ? call(run) : {};
};
const table = (tab) => { const [h, ...rows] = S[tab].rows; return rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const text = (page, sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
const review = (page) => page.$$eval('#review .review-row', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
const typed = async (page, t) => { await typeTop(page, t); await sleep(150); };

(async () => {
  // 2 PM: employee's shift close, old pack 040 → 030 (10), slot 2 045 → 040 (5).
  let app = await openApp({ role: 'employee', handle: handler(users.employee) });
  let { page, base } = app;
  await page.goto(base + 'close.html?shift=1'); await page.waitForSelector('#closeView:not(.hidden)'); await sleep(200);
  await typed(page, '1747-0000001-0-030');
  await typed(page, '1111-0000001-0-040');
  await page.click('#submitBtn'); await page.waitForSelector('#closedView:not(.hidden)');
  assert.match(await text(page, '#summary'), /15 tickets sold this shift/);
  await app.close();

  // 3 PM: the owner starts Close Day early and types 025 for the old pack (kept as a draft on the phone).
  clock = '15:00:00';
  app = await openApp({ role: 'owner', handle: handler(users.owner) });
  ({ page, base } = app);
  await page.goto(base + 'close.html'); await page.waitForSelector('#closeView:not(.hidden)'); await sleep(200);
  await typed(page, '1747-0000001-0-025');
  assert.deepEqual((await review(page))[0], 'B1 · S1 · $20 15 Sold · Top 025');

  // 4 PM: the old pack sells out; a new game goes in the same slot at ticket 049 (descending).
  clock = '16:00:00';
  call(() => ctx.endPack(users.owner, { box: 1, slot: 1, reason: 'sold_out' }));
  call(() => ctx.activatePack(users.owner, { box: 1, slot: 1, gameNumber: '2222', packNumber: '0000001', ticketNumber: 49 }));
  const soldOut = table('DailyCloseLog').filter((r) => r.pack_key === '1747-0000001');
  assert.equal(soldOut.length, 1, 'the old pack has one sold-out row');
  assert.equal(Number(soldOut[0].tickets_sold), 41, 'sold out = every ticket left since last night (040 → all 41)');

  // 6 PM: owner's shift close. The new pack starts from its activation ticket; the old pack's last 31 (030 → out)
  // count in this shift.
  clock = '18:00:00';
  await page.goto(base + 'close.html?shift=1'); await page.waitForSelector('#closeView:not(.hidden)'); await sleep(200);
  assert.equal(await text(page, '#typedPack'), '2222-0000001-');
  assert.equal(await text(page, '#curLast'), 'Shift start ticket 049 (50 left)');
  await typed(page, '2222-0000001-0-050');
  assert.match(await text(page, '#typedNote'), /050 is above the shift's start ticket \(049\)/);
  await typed(page, '2222-0000001-0-045');
  await typed(page, '1111-0000001-0-038');
  await page.click('#submitBtn'); await page.waitForSelector('#closedView:not(.hidden)');
  const shift = await text(page, '#summary');
  console.log('6 PM shift:', shift);
  assert.match(shift, /37 tickets sold this shift/, 'old pack 31 + new pack 4 + slot 2 2');

  // 10 PM Close Day: the 3 PM draft for the old pack is dropped for slot 1; the new pack counts from 049.
  clock = '22:00:00';
  await page.goto(base + 'close.html'); await page.waitForSelector('#closeView:not(.hidden)'); await sleep(200);
  assert.deepEqual(await review(page), ['B1 · S1 · $20 Not Done', 'B1 · S2 · $20 Not Done']);
  assert.equal(await text(page, '#typedPack'), '2222-0000001-');
  assert.equal(await text(page, '#curLast'), 'Last top ticket 049 (50 left)');
  await typed(page, '2222-0000001-0-055');
  assert.match(await text(page, '#typedNote'), /055 is above the last top ticket \(049\)/);
  await typed(page, '2222-0000001-0-040');
  await typed(page, '1111-0000001-0-035');
  assert.deepEqual(await review(page), ['B1 · S1 · $20 9 Sold · Top 040', 'B1 · S2 · $20 10 Sold · Top 035']);
  await page.click('#submitBtn'); await page.waitForSelector('#closedView:not(.hidden)');
  console.log('Close Day:', await text(page, '#summary'));
  await app.close();

  // Every pack's sales are recorded once: old pack 41 (sold out), new pack 9, slot 2 10 = 60 tickets, $1,200.
  const log = table('DailyCloseLog').map((r) => [r.pack_key, Number(r.tickets_sold)]);
  console.log('DailyCloseLog:', JSON.stringify(log));
  assert.deepEqual(log.sort(), [['1111-0000001', 10], ['1747-0000001', 41], ['2222-0000001', 9]]);
  const day = table('DailySummary').pop();
  assert.equal(Number(day.total_tickets_sold), 60);
  assert.equal(Number(day.total_dollars_sold), 1200);
  const slots = table('SlotState').map((r) => [r.pack_key, Number(r.current_exposed_ticket_number)]);
  assert.deepEqual(slots, [['2222-0000001', 40], ['1111-0000001', 35]]);
  // The old pack is in the pack history, ended today.
  const ended = table('PackHistory').filter((r) => r.game_number === '1747' && r.pack_number === '0000001');
  assert.equal(ended.length, 1, 'old pack in PackHistory once');
  assert.equal(ended[0].end_reason, 'sold_out'); assert.equal(ended[0].end_date, '2026-11-10');
  console.log('CLOSE REPLACED PACK CHECKS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
