// Try again (owner's request 2026-10-04): when Slots, Back stock or Months & totals can't load, the reason shows
// with a Try again button. Tapping it loads again: still no connection → the reason and a fresh button come back;
// connected → the page fills in and the message goes away. Back stock's camera starts once it has loaded.
// The message sits at the top, under the header, so it's seen without scrolling (owner 2026-10-04), even when the
// saved list from an earlier load fills the page.
// Run: node test/browser/try-again.js   (SHOTS=dir also saves a screenshot)
const assert = require('assert/strict');
const { openApp, sleep, ABORT } = require('./harness');

const live = (slot) => ({ box: 1, slot, slotPrice: 20, endedToday: null, lastGame: null,
  pack: { gameNumber: '1747', packNumber: String(1000000 + slot), price: 20, exposedTicket: 9, remaining: 10,
    activationDate: '2026-10-01', lastCloseDate: '2026-10-03', daysActive: 3, packsInBack: 0, ticketsPerPack: 30, standardPackSize: 30 } });
const game = { gameNumber: '1747', price: 20, ticketsPerPack: 30, standardPackSize: 30, packsInBack: 3,
  ticketsInBack: 90, valueInBack: 1800, liveSlots: 0, liveIn: [], endedDate: null };
const summary = { label: '2026-10', status: 'active', url: 'https://example.com', ticketsSold: 10, dollarsSold: 700,
  shipmentValue: 0, endingInventoryValue: 100, days: [{ date: '2026-10-02', ticketsSold: 10, dollarsSold: 700, inventoryValue: 100 }] };
const data = { listSlots: Array.from({ length: 24 }, (_, i) => live(i + 1)), listBackStock: [game],
  monthsPage: { status: { current: '2026-10', currentUrl: 'https://example.com', next: '2026-11', canStart: false },
    summary, months: [{ label: '2026-10', status: 'active', url: 'u' }] } };

const pages = [
  { url: 'slots.html', message: '#loadMessage', loaded: () => document.querySelectorAll('#list .slot-card, #list a').length > 0 },
  { url: 'backstock.html', message: '#loadMessage', loaded: () => document.querySelectorAll('#stock .card').length === 1 },
  { url: 'month.html', message: '#loadMessage', loaded: () => /\$700/.test(document.getElementById('current').innerText) },
];

(async () => {
  let offline = true;
  const calls = [];
  const app = await openApp({ role: 'owner', handle: (b) => { calls.push(b.action); return offline ? ABORT : data[b.action] || {}; } });
  const { page, base } = app;
  const button = (sel) => page.$eval(sel, (m) => {
    const b = m.querySelector('button.try-again');
    return b && { text: b.textContent, disabled: b.disabled, reason: m.textContent.includes('Could not reach the server') };
  });
  // The whole message and its button are on screen at the top, without scrolling.
  const onTop = (sel) => page.$eval(sel, (m) => window.scrollY === 0 && m.getBoundingClientRect().top < 260
    && m.getBoundingClientRect().bottom <= window.innerHeight);

  for (const p of pages) {
    offline = true;
    await page.goto(base + p.url);
    await page.waitForFunction((sel) => document.querySelector(`${sel} button.try-again`), {}, p.message);
    assert.deepEqual(await button(p.message), { text: 'Try again', disabled: false, reason: true }, p.url);
    assert.ok(await onTop(p.message), `${p.url} message at the top`);
    assert.ok(!(await page.evaluate(p.loaded)), `${p.url} empty`);
    if (process.env.SHOTS && p.url === 'slots.html') await page.screenshot({ path: `${process.env.SHOTS}/try-again.png`, clip: { x: 0, y: 0, width: 390, height: 360 } });

    // Still offline: tries again, then the reason and a fresh button come back.
    calls.length = 0;
    await page.click(`${p.message} button.try-again`);
    await sleep(400);
    assert.equal(calls.length, 1, `${p.url} asked again`);
    assert.deepEqual(await button(p.message), { text: 'Try again', disabled: false, reason: true }, `${p.url} again`);

    // Back online: the page fills in and the message goes away.
    offline = false;
    await page.click(`${p.message} button.try-again`);
    await page.waitForFunction(p.loaded);
    await sleep(200);
    assert.equal(await page.$eval(p.message, (m) => m.textContent), '', `${p.url} message cleared`);
    if (p.url === 'backstock.html') {
      await sleep(500);
      assert.ok(await page.$eval('#video', (v) => Boolean(v.srcObject)), 'camera started after Try again');
    }
  }

  // Slots loaded once (24 slots saved on the phone), then opened offline: the saved list fills the page,
  // and the message and Try again are still at the top.
  offline = true;
  await page.goto(base + 'slots.html');
  await page.waitForFunction(() => document.querySelector('#loadMessage button.try-again'));
  assert.ok(await page.evaluate(() => document.body.classList.contains('showing-saved')), 'saved list shown');
  assert.ok(await page.evaluate(() => document.body.scrollHeight > window.innerHeight * 1.5), 'page is long');
  assert.ok(await onTop('#loadMessage'), 'message at the top over a saved list');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/try-again-saved.png` });
  await app.close();
  console.log('TRY AGAIN CHECKS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
