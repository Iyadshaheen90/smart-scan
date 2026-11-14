// One person on two stores, end to end on the database backend against the dev project (smart-scan-dev): the pages,
// the real database, Supabase Auth and the members Edge Function (many stores, steps 4 and 5; migration 0029).
// An owner adds an email that already has an account (it joins with its own sign-in; a test store sends no email);
// Reset Password for that person emails a link instead of taking a typed password (and the function refuses the
// typed one); that person signs in, picks a store, switches by the header, leaves the first store, deletes their own
// store by typing its name, then deletes their account with their password.
// Needs migration 0029 and the members function deployed on dev.
// Run: node test/browser/db-two-stores.js   (needs the Supabase CLI signed in, like test/parity)
const assert = require('assert/strict');
const crypto = require('crypto');
const { openApp, sleep } = require('./harness');
const { keys, http, service, URL } = require('../parity/harness');

const DOMAIN = 'twostores.smartscan.test';
const tag = crypto.randomBytes(3).toString('hex');
const bossEmail = `boss-${tag}@${DOMAIN}`;
const patEmail = `pat-${tag}@${DOMAIN}`;
const password = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;

async function deleteTestUsers() {
  const listed = await http('GET', '/auth/v1/admin/users?per_page=200', { key: keys().service });
  for (const u of (listed.data.users || []).filter((x) => String(x.email).endsWith(`@${DOMAIN}`))) {
    await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: keys().service });
  }
}

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const sessionOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession') || 'null'));
const at = (page, name) => page.waitForFunction((n) => location.pathname.endsWith(n), { timeout: 20000 }, name);
async function tap(page, sel) {
  await page.waitForSelector(sel);
  await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
  await page.click(sel);
}

(async () => {
  await deleteTestUsers();
  const first = await service('test_create_store', { p_name: 'Two Stores First' });
  const second = await service('test_create_store', { p_name: 'Two Stores Second' });
  let secondGone = false;
  let app;
  try {
    const ids = {};
    for (const email of [bossEmail, patEmail]) {
      const made = await http('POST', '/auth/v1/admin/users', { key: keys().service, body: { email, password, email_confirm: true } });
      assert.ok(made.status < 300, JSON.stringify(made.data));
      ids[email] = made.data.id;
    }
    await service('test_add_members', { p_store: first, users: [{ userId: ids[bossEmail], username: 'boss', role: 'owner', permissions: [], email: bossEmail }] });
    await service('test_add_members', { p_store: second, users: [{ userId: ids[patEmail], username: 'patowner', role: 'owner', permissions: [], email: patEmail }] });
    for (const store of [first, second]) await service('test_seed', { p_store: store, data: { slots: [{ box: 1, slot: 1, price: 20 }] } });

    const dialogs = [];
    app = await openApp({
      signedIn: false,
      configJs: `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'Not This Name';\n`
        + `const BACKEND = 'supabase';\nconst SIGN_UP_OPEN = false;\nconst SUPABASE_URL = '${URL}';\nconst SUPABASE_ANON_KEY = '${keys().anon}';\n`,
      onDialog: (d) => { dialogs.push(d.message()); return d.accept(); },
      handle: () => { throw new Error('the Apps Script backend was called'); },
    });
    const { page, base } = app;
    const signIn = async (email) => {
      await page.goto(base + 'login.html');
      await page.evaluate(() => localStorage.removeItem('smartScanSession'));
      await page.goto(base + 'login.html');
      await page.$eval('#username', (e) => { e.value = ''; });
      await page.type('#username', email);
      await page.type('#password', password);
      await page.click('#form button[type="submit"]');
    };

    // ---- The first store's owner adds an email that already has an account ----
    await signIn(bossEmail);
    await at(page, 'index.html');
    assert.equal((await sessionOf(page)).storeCount, 1);
    await page.goto(base + 'users.html');
    await tap(page, '#addOpen');
    await page.type('#username', 'pat');
    await page.type('#email', patEmail);
    await tap(page, '#addForm button[type="submit"]');
    await page.waitForFunction(() => /already has a Smart Scan account/.test(document.querySelector('#listMessage').textContent), { timeout: 30000 });
    assert.equal(await page.$$eval('#list .card', (c) => c.length), 2);
    // Adding the same email again is refused by name.
    await tap(page, '#addOpen');
    await page.type('#username', 'pat2');
    await page.type('#email', patEmail);
    await tap(page, '#addForm button[type="submit"]');
    await page.waitForFunction(() => /already on the list \(pat\)/.test(document.querySelector('#addMessage').textContent), { timeout: 30000 });
    await tap(page, '#addCancel');

    // ---- Reset Password: a link by email, never a typed password, for someone on another store too ----
    await page.click('#listMessage');
    await page.evaluate(() => [...document.querySelectorAll('.member-card')].find((c) => c.querySelector('strong').textContent === 'pat')
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Reset Password') b.click(); }));
    await page.waitForFunction(() => /A link to choose a new password is on its way/.test(document.querySelector('#listMessage').textContent), { timeout: 30000 });
    assert.ok(dialogs.some((m) => m.startsWith('pat also uses Smart Scan at another store')), JSON.stringify(dialogs));
    assert.equal(await page.evaluate(() => api('resetPassword', { username: 'pat', newPassword: 'Typed-by-0wner!' }).then(() => 'changed', (e) => e.code)),
      'shared_account', 'the function refuses a typed password for a shared account');

    // ---- That person signs in: Your Stores asks, the header switches ----
    await signIn(patEmail);
    await at(page, 'stores.html');
    await page.waitForSelector('.store-row');
    assert.deepEqual(await page.$$eval('.store-row .row-title', (els) => els.map((e) => e.textContent)), ['Two Stores First', 'Two Stores Second']);
    await tap(page, `.store-row[data-store="${first}"]`);
    await at(page, 'index.html');
    let s = await sessionOf(page);
    assert.deepEqual([s.storeName, s.username, s.role], ['Two Stores First', 'pat', 'employee']);
    await page.goto(base + 'more.html');
    await tap(page, 'a.eyebrow');
    await at(page, 'stores.html');
    await tap(page, `.store-row[data-store="${second}"]`);
    await at(page, 'index.html');
    s = await sessionOf(page);
    assert.deepEqual([s.storeName, s.username, s.role], ['Two Stores Second', 'patowner', 'owner']);
    // The owner there sets up the layout and hours for real.
    await page.goto(base + 'layout.html');
    await tap(page, '.layout-box[data-box="1"] [data-act="add"]');
    await page.type('#addCount', '2');
    await tap(page, '#priceChips button[data-price="5"]');
    await tap(page, '#addSave');
    await page.waitForFunction(() => /Added slots 2 to 3 to box 1/.test(document.getElementById('toast').textContent), { timeout: 20000 });
    await tap(page, '.layout-box[data-box="1"] [data-act="removeSlot"]');
    await tap(page, '#removeGo');
    await page.waitForFunction(() => /Removed slot 3 from box 1/.test(document.getElementById('toast').textContent), { timeout: 20000 });
    await page.goto(base + 'store-settings.html');
    await page.waitForFunction(() => !document.getElementById('saveBtn').disabled, { timeout: 20000 });
    await page.select('#dayEnd', '2');
    await tap(page, '#saveBtn');
    await page.waitForFunction(() => document.getElementById('formMessage').textContent === 'Store settings saved.', { timeout: 20000 });

    // ---- Leave the first store ----
    await page.goto(base + 'stores.html');
    await tap(page, `.store-row[data-store="${first}"]`);
    await at(page, 'index.html');
    await page.goto(base + 'delete.html');
    await tap(page, '#leaveBtn');
    await tap(page, '#confirmGo');
    await at(page, 'index.html');
    s = await sessionOf(page);
    assert.deepEqual([s.storeName, s.storeCount], ['Two Stores Second', 1], 'into the store that\'s left');

    // ---- Delete their own store, then their account ----
    await page.goto(base + 'delete.html');
    await page.waitForFunction(() => !document.getElementById('accountBlocked').classList.contains('hidden'), { timeout: 20000 });
    assert.equal(await text(page, '#accountBlocked'), 'You own Two Stores Second. Delete the store first, then delete your account.');
    await page.type('#storeName', 'two stores second');
    await tap(page, '#storeBtn');
    await tap(page, '#confirmGo');
    await page.waitForFunction(() => document.querySelector('.app-header h1').textContent === 'Delete Account', { timeout: 30000 });
    secondGone = true;
    assert.equal((await sessionOf(page)).storeId, null);
    await assert.rejects(service('test_drop_store', { p_store: second }), /Not a test store/, 'the store is gone from the database');
    await page.waitForFunction(() => !document.getElementById('accountForm').classList.contains('hidden'), { timeout: 20000 });
    await page.type('#password', password);
    await tap(page, '#accountBtn');
    await tap(page, '#confirmGo');
    await at(page, 'login.html');
    assert.equal(await sessionOf(page), null);
    const gone = await http('GET', `/auth/v1/admin/users/${ids[patEmail]}`, { key: keys().service });
    assert.equal(gone.status, 404, 'the account is gone');
    await signIn(patEmail);
    await page.waitForFunction(() => document.querySelector('#message').textContent, { timeout: 20000 });
    assert.equal(await text(page, '#message'), 'Wrong email or password.');
    await sleep(100);
    console.log('database two stores: all passed');
  } finally {
    if (app) await app.close();
    await service('test_drop_store', { p_store: first });
    if (!secondGone) await service('test_drop_store', { p_store: second }).catch(() => {});
    await deleteTestUsers();
  }
})().catch((e) => { console.error(e); process.exit(1); });
