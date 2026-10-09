// Close shift (close.html?shift=1, owner's request 2026-09-30): the Close Day screen titled Close shift, counting
// from the previous shift close today (or last night's close). An employee's shift close shows tickets only and
// can be done once a day; a slot sold out at an earlier shift close is filled in as "sold out · 0"; the owner sees
// $; Close Day itself still starts from last night's close; no shift close once the day is closed.
// Runs the real backend on an in-memory sheet. Run: node test/browser/shift-close.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const { openApp, backendInVm, sleep } = require('./harness');

let clock = '14:00:00';
const { ctx, sheets: S, addRow, call } = backendInVm('2026-11-10', () => clock);
const slotRow = (slot, price, game, pack, ticket) => ({ box: 1, slot_number: slot, pack_key: `${game}-${pack}`, game_number: game,
  pack_number: pack, price_per_ticket: price, current_exposed_ticket_number: ticket, activation_date: '2026-11-01', last_close_date: '2026-11-09' });
for (const [slot, price] of [[1, 20], [2, 10], [3, 5]]) addRow('SlotConfig', { box: 1, slot_number: slot, price_per_ticket: price });
addRow('SlotState', slotRow(1, 20, '1747', '0000001', 25));
addRow('SlotState', slotRow(2, 10, '1111', '0000001', 45));
addRow('SlotState', slotRow(3, 5, '5555', '0000001', 70));

const users = { owner: { username: 'o', role: 'owner' }, employee: { username: 'e', role: 'employee' } };
const requests = [];
const handler = (user) => (body) => {
  requests.push(body);
  const fn = {
    shiftStatus: () => ctx.shiftStatus(user),
    submitShiftClose: () => ctx.submitShiftClose(user, body.entries, body.shiftId, body.date),
    closeStatus: () => ctx.closeStatus(user),
  }[body.action];
  return fn ? call(fn) : {};
};

const text = (page, sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
const typed = async (page, t) => { await page.type('#typed', t); await page.click('#typedForm button'); await sleep(150); };
const review = (page) => page.$$eval('#review .review-row', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));

(async () => {
  const shots = process.env.SHOTS;

  // Employee, 2 PM: the first shift close today starts from last night's close.
  let app = await openApp({ role: 'employee', handle: handler(users.employee) });
  let { page, base } = app;
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(base + 'close.html?shift=1');
  await page.waitForSelector('#closeView:not(.hidden)'); await sleep(200);
  assert.equal(await text(page, 'header h1'), 'Close Shift');
  assert.equal(await page.title(), 'Smart Scan — Close Shift');
  assert.equal(await text(page, '#dateLine'), "2026-11-10 · since last night's close");
  assert.equal(await text(page, '#curLast'), 'Shift start ticket 025 (26 left)');
  assert.equal(await text(page, '#submitBtn'), 'Submit Shift Close (3 Left)');
  await typed(page, '1747-0000001-0-020');
  await page.click('#soldOutBtn'); await sleep(150);             // slot 2 (dialog accepted)
  await typed(page, '5555-0000001-0-071');                        // above the start ticket: refused
  assert.match(await text(page, '#flash'), /above the shift's start ticket \(070\)/);
  await typed(page, '5555-0000001-0-070');
  assert.deepEqual(await review(page), ['B1 · S1 · $20 5 Sold · Top 020', 'B1 · S2 · $10 Sold Out · 46', 'B1 · S3 · $5 0 Sold · Top 070']);
  assert.equal(await text(page, '#submitBtn'), 'Submit Shift Close');
  if (shots) await page.screenshot({ path: `${shots}/shift-close-employee.png`, fullPage: true });
  await page.click('#submitBtn');
  await page.waitForSelector('#closedView:not(.hidden)');
  let summary = await text(page, '#summary');
  assert.match(summary, /Shift Closed at 2:00 PM by e/); assert.match(summary, /From last night's close to 2:00 PM/);
  assert.match(summary, /51 tickets sold this shift/); assert.ok(!summary.includes('$'), 'employees see no dollars');
  assert.ok(!(await page.$eval('#reopenBtn', (b) => b.offsetParent)), 'no Reopen on a shift close');
  if (shots) await page.screenshot({ path: `${shots}/shift-close-done.png`, fullPage: true });
  // Nothing Close Day uses changed.
  assert.deepEqual(S.SlotState.rows.slice(1).map((r) => r[S.SlotState.rows[0].indexOf('current_exposed_ticket_number')]), [25, 45, 70]);
  assert.equal(S.DailyCloseLog.rows.length, 1); assert.equal(S.DailySummary.rows.length, 1);
  // Opened again: one shift close a day.
  await page.goto(base + 'close.html?shift=1'); await page.waitForSelector('#closedView:not(.hidden)');
  assert.match(await text(page, '#summary'), /You can close one shift a day\. If this one was a mistake, ask the owner to delete it\./);
  assert.ok(!(await page.$eval('#closeView', (el) => el.offsetParent)));
  await app.close();

  // Owner, 4 PM: counts from the 2 PM shift close; slot 2 was sold out then, so it's filled in and needs no scan.
  clock = '16:00:00';
  app = await openApp({ role: 'owner', handle: handler(users.owner) });
  ({ page, base } = app);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(base + 'close.html?shift=1');
  await page.waitForSelector('#closeView:not(.hidden)'); await sleep(200);
  assert.equal(await text(page, '#dateLine'), '2026-11-10 · since the 2:00 PM shift close by e');
  assert.equal(await text(page, '#progressText'), '1 of 3 Slots Done');
  assert.equal(await text(page, '#curLast'), 'Shift start ticket 020 (21 left)');
  assert.deepEqual((await review(page))[1], 'B1 · S2 · $10 Sold Out · 0');
  await typed(page, '1111-0000001-0-040');
  assert.match(await text(page, '#flash'), /was marked sold out at the 2:00 PM shift close\. Not saved\./);
  await typed(page, '1747-0000001-0-015');
  await typed(page, '5555-0000001-0-060');
  assert.equal(await text(page, '#submitBtn'), 'Submit Shift Close');
  // Tap the sold-out slot: nothing to scan, and no Sold out button.
  await page.click('#review .review-row:nth-child(2)'); await sleep(100);
  assert.equal(await text(page, '#curLast'), 'Sold out at the 2:00 PM shift close');
  assert.ok(await page.$eval('#soldOutBtn', (b) => b.disabled));
  if (shots) await page.screenshot({ path: `${shots}/shift-close-owner.png`, fullPage: true });
  await page.click('#submitBtn');
  await page.waitForSelector('#closedView:not(.hidden)');
  summary = await text(page, '#summary');
  assert.match(summary, /Shift Closed at 4:00 PM by o/); assert.match(summary, /From the 2:00 PM shift close to 4:00 PM/);
  assert.match(summary, /15 tickets sold this shift/); assert.match(summary, /\$150 sold this shift/); // 5 × $20 + 10 × $5
  const sent = requests.filter((r) => r.action === 'submitShiftClose').pop();
  assert.deepEqual(sent.entries.map((e) => e.slot), [1, 3], 'the earlier sold out is not sent');
  // The owner may close another shift.
  await page.goto(base + 'close.html?shift=1'); await page.waitForSelector('#closeView:not(.hidden)');

  // Close Day still starts from last night's close and needs slot 2 marked sold out again.
  await page.goto(base + 'close.html'); await page.waitForSelector('#closeView:not(.hidden)'); await sleep(200);
  assert.equal(await text(page, 'header h1'), 'Close Day');
  assert.equal(await text(page, '#curLast'), 'Last top ticket 025 (26 left)');
  assert.deepEqual(await review(page), ['B1 · S1 · $20 Not Done', 'B1 · S2 · $10 Not Done', 'B1 · S3 · $5 Not Done']);
  assert.equal(await text(page, '#submitBtn'), 'Submit Close (3 Left)');

  // Once the day is closed there's no shift left to close.
  addRow('DailySummary', { close_date: '2026-11-10', total_tickets_sold: 1 });
  await page.goto(base + 'close.html?shift=1'); await page.waitForSelector('#closedView:not(.hidden)');
  assert.match(await text(page, '#summary'), /Today is already closed/);
  await app.close();

  console.log('SHIFT CLOSE CHECKS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
