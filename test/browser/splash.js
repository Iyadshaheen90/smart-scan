// Launch screen (owner 2026-10-26): once per app open, on Home (signed in) and Sign In. SMART comes in across and SCAN
// down sharing the S, a letter at a time behind a cursor, then the corner barcode opens and the beam sweeps; Home keeps
// it up until its numbers arrive (never past 8 s); Sign In closes it once the animation has played. Not shown again in the same session, nor on Home
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
  // The page logs each stage as it happens (letters typed, stretch, beam), so the order is checked however slow the
  // test machine is.
  await page.evaluateOnNewDocument(() => {
    window.splashLog = [];
    new MutationObserver((changes) => changes.forEach((c) => {
      const el = c.target;
      if (el.classList.contains('splash-letter') && el.classList.contains('on') && !el.dataset.logged) {
        el.dataset.logged = '1';
        window.splashLog.push(el.textContent);
      }
      for (const stage of ['stretched', 'scanning']) {
        if (el.classList.contains(stage) && !window.splashLog.includes(stage)) window.splashLog.push(stage);
      }
    })).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const t0 = Date.now();
  await freshOpen(page, base + 'index.html');
  assert.equal(await up(page), true, 'shown on opening Home');
  await sleep(Math.max(0, 380 - (Date.now() - t0))); await shot(page, 'splash-1-letters');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.splash-cursor'))), true, 'cursor while the letters come in');
  // Each stage is waited for (a busy test machine runs late), then checked in order.
  await page.waitForFunction(() => document.querySelector('.splash-code.stretched'), { timeout: 3000 });
  assert.equal(await typed(page), 'SMARTCAN', 'all letters in before the barcode opens (the S once)');
  await shot(page, 'splash-2-stretch');
  await page.waitForFunction(() => document.querySelector('.splash-code.scanning'), { timeout: 3000 });
  assert.deepEqual(await state(page), { stretched: true, scanning: true }, 'beam sweeping');
  // S M A R T, then C A N, then the barcode opens and the beam starts at the same moment; the cursor is gone by then.
  assert.deepEqual(await page.evaluate(() => window.splashLog),
    ['S', 'M', 'A', 'R', 'T', 'C', 'A', 'N', 'stretched', 'scanning']);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.splash-cursor'))), false, 'cursor gone after the N');
  await sleep(100);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.splash-beam')).opacity), '1');
  await shot(page, 'splash-3-beam');
  // The animation is done but Home's numbers aren't: still up.
  await sleep(Math.max(0, 2900 - (Date.now() - t0)));
  if (Date.now() - t0 < answerAt - 100) assert.equal(await up(page), true, 'waits for Home\'s numbers');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'fits a phone');
  // Then it closes once they arrive, well before the 8 s limit. (Limits are loose: a busy test machine runs late.)
  await page.waitForFunction(() => !document.querySelector('.splash'), { timeout: 5000 });
  assert.ok(Date.now() - t0 > answerAt, 'closed after the answer');
  assert.ok(Date.now() - t0 < 7000, `closed on the answer, not at the limit (${Date.now() - t0} ms)`);

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
  assert.ok(Date.now() - t1 < 11000 && Date.now() - t1 > 7500, `closed at the 8 s limit (${Date.now() - t1} ms)`);

  // Signed in and the app opens on Sign In (owner 2026-10-26: Sign In flashed up): straight on to Home before Sign In
  // draws anything, and Home plays the launch screen.
  answerAt = 3000;
  await page.evaluateOnNewDocument(() => {
    if (location.pathname.endsWith('login.html')) {
      window.addEventListener('DOMContentLoaded', () => { sessionStorage.setItem('drewSignIn', '1'); });
    }
  });
  await freshOpen(page, base + 'login.html');
  await page.waitForFunction(() => location.pathname.endsWith('index.html'));
  assert.equal(await up(page), true, 'Home plays the launch screen after Sign In passes it on');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('drewSignIn')), null, 'Sign In never drew');
  await app.close();

  // Safari keeps building and drawing Sign In until Home arrives (Chrome stops at once), which still flashed Sign In and
  // used up the launch screen there (owner 2026-10-26). Holding the switch back here plays that out: nothing of Sign In
  // shows, its launch screen doesn't start, and Home still gets its turn.
  app = await openApp({ role: 'owner', splash: true, handle: async () => ({}) });
  ({ page, base } = app);
  await page.evaluateOnNewDocument(() => {
    if (location.pathname.endsWith('login.html')) {
      navigation.addEventListener('navigate', (e) => { window.heldBack = e.destination.url; e.preventDefault(); });
    }
  });
  await freshOpen(page, base + 'login.html');
  await sleep(300);
  assert.deepEqual(await page.evaluate(() => ({ heldBack: window.heldBack.replace(location.origin, ''),
    signInShows: getComputedStyle(document.body).display !== 'none', splash: Boolean(document.querySelector('.splash')),
    turnUsed: sessionStorage.getItem('smartScanSplash') })),
  { heldBack: '/index.html', signInShows: false, splash: false, turnUsed: null });
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
  await page.waitForFunction(() => !document.querySelector('.splash'), { timeout: 7000 });
  assert.ok(Date.now() - t2 > 2000 && Date.now() - t2 < 6000, `Sign In: closes after the animation, no waiting (${Date.now() - t2} ms)`);

  // Opening Home signed out, or after the 12 hours (owner 2026-10-26: Home's empty page flashed before Sign In's launch
  // screen). Holding the switch back plays out Safari's way: nothing of Home shows, and Sign In gets the launch screen.
  for (const saved of [null, { token: 't', username: 'o', role: 'owner', expiresAt: '2020-01-01' }]) {
    const held = await page.browser().newPage();
    await held.setViewport({ width: 390, height: 900 });
    await held.evaluateOnNewDocument(() => {
      if (location.pathname.endsWith('index.html')) {
        navigation.addEventListener('navigate', (e) => { window.heldBack = e.destination.url; e.preventDefault(); });
      }
    });
    await held.goto(base + 'more.html');
    await held.evaluate((s) => {
      sessionStorage.clear();
      if (s) localStorage.setItem('smartScanSession', JSON.stringify(s)); else localStorage.removeItem('smartScanSession');
    }, saved);
    await held.goto(base + 'index.html');
    await sleep(300);
    assert.deepEqual(await held.evaluate(() => ({ heldBack: (window.heldBack || '').replace(location.origin, ''),
      homeShows: getComputedStyle(document.body).display !== 'none', turnUsed: sessionStorage.getItem('smartScanSplash') })),
    { heldBack: '/login.html', homeShows: false, turnUsed: null }, saved ? 'after the 12 hours' : 'signed out');
    await held.close();
  }
  // And for real: Sign In plays it.
  await page.evaluate(() => localStorage.setItem('smartScanSession', JSON.stringify({ token: 't', username: 'o', role: 'owner', expiresAt: '2020-01-01' })));
  await freshOpen(page, base + 'index.html');
  await page.waitForFunction(() => location.pathname.endsWith('login.html'));
  assert.equal(await up(page), true, 'after the 12 hours: Sign In shows it');
  await page.waitForFunction(() => !document.querySelector('.splash'), { timeout: 7000 });
  await page.evaluate(() => localStorage.clear());

  // Reduced motion: all at once, short.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const t3 = Date.now();
  await freshOpen(page, base + 'login.html');
  assert.equal(await typed(page), 'SMARTCAN');
  await page.waitForFunction(() => !document.querySelector('.splash'), { timeout: 4000 });
  assert.ok(Date.now() - t3 < 2000, `reduced motion: short (${Date.now() - t3} ms)`);
  await app.close();

  console.log('splash: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
