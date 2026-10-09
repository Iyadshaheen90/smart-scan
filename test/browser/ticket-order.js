// Ticket order per slot (owner 2026-10-08): the ↓/↑ arrow on every Slots card (everyone), the slot page's
// Ticket order section (only while the slot is empty; owner or an employee with the permission), More's
// Set all slots pop-up, and Close Day refusing an already-sold ticket the pack's own way.
// Real backend code on an in-memory sheet. Run: node test/browser/ticket-order.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const { openApp, backendInVm, sleep } = require('./harness');

const TODAY = '2026-10-08';
const { ctx, addRow, call } = backendInVm(TODAY);
for (let slot = 1; slot <= 24; slot++) {
  addRow('SlotConfig', { box: 1, slot_number: slot, price_per_ticket: 20 });
  addRow('SlotState', { box: 1, slot_number: slot });
}
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 5, tickets_in_reserve: 150 });
const owner = { username: 'o', role: 'owner' };
ctx.activatePack(owner, { box: 1, slot: 1, gameNumber: '1747', packNumber: '0000001', ticketNumber: 24 });
ctx.setSlotOrder(owner, { box: 1, slot: 2, order: 'ascending' });
ctx.activatePack(owner, { box: 1, slot: 2, gameNumber: '1747', packNumber: '0000002', ticketNumber: 5 });
ctx.setSlotOrder(owner, { box: 1, slot: 3, order: 'ascending' }); // empty, ascending next

function handler(user) {
  return (b) => {
    const run = {
      listSlots: () => ctx.listSlots(),
      setSlotOrder: () => ctx.setSlotOrder(user, b),
      setAllSlotsOrder: () => ctx.setAllSlotsOrder(user, b),
      closeStatus: () => ctx.closeStatus(user),
    }[b.action];
    return run ? call(run) : {};
  };
}

const arrows = (page) => page.$$eval('#list .card', (cards) => cards.slice(0, 4).map((c) => c.querySelector('.order-arrow').dataset.order));

(async () => {
  // --- Employee without the permission: sees the arrows, can't open a slot, no Ticket order on More.
  let app = await openApp({ role: 'employee', permissions: [], handle: handler({ username: 'e', role: 'employee', permissions: [] }) });
  let { page } = app;
  await page.goto(app.base + 'slots.html');
  await page.waitForSelector('#list .card .order-arrow');
  assert.deepEqual(await arrows(page), ['descending', 'ascending', 'ascending', 'descending']);
  assert.equal(await page.$('#list a.card'), null, 'cards not tappable');
  // The arrow sits at the right end of the card's top row.
  const pos = await page.$eval('#list .card', (c) => {
    const a = c.querySelector('.order-arrow').getBoundingClientRect();
    const tag = c.querySelector('.tag').getBoundingClientRect();
    return { arrowRight: a.right, cardRight: c.getBoundingClientRect().right, tagRight: tag.right, arrowLeft: a.left };
  });
  assert.ok(pos.arrowLeft >= pos.tagRight, 'arrow right of the tag');
  assert.ok(pos.cardRight - pos.arrowRight < 30, 'arrow at the right edge');
  await page.goto(app.base + 'more.html');
  await page.waitForSelector('#signOut');
  assert.ok(await page.$eval('#orderRow', (el) => el.classList.contains('hidden')));
  await app.close();

  // --- Owner: slot page section greyed with a pack in, live on an empty slot.
  app = await openApp({ role: 'owner', handle: handler(owner) });
  ({ page } = app);
  await page.goto(app.base + 'slots.html');
  await page.waitForSelector('#list .card .order-arrow');
  assert.ok(await page.$('#list .card .tag-stack + .order-arrow'), 'owner: arrow after the tickets-left / days stack');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/order-slots.png` });

  await page.goto(app.base + 'activate.html?box=1&slot=2');
  await page.waitForFunction(() => !document.getElementById('orderForm').classList.contains('hidden'));
  assert.equal(await page.$eval('#orderInfo', (el) => el.textContent),
    'This pack is sold ↑ ascending (000 up). Change it when the slot is empty.');
  assert.deepEqual(await page.$$eval('#orderSwitch button', (bs) => bs.map((b) => [b.dataset.order, b.disabled, b.classList.contains('active')])),
    [['descending', true, false], ['ascending', true, true]]);
  assert.match(await page.$eval('#slotInfo', (el) => el.textContent), /25 Tickets Left/);

  await page.goto(app.base + 'activate.html?box=1&slot=4');
  await page.waitForFunction(() => !document.getElementById('orderForm').classList.contains('hidden'));
  assert.equal(await page.$eval('#orderInfo', (el) => el.textContent), 'The next pack in this slot is sold ↓ descending (down to 000).');
  await page.click('#orderSwitch button[data-order="ascending"]');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('orderMessage').textContent));
  assert.equal(ctx.listSlots()[3].slotOrder, 'ascending');
  assert.ok(await page.$eval('#orderSwitch button[data-order="ascending"]', (b) => b.classList.contains('active') && b.querySelector('svg')), 'arrow kept');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/order-slot-page.png`, fullPage: true });

  // --- Returned on an ascending pack: 005 → 010 sold 5, 20 going back; a ticket below 005 is refused.
  await page.goto(app.base + 'activate.html?box=1&slot=2');
  await page.waitForFunction(() => !document.getElementById('oldStep').classList.contains('hidden'));
  await page.click('#returnedBtn'); await sleep(100);
  await page.type('#typed', '1747-0000002-4-003'); await page.click('#typedForm button'); await sleep(150);
  assert.match(await page.$eval('#message', (el) => el.textContent), /below the last recorded top ticket \(005\)/);
  await page.$eval('#typed', (el) => { el.value = ''; });
  await page.type('#typed', '1747-0000002-4-010'); await page.click('#typedForm button'); await sleep(150);
  assert.match(await page.$eval('#nextPrompt', (el) => el.textContent), /returned with top ticket 010: 5 sold today \(\$100\), 20 going back/);

  // --- More: Set all slots. Cancel changes nothing; Save sets every slot.
  await page.goto(app.base + 'more.html');
  await page.waitForSelector('#orderRow:not(.hidden)');
  await page.click('#orderRow');
  assert.ok(await page.$eval('#orderSave', (b) => b.disabled), 'Save greyed until a choice');
  await page.click('#orderChoices button[data-order="ascending"]');
  await page.click('#orderCancel');
  assert.equal(ctx.listSlots()[0].slotOrder, 'descending');
  await page.click('#orderRow');
  await page.click('#orderChoices button[data-order="ascending"]');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/order-more.png` });
  await page.click('#orderSave');
  await page.waitForFunction(() => /All 24 slots/.test(document.getElementById('orderResult').textContent));
  assert.equal(await page.$eval('#orderResult', (el) => el.textContent),
    'All 24 slots are set to ↑ ascending. 23 switched now; 1 switch when their pack sells out or is returned.');
  assert.ok(ctx.listSlots().every((s) => s.slotOrder === 'ascending'));
  // Slot 1's descending pack keeps its ↓ until it ends; its slot page says what comes next.
  await page.goto(app.base + 'slots.html');
  await page.waitForSelector('#list .card .order-arrow');
  assert.deepEqual(await arrows(page), ['descending', 'ascending', 'ascending', 'ascending']);
  await page.goto(app.base + 'activate.html?box=1&slot=1');
  await page.waitForFunction(() => !document.getElementById('orderForm').classList.contains('hidden'));
  assert.equal(await page.$eval('#orderInfo', (el) => el.textContent),
    'This pack is sold ↓ descending (down to 000). Next pack: ↑ ascending (000 up). Change it when the slot is empty.');

  // --- Close Day: below the last top ticket is refused for the ascending pack; above is fine.
  await page.goto(app.base + 'close.html');
  await page.waitForSelector('#typed');
  await sleep(300);
  await page.type('#typed', '1747-0000002-4-004'); await page.click('#typedForm button'); await sleep(300);
  assert.match(await page.$eval('#flash', (el) => el.textContent), /Ticket 004 is below the last top ticket \(005\)/);
  await page.$eval('#typed', (el) => { el.value = ''; });
  await page.type('#typed', '1747-0000002-4-009'); await page.click('#typedForm button'); await sleep(300);
  assert.match(await page.$eval('#review', (el) => el.textContent), /4 Sold/);
  await app.close();

  // --- Employee with Ticket order only: slot page shows just that section; home and More link to it.
  const orderer = { username: 'e', role: 'employee', permissions: ['ticket_order'] };
  app = await openApp({ role: 'employee', permissions: ['ticket_order'], handle: handler(orderer) });
  ({ page } = app);
  await page.goto(app.base + 'activate.html?box=1&slot=5');
  await page.waitForFunction(() => !document.getElementById('orderForm').classList.contains('hidden'));
  for (const id of ['priceForm', 'sizeForm', 'swapForm', 'scanStep']) {
    assert.ok(await page.$eval('#' + id, (el) => el.classList.contains('hidden')), id);
  }
  assert.equal(await page.$eval('#message', (el) => el.textContent), '', 'no "loading packs" notice');
  await page.click('#orderSwitch button[data-order="descending"]');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('orderMessage').textContent));
  assert.equal(ctx.listSlots()[4].slotOrder, 'descending');
  await page.goto(app.base + 'more.html');
  await page.waitForSelector('#orderRow:not(.hidden)');
  await app.close();

  console.log('TICKET ORDER CHECKS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
