// Launch screen (owner 2026-10-26): once per app open, on Home (signed in) and Sign In. SMART types across and SCAN
// down sharing the S, the corner barcode stretches out, then the beam sweeps; Home keeps it up until its numbers arrive
// (never past 8 s); Sign In closes it once the animation has played. Not shown again in the same session, nor on Home
// with no sign-in. Reduced motion: everything at once, short.
// Run: node test/browser/splash.js   (SHOTS=dir saves a screenshot of each stage)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
const up = (page) => page.evaluate(() => Boolean(document.querySelector('.splash')));
const typed = (page) => page.evaluate(() => [...document.querySelectorAll('.splash-letter.on')].map((l) => l.textContent).join(''));
const state = (page) => page.evaluate(() => {
  const code = document.querySelector('.splash-code');
  return code ? { stretched: code.classList.contains('stretched'), scanning: code.classList.contains('scanning') } : null;
});
const freshOpen = async (page, url) => {
  await page.evaluate(() => sessionStorage.removeItem('smartScanSplash'));
  await page.goto(url);
};

(async () => {
  // ---- Home (owner): plays through, then waits for ownerHome ----
  let answerAt = 3200;
  let app = await openApp({ role: 'owner', splash: true, handle: async (b) => {
    if (b.action === 'ownerHome') { await sleep(answerAt); throw { code: 'network', message: 'offline' }; }
    return {};
  } });
  let { page, base } = app;
  const t0 = Date.now();
  await freshOpen(page, base + 'index.html');
  assert.equal(await up(page), true, 'shown on opening Home');
  await sleep(380 - (Date.now() - t0)); await shot(page, 'splash-1-typing');
  const early = await typed(page);
  assert.ok(early.startsWith('S') && early.length < 8, `typing: ${early}`);
  await sleep(1100 - (Date.now() - t0));
  assert.equal(await typed(page), 'SMARTCAN', 'all letters typed (the S once)');
  assert.deepEqual(await state(page), { stretched: true, scanning: false });
  await shot(page, 'splash-2-stretch');
  await sleep(1900 - (Date.now() - t0));
  assert.deepEqual(await state(page), { stretched: true, scanning: true }, 'beam sweeping');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.splash-beam')).opacity), '1');
  await shot(page, 'splash-3-beam');
  // The animation is done but Home's numbers aren't: still up.
  await sleep(2900 - (Date.now() - t0));
  assert.equal(await up(page), true, 'waits for Home\'s numbers');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'fits a phone');
  // Then it closes soon after they arrive.
  await page.waitForFunction(() => !document.querySelector('.splash'), { timeout: 3000 });
  assert.ok(Date.now() - t0 > answerAt, 'closed after the answer');
  assert.ok(Date.now() - t0 < answerAt + 1600, 'closed soon after the answer');

  // Same session: another page and Home again show nothing.
  await page.goto(base + 'more.html');
  assert.equal(await up(page), false, 'not on other pages');
  await page.goto(base + 'index.html');
  assert.equal(await up(page), false, 'once per app open');

  // A server that never answers: gone by 8 s anyway.
  answerAt = 60000;
  const t1 = Date.now();
  await freshOpen(page, base + 'index.html');
  await page.waitForFunction(() => !document.querySelector('.splash'), { timeout: 10000 });
  assert.ok(Date.now() - t1 < 9000 && Date.now() - t1 > 7500, `closed at the 8 s limit (${Date.now() - t1} ms)`);
  await app.close();

  // ---- Small phone (320 wide): the logo fits ----
  app = await openApp({ role: 'owner', splash: true, handle: async () => { await sleep(5000); return {}; } });
  ({ page, base } = app);
  await page.setViewport({ width: 320, height: 640 });
  await freshOpen(page, base + 'index.html');
  await sleep(2000);
  const box = await page.$eval('.splash-logo', (el) => { const r = el.getBoundingClientRect(); return [r.left, r.right]; });
  assert.ok(box[0] >= 16 && box[1] <= 304, `logo inside the gutters: ${box}`);
  await shot(page, 'splash-4-small');
  await app.close();

  // ---- Not signed in: Home skips it, Sign In shows it and closes after the animation ----
  app = await openApp({ role: 'owner', splash: true, signedIn: false, handle: () => ({}) });
  ({ page, base } = app);
  await page.evaluate(() => localStorage.clear());
  const t2 = Date.now();
  await freshOpen(page, base + 'index.html');
  await page.waitForFunction(() => location.pathname.endsWith('login.html'));
  assert.equal(await up(page), true, 'Sign In shows it');
  await page.waitForFunction(() => !document.querySelector('.splash'), { timeout: 5000 });
  assert.ok(Date.now() - t2 > 2000 && Date.now() - t2 < 3800, `Sign In: closes after the animation (${Date.now() - t2} ms)`);

  // Reduced motion: all at once, short.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const t3 = Date.now();
  await freshOpen(page, base + 'login.html');
  assert.equal(await typed(page), 'SMARTCAN');
  await page.waitForFunction(() => !document.querySelector('.splash'), { timeout: 3000 });
  assert.ok(Date.now() - t3 < 1600, `reduced motion: short (${Date.now() - t3} ms)`);
  await app.close();

  console.log('splash: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
