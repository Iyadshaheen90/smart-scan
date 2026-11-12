// Press and Hold | Auto Scan (owner 2026-11-11): the switch under the camera on the slot page (putting a pack in) and
// on Back Stock's Scan view, like Close Day's. Press and Hold is the default; Auto Scan hides the hold button; each
// phone remembers the choice. Putting packs in (slot page, Activate Several) shares one choice; Back Stock and Close
// Day keep their own.
// Run: node test/browser/auto-scan.js
const assert = require('assert/strict');
const { openApp, showScan } = require('./harness');

const empty = { box: 1, slot: 3, slotPrice: 5, endedToday: null, lastGame: null, pack: null };
const stock = [{ gameNumber: '1747', price: 20, ticketsPerPack: 30, standardPackSize: 30, packsInBack: 2, ticketsInBack: 60,
  valueInBack: 1200, liveSlots: 0, liveIn: [], endedDate: null }];

(async () => {
  const app = await openApp({ role: 'owner', handle: (b) => (b.action === 'listSlots' ? [empty] : b.action === 'listBackStock' ? stock : {}) });
  const { page, base } = app;
  const active = () => page.$eval('#scanModeSwitch .active', (b) => b.textContent);
  const holdShown = () => page.$eval('#holdBtn', (b) => !b.classList.contains('hidden'));
  const cameraOn = () => page.waitForFunction(() => Boolean(document.getElementById('video').srcObject), { timeout: 10000 });
  const saved = (key) => page.evaluate((k) => localStorage.getItem(k), key);

  // Slot page, empty slot: the scan step with the switch, Press and Hold first.
  await page.goto(base + 'activate.html?box=1&slot=3');
  await page.waitForFunction(() => !document.getElementById('scanStep').classList.contains('hidden'));
  // Tapped while the camera is still opening: the hold button goes at once.
  await page.click('#scanModeSwitch button[data-mode="auto"]'); assert.equal(await holdShown(), false);
  await page.click('#scanModeSwitch button[data-mode="hold"]'); assert.equal(await holdShown(), true);
  await page.waitForFunction(() => !document.getElementById('scanStep').classList.contains('hidden'));
  await cameraOn();
  assert.equal(await active(), 'Press and Hold'); assert.equal(await holdShown(), true);
  await page.click('#scanModeSwitch button[data-mode="auto"]');
  assert.equal(await active(), 'Auto Scan'); assert.equal(await holdShown(), false);
  assert.equal(await saved('smartScanActivateScanMode'), 'auto');

  // Remembered after a reload.
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('scanStep').classList.contains('hidden'));
  await cameraOn();
  assert.equal(await active(), 'Auto Scan'); assert.equal(await holdShown(), false);

  // Back Stock keeps its own choice (still Press and Hold).
  await page.goto(base + 'backstock.html');
  await page.waitForFunction(() => document.querySelectorAll('#stock .stock-row').length === 1);
  await showScan(page); await cameraOn();
  assert.equal(await active(), 'Press and Hold'); assert.equal(await holdShown(), true);
  await page.click('#scanModeSwitch button[data-mode="auto"]');
  assert.equal(await saved('smartScanBackStockScanMode'), 'auto');
  assert.equal(await saved('smartScanCloseMode'), null, 'Close Day untouched');

  // Back to Press and Hold on the slot page: the button comes back.
  await page.goto(base + 'activate.html?box=1&slot=3');
  await page.waitForFunction(() => !document.getElementById('scanStep').classList.contains('hidden'));
  await cameraOn();
  await page.click('#scanModeSwitch button[data-mode="hold"]');
  assert.equal(await holdShown(), true); assert.equal(await saved('smartScanActivateScanMode'), 'hold');
  console.log('AUTO SCAN SWITCH CHECKS PASS'); await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
