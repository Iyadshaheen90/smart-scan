// Slot page, Activation Date (owner 2026-10-26): a slow pack the lottery activated on its own while in the back. The owner
// sets the day it was really activated, and the days counter (and so Settling) follows it. Owner only; the section sits
// under Pack Size, above Move or Swap; empty slots have none. Real backend code (Slots.js) on an in-memory sheet.
// Run: node test/browser/activation-date.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const { openApp, backendInVm, sleep } = require('./harness');

const { ctx, addRow, call } = backendInVm('2026-10-26');
for (const slot of [1, 2]) addRow('SlotConfig', { box: 1, slot_number: slot, price_per_ticket: 20 });
addRow('SlotState', { box: 1, slot_number: 1, pack_key: '1747-0012345', game_number: '1747', pack_number: '0012345',
  price_per_ticket: 20, current_exposed_ticket_number: 29, activation_date: '2026-10-26', last_close_date: '' });
addRow('SlotState', { box: 1, slot_number: 2 });
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 1, tickets_in_reserve: 30 });

const handle = (b) => {
  if (b.action === 'listSlots') return call(() => ctx.listSlots());
  if (b.action === 'setActivationDate') return call(() => ctx.setActivationDate(b));
  return {};
};
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });

(async () => {
  let app = await openApp({ role: 'owner', handle });
  let { page, base } = app;
  const visible = (id) => page.$eval('#' + id, (el) => !el.classList.contains('hidden'));
  const text = (id) => page.$eval('#' + id, (el) => el.textContent);
  const setDate = async (value) => {
    await page.click('#activatedRow'); // Slot Settings → Activation Date opens its pop-up (redesign 2026-10-29)
    await page.$eval('#activatedOn', (el, v) => { el.value = v; }, value);
    await page.click('#activatedForm button[type="submit"]'); await sleep(200);
  };

  await page.goto(base + 'activate.html?box=1&slot=1');
  await page.waitForFunction(() => !document.getElementById('activatedForm').classList.contains('hidden'));
  // Under Pack Size, above Move or Swap.
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('form')].map((f) => f.id).filter((id) => /size|activated|swap/i.test(id))),
    ['sizeForm', 'activatedForm', 'swapForm']);
  assert.match(await text('activatedInfo'), /^Oct 26, 2026: activated today\. If the lottery activated this pack before it went in the slot/);
  assert.equal(await page.$eval('#activatedOn', (el) => el.value), '2026-10-26');
  // The pop-up never scrolls sideways, and the date field fits inside it (iPhone draws date fields too wide otherwise).
  await page.click('#activatedRow');
  for (const width of [390, 320]) {
    await page.setViewport({ width, height: 800 });
    const fit = await page.$eval('#activatedForm', (f) => {
      const date = f.querySelector('#activatedOn').getBoundingClientRect();
      const box = f.getBoundingClientRect();
      return { x: getComputedStyle(f).overflowX, fits: date.left >= box.left && date.right <= box.right, wide: f.scrollWidth > f.clientWidth,
        look: getComputedStyle(f.querySelector('#activatedOn')).appearance };
    });
    assert.deepEqual(fit, { x: 'hidden', fits: true, wide: false, look: 'none' }, `width ${width}`);
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.click('#activatedDialog [data-close]');

  // The lottery activated it on its own on Sep 12.
  await setDate('2026-09-12');
  assert.equal(await text('activatedMessage'), 'Pack 1747-0012345 activated Sep 12, 2026: 44 days ago.');
  // Saved: the pop-up closes, the row shows the new day, and the message floats above the tab bar.
  assert.equal(await visible('activatedDialog'), false);
  assert.equal(await text('activatedRowSub'), 'Sep 12, 2026 · 44 days ago');
  assert.equal(await text('settingsToast'), 'Pack 1747-0012345 activated Sep 12, 2026: 44 days ago.');
  assert.match(await text('activatedInfo'), /^Sep 12, 2026: 44 days ago\./);
  assert.match(await text('oldDetail'), /activated 2026-09-12$/);
  assert.equal(call(() => ctx.listSlots())[0].pack.daysActive, 44);
  await shot(page, 'activation-date-saved');

  // A typo in the year is refused; nothing changes.
  await setDate('2024-09-12');
  assert.equal(await text('activatedMessage'), 'That date is more than a year ago. Check the year.');
  assert.equal(await visible('activatedDialog'), true, 'a refusal keeps the pop-up open');
  assert.equal(call(() => ctx.listSlots())[0].pack.daysActive, 44);

  // An empty slot has no Activation Date.
  await page.goto(base + 'activate.html?box=1&slot=2');
  await page.waitForFunction(() => !document.getElementById('swapForm').classList.contains('hidden'));
  assert.equal(await visible('activatedForm'), false, 'empty slot');
  await app.close();

  // An employee who can load packs doesn't get it.
  app = await openApp({ role: 'employee', permissions: ['load_packs'], handle });
  ({ page, base } = app);
  await page.goto(base + 'activate.html?box=1&slot=1');
  await page.waitForFunction(() => !document.getElementById('oldStep').classList.contains('hidden'));
  assert.equal(await page.$eval('#activatedForm', (el) => !el.classList.contains('hidden')), false, 'employee');
  assert.equal(await page.$eval('#settingsGroup', (el) => el.classList.contains('hidden')), true, 'no Slot Settings for Load Packs only');
  await app.close();

  console.log('activation date: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
