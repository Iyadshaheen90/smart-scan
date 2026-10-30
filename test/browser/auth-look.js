// Sign In and Change My Password redesign (owner 2026-10-29): Sign In shows the app's mark and its fields in one card;
// every password field has an eye that shows / hides it; new passwords show the rule as a checklist that ticks off while
// typing; Change My Password has a back pill to More and still saves. Signing in still works with the eye in the form.
// Manage Employees: Add Employee opens a pop-up (Cancel keeps nothing, a bad password keeps it open, adding closes it);
// each person's card has initials and a status chip (Owner green, Inactive red).
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

  // ---- Manage Employees (Sheets): Add Employee pop-up with a starting password; cards with initials and status chips ----
  let users = [
    { username: 'o', role: 'owner', active: true, permissions: [] },
    { username: 'sara', role: 'employee', active: true, permissions: ['load_packs'] },
    { username: 'old', role: 'employee', active: false, permissions: [] },
  ];
  const created = [];
  app = await openApp({ role: 'owner', handle: (b) => {
    if (b.action === 'createUser') { created.push(b); users = [...users, { username: b.username, role: 'employee', active: true, permissions: [] }]; }
    return users;
  } });
  ({ page, base } = app);
  await page.goto(base + 'users.html');
  await page.waitForSelector('#list .member-card');
  const cards = () => page.$$eval('#list .member-card', (cs) => cs.map((c) => [c.querySelector('.avatar').textContent,
    c.querySelector('strong').textContent, c.querySelector('.tag').textContent, c.querySelector('.tag').className]));
  assert.deepEqual(await cards(), [['O', 'o', 'Owner', 'tag live'], ['SA', 'sara', 'Employee', 'tag'], ['OL', 'old', 'Employee · Inactive', 'tag warn']]);
  assert.equal(await page.$eval('#addDialog', (e) => e.classList.contains('hidden')), true);
  await page.click('#addOpen');
  assert.equal(await page.$eval('#addDialog', (e) => e.classList.contains('hidden')), false);
  await page.type('#username', 'Sam');
  await page.type('#password', 'Start-pass1!');
  assert.deepEqual(await met(page), [true, true, true, true, true]);
  await shot(page, 'auth-users-add');
  await page.click('#addCancel');
  assert.equal(await page.$eval('#addDialog', (e) => e.classList.contains('hidden')), true);
  assert.equal(created.length, 0, 'Cancel adds nobody');
  await page.click('#addOpen');
  assert.equal(await page.$eval('#username', (e) => e.value), '', 'Cancel cleared the form');
  assert.deepEqual(await met(page), [false, false, false, false, false]);
  // A password that breaks the rule is refused in the pop-up, which stays open.
  await page.type('#username', 'sam');
  await page.type('#password', 'longbutplain');
  await page.click('#addForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#addMessage').textContent);
  assert.match(await page.$eval('#addMessage', (e) => e.textContent), /^Password needs/);
  await page.$eval('#password', (e) => { e.value = ''; });
  await page.type('#password', 'Start-pass1!');
  await page.click('#addForm button[type="submit"]');
  await page.waitForFunction(() => /Added sam/.test(document.querySelector('#listMessage').textContent));
  assert.equal(await page.$eval('#addDialog', (e) => e.classList.contains('hidden')), true);
  assert.deepEqual([created[0].username, created[0].password], ['sam', 'Start-pass1!']);
  assert.equal((await cards()).length, 4);
  assert.ok(await noSideScroll(page));
  await page.click('#list .member-card:nth-child(2) details.perm-details summary');
  // Flipping a switch shows a floating message: nothing on the page moves, and a tap puts it away.
  const toggleTop = () => page.$eval('#list .member-card:nth-child(2) input.toggle', (e) => e.getBoundingClientRect().top);
  await page.$eval('#list .member-card:nth-child(2) input.toggle', (e) => e.scrollIntoView({ block: 'center' }));
  const before = await toggleTop();
  await page.click('#list .member-card:nth-child(2) input.toggle');
  await page.waitForFunction(() => /sara: Load Packs turned/.test(document.querySelector('#listMessage').textContent));
  assert.equal(await toggleTop(), before, 'the switch stays under the finger');
  assert.equal(await page.$eval('#listMessage', (e) => getComputedStyle(e.parentElement).position), 'fixed');
  await shot(page, 'auth-users');
  await page.click('#listMessage');
  assert.equal(await page.$eval('#listMessage', (e) => e.textContent), '');
  await app.close();

  console.log('auth look: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
