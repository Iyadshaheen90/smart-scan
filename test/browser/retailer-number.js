// Retailer number (owner 2026-10-26): More → Retailer Number (owner only) shows and changes it in a pop-up; the Theft
// Report prints it under the store name, in the shared text and in the PDF, for the owner and for an employee with
// Theft Report. Not entered yet: the owner's report says where to add it, an employee's leaves the line out.
// Real backend code (Store.js, Reports.js) on an in-memory sheet. Uses a made-up number.
// Run: node test/browser/retailer-number.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const { openApp, backendInVm, sleep } = require('./harness');

const { ctx, addRow, call } = backendInVm('2026-10-26');
addRow('SlotConfig', { box: 1, slot_number: 1, price_per_ticket: 20 });
addRow('SlotState', { box: 1, slot_number: 1, pack_key: '1747-0012345', game_number: '1747', pack_number: '0012345',
  price_per_ticket: 20, current_exposed_ticket_number: 24, activation_date: '2026-10-01', last_close_date: '2026-10-25' });
addRow('ReserveInventory', { game_number: '1747', price_per_ticket: 20, tickets_per_pack: 30, packs_in_reserve: 0, tickets_in_reserve: 0 });
addRow('DailySummary', { close_date: '2026-10-25', closed_by: 'o', closed_at: '2026-10-25 22:50' });

const calls = [];
const handler = (user) => (b) => {
  calls.push(b.action);
  if (b.action === 'theftReport') return call(() => ctx.theftReport(user, b));
  if (b.action === 'getRetailerNumber') return call(() => ctx.getRetailerNumber());
  if (b.action === 'setRetailerNumber') return call(() => ctx.setRetailerNumber(b.retailerNumber));
  if (b.action === 'closeStatus') return { today: '2026-10-26', closed: null, slots: [], permissions: user.permissions || [] };
  return {};
};
const text = (page, sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
const shown = (page, sel) => page.$eval(sel, (el) => !el.classList.contains('hidden') && el.offsetParent !== null);
// The pop-up is position: fixed (no offsetParent), so it's open while it isn't .hidden.
const open = (page) => page.$eval('#retailerDialog', (el) => !el.classList.contains('hidden'));
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
const makeReport = async (page, base) => {
  await page.goto(base + 'theft-report.html');
  await page.click('#makeBtn');
  await page.waitForFunction(() => !document.getElementById('report').classList.contains('hidden'));
};

(async () => {
  const owner = { username: 'o', role: 'owner' };
  const sara = { username: 'sara', role: 'employee', permissions: ['theft_report'] };

  // ---- Not entered yet ----
  let app = await openApp({ role: 'owner', handle: handler(owner) });
  let { page, base } = app;
  await makeReport(page, base);
  assert.equal(await text(page, '#retailer'), 'Retailer Number: Not Set (Add It on More)');
  await app.close();
  app = await openApp({ role: 'employee', username: 'sara', permissions: ['theft_report'], handle: handler(sara) });
  ({ page, base } = app);
  await makeReport(page, base);
  assert.equal(await shown(page, '#retailer'), false, "an employee's report leaves the line out");
  // Employees don't get the More row, even with every permission.
  await page.goto(base + 'more.html');
  assert.equal(await shown(page, '#retailerRow'), false);
  await app.close();

  // ---- More → Retailer Number (owner) ----
  app = await openApp({ role: 'owner', handle: handler(owner) });
  ({ page, base } = app);
  await page.goto(base + 'more.html');
  assert.equal(await shown(page, '#retailerRow'), true);
  assert.equal(await text(page, '#retailerRow .row-title'), 'Retailer Number');
  assert.equal(calls.includes('getRetailerNumber'), false, 'not asked for until the pop-up opens');
  await page.click('#retailerRow');
  await page.waitForFunction(() => !document.getElementById('retailerInput').disabled);
  assert.equal(await page.$eval('#retailerInput', (i) => [i.value, i.placeholder].join('|')), '|Not set yet');
  assert.equal(await page.$eval('#retailerInput', (i) => i.inputMode), 'numeric');
  await shot(page, 'retailer-dialog');
  // Refused: not digits. The pop-up stays open with the reason.
  await page.type('#retailerInput', '12ab');
  await page.click('#retailerSave');
  await page.waitForFunction(() => document.getElementById('retailerError').textContent);
  assert.equal(await text(page, '#retailerError'), 'Enter the retailer number: digits only, as on your lottery terminal.');
  assert.equal(await open(page), true);
  // Cancel saves nothing.
  await page.click('#retailerCancel');
  assert.equal(await open(page), false);
  assert.equal(call(() => ctx.getRetailerNumber()).retailerNumber, null);
  // Save (spaces and dashes dropped).
  await page.click('#retailerRow');
  await page.waitForFunction(() => !document.getElementById('retailerInput').disabled);
  assert.equal(await text(page, '#retailerError'), '', 'the old error is gone');
  await page.type('#retailerInput', '999-0001');
  await page.click('#retailerSave');
  await page.waitForFunction(() => document.getElementById('retailerResult').textContent);
  assert.equal(await text(page, '#retailerResult'), 'Retailer number saved. It shows on the Theft Report.');
  assert.equal(await open(page), false);
  assert.equal(call(() => ctx.getRetailerNumber()).retailerNumber, '9990001');
  // Opened again: shows the saved number.
  await page.click('#retailerRow');
  await page.waitForFunction(() => document.getElementById('retailerInput').value === '9990001');
  await page.click('#retailerCancel');

  // ---- On the owner's Theft Report: screen, shared text, PDF ----
  await makeReport(page, base);
  assert.equal(await text(page, '#retailer'), 'Retailer Number: 9990001');
  await shot(page, 'retailer-report');
  await page.evaluate(() => { navigator.share = async (d) => { window.shared = d; }; });
  await page.click('#shareBtn');
  await page.waitForFunction(() => window.shared);
  assert.deepEqual((await page.evaluate(() => window.shared.text)).split('\n').slice(0, 3),
    ['THEFT REPORT · LIVE SCRATCHERS', 'Route 66 Liquor', 'Retailer Number: 9990001']);
  await page.evaluate(() => {
    navigator.canShare = (d) => Boolean(d.files);
    navigator.share = async (d) => { window.sharedPdf = String.fromCharCode(...new Uint8Array(await d.files[0].arrayBuffer())); };
  });
  await page.click('#printBtn');
  await page.waitForFunction(() => window.sharedPdf || document.getElementById('shareMessage').textContent);
  assert.equal(await text(page, '#shareMessage'), '');
  assert.match(await page.evaluate(() => window.sharedPdf), /\(Retailer Number: 9990001\)/);
  await app.close();

  // ---- An employee with Theft Report gets the full number on their report ----
  app = await openApp({ role: 'employee', username: 'sara', permissions: ['theft_report'], handle: handler(sara) });
  ({ page, base } = app);
  await makeReport(page, base);
  assert.equal(await text(page, '#retailer'), 'Retailer Number: 9990001');
  await sleep(50);
  await app.close();
  console.log('retailer number: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
