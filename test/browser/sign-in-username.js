// Sign in by username (database backend; owner 2026-11-20): one "Email or Username" box; a username on a phone that
// doesn't know its store asks for the Store ID; after signing in the phone remembers the store (its name shows under
// the title, Change asks for another) and what was typed, so only the password is needed; an email goes straight to
// Supabase Auth; wrong answers and Forgot Password with a username.
// The database, Supabase Auth and the signin function are answered here (a small fake), so this checks exactly what
// the page sends. The database's own rules: supabase/tests/sign_in_by_username_test.sql.
// Run: node test/browser/sign-in-username.js   (add a folder path to also save phone-size screenshots there)
const assert = require('assert/strict');
const path = require('path');
const { openApp, sleep } = require('./harness');

const DB = 'https://fake-db.smartscan.test';
const SHOTS = process.argv[2];
const CONFIG = `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'Not This Name';\n`
  + `const BACKEND = 'supabase';\nconst SIGN_UP_OPEN = false;\nconst SUPABASE_URL = '${DB}';\nconst SUPABASE_ANON_KEY = 'anon';\n`;
const A = { storeId: 'aaaaaaaa-0000-4000-8000-000000000001', storeName: 'Corner Market', storeNumber: 10021, username: 'sam', role: 'employee',
  permissions: [], timeZone: 'America/Los_Angeles', dayEndHour: 0 };

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const shown = (page, sel) => page.$eval(sel, (e) => !e.closest('.hidden') && e.getClientRects().length > 0);
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

(async () => {
  const calls = [];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' };
  const app = await openApp({ signedIn: false, configJs: CONFIG,
    handle: () => { throw new Error('the Apps Script backend was called'); },
    intercept: async (req) => {
      if (!req.url().startsWith(DB)) return false;
      if (req.method() === 'OPTIONS') { await req.respond({ status: 204, headers: cors }); return true; }
      const url = req.url().slice(DB.length);
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      const send = (status, data) => req.respond({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(data) });
      const tokens = (email) => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { email } });
      if (url.startsWith('/functions/v1/signin')) {
        calls.push({ fn: 'signin', body });
        const store = body.storeId === A.storeId || body.storeNumber === '10021';
        if (body.username === 'locked') await send(200, { ok: false, code: 'too_many_attempts', error: 'Too many tries. Wait 15 minutes.' });
        else if (store && body.username === 'sam' && body.password === 'Right1!pass') await send(200, { ok: true, data: { storeId: A.storeId, tokens: tokens('sam@example.test') } });
        else await send(200, { ok: false, code: 'bad_login', error: body.storeId ? 'Wrong username or password.' : 'Wrong Store ID, username or password.' });
      } else if (url.startsWith('/auth/v1/token')) {
        calls.push({ fn: 'token', body });
        await send(200, tokens(body.email));
      } else if (url.startsWith('/auth/v1/logout')) {
        await send(204, {});
      } else if (url.startsWith('/rest/v1/rpc/')) {
        const fn = url.slice('/rest/v1/rpc/'.length);
        calls.push({ fn, body });
        await send(200, fn === 'my_stores' ? [A] : {});
      } else {
        await send(404, {});
      }
      return true;
    } });
  const { page, base } = app;
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
  const signOut = () => page.evaluate(() => localStorage.removeItem('smartScanSession'));
  const submit = () => page.click('#form button[type="submit"]');
  const typeInto = async (sel, value) => { await page.$eval(sel, (e) => { e.value = ''; }); await page.type(sel, value); };
  const message = async () => { await page.waitForFunction(() => document.getElementById('message').textContent.trim()); return text(page, '#message'); };
  const clearMessage = () => page.$eval('#message', (e) => { e.textContent = ''; });
  try {
    // 1. A new phone: one box; the Store ID box shows only for a username.
    await page.goto(base + 'login.html');
    assert.equal(await text(page, 'label[for="username"]'), 'Email or Username');
    assert.equal(await text(page, '.auth-brand .sub'), 'Sign in to continue.');
    assert.equal(await shown(page, '#storeNumber'), false, 'no Store ID box before typing');
    await page.type('#username', 'sam');
    assert.equal(await shown(page, '#storeNumber'), true, 'a username asks for the Store ID');
    await page.type('#username', '@example.test');
    assert.equal(await shown(page, '#storeNumber'), false, 'an email needs no Store ID');
    await typeInto('#username', 'sam');
    await shot('sign-in-new-phone');

    // 2. Forgot Password with a username: asks for the email.
    await page.click('#forgot');
    assert.equal(await message(), 'Type your email to get a reset link.');
    await clearMessage();

    // 3. Wrong Store ID / password: the function's words, still on Sign In.
    await page.type('#storeNumber', '10099');
    await page.type('#password', 'Right1!pass');
    await submit();
    assert.equal(await message(), 'Wrong Store ID, username or password.');
    let last = calls.filter((c) => c.fn === 'signin').pop();
    assert.deepEqual(last.body, { storeId: '', storeNumber: '10099', username: 'sam', password: 'Right1!pass' });
    await clearMessage();

    // 4. The right Store ID: signed in to that store, and the phone remembers the store and the username.
    await typeInto('#storeNumber', '10021');
    await Promise.all([page.waitForNavigation(), submit()]);
    assert.equal(page.url().split('/').pop(), 'index.html');
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession')));
    assert.equal(session.storeId, A.storeId);
    assert.equal(session.username, 'sam');
    assert.deepEqual(JSON.parse(await stored(page, 'smartScanSignInStore')), { storeId: A.storeId, storeName: 'Corner Market', storeNumber: 10021 });
    assert.equal(await stored(page, 'smartScanLastEmail'), 'sam');
    assert.equal(calls.filter((c) => c.fn === 'token').length, 0, 'a username never signs in to Auth from the phone');

    // 5. Next time: the store's name, the username filled in, no Store ID box, only the password.
    await signOut();
    await page.goto(base + 'login.html');
    assert.equal(await text(page, '.auth-brand .sub'), 'Corner Market · Change');
    assert.equal(await page.$eval('#username', (e) => e.value), 'sam');
    assert.equal(await shown(page, '#storeNumber'), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'password');
    await shot('sign-in-known-store');
    await page.type('#password', 'Wrong1!pass');
    await submit();
    assert.equal(await message(), 'Wrong username or password.');
    last = calls.filter((c) => c.fn === 'signin').pop();
    assert.deepEqual(last.body, { storeId: A.storeId, storeNumber: '', username: 'sam', password: 'Wrong1!pass' });
    await clearMessage();
    await typeInto('#username', 'locked');
    await submit();
    assert.equal(await message(), 'Too many tries. Wait 15 minutes.');
    await clearMessage();
    await typeInto('#username', 'sam');
    await typeInto('#password', 'Right1!pass');
    await Promise.all([page.waitForNavigation(), submit()]);
    assert.equal(page.url().split('/').pop(), 'index.html');

    // 6. Change: asks for a Store ID again.
    await signOut();
    await page.goto(base + 'login.html');
    await page.click('#changeStore');
    assert.equal(await text(page, '.auth-brand .sub'), 'Sign in to continue.');
    assert.equal(await shown(page, '#storeNumber'), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'storeNumber');

    // 7. An email signs in with Supabase Auth directly, never through the signin function.
    const before = calls.filter((c) => c.fn === 'signin').length;
    await typeInto('#username', 'sam@example.test');
    assert.equal(await shown(page, '#storeNumber'), false);
    await page.type('#password', 'Right1!pass');
    await Promise.all([page.waitForNavigation(), submit()]);
    assert.equal(calls.filter((c) => c.fn === 'signin').length, before);
    assert.equal(calls.filter((c) => c.fn === 'token').pop().body.email, 'sam@example.test');
    assert.equal(await stored(page, 'smartScanLastEmail'), 'sam@example.test');

    console.log('sign-in-username: one box, Store ID only for a username, remembered store + name, Change, email path, wrong / locked, forgot');
  } finally {
    await app.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
