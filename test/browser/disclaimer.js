// Third-party disclaimer (owner 2026-10-26, for the App Store and Google Play): Smart Scan is not a lottery app. Sign In
// shows the disclaimer in small print; More → About Smart Scan (everyone) shows it in a pop-up; no page says
// "CA Lottery" (the Theft Report footer is checked in theft-report.js).
// Run: node test/browser/disclaimer.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { openApp, sleep } = require('./harness');

const DISCLAIMER = 'Smart Scan is an independent bookkeeping tool for retailers. It is not affiliated with, endorsed by'
  + ' or approved by the California State Lottery or any other lottery. It does not sell tickets or offer any game.';
const text = (page, sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
const open = (page) => page.$eval('#aboutDialog', (el) => !el.classList.contains('hidden'));
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });

(async () => {
  // No page or script in src/ (not the backend's comments) names "CA Lottery".
  const src = path.join(__dirname, '../../src');
  for (const name of fs.readdirSync(src).filter((f) => /\.(html|js|css|webmanifest)$/.test(f))) {
    assert.ok(!fs.readFileSync(path.join(src, name), 'utf8').includes('CA Lottery'), `${name} says CA Lottery`);
  }

  // Sign In: the disclaimer under the form.
  let app = await openApp({ role: 'owner', signedIn: false, handle: () => ({}) });
  let { page, base } = app;
  await page.goto(base + 'login.html');
  assert.equal(await text(page, '#disclaimer'), DISCLAIMER);
  assert.ok(await noSideScroll(page), 'sign in fits a phone');
  await shot(page, 'disclaimer-login');
  await app.close();

  // More → About Smart Scan, for the owner and for an employee: opens the pop-up, Close shuts it.
  for (const role of ['owner', 'employee']) {
    app = await openApp({ role, handle: (b) => (b.action === 'closeStatus' ? { slots: [], permissions: [] } : {}) });
    ({ page, base } = app);
    await page.goto(base + 'more.html');
    assert.equal(await text(page, '#aboutRow .row-title'), 'About Smart Scan', role);
    assert.equal(await open(page), false);
    await page.click('#aboutRow'); await sleep(50);
    assert.equal(await open(page), true, `${role}: About opens`);
    assert.equal(await text(page, '#aboutTitle'), 'About Smart Scan');
    assert.equal(await text(page, '#aboutText'), DISCLAIMER);
    await shot(page, `disclaimer-about-${role}`);
    await page.click('#aboutClose'); await sleep(50);
    assert.equal(await open(page), false, `${role}: Close shuts it`);
    await app.close();
  }

  console.log('disclaimer: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
