// Close Yesterday (owner 2026-10-26: a broken or forgotten phone). The morning after a day nobody closed, Home shows a
// Close Yesterday button to the owner and employees until 12:00 PM, Close Day shows a banner to it, and
// close.html?yesterday=1 closes that day late (recorded under yesterday, "Submitted the next morning"); the owner can
// reopen it. Something changed today: the reason instead of the button. After noon: nothing.
// Real backend code (Close.js, Slots.js, Shifts.js) on an in-memory sheet.
// Run: node test/browser/close-yesterday.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const { openApp, backendInVm, sleep } = require('./harness');

let clock = '09:00:00';
const { ctx, addRow, call } = backendInVm('2026-10-27', () => clock);
for (const [slot, price] of [[1, 20], [2, 10]]) addRow('SlotConfig', { box: 1, slot_number: slot, price_per_ticket: price });
addRow('SlotState', { box: 1, slot_number: 1, pack_key: '1747-0000001', game_number: '1747', pack_number: '0000001',
  price_per_ticket: 20, current_exposed_ticket_number: 20, activation_date: '2026-10-01', last_close_date: '2026-10-25' });
addRow('SlotState', { box: 1, slot_number: 2, pack_key: '1111-0000001', game_number: '1111', pack_number: '0000001',
  price_per_ticket: 10, current_exposed_ticket_number: 40, activation_date: '2026-10-01', last_close_date: '2026-10-25' });
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 1, tickets_in_reserve: 30 });
addRow('ReserveInventory', { game_number: '1111', price_per_ticket: 10, tickets_per_pack: 50, packs_in_reserve: 1, tickets_in_reserve: 50 });
// Sunday was closed; Monday a pack of game 5555 sold out (logged Monday), and nobody closed Monday.
addRow('DailySummary', { close_date: '2026-10-25', total_tickets_sold: 10, total_dollars_sold: 200, occupied_slot_count: 3,
  total_inventory_value: 4000, closed_by: 'o', closed_at: '2026-10-25 22:50' });
addRow('DailyCloseLog', { close_date: '2026-10-26', box: 1, slot_number: 3, pack_key: '5555-0000001', previous_exposed_ticket_number: 50,
  tickets_sold: 51, price_per_ticket: 5, dollars_sold: 255, remaining_after_close: 0, close_type: 'sold_out', performed_by: 'o' });

const users = { owner: { username: 'o', role: 'owner' }, employee: { username: 'e', role: 'employee', permissions: [] } };
const handler = (user) => (b) => {
  switch (b.action) {
    case 'closeStatus': return call(() => ctx.closeStatus(user));
    case 'ownerHome': return call(() => ({ ...ctx.closeStatus(user), month: { current: '2026-10', next: null, canStart: false },
      monthDollars: 0, lastClose: null, backValue: 0, fullPacks: { count: 0, dollars: 0 }, shifts: { count: 0, last: null } }));
    case 'submitClose': return call(() => ctx.submitClose(user, b.entries, b.closeId, b.date, b.late === true));
    case 'reopenClose': return call(() => ctx.reopenClose(b));
    case 'endPack': return call(() => ctx.endPack(user, b));
    default: return {};
  }
};
const text = (page, sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
const shown = (page, sel) => page.$eval(sel, (el) => !el.classList.contains('hidden'));
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
const homeLoaded = (page) => page.waitForFunction(() => !document.querySelector('.splash') && document.getElementById('todayLabel').textContent.includes('Oct'));

(async () => {
  // ---- 9:00, employee: Home offers it; Close Day points to it ----
  let app = await openApp({ role: 'employee', username: 'e', permissions: [], handle: handler(users.employee) });
  let { page, base } = app;
  await page.goto(base + 'index.html'); await homeLoaded(page);
  await page.waitForFunction(() => !document.getElementById('closeYesterdayBtn').classList.contains('hidden'));
  assert.equal(await text(page, '#closeYesterdayBtn'), 'Close Yesterday · Mon, Oct 26');
  assert.equal(await text(page, '#closeYesterdayNote'), 'Nobody closed yesterday. Scan every slot before selling any scratchers today, before 12:00 PM.');
  await shot(page, 'close-yesterday-home');
  await page.goto(base + 'close.html');
  await page.waitForFunction(() => !document.getElementById('closeView').classList.contains('hidden'));
  assert.match(await text(page, '#lateBanner'), /^Nobody closed yesterday \(2026-10-26\)\. Tap to close it first/);

  // ---- Close Yesterday: scan both slots, submit ----
  await page.goto(base + 'close.html?yesterday=1');
  await page.waitForFunction(() => !document.getElementById('closeView').classList.contains('hidden'));
  assert.match(await text(page, '.app-header'), /Close Yesterday/);
  assert.equal(await text(page, '#dateLine'), 'Yesterday, 2026-10-26 · scan before selling any scratchers today (until 12:00 PM)');
  assert.equal(await shown(page, '#lateBanner'), false);
  const typed = async (t) => { await page.type('#typed', t); await page.click('#typedForm button'); await sleep(120); };
  await typed('1747-0000001-0-015');
  await typed('1111-0000001-0-030');
  assert.equal(await text(page, '#submitBtn'), "Submit Yesterday's Close");
  await shot(page, 'close-yesterday-scanned');
  await page.click('#submitBtn');
  await page.waitForFunction(() => !document.getElementById('closedView').classList.contains('hidden'));
  // 5 + 10 scanned, plus Monday's sold out (51).
  assert.equal(await text(page, '#summary'), 'Closed for 2026-10-26 Submitted the next morning at 9:00 AM by e 66 tickets sold that day 2 slots live');
  assert.equal(await shown(page, '#reopenBtn'), false, 'employee');
  assert.equal(call(() => ctx.summaryOn('2026-10-26')).total_dollars_sold, 100 + 100 + 255);
  // Home: done, so nothing shows.
  await page.goto(base + 'index.html'); await homeLoaded(page); await sleep(200);
  assert.deepEqual([await shown(page, '#closeYesterdayBtn'), await shown(page, '#closeYesterdayNote')], [false, false]);
  await app.close();

  // ---- Owner: sees the late close and reopens it, then closes it again ----
  app = await openApp({ role: 'owner', handle: handler(users.owner) });
  ({ page, base } = app);
  await page.goto(base + 'close.html?yesterday=1');
  await page.waitForFunction(() => !document.getElementById('closedView').classList.contains('hidden'));
  assert.match(await text(page, '#summary'), /\$455 sold that day/);
  assert.equal(await text(page, '#reopenBtn'), "Reopen Yesterday's Close to Fix It");
  await shot(page, 'close-yesterday-closed');
  await page.click('#reopenBtn');
  await page.waitForFunction(() => !document.getElementById('closeView').classList.contains('hidden'));
  assert.equal(call(() => ctx.summaryOn('2026-10-26')), null);
  const typed2 = async (t) => { await page.type('#typed', t); await page.click('#typedForm button'); await sleep(120); };
  await typed2('1747-0000001-0-015'); await typed2('1111-0000001-0-030');
  await page.click('#submitBtn');
  await page.waitForFunction(() => !document.getElementById('closedView').classList.contains('hidden'));
  assert.match(await text(page, '#summary'), /^Closed for 2026-10-26 Submitted the next morning at 9:00 AM by o/);

  // ---- Another morning: something already changed today → the reason, no button ----
  call(() => ctx.reopenClose({ date: '2026-10-26' }));
  call(() => ctx.endPack(users.owner, { box: 1, slot: 2, reason: 'returned', ticketNumber: 38 }));
  await page.goto(base + 'index.html'); await homeLoaded(page);
  await page.waitForFunction(() => !document.getElementById('closeYesterdayNote').classList.contains('hidden'));
  assert.equal(await shown(page, '#closeYesterdayBtn'), false);
  assert.equal(await text(page, '#closeYesterdayNote'), "Yesterday (Mon, Oct 26) wasn't closed. A pack was already sold out, returned or sold whole today, so yesterday can't be closed now. Its sales will count in tonight's close.");
  await shot(page, 'close-yesterday-blocked');
  await page.goto(base + 'close.html?yesterday=1');
  await page.waitForFunction(() => !document.getElementById('closedView').classList.contains('hidden'));
  assert.match(await text(page, '#summary'), /^A pack was already sold out, returned or sold whole today/);

  // ---- After noon: gone everywhere ----
  clock = '12:00:00';
  await page.goto(base + 'index.html'); await homeLoaded(page); await sleep(300);
  assert.deepEqual([await shown(page, '#closeYesterdayBtn'), await shown(page, '#closeYesterdayNote')], [false, false]);
  await page.goto(base + 'close.html?yesterday=1');
  await page.waitForFunction(() => !document.getElementById('closedView').classList.contains('hidden'));
  assert.match(await text(page, '#summary'), /^There's no day to close late now\./);
  await app.close();

  console.log('close yesterday: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
