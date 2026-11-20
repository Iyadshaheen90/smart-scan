// Sign in by username against the dev project (smart-scan-dev): the real database check (migration 0032) and the
// signin Edge Function. A throwaway test store and owner: sign in by email once (the phone remembers the store), then
// by username at the remembered store, then by username + Store ID on a phone that doesn't know the store, then 5 wrong
// passwords lock the username (even the right password waits). The page-only cases: test/browser/sign-in-username.js.
// Run: node test/browser/db-sign-in-username.js   (needs the Supabase CLI signed in, like test/parity)
const assert = require('assert/strict');
const crypto = require('crypto');
const { openApp } = require('./harness');
const { keys, http, service, URL } = require('../parity/harness');

const DOMAIN = 'username.smartscan.test';
const tag = crypto.randomBytes(3).toString('hex');
const email = `owner-${tag}@${DOMAIN}`;
const username = `boss${tag}`;
const password = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;

async function deleteTestUsers() {
  const listed = await http('GET', '/auth/v1/admin/users?per_page=200', { key: keys().service });
  for (const u of (listed.data.users || []).filter((x) => String(x.email).endsWith(`@${DOMAIN}`))) {
    await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: keys().service });
  }
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());

(async () => {
  await deleteTestUsers();
  const store = await service('test_create_store', { p_name: 'Username Test Store' });
  let app;
  try {
    const made = await http('POST', '/auth/v1/admin/users', { key: keys().service, body: { email, password, email_confirm: true } });
    assert.ok(made.status < 300, JSON.stringify(made.data));
    await service('test_add_members', { p_store: store, users: [{ userId: made.data.id, username, role: 'owner', permissions: [], email }] });
    app = await openApp({ signedIn: false,
      configJs: `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'x';\n`
        + `const BACKEND = 'supabase';\nconst SUPABASE_URL = '${URL}';\nconst SUPABASE_ANON_KEY = '${keys().anon}';\n`,
      handle: () => { throw new Error('the Apps Script backend was called'); } });
    const { page, base } = app;
    const signIn = async (login, pass, storeNumber) => {
      await page.evaluate(() => localStorage.removeItem('smartScanSession'));
      await page.goto(base + 'login.html');
      await page.$eval('#message', (e) => { e.textContent = ''; });
      await page.$eval('#username', (e) => { e.value = ''; });
      await page.type('#username', login);
      await page.evaluate(() => document.getElementById('username').dispatchEvent(new Event('input')));
      if (storeNumber) await page.type('#storeNumber', String(storeNumber));
      await page.type('#password', pass);
      await page.click('#form button[type="submit"]');
    };
    const landed = () => page.waitForFunction(() => location.pathname.endsWith('index.html'), { timeout: 20000 });
    const said = async () => { await page.waitForFunction(() => document.querySelector('#message').textContent, { timeout: 20000 }); return text(page, '#message'); };

    // Email once: the phone remembers the store.
    await page.goto(base + 'login.html');
    await page.evaluate(() => localStorage.clear());
    await signIn(email, password);
    await landed();
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession')));
    assert.equal(session.storeId, store);

    // Username at the remembered store.
    await signIn(username.toUpperCase(), password);
    await landed();

    // A phone that doesn't know the store: username + Store ID (and a wrong Store ID first).
    await page.evaluate(() => localStorage.removeItem('smartScanSignInStore'));
    await signIn(username, password, 99999999);
    assert.equal(await said(), 'Wrong Store ID, username or password.');
    await signIn(username, password, session.storeNumber);
    await landed();
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('smartScanSignInStore'))).storeId, store);

    // Wrong passwords: the 5th within 15 minutes locks the username; the right one then waits too.
    // (The wrong Store ID above was another store's key, so it doesn't count here.)
    for (let i = 1; i <= 4; i += 1) {
      await signIn(username, 'Wrong-pass1!');
      assert.equal(await said(), 'Wrong username or password.', `try ${i}`);
    }
    await signIn(username, 'Wrong-pass1!');
    assert.equal(await said(), 'Too many tries. Wait 15 minutes.');
    await signIn(username, password);
    assert.equal(await said(), 'Too many tries. Wait 15 minutes.');
    // Email still works (Supabase Auth's own limits only).
    await signIn(email, password);
    await landed();
    console.log('database sign-in by username: email once, remembered store, Store ID, wrong Store ID, 5 wrong tries lock');
  } finally {
    if (app) await app.close();
    await service('test_drop_store', { p_store: store });
    await deleteTestUsers();
  }
})().catch((e) => { console.error(e); process.exit(1); });
