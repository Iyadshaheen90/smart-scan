// Home page (new design, 2026-09-28): the owner's last-close totals, live slots and back stock $,
// the Not closed / Closed chip, and the tab bar for each role. Employees see no dollar amounts.
// Run: node test/browser/home.js   (SHOTS=dir also saves screenshots)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const live = (slot, remaining = 10, daysActive = 3) => ({ box: 1, slot, slotPrice: 20,
  pack: { gameNumber: '1747', packNumber: String(1000000 + slot), price: 20, remaining, daysActive } });
const slots = [live(1), live(2, 10, 50), live(3, 10, 70), { box: 1, slot: 4, slotPrice: 10, pack: null }];
let backStock = [{ gameNumber: '1747', valueInBack: 1200 }, { gameNumber: '1800', valueInBack: 450.5 }];

// closed: today's summary or null. months: { label: days[] }.
function backend({ closed = null, slotList = slots, months = { '2026-09': [{ date: '2026-09-27', ticketsSold: 214, dollarsSold: 1284 }] }, current = '2026-09', canStart = false, today = '2026-09-28' } = {}) {
  return (body) => {
    switch (body.action) {
      // What ownerHome in Home.js returns, built from the same pieces.
      case 'ownerHome': {
        const next = `${current.slice(0, 5)}${String(Number(current.slice(5)) + 1).padStart(2, '0')}`;
        const days = months[current] || [];
        const earlier = Object.keys(months).sort().reverse().find((l) => l < current);
        const before = earlier ? months[earlier] : [];
        return { today, closed, slots: slotList, month: { current, next, canStart },
          monthDollars: days.reduce((sum, d) => sum + d.dollarsSold, 0),
          lastClose: days.length ? days[days.length - 1] : before.length ? before[before.length - 1] : null,
          backValue: backStock.reduce((sum, g) => sum + g.valueInBack, 0) };
      }
      case 'startNewMonth': {
        const previous = current;
        current = body.label; canStart = false; months[current] = [];
        return { label: current, previous, moved: { DailyCloseLog: 0 } };
      }
      case 'closeStatus': return { today, closed, slots: slotList };
      case 'listBackStock': return backStock;
      case 'monthStatus': return { current, next: `${current.slice(0, 5)}${String(Number(current.slice(5)) + 1).padStart(2, '0')}`, canStart };
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
  const ownerCalls = [];
  const ownerBackend = backend();
  let app = await openApp({ role: 'owner', username: 'ishaheen', handle: (body) => { ownerCalls.push(body.action); return ownerBackend(body); } });
  await home(app);
  assert.deepEqual(ownerCalls, ['ownerHome'], 'owner home is one request');
  assert.equal(await text(app.page, 'closedChip'), 'Not closed');
  assert.equal(await text(app.page, 'todayLabel'), 'Today · Mon, Sep 28');
  assert.equal(await text(app.page, 'lastDollars'), '$1,284');
  assert.equal(await text(app.page, 'lastLabel'), 'Last close · Sun, Sep 27');
  assert.equal(await text(app.page, 'lastTickets'), '214');
  assert.equal(await text(app.page, 'liveSlots'), '3');
  assert.equal(await text(app.page, 'backValue'), '$1,651');      // on the Back stock tile
  assert.equal(await text(app.page, 'liveValue'), '$600');        // 3 packs × 10 left × $20, on the Slots tile
  assert.equal(await text(app.page, 'monthDollars'), '$1,284');   // this month so far, on the Months tile
  assert.equal(await text(app.page, 'settlingCount'), '2 packs');   // live 50+ days, on the Settling tile
  assert.ok(await app.page.$eval('#settlingCount', (e) => e.classList.contains('amber')));
  assert.equal(await app.page.$$eval('.owner-only a[href="raw-scanner.html"]', (els) => els.length), 0, 'Scanner test is in More only');
  assert.ok(await app.page.$eval('#statusCard', (el) => !el.textContent.includes('Back stock')), 'back stock is not in the top card');
  assert.deepEqual((await tabs(app.page)).map((t) => t[0]), ['Home', 'Scan', 'Stock', 'Reports', 'More']);
  assert.deepEqual((await tabs(app.page))[1], ['Scan', 'close.html', false]);
  assert.ok((await tabs(app.page))[0][2]);
  assert.ok(await app.page.$eval('.user-pill', (el) => el.textContent.includes('ishaheen') && el.textContent.includes('IS')));
  const ownerText = await visibleText(app.page);
  for (const label of ['Close Day', 'Slots', 'Back stock & shipments', 'Months & totals', 'Settling', 'Manage employees']) {
    assert.ok(ownerText.includes(label), label);
  }
  assert.ok(await app.page.$eval('#startMonthBtn', (el) => el.classList.contains('hidden')), 'no Start month before the 1st');
  if (shots) await app.page.screenshot({ path: `${shots}/home-owner.png`, fullPage: true });
  assert.ok(await app.page.$eval('#statusCard', (el) => !el.classList.contains('stale')), 'fresh numbers are not dimmed');

  // Opened again: the saved numbers show at once, dimmed, before the (slow) answer arrives.
  let release;
  const slowAnswer = new Promise((r) => { release = r; });
  const slowBackend = backend({ months: { '2026-09': [{ date: '2026-09-27', ticketsSold: 214, dollarsSold: 1284 }, { date: '2026-09-28', ticketsSold: 10, dollarsSold: 99 }] } });
  app.setHandle(async (body) => { await slowAnswer; return slowBackend(body); });
  await app.page.goto(app.base + 'index.html'); await sleep(300);
  assert.equal(await text(app.page, 'lastDollars'), '$1,284', 'saved number shown before the answer');
  assert.equal(await text(app.page, 'backValue'), '$1,651');
  assert.ok(await app.page.$eval('#statusCard', (el) => el.classList.contains('stale')));
  release();
  await app.page.waitForFunction(() => !document.getElementById('statusCard').classList.contains('stale'));
  assert.equal(await text(app.page, 'lastDollars'), '$99', 'then the fresh number');
  assert.equal(await text(app.page, 'monthDollars'), '$1,383');
  await app.close();

  // A copy saved on an earlier day: that day's close shows as the last close, and today is Not closed.
  app = await openApp({ role: 'owner', username: 'ishaheen', handle: () => new Promise(() => {}) });   // never answers
  await app.page.evaluate(() => localStorage.setItem('smartScanOwnerHome:ishaheen', JSON.stringify({
    today: '2020-01-01', closed: { date: '2020-01-01', ticketsSold: 5, dollarsSold: 50, liveSlots: 1 }, lastClose: null, slots: [],
    month: { current: '2020-01', next: '2020-02', canStart: true }, monthDollars: 50, backValue: 7 })));
  await app.page.goto(app.base + 'index.html'); await sleep(300);
  assert.equal(await text(app.page, 'closedChip'), 'Not closed');
  assert.equal(await text(app.page, 'lastDollars'), '$50');
  assert.equal(await text(app.page, 'lastLabel'), 'Last close · Wed, Jan 1');
  assert.ok(await app.page.$eval('#startMonthBtn', (el) => el.classList.contains('hidden')), 'a saved copy never shows Start month');
  await app.close();

  // From the 1st: Start October 2026 between the top card and Close Day; gone once started.
  const monthCalls = [];
  const rollover = backend({ canStart: true });
  let answer = false; let dialog = null;
  app = await openApp({ role: 'owner', handle: (body) => { monthCalls.push(body); return rollover(body); },
    onDialog: (d) => { dialog = d.message(); return answer ? d.accept() : d.dismiss(); } });
  await home(app);
  await app.page.waitForFunction(() => !document.getElementById('startMonthBtn').classList.contains('hidden'));
  assert.equal(await text(app.page, 'startMonthBtn'), 'Start October 2026');
  const order = await app.page.evaluate(() => {
    const top = (sel) => document.querySelector(sel).getBoundingClientRect().top;
    return [top('#statusCard'), top('#startMonthBtn'), top('.owner-only a.action-main[href="close.html"]')];
  });
  assert.ok(order[0] < order[1] && order[1] < order[2], 'top card, then Start month, then Close Day');
  if (shots) await app.page.screenshot({ path: `${shots}/home-owner-start-month.png`, fullPage: true });
  await app.page.click('#startMonthBtn'); await sleep(200);
  assert.ok(dialog.startsWith('Start October 2026? September 2026 will be archived'));
  assert.ok(!monthCalls.some((b) => b.action === 'startNewMonth'), 'Cancel starts nothing');
  answer = true;
  await app.page.click('#startMonthBtn');
  await app.page.waitForFunction(() => document.getElementById('startMonthBtn').classList.contains('hidden'));
  assert.equal(monthCalls.find((b) => b.action === 'startNewMonth').label, '2026-10');
  assert.equal(await text(app.page, 'monthMessage'), 'October 2026 started.');
  await sleep(300);
  assert.equal(await text(app.page, 'monthDollars'), '$0', 'Months tile shows October');
  assert.equal(await text(app.page, 'lastLabel'), 'Last close · Sun, Sep 27');
  await app.page.reload(); await sleep(500);
  assert.ok(await app.page.$eval('#startMonthBtn', (el) => el.classList.contains('hidden')), 'stays gone until November 1');
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
  assert.ok(await app.page.$eval('#startMonthBtn', (el) => !el.offsetParent), 'no Start month for employees');
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
