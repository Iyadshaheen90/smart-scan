// Close Day: the camera and the Press and hold button stay in the same place from one scan to the next
// (owner's request 2026-09-29), for the owner and employees, and the progress bar, the slot card with Sold out / Skip, the
// camera and the button all fit on an iPhone screen above the tab bar at once (the scan message sits on the camera): first scan, a long "belongs to" note, a big
// sale, a refused scan, Skip, Sold out, and every slot done. Also the buzz: two for a scan that wasn't saved,
// and on an iPhone (no navigator.vibrate) a hidden switch is clicked instead.
// Run: node test/browser/close-layout.js   (SHOTS=dir also saves screenshots)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const pack = (g, p, t, price = 5) => ({ gameNumber: g, packNumber: p, exposedTicket: t, remaining: t + 1, price });
const slots = [
  { box: 1, slot: 1, pack: pack('1747', '1263622', 40) },
  { box: 1, slot: 2, pack: pack('1718', '1279742', 20) },
  { box: 2, slot: 24, pack: pack('1801', '0000123', 149, 30) },
  { box: 2, slot: 3, pack: pack('1650', '0555555', 59, 10) },
];
const handle = (b) => (b.action === 'closeStatus' ? { today: '2026-09-29', largeSaleTickets: 50, closed: null, slots } : {});

(async () => {
  for (const role of ['owner', 'employee']) {
    const app = await openApp({ role, handle });
    const { page, base } = app;
    await page.setViewport({ width: 390, height: 844 });   // iPhone 12–16
    await page.evaluateOnNewDocument(() => {
      window.buzzes = [];
      navigator.vibrate = (p) => { window.buzzes.push(p); return true; };
    });
    await page.goto(base + 'close.html');
    await page.waitForSelector('#closeView:not(.hidden)'); await sleep(300);
    const where = () => page.evaluate(() => {
      const r = (id) => Math.round(document.getElementById(id).getBoundingClientRect().top + window.scrollY);
      return { hold: r('holdBtn'), camera: r('viewport') };
    });
    const typed = async (t) => { await page.type('#typed', t); await page.click('#typedForm button'); await sleep(100); };
    const start = await where();
    const steps = [];
    const check = async (label) => {
      const now = await where();
      steps.push([label, now.hold]);
      assert.deepEqual(now, start, `${role}: moved after ${label}`);
      // Scrolled to the top: progress bar to scan button all on screen, above the tab bar.
      const inView = await page.evaluate(() => {
        window.scrollTo(0, 0);
        const r = (el) => el.getBoundingClientRect();
        const bar = r(document.querySelector('nav.tabbar')).top;
        return r(document.getElementById('progressText')).top >= 0 && r(document.getElementById('skipBtn')).bottom <= bar
          && r(document.getElementById('holdBtn')).bottom <= bar;
      });
      assert.ok(inView, `${role}: progress, slot card and scan button not all in view after ${label}`);
      const flash = await page.$eval('#flash', (e) => [e.scrollHeight <= e.clientHeight, e.getBoundingClientRect().bottom,
        document.querySelector('#viewport .scan-guide').getBoundingClientRect().top]);
      assert.ok(flash[0], `${role}: message cut off after ${label}`);
      assert.ok(flash[1] <= flash[2], `${role}: message covers the guide box after ${label}`);
      assert.ok(await page.$eval('#curDone', (e) => e.scrollWidth <= e.clientWidth), `${role}: slot card line cut off after ${label}`);
    };

    await typed('1718-1279742-6-018'); await check('a scan of another slot (long note)');
    await typed('1801-0000123-6-010'); await check('a big sale (warning)');
    await typed('9999-0000001-6-010'); await check('a pack in no slot (error)');
    await typed('1747-1263622-4-099'); await check('a ticket above the top one (longest error)');
    await page.click('#skipBtn'); await sleep(100); await check('Skip');
    await typed('1747-1263622-4-035'); await check('a normal scan');
    await typed('1747-1263622-4-030'); await check('scanning a done slot again');
    await page.$$eval('.review-row', (rows) => rows.find((r) => r.textContent.includes('B2 · S3 ·')).click()); await sleep(100);
    await page.click('#soldOutBtn'); await sleep(200); await check('Sold out, all slots done');
    assert.equal(await page.$eval('#curWhere', (e) => e.textContent), 'All slots done');
    assert.ok(await page.$eval('#soldOutBtn', (b) => b.disabled));
    // The longest message fits its box (smaller text), nothing cut off.
    await typed('1747-1263622-4-099');
    assert.ok(await page.$eval('#flash', (e) => e.scrollHeight <= e.clientHeight), 'long message fits');
    await check('longest error again');
    console.log(role, JSON.stringify(steps.map((s) => s[1])));
    if (process.env.SHOTS) { await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100); await page.screenshot({ path: `${process.env.SHOTS}/close-${role}.png` }); }

    // Two scans that weren't saved buzzed twice each.
    const buzzes = await page.evaluate(() => window.buzzes);
    assert.deepEqual(buzzes.filter((b) => Array.isArray(b)).length, 3, 'error buzzes');
    await app.close();
  }

  // iPhone: no navigator.vibrate, so haptic() clicks a hidden iOS switch (one for a scan, two for an error).
  const app = await openApp({ role: 'owner', handle });
  await app.page.evaluateOnNewDocument(() => {
    delete Navigator.prototype.vibrate;
    window.switchClicks = 0;
    const click = HTMLLabelElement.prototype.click;
    HTMLLabelElement.prototype.click = function () {
      if (this.querySelector('input[switch]')) window.switchClicks++;
      return click.call(this);
    };
  });
  await app.page.goto(app.base + 'close.html');
  await app.page.waitForSelector('#closeView:not(.hidden)');
  const clicks = await app.page.evaluate(async () => {
    const { haptic } = await import('./scanner.js');
    haptic();
    haptic('error');
    await new Promise((r) => setTimeout(r, 300));
    return { clicks: window.switchClicks, left: document.querySelectorAll('input[switch]').length };
  });
  assert.deepEqual(clicks, { clicks: 3, left: 0 }, 'iPhone taps, nothing left behind');
  // During Press and hold the tap waits for the finger to lift (iOS only allows it as part of a touch).
  const box = await app.page.$eval('#holdBtn', (b) => { b.scrollIntoView(); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await app.page.evaluate(() => { window.switchClicks = 0; });
  await app.page.mouse.move(box.x, box.y);
  await app.page.mouse.down();
  const whileHeld = await app.page.evaluate(async () => {
    const { haptic } = await import('./scanner.js');
    haptic(); haptic('error');
    return window.switchClicks;
  });
  await app.page.mouse.up(); await sleep(300);
  assert.equal(whileHeld, 0, 'no tap while the finger is down');
  assert.equal(await app.page.evaluate(() => window.switchClicks), 2, 'two taps (scan not saved) when it lifts');
  await app.page.mouse.down(); await app.page.mouse.up(); await sleep(300);
  assert.equal(await app.page.evaluate(() => window.switchClicks), 2, 'nothing left over for the next press');
  await app.close();
  console.log('CLOSE LAYOUT CHECKS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
