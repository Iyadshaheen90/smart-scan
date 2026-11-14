// Many stores, steps 4 and 5, the pages (database backend): Your Stores (the chooser after sign-in, switching, what
// is cleared, a waiting close blocks it, the phone remembers its store), the store's name in the header, More's rows,
// Store Settings, Edit Layout, Manage Employees (an email that already has an account; the Reset Password rule),
// Leave Store, Delete Store, Delete My Account, and a phone whose store went away.
// The database, Supabase Auth and the members function are answered here (a small fake below), so this runs without
// the dev project and checks exactly what each page sends. The database's own rules are in
// supabase/tests/switch_and_deletion_test.sql and many_stores_test.sql.
// Run: node test/browser/many-stores-pages.js   (add a folder path to also save phone-size screenshots there)
const assert = require('assert/strict');
const path = require('path');
const { openApp, sleep } = require('./harness');

const DB = 'https://fake-db.smartscan.test';
const SHOTS = process.argv[2];
const config = (signUpOpen) => `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'Not This Name';\n`
  + `const BACKEND = 'supabase';\nconst SIGN_UP_OPEN = ${signUpOpen};\nconst SUPABASE_URL = '${DB}';\nconst SUPABASE_ANON_KEY = 'anon';\n`;

const A = { storeId: 'aaaaaaaa-0000-4000-8000-000000000001', storeName: 'Corner Market', storeNumber: 10021, username: 'boss', role: 'owner',
  permissions: [], timeZone: 'America/Los_Angeles', dayEndHour: 0 };
const B = { storeId: 'bbbbbbbb-0000-4000-8000-000000000002', storeName: 'Second Stop', storeNumber: 10022, username: 'pat', role: 'employee',
  permissions: ['load_packs'], timeZone: 'America/Denver', dayEndHour: 2 };

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
// (Not offsetParent: a pop-up is position: fixed, which has none.)
const shown = (page, sel) => page.$eval(sel, (e) => !e.closest('.hidden') && e.getClientRects().length > 0);
const sessionOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession') || 'null'));
const fail = (code, message) => Object.assign(new Error(message), { code });

// The fake: rpc(fn, body) and members(req) answer or throw fail(code, message). calls keeps every request.
async function open({ signUpOpen = false, rpc, members, onDialog }) {
  const calls = [];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' };
  const app = await openApp({ signedIn: false, configJs: config(signUpOpen), onDialog,
    handle: () => { throw new Error('the Apps Script backend was called'); },
    intercept: async (req) => {
      if (!req.url().startsWith(DB)) return false;
      if (req.method() === 'OPTIONS') { await req.respond({ status: 204, headers: cors }); return true; }
      const url = req.url().slice(DB.length);
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      const send = (status, data) => req.respond({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(data) });
      try {
        if (url.startsWith('/auth/v1/token')) {
          await send(200, { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { email: body.email } });
        } else if (url.startsWith('/auth/v1/logout')) {
          await send(204, {});
        } else if (url.startsWith('/rest/v1/rpc/')) {
          const fn = url.slice('/rest/v1/rpc/'.length);
          calls.push({ fn, body });
          await send(200, await rpc(fn, body));
        } else if (url.startsWith('/functions/v1/members')) {
          calls.push({ fn: `members.${body.action}`, body });
          await send(200, { ok: true, ...(await members(body)) });
        } else {
          await send(404, {});
        }
      } catch (e) {
        if (url.startsWith('/functions/')) await send(200, { ok: false, code: e.code || 'server_error', error: e.message });
        else await send(400, { hint: e.code || 'server_error', message: e.message });
      }
      return true;
    } });
  const signIn = async (email = 'pat@example.test') => {
    await app.page.goto(app.base + 'login.html');
    await app.page.evaluate(() => localStorage.removeItem('smartScanSession'));
    await app.page.goto(app.base + 'login.html');
    await app.page.$eval('#username', (e) => { e.value = ''; });
    await app.page.type('#username', email);
    await app.page.type('#password', 'Whatever1!');
    await Promise.all([app.page.waitForNavigation(), app.page.click('#form button[type="submit"]')]);
  };
  const shot = async (name) => { if (SHOTS) await app.page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
  return { ...app, calls, signIn, shot };
}
const page_ = (url) => url.split('/').pop().split('?')[0];
// Centered first, so the tap never lands on the tab bar floating over the bottom of the screen.
async function tap(page, sel) {
  await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
  await page.click(sel);
}

(async () => {
  const apps = [];
  try {
    // ================= Two stores: the chooser, switching, the header, More =================
    let stores = [A, B];
    let users = [{ username: 'boss', role: 'owner', active: true, permissions: [], email: 'pat@example.test', signedIn: true },
      { username: 'sam', role: 'employee', active: true, permissions: [], email: 'sam@example.test', signedIn: true },
      { username: 'kim', role: 'employee', active: true, permissions: [], email: 'kim@example.test', signedIn: true }];
    let settings = { timeZone: 'America/Los_Angeles', dayEndHour: 0, ticketOrder: 'descending', lotteryState: 'CA', today: '2026-11-14',
      boxes: [{ box: 1, slots: 24, live: 20 }, { box: 2, slots: 12, live: 0 }], maxBoxes: 20, maxSlots: 100, prices: [1, 2, 3, 5, 10, 20, 30, 40] };
    let refuse = null;
    const rpc = async (fn, body) => {
      if (fn === 'my_stores') return stores;
      if (refuse && refuse.fn === fn) throw fail(refuse.code, refuse.message);
      if (fn === 'store_info') return { storeId: 10021, name: 'Corner Market', complete: true };
      if (fn === 'store_settings') return settings;
      if (fn === 'set_store_settings') { settings = { ...settings, ...body.req }; return settings; }
      if (fn === 'add_slots') {
        const { box, count, price } = body.req;
        const boxes = settings.boxes.map((b) => ({ ...b }));
        const at = boxes.find((b) => b.box === box);
        if (at) at.slots += count; else boxes.push({ box, slots: count, live: 0 });
        settings = { ...settings, boxes };
        return { box, added: count, boxes };
      }
      if (fn === 'remove_slot') {
        if (body.req.box === 1) throw fail('slot_occupied', 'Box 1, slot 24 still has pack 1234-0000001. Mark it sold out or returned first.');
        const boxes = settings.boxes.map((b) => (b.box === body.req.box ? { ...b, slots: b.slots - 1 } : b));
        settings = { ...settings, boxes };
        return { box: body.req.box, slot: body.req.slot, boxes };
      }
      if (fn === 'remove_box') {
        const boxes = settings.boxes.filter((b) => b.box !== body.req.box);
        settings = { ...settings, boxes };
        return { box: body.req.box, boxes };
      }
      if (fn === 'list_users') return users;
      if (fn === 'account_delete_check') {
        if (stores.some((s) => s.role === 'owner')) throw fail('owns_store', 'You own Corner Market. Delete the store first, then delete your account.');
        return { stores: stores.length };
      }
      if (fn === 'leave_store') { stores = stores.filter((s) => s.storeId !== body.p_store); return { left: true }; }
      throw fail('server_error', `${fn} isn't in this test`);
    };
    const members = async (req) => {
      if (req.action === 'invite') {
        users = [...users, { username: req.username, role: 'employee', active: true, permissions: [], email: req.email, signedIn: false }];
        return req.email.startsWith('known') ? { data: users, existing: true, emailed: req.email !== 'known-nomail@example.test' } : { data: users };
      }
      if (req.action === 'passwordHelp') return { data: { how: req.username === 'kim' ? 'email' : 'set', username: req.username } };
      if (req.action === 'sendReset') return { data: {} };
      if (req.action === 'setPassword') return { data: users };
      if (req.action === 'deleteStore') {
        if (req.name.trim().toLowerCase() !== 'corner market') throw fail('wrong_name', 'Type the store\'s name to delete it: Corner Market');
        stores = stores.filter((s) => s.storeId !== req.storeId);
        return { data: { deleted: true, storeName: 'Corner Market' } };
      }
      if (req.action === 'deleteAccount') {
        if (req.password !== 'Right1!pw') throw fail('bad_password', 'Your password is wrong.');
        return { data: { deleted: true } };
      }
      throw fail('bad_request', 'Unknown request.');
    };

    let dialogs = [];
    let promptAnswer = null;
    let app = await open({ rpc, members, onDialog: (d) => { dialogs.push(d.message()); return d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept(); } });
    apps.push(app);
    let { page, base, calls } = app;

    // ---- Sign in with two stores and none remembered: Your Stores asks ----
    await app.signIn();
    assert.equal(page_(page.url()), 'stores.html', 'the chooser after sign-in');
    await page.waitForSelector('.store-row');
    let s = await sessionOf(page);
    assert.equal(s.storeId, null);
    assert.equal(s.storeCount, 2);
    assert.deepEqual(await page.$$eval('.store-row .row-title', (els) => els.map((e) => e.textContent)), ['Corner Market', 'Second Stop']);
    assert.equal(await text(page, '.store-row[data-store="bbbbbbbb-0000-4000-8000-000000000002"] .row-sub'), 'Employee · pat · Store ID 10022');
    assert.equal(await text(page, '#intro'), 'Which store are you working in? Each store keeps its own slots, stock and reports.');
    assert.equal(await shown(page, '#signOut'), true, 'Sign Out before a store is picked');
    assert.equal(await page.$('.app-header .back'), null, 'no back pill before a store is picked');
    assert.equal(await page.$('.user-pill'), null, 'no name pill before a store is picked');
    assert.equal(await page.$eval('nav.tabbar', (e) => e.children.length + e.getClientRects().length), 0, 'no tab bar before a store is picked');
    assert.equal(await shown(page, '#addBlock'), false, 'no Set Up Another Store while sign-up is closed');
    await app.shot('stores-choose');
    // Any other page sends them back here.
    await page.goto(base + 'more.html');
    await page.waitForFunction(() => location.pathname.endsWith('stores.html'));
    await page.waitForSelector('.store-row');

    // ---- Pick the owner's store: the phone is in it and remembers it ----
    await Promise.all([page.waitForNavigation(), tap(page, `.store-row[data-store="${A.storeId}"]`)]);
    assert.equal(page_(page.url()), 'index.html');
    s = await sessionOf(page);
    assert.deepEqual([s.storeId, s.storeName, s.username, s.role, s.storeCount, s.timeZone], [A.storeId, 'Corner Market', 'boss', 'owner', 2, 'America/Los_Angeles']);
    assert.equal(await page.evaluate(() => localStorage.getItem('smartScanLastStore:pat@example.test')), A.storeId);

    // ---- The header: the store's name opens Your Stores; More has Switch Store ----
    await page.goto(base + 'more.html');
    await page.waitForSelector('a.eyebrow');
    assert.equal(await text(page, 'a.eyebrow'), 'Corner Market');
    assert.equal(await page.$eval('a.eyebrow', (e) => e.getAttribute('href')), 'stores.html');
    assert.equal(await shown(page, '#storesRow'), true);
    assert.equal(await text(page, '#storesTitle'), 'Switch Store');
    assert.equal(await text(page, '#storesSub'), 'Now in Corner Market');
    assert.equal(await shown(page, 'a[href="store-settings.html"]'), true, 'Store Settings for the owner');
    assert.equal(await shown(page, 'a[href="layout.html"]'), true, 'Edit Layout for the owner');
    assert.equal(await shown(page, '#deleteRow'), false, 'no delete row while sign-up is closed');
    await app.shot('more-owner');

    // ---- Switching: a close waiting to be sent blocks it; otherwise the other store's work is cleared ----
    await tap(page, 'a.eyebrow');
    await page.waitForSelector('.store-row');
    assert.equal(await text(page, `.store-row[data-store="${A.storeId}"] .chip`), 'Current');
    assert.equal(await shown(page, '#signOut'), false);
    assert.equal(await text(page, '.app-header .back-label'), 'More');
    await app.shot('stores-switch');
    await page.evaluate(() => {
      localStorage.setItem('smartScanPendingClose', JSON.stringify({ closeId: 'x', date: '2026-11-14', entries: [] }));
      localStorage.setItem('smartScanSaved:boss:slots', '{}');
      localStorage.setItem('smartScanOwnerHome:boss', '{}');
      localStorage.setItem('smartScanCloseDraft:boss', '{}');
      localStorage.setItem('smartScanShiftDraft:boss', '{}');
      localStorage.setItem('smartScanBackStockDraft', '{}');
      localStorage.setItem('smartScanActivateSeveral:boss', '{}');
      localStorage.setItem('smartScanHelpLang', 'es');
    });
    await tap(page, `.store-row[data-store="${B.storeId}"]`);
    await page.waitForFunction(() => document.getElementById('message').textContent);
    assert.equal(await text(page, '#message'), 'A close on this phone is still waiting to be sent. Open Close Day to send it first, then switch.');
    assert.equal((await sessionOf(page)).storeId, A.storeId, 'still in the first store');
    assert.equal(await page.evaluate(() => localStorage.getItem('smartScanCloseDraft:boss')), '{}', 'a refused switch cleared nothing');
    await page.evaluate(() => localStorage.removeItem('smartScanPendingClose'));
    await Promise.all([page.waitForNavigation(), tap(page, `.store-row[data-store="${B.storeId}"]`)]);
    s = await sessionOf(page);
    assert.deepEqual([s.storeId, s.storeName, s.username, s.role, s.dayEndHour, s.permissions], [B.storeId, 'Second Stop', 'pat', 'employee', 2, ['load_packs']]);
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter((k) => /Saved:|OwnerHome|Draft|ActivateSeveral/.test(k))), [],
      'the other store\'s saved answers and drafts are gone');
    assert.equal(await page.evaluate(() => localStorage.getItem('smartScanHelpLang')), 'es', 'the phone\'s own choices stay');
    // An employee there: the name in the header still switches; no owner rows.
    await page.goto(base + 'more.html');
    await page.waitForSelector('a.eyebrow');
    assert.equal(await text(page, 'a.eyebrow'), 'Second Stop');
    assert.equal(await text(page, '#profileName'), 'pat');
    assert.equal(await shown(page, 'a[href="layout.html"]'), false, 'no Edit Layout for an employee');
    assert.equal(await shown(page, '#storesRow'), true, 'Switch Store for an employee on two stores');
    // Tapping the store they're already in just goes Home.
    await page.goto(base + 'stores.html');
    await page.waitForSelector('.store-row');
    await Promise.all([page.waitForNavigation(), tap(page, `.store-row[data-store="${B.storeId}"]`)]);
    assert.equal(page_(page.url()), 'index.html');

    // ---- Signing in again opens the store this phone used last ----
    await app.signIn();
    assert.equal(page_(page.url()), 'index.html', 'no chooser the second time');
    assert.equal((await sessionOf(page)).storeId, B.storeId);
    // …unless that store is gone: then it asks again (or with one store left, uses it).
    stores = [A];
    await app.signIn();
    assert.equal(page_(page.url()), 'index.html');
    s = await sessionOf(page);
    assert.deepEqual([s.storeId, s.storeCount], [A.storeId, 1]);

    // ---- One store: nothing about switching shows ----
    await page.goto(base + 'more.html');
    await page.waitForSelector('.eyebrow');
    assert.equal(await page.$('a.eyebrow'), null, 'the name isn\'t a link with one store');
    assert.equal(await text(page, '.eyebrow'), 'Corner Market');
    await sleep(300);
    assert.equal(await shown(page, '#storesRow'), false, 'no Switch Store with one store');

    // ================= Store Settings =================
    await page.goto(base + 'store-settings.html');
    await page.waitForFunction(() => !document.getElementById('saveBtn').disabled);
    assert.equal(await page.$eval('#timeZone', (e) => e.value), 'America/Los_Angeles');
    assert.equal(await page.$eval('#dayEnd', (e) => e.value), '0');
    assert.equal(await page.$eval('input[name="order"]:checked', (e) => e.value), 'descending');
    await app.shot('store-settings');
    await page.select('#timeZone', 'America/Denver');
    await page.select('#dayEnd', '4');
    assert.equal(await text(page, '#dayEndHelp'), 'Sales until 4 AM count for the day before. Pick the first hour you are always closed.');
    await tap(page, 'input[name="order"][value="ascending"]');
    calls.length = 0;
    await tap(page, '#saveBtn');
    await page.waitForFunction(() => document.getElementById('formMessage').textContent);
    assert.equal(await text(page, '#formMessage'), 'Store settings saved.');
    assert.deepEqual(calls.find((c) => c.fn === 'set_store_settings').body,
      { p_store: A.storeId, req: { timeZone: 'America/Denver', dayEndHour: 4, ticketOrder: 'ascending' } });
    s = await sessionOf(page);
    assert.deepEqual([s.timeZone, s.dayEndHour], ['America/Denver', 4], 'the phone knows the store\'s new day');
    // Refused once the day has a close: the server's words, nothing changes on the phone.
    refuse = { fn: 'set_store_settings', code: 'day_started', message: 'Today already has a close. Change the hours tomorrow, before the first close.' };
    await page.select('#dayEnd', '0');
    await tap(page, '#saveBtn');
    await page.waitForFunction(() => document.getElementById('formMessage').classList.contains('error'));
    assert.equal(await text(page, '#formMessage'), 'Today already has a close. Change the hours tomorrow, before the first close.');
    assert.equal((await sessionOf(page)).dayEndHour, 4);
    refuse = null;
    // A time zone that isn't on the list still shows.
    settings = { ...settings, timeZone: 'America/Boise' };
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('saveBtn').disabled);
    assert.equal(await page.$eval('#timeZone', (e) => e.value), 'America/Boise');

    // ================= Edit Layout =================
    await page.goto(base + 'layout.html');
    await page.waitForSelector('.layout-box');
    assert.equal(await text(page, '#total'), '2 Boxes · 36 Slots · 20 With a Pack');
    assert.deepEqual(await page.$$eval('.layout-box', (els) => els.map((e) => [e.querySelector('.wiz-box-name').textContent,
      e.querySelector('.layout-count').textContent, e.querySelectorAll('.wiz-dots span').length,
      [...e.querySelectorAll('.layout-actions button')].map((b) => b.textContent).join('|')])),
    [['Box 1', '24 Slots · 20 With a Pack', 24, 'Add Slots|Remove Last Slot'], ['Box 2', '12 Slots · 0 With a Pack', 12, 'Add Slots|Remove Last Slot|Remove Box']]);
    assert.equal(await text(page, '#addBoxLabel'), 'Add Box 3');
    await app.shot('layout');
    // Add Slots: needs a count and a price.
    await tap(page, '.layout-box[data-box="1"] [data-act="add"]');
    assert.equal(await text(page, '#addTitle'), 'Add Slots to Box 1');
    assert.equal(await text(page, '#addRange'), 'Up to 76. A box holds at most 100 slots.');
    calls.length = 0;
    await tap(page, '#addSave');
    assert.equal(await text(page, '#addError'), 'Enter how many slots to add.');
    await page.type('#addCount', '2x');
    assert.equal(await page.$eval('#addCount', (e) => e.value), '2');
    assert.equal(await text(page, '#addRange'), 'The new slots are numbers 25 to 26.');
    await tap(page, '#addSave');
    assert.equal(await text(page, '#addError'), 'Pick the price of the new slots.');
    assert.equal(calls.length, 0, 'nothing sent yet');
    await tap(page, '#priceChips button[data-price="5"]');
    assert.equal(await text(page, '#addError'), '', 'the message goes once they pick a price');
    await app.shot('layout-add');
    await tap(page, '#addSave');
    await page.waitForFunction(() => document.getElementById('toast').textContent);
    assert.deepEqual(calls[0], { fn: 'add_slots', body: { p_store: A.storeId, req: { box: 1, count: 2, price: 5 } } });
    assert.equal(await text(page, '#toast'), 'Added slots 25 to 26 to box 1, at $5.');
    assert.equal(await shown(page, '#addDialog'), false);
    assert.equal(await text(page, '.layout-box[data-box="1"] .layout-count'), '26 Slots · 20 With a Pack');
    // More than fits is cut to what fits.
    await tap(page, '.layout-box[data-box="1"] [data-act="add"]');
    await page.type('#addCount', '99');
    assert.equal(await page.$eval('#addCount', (e) => e.value), '74');
    await tap(page, '#addCancel');
    // Remove Last Slot: the way back for the slot just added; a slot with a pack is refused in the pop-up.
    await tap(page, '.layout-box[data-box="2"] [data-act="removeSlot"]');
    assert.equal(await text(page, '#removeTitle'), 'Remove Slot 12 From Box 2?');
    calls.length = 0;
    await tap(page, '#removeGo');
    await page.waitForFunction(() => document.getElementById('removeDialog').classList.contains('hidden'));
    assert.deepEqual(calls[0], { fn: 'remove_slot', body: { p_store: A.storeId, req: { box: 2, slot: 12 } } });
    assert.equal(await text(page, '#toast'), 'Removed slot 12 from box 2.');
    await tap(page, '.layout-box[data-box="1"] [data-act="removeSlot"]');
    await tap(page, '#removeGo');
    await page.waitForFunction(() => document.getElementById('removeError').textContent);
    assert.equal(await text(page, '#removeError'), 'Box 1, slot 24 still has pack 1234-0000001. Mark it sold out or returned first.');
    assert.equal(await shown(page, '#removeDialog'), true, 'the pop-up stays on a refusal');
    await tap(page, '#removeCancel');
    // Add a box, then remove it again.
    await tap(page, '#addBox');
    assert.equal(await text(page, '#addTitle'), 'Add Box 3');
    await page.type('#addCount', '8');
    assert.equal(await text(page, '#addRange'), 'The new slots are numbers 1 to 8.');
    await tap(page, '#priceChips button[data-price="20"]');
    calls.length = 0;
    await tap(page, '#addSave');
    await page.waitForFunction(() => document.querySelectorAll('.layout-box').length === 3);
    assert.deepEqual(calls[0].body.req, { box: 3, count: 8, price: 20 });
    assert.equal(await text(page, '#toast'), 'Added box 3 with 8 slots, at $20.');
    assert.equal(await page.$('.layout-box[data-box="2"] [data-act="removeBox"]'), null, 'only the last box can go');
    await tap(page, '.layout-box[data-box="3"] [data-act="removeBox"]');
    assert.equal(await text(page, '#removeTitle'), 'Remove Box 3?');
    calls.length = 0;
    await tap(page, '#removeGo');
    await page.waitForFunction(() => document.querySelectorAll('.layout-box').length === 2);
    assert.deepEqual(calls[0], { fn: 'remove_box', body: { p_store: A.storeId, req: { box: 3 } } });

    // ================= Manage Employees =================
    await page.goto(base + 'users.html');
    await page.waitForSelector('.member-card');
    // An email that already has a Smart Scan account.
    const add = async (username, email) => {
      await tap(page, '#addOpen');
      await page.type('#username', username);
      await page.type('#email', email);
      await tap(page, '#addForm button[type="submit"]');
      await page.waitForFunction(() => document.getElementById('addDialog').classList.contains('hidden'));
    };
    calls.length = 0;
    await add('lee', 'known@example.test');
    assert.equal(calls[0].fn, 'members.invite');
    assert.equal(await text(page, '#listMessage'), 'Added lee. known@example.test already has a Smart Scan account, so they sign in as they do now and pick'
      + ' Corner Market from their stores. An email telling them is on its way.');
    await add('max', 'known-nomail@example.test');
    assert.ok((await text(page, '#listMessage')).endsWith('The email telling them couldn\'t be sent, so let them know.'));
    await add('new', 'fresh@example.test');
    assert.ok((await text(page, '#listMessage')).startsWith('Added new. An invite is on its way to fresh@example.test.'));
    // Reset Password: typed for someone only on this store; a reset email for someone on another store too.
    const reset = async (username) => {
      await page.evaluate((u) => {
        const card = [...document.querySelectorAll('.member-card')].find((c) => c.querySelector('strong').textContent === u);
        [...card.querySelectorAll('button')].find((b) => b.textContent === 'Reset Password').click();
      }, username);
      await page.waitForFunction(() => document.getElementById('listMessage').textContent);
    };
    calls.length = 0; dialogs = []; promptAnswer = 'NewPass1!x';
    await reset('sam');
    assert.deepEqual(calls.map((c) => c.fn), ['members.passwordHelp', 'members.setPassword']);
    assert.equal(calls[1].body.newPassword, 'NewPass1!x');
    assert.equal(await text(page, '#listMessage'), 'Password for sam changed. Tell them the new one.');
    await tap(page, '#listMessage');
    calls.length = 0; dialogs = [];
    await reset('kim');
    assert.deepEqual(calls.map((c) => c.fn), ['members.passwordHelp', 'members.sendReset']);
    assert.ok(dialogs[0].startsWith('kim also uses Smart Scan at another store, so only they can choose their password.'), dialogs[0]);
    assert.ok(calls[1].body.redirectTo.endsWith('set-password.html'));
    assert.equal(await text(page, '#listMessage'), 'A link to choose a new password is on its way to kim@example.test. It works once, for 24 hours.');

    // ================= The phone's store went away (taken off, or the store was deleted) =================
    stores = [B];
    refuse = { fn: 'list_users', code: 'forbidden', message: 'You don\'t have access to this store.' };
    await page.goto(base + 'users.html');
    await page.waitForFunction(() => location.pathname.endsWith('index.html'), { timeout: 10000 });
    s = await sessionOf(page);
    assert.deepEqual([s.storeId, s.username, s.storeCount], [B.storeId, 'pat', 1], 'moved into the store that\'s left');
    // An ordinary refusal (an employee without the permission) changes nothing.
    refuse = { fn: 'list_slots', code: 'forbidden', message: 'The owner hasn\'t turned this on for you.' };
    await page.goto(base + 'slots.html');
    await sleep(600);
    assert.equal(page_(page.url()), 'slots.html');
    assert.equal((await sessionOf(page)).storeId, B.storeId);
    // No store left at all: signed out.
    stores = [];
    refuse = { fn: 'list_slots', code: 'forbidden', message: 'You don\'t have access to this store.' };
    await page.goto(base + 'slots.html');
    await page.waitForFunction(() => location.pathname.endsWith('login.html'), { timeout: 10000 });
    assert.equal(await sessionOf(page), null);
    refuse = null;
    await app.close(); apps.pop();

    // ================= Sign-up open: Leave Store, Delete Store, Delete My Account, another store =================
    stores = [A, B];
    app = await open({ signUpOpen: true, rpc, members });
    apps.push(app);
    ({ page, base, calls } = app);
    await app.signIn();
    await page.waitForSelector('.store-row');
    assert.equal(await shown(page, '#addBlock'), true, 'Set Up Another Store with sign-up open');
    assert.equal(await page.$eval('#addBlock a', (e) => e.getAttribute('href')), 'setup.html?new=1');

    // ---- Employee: Leave Store ----
    await Promise.all([page.waitForNavigation(), tap(page, `.store-row[data-store="${B.storeId}"]`)]);
    await page.goto(base + 'more.html');
    await page.waitForSelector('#deleteRow:not(.hidden)');
    assert.equal(await text(page, '#deleteTitle'), 'Leave Store or Delete Account');
    await Promise.all([page.waitForNavigation(), tap(page, '#deleteRow')]);
    assert.equal(await text(page, '.app-header h1'), 'Leave Store');
    assert.equal(await shown(page, '#leaveCard'), true);
    assert.equal(await shown(page, '#storeCard'), false, 'an employee can\'t delete the store');
    assert.equal(await text(page, '#leaveCard h2'), 'Leave Second Stop');
    // Their account owns another store, so it can't go yet.
    await page.waitForFunction(() => !document.getElementById('accountBlocked').classList.contains('hidden'));
    assert.equal(await text(page, '#accountBlocked'), 'You own Corner Market. Delete the store first, then delete your account.');
    assert.equal(await shown(page, '#accountForm'), false);
    await app.shot('leave-store');
    // Keep It changes nothing.
    await tap(page, '#leaveBtn');
    assert.equal(await text(page, '#confirmTitle'), 'Leave Second Stop?');
    calls.length = 0;
    await tap(page, '#confirmCancel');
    assert.equal(calls.length, 0);
    await tap(page, '#leaveBtn');
    await Promise.all([page.waitForNavigation(), tap(page, '#confirmGo')]);
    assert.deepEqual(calls[0], { fn: 'leave_store', body: { p_store: B.storeId, req: {} } });
    assert.equal(page_(page.url()), 'index.html', 'into the store that\'s left');
    s = await sessionOf(page);
    assert.deepEqual([s.storeId, s.role, s.storeCount], [A.storeId, 'owner', 1]);

    // ---- Set Up Another Store: the wizard opens for someone already in a store ----
    await page.goto(base + 'setup.html?new=1');
    await page.waitForSelector('#welcome:not(.hidden)');
    assert.equal(await text(page, '#welcome h1'), 'Set Up Another Store');
    assert.equal(await shown(page, '#signOutBtn'), false);
    assert.equal(await shown(page, '#cancelAdd'), true);
    assert.equal(await shown(page, '#joinNote'), false);
    await page.goto(base + 'setup.html');
    await page.waitForFunction(() => location.pathname.endsWith('index.html'));

    // ---- Owner: Delete Store ----
    await page.goto(base + 'more.html');
    await page.waitForSelector('#deleteRow:not(.hidden)');
    assert.equal(await text(page, '#deleteTitle'), 'Delete Store or Account');
    assert.equal(await text(page, '#storesTitle'), 'Your Stores');
    await app.shot('more-signup-open');
    await page.goto(base + 'delete.html');
    assert.equal(await text(page, '.app-header h1'), 'Delete Store');
    assert.equal(await shown(page, '#leaveCard'), false, 'the owner can\'t leave');
    assert.equal(await text(page, '#storeCard h2'), 'Delete Corner Market');
    await page.waitForFunction(() => !document.getElementById('accountBlocked').classList.contains('hidden'));
    await app.shot('delete-store');
    // The wrong name: nothing is asked or sent.
    calls.length = 0;
    await page.type('#storeName', 'Corner');
    await tap(page, '#storeBtn');
    assert.equal(await text(page, '#storeMessage'), 'Type the store\'s name to delete it: Corner Market');
    assert.equal(await shown(page, '#confirmDialog'), false);
    assert.equal(calls.length, 0);
    // The right name (capitals don't matter), then the second question.
    await page.$eval('#storeName', (e) => { e.value = ''; });
    await page.type('#storeName', ' corner market ');
    await tap(page, '#storeBtn');
    assert.equal(await text(page, '#confirmTitle'), 'Delete Corner Market for Good?');
    assert.equal(await text(page, '#confirmGo'), 'Delete Store');
    await app.shot('delete-store-confirm');
    await Promise.all([page.waitForNavigation(), tap(page, '#confirmGo')]);
    const sent = calls.find((c) => c.fn === 'members.deleteStore').body;
    assert.deepEqual([sent.storeId, sent.name], [A.storeId, 'corner market']);

    // ---- No store left: still signed in, on the page that offers the account ----
    assert.equal(page_(page.url()), 'delete.html');
    s = await sessionOf(page);
    assert.deepEqual([s.storeId, s.storeCount, s.email], [null, 0, 'pat@example.test']);
    assert.equal(await text(page, '.app-header h1'), 'Delete Account');
    assert.equal(await text(page, '#noStore'), 'You\'re not on any store now. You can delete your account too, or keep it and sign out.');
    assert.equal(await shown(page, '#storeCard'), false);
    assert.equal(await shown(page, '#keepBtn'), true);
    await page.waitForFunction(() => !document.getElementById('accountForm').classList.contains('hidden'));
    await app.shot('delete-account');
    // No password, then a wrong one.
    await tap(page, '#accountBtn');
    assert.equal(await text(page, '#accountMessage'), 'Enter your password to delete your account.');
    await page.type('#password', 'wrong');
    await tap(page, '#accountBtn');
    assert.equal(await text(page, '#confirmTitle'), 'Delete Your Account for Good?');
    await tap(page, '#confirmGo');
    await page.waitForFunction(() => document.getElementById('accountMessage').textContent);
    assert.equal(await text(page, '#accountMessage'), 'Your password is wrong.');
    assert.equal(await shown(page, '#confirmDialog'), false);
    assert.ok(await sessionOf(page), 'still signed in after a wrong password');
    // The right one: the account is gone and the phone forgets it.
    await page.$eval('#password', (e) => { e.value = ''; });
    await page.type('#password', 'Right1!pw');
    await tap(page, '#accountBtn');
    await Promise.all([page.waitForNavigation(), tap(page, '#confirmGo')]);
    assert.equal(page_(page.url()), 'login.html');
    assert.equal(await sessionOf(page), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('smartScanLastEmail')), null, 'the phone forgot the email');
    assert.equal(await page.$eval('#username', (e) => e.value), '');

    // ---- Keep My Account and Sign Out ----
    stores = [B];
    await app.signIn();
    await page.goto(base + 'delete.html');
    await tap(page, '#leaveBtn');
    await Promise.all([page.waitForNavigation(), tap(page, '#confirmGo')]);
    assert.equal(page_(page.url()), 'delete.html');
    await Promise.all([page.waitForNavigation(), tap(page, '#keepBtn')]);
    assert.equal(page_(page.url()), 'login.html');
    assert.equal(await sessionOf(page), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('smartScanLastEmail')), 'pat@example.test', 'the account is kept');

    console.log('many-stores-pages: all passed');
  } finally {
    for (const a of apps) await a.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
