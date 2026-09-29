// Home page (new design, 2026-09-28): the owner's last-close totals, live slots and back stock $,
// the Not closed / Closed chip, and the tab bar for each role. Employees see no dollar amounts.
// Run: node test/browser/home.js   (SHOTS=dir also saves screenshots)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const live = (slot, remaining = 10) => ({ box: 1, slot, slotPrice: 20, pack: { gameNumber: '1747', packNumber: String(1000000 + slot), price: 20, remaining } });
const slots = [live(1), live(2), live(3), { box: 1, slot: 4, slotPrice: 10, pack: null }];
let backStock = [{ gameNumber: '1747', valueInBack: 1200 }, { gameNumber: '1800', valueInBack: 450.5 }];

// closed: today's summary or null. months: { label: days[] }.
function backend({ closed = null, slotList = slots, months = { '2026-09': [{ date: '2026-09-27', ticketsSold: 214, dollarsSold: 1284 }] }, current = '2026-09' } = {}) {
  return (body) => {
    switch (body.action) {
      case 'closeStatus': return { today: '2026-09-28', closed, slots: slotList };
      case 'listBackStock': return backStock;
      case 'monthStatus': return { current, next: '2026-10', canStart: false };
      case 'monthSummary': {
        const days = months[body.label] || [];
        return { label: body.label, days, dollarsSold: days.reduce((sum, d) => sum + d.dollarsSold, 0) };
      }
      case 'listMonths': return Object.keys(months).sort().reverse().map((label) => ({ label }));
      default: return {};
    }
  };
}

const text = (page, id) => page.$eval(`#${id}`, (el) => el.textContent.trim());
const visibleText = (page) => page.evaluate(() => document.body.innerText);
const tabs = (page) => page.$$eval('nav.tabbar a', (els) => els.map((a) => [a.textContent.trim(), a.getAttribute('href'), a.classList.contains('active')]));

async function home(app) {
  await app.page.goto(app.base + 'index.html');
  await app.page.waitForFunction(() => document.getElementById('closedChip').textContent !== '');
  await sleep(200);
}

(async () => {
  const shots = process.env.SHOTS;

  // Owner, not closed yet: yesterday's close.
  let app = await openApp({ role: 'owner', username: 'ishaheen', handle: backend() });
  await home(app);
  assert.equal(await text(app.page, 'closedChip'), 'Not closed');
  assert.equal(await text(app.page, 'todayLabel'), 'Today · Mon, Sep 28');
  assert.equal(await text(app.page, 'lastDollars'), '$1,284');
  assert.equal(await text(app.page, 'lastLabel'), 'Last close · Sun, Sep 27');
  assert.equal(await text(app.page, 'lastTickets'), '214');
  assert.equal(await text(app.page, 'liveSlots'), '3');
  assert.equal(await text(app.page, 'backValue'), '$1,651');      // on the Back stock tile
  assert.equal(await text(app.page, 'liveValue'), '$600');        // 3 packs × 10 left × $20, on the Slots tile
  assert.equal(await text(app.page, 'monthDollars'), '$1,284');   // this month so far, on the Months tile
  assert.ok(await app.page.$eval('#statusCard', (el) => !el.textContent.includes('Back stock')), 'back stock is not in the top card');
  assert.deepEqual((await tabs(app.page)).map((t) => t[0]), ['Home', 'Scan', 'Stock', 'Reports', 'More']);
  assert.deepEqual((await tabs(app.page))[1], ['Scan', 'close.html', false]);
  assert.ok((await tabs(app.page))[0][2]);
  assert.ok(await app.page.$eval('.user-pill', (el) => el.textContent.includes('ishaheen') && el.textContent.includes('IS')));
  const ownerText = await visibleText(app.page);
  for (const label of ['Close Day', 'Slots', 'Back stock & shipments', 'Months & totals', 'Scanner test', 'Manage employees']) {
    assert.ok(ownerText.includes(label), label);
  }
  if (shots) await app.page.screenshot({ path: `${shots}/home-owner.png`, fullPage: true });
  await app.close();

  // Very large numbers show whole (smaller text, never cut off).
  backStock = [{ gameNumber: '1747', valueInBack: 98765432 }];
  app = await openApp({ role: 'owner', handle: backend({ slotList: [live(1, 99999999)],
    months: { '2026-09': [{ date: '2026-09-27', ticketsSold: 1234567, dollarsSold: 87654321 }] } }) });
  await home(app);
  const fits = await app.page.$$eval('.fit', (els) => els.filter((el) => el.offsetParent)
    .map((el) => [el.id, el.textContent, el.scrollWidth <= el.clientWidth, parseFloat(getComputedStyle(el).fontSize)]));
  console.log('large numbers:', JSON.stringify(fits));
  for (const [id, value, fit] of fits) assert.ok(fit, `${id} ${value} is cut off`);
  const tooWide = await app.page.evaluate(() => [...document.querySelectorAll('.tile-card, .stat, .status-card')]
    .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth).length);
  assert.equal(tooWide, 0, 'nothing sticks out past the screen');
  assert.equal(await text(app.page, 'backValue'), '$98,765,432');
  if (shots) await app.page.screenshot({ path: `${shots}/home-owner-large.png`, fullPage: true });
  await app.close();
  backStock = [{ gameNumber: '1747', valueInBack: 1200 }, { gameNumber: '1800', valueInBack: 450.5 }];

  // Owner, closed today: today's totals and a green chip.
  app = await openApp({ role: 'owner', handle: backend({ closed: { date: '2026-09-28', ticketsSold: 300, dollarsSold: 2500, liveSlots: 3 } }) });
  await home(app);
  assert.equal(await text(app.page, 'closedChip'), 'Closed');
  assert.equal(await text(app.page, 'lastDollars'), '$2,500');
  assert.equal(await text(app.page, 'lastLabel'), "Today's close");
  assert.equal(await text(app.page, 'lastTickets'), '300');
  await app.close();

  // Owner, new month with no close yet: last month's last close.
  app = await openApp({ role: 'owner', handle: backend({ current: '2026-10', months: {
    '2026-10': [], '2026-09': [{ date: '2026-09-29', ticketsSold: 1, dollarsSold: 5 }, { date: '2026-09-30', ticketsSold: 90, dollarsSold: 700 }] } }) });
  await home(app);
  assert.equal(await text(app.page, 'lastDollars'), '$700');
  assert.equal(await text(app.page, 'lastLabel'), 'Last close · Wed, Sep 30');
  await app.close();

  // Owner, no close anywhere yet.
  app = await openApp({ role: 'owner', handle: backend({ months: { '2026-09': [] } }) });
  await home(app);
  assert.equal(await text(app.page, 'lastLabel'), 'No close yet');
  await app.close();

  // Employee: Scan tickets opens Close Day; tabs Home · Slots · More (no Slots card); no dollars, no owner links.
  const calls = [];
  const employee = backend();
  app = await openApp({ role: 'employee', username: 'employee', handle: (body) => { calls.push(body.action); return employee(body); } });
  await home(app);
  assert.equal(await text(app.page, 'closedChip'), 'Not closed');
  assert.equal(await text(app.page, 'employeeTitle'), 'Ready to scan');
  assert.deepEqual(await tabs(app.page), [['Home', 'index.html', true], ['Slots', 'slots.html', false], ['More', 'more.html', false]]);
  assert.equal(await app.page.$$eval('.employee-only .tile-card', (els) => els.length), 0, 'no Slots card on home');
  const empText = await visibleText(app.page);
  assert.ok(!empText.includes('$'), 'no dollars for employees');
  for (const label of ['Back stock', 'Months', 'Manage employees', 'Tickets sold']) assert.ok(!empText.includes(label), label);
  assert.ok(empText.includes('Scan tickets'));
  const hero = await app.page.$eval('.employee-only .action-hero', (a) => a.getAttribute('href'));
  assert.equal(hero, 'close.html');
  assert.deepEqual(calls.filter((c) => c !== 'closeStatus'), [], 'employee home asks only closeStatus');
  if (shots) await app.page.screenshot({ path: `${shots}/home-employee.png`, fullPage: true });

  // More page: no Manage employees for employees; Sign out there.
  await app.page.goto(app.base + 'more.html'); await sleep(200);
  const moreText = await visibleText(app.page);
  assert.ok(!moreText.includes('Manage employees') && moreText.includes('Sign out') && moreText.includes('Change my password'));
  await app.close();

  // Employee, closed: who submitted it.
  app = await openApp({ role: 'employee', handle: backend({ closed: { date: '2026-09-28', ticketsSold: 300, liveSlots: 3, closedAt: '10:52 PM', closedBy: 'e' } }) });
  await home(app);
  assert.equal(await text(app.page, 'closedChip'), 'Closed');
  assert.equal(await text(app.page, 'employeeTitle'), 'Day closed');
  assert.equal(await text(app.page, 'employeeNote'), 'Submitted at 10:52 PM by e');
  await app.close();

  console.log('HOME CHECKS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
