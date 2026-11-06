// Shift Closure report (shifts.html, owner): this month's shift closes grouped by day, newest first; each card has who
// and when, from → to, tickets, $, slots scanned, packs ended during the shift; Slots opens every slot's start → end
// ticket; Delete (after a confirm) removes it; Select chooses several to delete together. Runs the real backend on an in-memory sheet.
// Run: node test/browser/shifts.js   (SHOT=file saves a screenshot)
const assert = require('assert/strict');
const { openApp, backendInVm, sleep } = require('./harness');

let clock = '14:00:00';
const { ctx, addRow, call } = backendInVm('2026-11-10', () => clock);
for (const [slot, price] of [[1, 20], [2, 5]]) addRow('SlotConfig', { box: 1, slot_number: slot, price_per_ticket: price });
addRow('SlotState', { box: 1, slot_number: 1, pack_key: '1747-0000001', game_number: '1747', pack_number: '0000001', price_per_ticket: 20,
  current_exposed_ticket_number: 25, activation_date: '2026-11-01', last_close_date: '2026-11-09' });
addRow('SlotState', { box: 1, slot_number: 2, pack_key: '5555-0000001', game_number: '5555', pack_number: '0000001', price_per_ticket: 5,
  current_exposed_ticket_number: 70, activation_date: '2026-11-01', last_close_date: '2026-11-09' });
addRow('ReserveInventory', { game_number: '3333', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 2, tickets_in_reserve: 60 });
const owner = { username: 'o', role: 'owner' }; const emp = { username: 'e', role: 'employee' };
const scan = (one, two) => [{ box: 1, slot: 1, packKey: '1747-0000001', type: 'scan', ticketNumber: one },
  { box: 1, slot: 2, packKey: '5555-0000001', type: 'scan', ticketNumber: two }];
ctx.submitShiftClose(emp, scan(20, 60), 's1', '2026-11-10');                 // 5 + 10
clock = '15:00:00'; ctx.sellFullPack(owner, { gameNumber: '3333', packNumber: '0000001' });
clock = '18:00:00'; ctx.submitShiftClose(owner, scan(18, 60), 's2', '2026-11-10');   // 2 + 0 + the full pack (30)

function handle(body) {
  const fn = {
    listShiftCloses: () => ctx.listShiftCloses(owner),
    deleteShiftClose: () => ctx.deleteShiftClose(owner, body),
  }[body.action];
  return fn ? call(fn) : {};
}

(async () => {
  let dialog = null; let answer = true;
  const app = await openApp({ role: 'owner', handle, onDialog: (d) => { dialog = d.message(); return answer ? d.accept() : d.dismiss(); } });
  const { page, base } = app;
  const cards = () => page.$$eval('#list .card', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
  await page.goto(base + 'shifts.html'); await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 2);
  assert.equal(await page.$eval('header h1', (el) => el.textContent), 'Shift Closure');
  assert.deepEqual(await page.$$eval('#list .section-label', (els) => els.map((el) => el.textContent)), ['Tue, Nov 10']);
  let c = await cards();
  assert.match(c[0], /^o · 6:00 PM \$640/); assert.match(c[0], /From the 2:00 PM shift close to 6:00 PM/);
  assert.match(c[0], /32 Tickets Sold \$640 Sold 2 Slots Scanned/);
  assert.match(c[0], /Includes 30 tickets \(\$600\) from packs ended or sold whole during the shift\./);
  assert.match(c[1], /^e · 2:00 PM \$150/); assert.match(c[1], /From last night's close to 2:00 PM/);
  // Slots: every slot's start → end ticket, and the full pack.
  await page.click('#list .card details summary'); await sleep(100);
  c = await cards();
  assert.match(c[0], /Slots \(3\)/);
  assert.match(c[0], /Box 1 · Slot 1 · 1747-0000001 020 → 018 · 2 sold · \$40/);
  assert.match(c[0], /Box 1 · Slot 2 · 5555-0000001 060 → 060 · 0 sold · \$0/);
  assert.match(c[0], /From the Back · 3333-0000001 full pack sold · 30 sold · \$600/);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  // Delete the 2 PM one.
  await page.$$eval('#list .card button.danger', (els) => els[1].click());   // the 2 PM one (under the tab bar)
  await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 1);
  assert.match(dialog, /^Delete e's shift close at 2:00 PM on Tue, Nov 10\?/);
  assert.equal(await page.$eval('#message', (el) => el.textContent), "Deleted e's shift close at 2:00 PM.");
  assert.match((await cards())[0], /^o · 6:00 PM/);
  assert.equal(ctx.shiftStatus(emp).myShiftToday, null, 'e can close a shift again');

  // None left.
  await page.$eval('#list .card button.danger', (b) => b.click());
  await page.waitForFunction(() => document.getElementById('list').innerText.includes('No shift closes this month yet.'));

  // ---- Choosing several ----
  clock = '19:00:00'; ctx.submitShiftClose(emp, scan(18, 60), 's3', '2026-11-10');
  clock = '19:10:00'; ctx.submitShiftClose(owner, scan(17, 60), 's4', '2026-11-10');
  clock = '19:20:00'; ctx.submitShiftClose(owner, scan(16, 60), 's5', '2026-11-10');
  await page.goto(base + 'shifts.html'); await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 3);
  const shown = (sel) => page.$eval(sel, (e) => e.getClientRects().length > 0);
  const text = (sel) => page.$eval(sel, (e) => e.textContent);
  const tapCard = (i) => page.$$eval('#list .card', (els, n) => els[n].click(), i);
  const marked = () => page.$$eval('#list .card', (els) => els.map((e) => e.classList.contains('selected')));
  // Before: Select, each card's own Delete, the tab bar; tapping a card chooses nothing.
  assert.equal(await text('#selectToggle'), 'Select');
  assert.equal(await shown('.shift-delete'), true); assert.equal(await shown('nav.tabbar'), true); assert.equal(await shown('#selectBar'), false);
  await tapCard(0); assert.deepEqual(await marked(), [false, false, false]);
  // Select: the bar takes the tab bar's place, card Deletes and Slots go, nothing chosen yet.
  await page.click('#selectToggle');
  assert.equal(await shown('#selectBar'), true); assert.equal(await shown('nav.tabbar'), false);
  assert.equal(await shown('.shift-delete'), false); assert.equal(await shown('.shift-card details'), false);
  assert.equal(await text('#selectCount'), 'Select Shifts'); assert.equal(await text('#selectToggle'), 'Select All');
  assert.equal(await page.$eval('#selectDelete', (b) => b.disabled), true);
  // Tap chooses, tap again un-chooses.
  await tapCard(0); await tapCard(2);
  assert.deepEqual(await marked(), [true, false, true]); assert.equal(await text('#selectCount'), '2 Selected');
  assert.equal(await page.$eval('#selectDelete', (b) => b.disabled), false);
  await tapCard(2); assert.deepEqual(await marked(), [true, false, false]); assert.equal(await text('#selectCount'), '1 Selected');
  // Select All / Deselect All.
  await page.click('#selectToggle'); assert.deepEqual(await marked(), [true, true, true]); assert.equal(await text('#selectToggle'), 'Deselect All');
  await page.click('#selectToggle'); assert.deepEqual(await marked(), [false, false, false]); assert.equal(await text('#selectCount'), 'Select Shifts');
  // Cancel drops the choice and brings everything back.
  await tapCard(1); await page.click('#selectCancel');
  assert.equal(await shown('#selectBar'), false); assert.equal(await shown('nav.tabbar'), true); assert.equal(await shown('.shift-delete'), true);
  assert.deepEqual(await marked(), [false, false, false]); assert.equal(await text('#selectToggle'), 'Select');
  // Answering No to the question deletes nothing and keeps the choice.
  await page.click('#selectToggle'); await tapCard(0); await tapCard(2);
  answer = false; await page.click('#selectDelete'); await sleep(100); answer = true;
  assert.match(dialog, /^Delete 2 shift closes\? This can't be undone\.\n\no, 7:20 PM, Tue, Nov 10\ne, 7:00 PM, Tue, Nov 10$/);
  assert.equal(ctx.listShiftCloses(owner).count, 3); assert.deepEqual(await marked(), [true, false, true]);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(/\.png$/, '-select.png') });
  // Yes: both go in one request; one left, so no more Select.
  let deletes = 0; page.on('request', (r) => { if ((r.postData() || '').includes('deleteShiftClose')) deletes += 1; });
  await page.click('#selectDelete');
  await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 1);
  assert.equal(deletes, 1, 'one request');
  assert.equal(await text('#message'), 'Deleted 2 shift closes.');
  assert.match((await cards())[0], /^o · 7:10 PM/);
  assert.equal(await shown('nav.tabbar'), true); assert.equal(await shown('#selectBar'), false);
  assert.equal(await page.$('#selectToggle'), null);
  assert.equal(ctx.shiftStatus(emp).myShiftToday, null, 'e can close a shift again');
  // Already deleted on another phone: says so and shows the list as it is now.
  clock = '19:30:00'; ctx.submitShiftClose(owner, scan(15, 60), 's6', '2026-11-10');
  await page.goto(base + 'shifts.html'); await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 2);
  await page.click('#selectToggle'); await tapCard(0);
  ctx.deleteShiftClose(owner, { shiftId: 's6' });
  await page.click('#selectDelete');
  await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 1);
  assert.equal(await text('#message'), "That shift close isn't saved any more.");
  assert.equal(await shown('#selectBar'), false);
  console.log('SHIFTS PAGE CHECKS PASS');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
