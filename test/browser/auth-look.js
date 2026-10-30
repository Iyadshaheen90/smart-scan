// Sign In and Change My Password redesign (owner 2026-10-29): Sign In shows the app's mark and its fields in one card;
// every password field has an eye that shows / hides it; new passwords show the rule as a checklist that ticks off while
// typing; Change My Password has a back pill to More and still saves. Signing in still works with the eye in the form.
// Run: node test/browser/auth-look.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const met = (page) => page.$$eval('.password-rule li', (lis) => lis.map((li) => li.classList.contains('met')));

(async () => {
  // ---- Sign In ----
  const calls = [];
  let app = await openApp({ role: 'owner', signedIn: false, handle: (b) => {
    calls.push(b);
    return b.action === 'login' ? { token: 't', username: 'o', role: 'owner', permissions: [], expiresAt: '2099-01-01' } : { slots: [], permissions: [] };
  } });
  let { page, base } = app;
  await page.goto(base + 'login.html');
  assert.equal(await page.$eval('.auth-brand h1', (e) => e.textContent), 'Smart Scan');
  assert.equal(await page.$eval('.auth-brand img', (e) => e.complete && e.naturalWidth > 0), true, 'the app icon loads');
  assert.equal(await page.$eval('label[for="username"]', (e) => e.textContent), 'Username');
  assert.equal(await page.$eval('#forgotLine', (e) => e.classList.contains('hidden')), true, 'no Forgot Password on Sheets');
  // The eye shows and hides the password, and isn't the form's submit.
  await page.type('#password', 'Secret-1!');
  assert.equal(await page.$eval('#password', (e) => e.type), 'password');
  await page.click('.password-field .eye');
  assert.equal(await page.$eval('#password', (e) => e.type), 'text');
  assert.equal(await page.$eval('.password-field .eye', (e) => e.getAttribute('aria-label')), 'Hide password');
  assert.equal(calls.filter((c) => c.action === 'login').length, 0, 'the eye does not sign in');
  await page.click('.password-field .eye');
  assert.equal(await page.$eval('#password', (e) => e.type), 'password');
  assert.ok(await noSideScroll(page));
  await shot(page, 'auth-login');
  await page.type('#username', 'o');
  await page.click('#form button[type="submit"]');
  await page.waitForFunction(() => location.pathname.endsWith('index.html'));
  const login = calls.find((c) => c.action === 'login');
  assert.deepEqual([login.username, login.password], ['o', 'Secret-1!']);
  await app.close();

  // ---- Change My Password ----
  const saved = [];
  app = await openApp({ role: 'employee', handle: (b) => { if (b.action === 'changePassword') saved.push(b); return {}; } });
  ({ page, base } = app);
  await page.goto(base + 'more.html');
  await Promise.all([page.waitForNavigation(), page.click('a[href="account.html"]')]);
  assert.equal(await page.$eval('.app-header .back', (e) => [e.getAttribute('href'), e.textContent].join(' ')), 'more.html More');
  assert.equal(await page.$$eval('.password-field .eye', (els) => els.length), 3, 'an eye on each of the 3 fields');
  assert.deepEqual(await page.$$eval('.password-rule li', (lis) => lis.map((li) => li.textContent)),
    ['At least 8 characters', 'A capital letter', 'A lowercase letter', 'A number', 'One of ? ! @ # $ % &']);
  assert.deepEqual(await met(page), [false, false, false, false, false]);
  await page.type('#next', 'abc');
  assert.deepEqual(await met(page), [false, false, true, false, false]);
  await page.type('#next', 'DEF12!');
  assert.deepEqual(await met(page), [true, true, true, true, true]);
  await shot(page, 'auth-account');
  await page.type('#current', 'Old-pass1!');
  await page.type('#confirm', 'abcDEF12!');
  await page.click('#form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#message').textContent);
  assert.equal(await page.$eval('#message', (e) => e.textContent), 'Password changed.');
  assert.equal(saved.length, 1);
  assert.ok(await noSideScroll(page));
  await page.click('.app-header .back');
  await page.waitForFunction(() => location.pathname.endsWith('more.html'));
  await sleep(50);
  await app.close();

  console.log('auth look: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
