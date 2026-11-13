// The setup wizard and Create Account (many stores), on the database backend against the dev project (smart-scan-dev):
// an account with no store signs in and lands on the wizard; every step (bad input, Back keeps what was typed, the
// draft survives closing the page), Create Store, then Home under the new store's name with What to Do First, and
// Slots drawing a box button per box (none for a one-box store). Create Account's page with the email answered here
// (dev has public sign-up off). With sign-up closed, an account without a store is refused as before.
// The stores made are handed to test_claim_store and dropped; the test accounts are deleted.
// Run: node test/browser/setup-wizard.js   (needs the Supabase CLI signed in, like test/parity)
const assert = require('assert/strict');
const crypto = require('crypto');
const { openApp, sleep } = require('./harness');
const { keys, http, service, URL } = require('../parity/harness');

// test_claim_store only takes a store whose people all have this kind of address.
const DOMAIN = 'test.invalid';
const tag = crypto.randomBytes(3).toString('hex');
const password = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;
const users = [`wizard-a-${tag}@${DOMAIN}`, `wizard-b-${tag}@${DOMAIN}`];

async function deleteTestUsers() {
  const listed = await http('GET', '/auth/v1/admin/users?per_page=200', { key: keys().service });
  for (const u of (listed.data.users || []).filter((x) => /^wizard-[ab]-[0-9a-f]{6}@test\.invalid$/.test(String(x.email)))) {
    await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: keys().service });
  }
}
const config = (signUpOpen) => `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'Not This Name';\n`
  + `const BACKEND = 'supabase';\nconst SIGN_UP_OPEN = ${signUpOpen};\nconst SUPABASE_URL = '${URL}';\nconst SUPABASE_ANON_KEY = '${keys().anon}';\n`;

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const visible = (page, sel) => page.$eval(sel, (e) => !e.closest('.hidden') && e.offsetParent !== null);
const value = (page, sel) => page.$eval(sel, (e) => e.value);

(async () => {
  await deleteTestUsers();
  const stores = [];
  const apps = [];
  try {
    for (const email of users) {
      const made = await http('POST', '/auth/v1/admin/users', { key: keys().service, body: { email, password, email_confirm: true } });
      assert.ok(made.status < 300, JSON.stringify(made.data));
    }
    const signups = [];
    const open = async (signUpOpen) => {
      const app = await openApp({ signedIn: false, configJs: config(signUpOpen),
        // Create Account would email a real link (and dev has sign-up off): answered here.
        intercept: async (req) => {
          if (!req.url().includes('/auth/v1/signup')) return false;
          const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' };
          if (req.method() === 'OPTIONS') { await req.respond({ status: 204, headers: cors }); return true; }
          signups.push({ url: req.url(), body: JSON.parse(req.postData()) });
          await req.respond({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
          return true;
        },
        handle: () => { throw new Error('the Apps Script backend was called'); } });
      apps.push(app);
      return app;
    };
    const signIn = async (page, base, email) => {
      await page.goto(base + 'login.html');
      await page.evaluate(() => localStorage.removeItem('smartScanSession'));
      await page.goto(base + 'login.html');
      await page.$eval('#username', (e) => { e.value = ''; });
      await page.type('#username', email);
      await page.type('#password', password);
      await page.click('#form button[type="submit"]');
    };
    const storeOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession')).storeId);

    // ---- Sign-up closed: no Create Account link, and an account without a store is refused as before ----
    let { page, base } = await open(false);
    await page.goto(base + 'login.html');
    assert.equal(await visible(page, '#signUpLine'), false, 'no Create Account while sign-up is closed');
    await signIn(page, base, users[0]);
    await page.waitForFunction(() => document.getElementById('message').textContent, { timeout: 15000 });
    assert.equal(await text(page, '#message'), 'This account is no longer active.');
    await page.goto(base + 'signup.html'); await sleep(300);
    assert.ok(page.url().endsWith('login.html'), 'Create Account is closed');

    // ---- Sign-up open: Create Account ----
    ({ page, base } = await open(true));
    await page.goto(base + 'login.html');
    assert.equal(await visible(page, '#signUpLine'), true, 'Create Account on Sign In');
    await page.click('#signUpLine a');
    await page.waitForFunction(() => location.pathname.endsWith('signup.html'));
    await page.type('#email', `new-${tag}@${DOMAIN}`);
    await page.type('#password', 'short');
    await page.click('#form button[type="submit"]');
    assert.match(await text(page, '#message'), /^Password needs /);
    await page.$eval('#password', (e) => { e.value = ''; });
    await page.type('#password', password);
    await page.type('#confirm', `${password}x`);
    await page.click('#form button[type="submit"]');
    assert.equal(await text(page, '#message'), "The two passwords don't match.");
    await page.$eval('#confirm', (e) => { e.value = ''; });
    await page.type('#confirm', password);
    await page.click('#form button[type="submit"]');
    await page.waitForFunction(() => !document.getElementById('sent').classList.contains('hidden'), { timeout: 15000 });
    assert.equal(signups.length, 1);
    assert.equal(signups[0].body.email, `new-${tag}@${DOMAIN}`);
    assert.match(decodeURIComponent(signups[0].url), /redirect_to=http:\/\/localhost:\d+\/setup\.html$/);
    assert.equal(await text(page, '#sentTo'), `new-${tag}@${DOMAIN}`);
    assert.equal(await visible(page, '#form'), false);

    // ---- An account with no store signs in: the wizard ----
    await signIn(page, base, users[0]);
    await page.waitForFunction(() => location.pathname.endsWith('setup.html'), { timeout: 15000 });
    await page.waitForSelector('#welcome:not(.hidden)');
    assert.equal(await text(page, '#myEmail'), users[0]);
    // Any other page sends them back here.
    await page.goto(base + 'slots.html');
    await page.waitForFunction(() => location.pathname.endsWith('setup.html'));
    await page.waitForSelector('#welcome:not(.hidden)');
    await page.click('#startBtn');
    assert.equal(await text(page, '#stepTitle'), 'Your Store');
    assert.equal(await text(page, '#wizCount'), '1 of 8');
    assert.equal(await page.$('.user-pill'), null, 'no name pill before there is a store');
    assert.equal(await value(page, '#username'), `wizard-a-${tag}`, 'username suggested from the email');

    const next = async () => { await page.click('#nextBtn'); await sleep(80); };
    const fill = async (sel, v) => { await page.$eval(sel, (e) => { e.value = ''; }); await page.type(sel, v); };
    // Store: each missing part is named, in order.
    await next();
    assert.equal(await text(page, '#message'), 'Enter the store name (up to 60 letters).');
    await fill('#name', `Wizard Market ${tag}`);
    await fill('#street', '1 Main St'); await fill('#city', 'Barstow'); await fill('#state', 'ca'); await fill('#zip', '9231');
    await next();
    assert.equal(await text(page, '#message'), 'Enter the 5-digit ZIP code.');
    await fill('#zip', '92311'); await fill('#phone', '555-0100');
    await next();
    assert.equal(await text(page, '#message'), 'Enter the store phone with its area code (10 digits).');
    await fill('#phone', '(760) 555-0100'); await fill('#username', 'B');
    await next();
    assert.match(await text(page, '#message'), /^Username must be 3-30 characters/);
    await fill('#username', 'Boss');
    await next();
    assert.equal(await text(page, '#stepTitle'), 'Your State');
    assert.equal(await page.$eval('input[name="lotteryState"]', (e) => e.checked), true, 'California picked');
    // Back keeps what was typed.
    await page.click('#backLink'); await sleep(80);
    assert.equal(await text(page, '#stepTitle'), 'Your Store');
    assert.equal(await value(page, '#street'), '1 Main St');
    assert.equal(await value(page, '#username'), 'boss');
    await next(); await next();
    assert.equal(await text(page, '#stepTitle'), 'Store Hours');
    assert.equal(await value(page, '#timeZone'), 'America/Los_Angeles');
    await page.select('#dayEnd', '2');
    assert.match(await text(page, '#dayEndHelp'), /^Sales until 2 AM count for the day before/);
    await next();
    // Layout: 2 boxes; a box without slots is refused; the picture follows the number.
    assert.equal(await text(page, '#stepTitle'), 'Your Boxes');
    await page.click('#boxCount [data-step="1"]');
    assert.equal(await text(page, '#boxCountValue'), '2');
    await page.type('#slots1', '3');
    await next();
    assert.equal(await text(page, '#message'), 'Enter how many slots box 2 has.');
    await page.type('#slots2', '250');
    assert.equal(await value(page, '#slots2'), '100', 'at most 100 slots a box');
    await fill('#slots2', '2');
    assert.equal(await page.$$eval('.wiz-box:nth-child(2) .wiz-dots span', (e) => e.length), 2);
    // The draft survives closing the page: same step, same answers.
    await page.goto(base + 'setup.html');
    await page.waitForSelector('#wizard:not(.hidden)');
    assert.equal(await text(page, '#stepTitle'), 'Your Boxes');
    assert.equal(await value(page, '#slots1'), '3');
    await next();
    // Prices: tap with a price; the rest is refused until filled.
    assert.equal(await text(page, '#stepTitle'), 'Slot Prices');
    assert.equal(await text(page, '#pricedCount'), '0 of 5 Slots Priced');
    await page.click('.wiz-cell[data-box="0"][data-slot="0"]');
    await page.evaluate(() => [...document.querySelectorAll('#priceChips button')].find((b) => b.textContent === '$5').click());
    await page.click('.wiz-cell[data-box="0"][data-slot="1"]');
    assert.equal(await text(page, '#pricedCount'), '2 of 5 Slots Priced');
    await next();
    assert.match(await text(page, '#message'), /^3 slots still need a price/);
    assert.equal(await text(page, '#fillRest'), 'Fill the Rest With $5');
    await page.evaluate(() => [...document.querySelectorAll('#priceChips button')].find((b) => b.textContent === '$10').click());
    await page.click('#fillRest');
    assert.equal(await text(page, '#pricedCount'), 'All 5 Slots Priced');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'fits a phone');
    await next();
    assert.equal(await text(page, '#stepTitle'), 'Ticket Order');
    await next();
    assert.equal(await text(page, '#message'), 'Pick the order your tickets sell in.');
    await page.click('input[name="order"][value="ascending"]');
    await next();
    // Retailer number: optional, checked when typed.
    assert.equal(await text(page, '#nextBtn'), 'Skip for Now');
    await page.type('#retailer', '12ab');
    assert.equal(await text(page, '#nextBtn'), 'Continue');
    await next();
    assert.match(await text(page, '#message'), /^Enter the retailer number/);
    await fill('#retailer', '');
    await next();
    // Review: everything, each with Edit.
    assert.equal(await text(page, '#stepTitle'), 'Review');
    const review = await page.$$eval('.wiz-review-row', (rows) => rows.map((r) => [...r.querySelectorAll('.wiz-review-label, .wiz-review-value')].map((e) => e.textContent)));
    assert.deepEqual(review, [
      ['Store', `Wizard Market ${tag}`, '1 Main St', 'Barstow, CA 92311', '(760) 555-0100', 'You sign your work as boss'],
      ['State', 'California'],
      ['Hours', 'Pacific time', 'The business day ends at 2 AM'],
      ['Boxes', '2 boxes · 5 slots', 'Box 1: 3 · Box 2: 2'],
      ['Slot Prices', '$5 × 1 · $10 × 3 · $20 × 1'],
      ['Ticket Order', 'Ascending (000 → 029)'],
      ['Retailer Number', 'Not added. You can add it later in More.'],
    ]);
    await page.click('.wiz-review-row:nth-child(6) .text-action'); await sleep(80);
    assert.equal(await text(page, '#stepTitle'), 'Ticket Order');
    await page.click('input[name="order"][value="descending"]');
    await next(); await next();
    assert.equal(await text(page, '#stepTitle'), 'Review');
    assert.equal(await text(page, '#nextBtn'), 'Create Store');
    await page.click('#nextBtn');

    // ---- The new store: Home under its name, What to Do First, Slots with a button per box ----
    await page.waitForFunction(() => location.pathname.endsWith('index.html'), { timeout: 20000 });
    stores.push(await storeOf(page));
    await page.waitForSelector('.app-header .eyebrow');
    assert.equal(await text(page, '.app-header .eyebrow'), `Wizard Market ${tag}`);
    assert.equal(await text(page, '.user-pill .name'), 'boss');
    assert.equal(await visible(page, '#firstSteps'), true);
    assert.deepEqual(await page.$$eval('#firstSteps .row-title', (e) => e.map((x) => x.textContent)),
      ['Scan the Packs in Your Slots', 'Scan Your Back Stock', 'Add Your Employees']);
    assert.equal(await page.evaluate((e) => localStorage.getItem(`smartScanSetupDraft:${e}`), users[0]), null, 'the draft is gone');
    await page.click('#firstStepsDone');
    assert.equal(await visible(page, '#firstSteps'), false);
    await page.goto(base + 'index.html'); await sleep(300);
    assert.equal(await visible(page, '#firstSteps'), false, 'Done stays done');
    // The wizard is over for this account.
    await page.goto(base + 'setup.html');
    await page.waitForFunction(() => location.pathname.endsWith('index.html'));

    await page.goto(base + 'slots.html');
    await page.waitForSelector('#list .card');
    assert.deepEqual(await page.$$eval('#boxSwitch button', (e) => e.map((b) => [b.textContent, b.classList.contains('active')])),
      [['Box 1', true], ['Box 2', false]]);
    assert.deepEqual(await page.$$eval('#list .slot-num', (e) => e.map((x) => x.textContent)), ['Slot 1 · $20', 'Slot 2 · $5', 'Slot 3 · $10']);
    await page.click('#boxSwitch button[data-box="2"]');
    assert.deepEqual(await page.$$eval('#list .slot-num', (e) => e.map((x) => x.textContent)), ['Slot 1 · $10', 'Slot 2 · $10']);
    // Store Info has what the wizard asked; the day ends at 2 AM on the server.
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession')));
    assert.equal(session.dayEndHour, 2);
    assert.equal(session.timeZone, 'America/Los_Angeles');
    await page.goto(base + 'store.html');
    await page.waitForFunction(() => document.getElementById('street').value, { timeout: 15000 });
    assert.equal(await value(page, '#street'), '1 Main St');
    assert.match(await text(page, '#storeId'), /^\d{5,}$/);

    // ---- A one-box store: no box buttons at all ----
    await signIn(page, base, users[1]);
    await page.waitForFunction(() => location.pathname.endsWith('setup.html'), { timeout: 15000 });
    await page.waitForSelector('#welcome:not(.hidden)');
    await page.click('#startBtn');
    await fill('#name', `Wizard One Box ${tag}`);
    await fill('#street', '2 Main St'); await fill('#city', 'Barstow'); await fill('#state', 'CA'); await fill('#zip', '92311');
    await fill('#phone', '7605550101'); await fill('#username', 'solo');
    await next(); await next(); await next();
    await page.type('#slots1', '2');
    await next();
    await page.click('#fillRest');
    await next();
    await page.click('input[name="order"][value="descending"]');
    await next();
    await page.type('#retailer', '12-3456');
    await next();
    assert.deepEqual(await page.$$eval('.wiz-review-row:last-child .wiz-review-value', (e) => e.map((x) => x.textContent)), ['123456']);
    await page.click('#nextBtn');
    await page.waitForFunction(() => location.pathname.endsWith('index.html'), { timeout: 20000 });
    stores.push(await storeOf(page));
    await page.goto(base + 'slots.html');
    await page.waitForSelector('#list .card');
    assert.equal(await visible(page, '#boxSwitch'), false, 'one box: no box buttons');
    assert.deepEqual(await page.$$eval('#list .slot-num', (e) => e.map((x) => x.textContent)), ['Slot 1 · $20', 'Slot 2 · $20']);

    console.log('setup wizard: all passed');
  } finally {
    for (const app of apps) await app.close();
    for (const store of stores.filter(Boolean)) {
      try { await service('test_claim_store', { p_store: store }); await service('test_drop_store', { p_store: store }); } catch (e) { console.log('cleanup:', e.message); }
    }
    await deleteTestUsers();
  }
})().catch((e) => { console.error(e); process.exit(1); });
