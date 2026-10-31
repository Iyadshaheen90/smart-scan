// Report a Problem and Store Info on the database backend (owner 2026-10-31), against a throwaway test store on the dev
// project (smart-scan-dev): the pages run with BACKEND 'supabase' and talk to the real database and the support Edge
// Function (a test store gets the email back instead of it being sent).
// Owner: More shows Store Info ("Add your address and phone") and Report a Problem; Store Info shows the Store ID, refuses
// a bad ZIP, saves; a report from Slots picks Slots, needs 10+ letters, takes a screenshot (saved in the private bucket),
// and its email has the store's name, ID, address, phone, the person and the last red message; My Reports shows it.
// Employee: no Store Info; My Reports starts empty (not the owner's), shows only their own. Support marks a report Fixed
// with a note: the owner sees it. On Sheets, neither row shows.
// Run: node test/browser/db-report.js   (needs the Supabase CLI signed in, like test/parity; SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const crypto = require('crypto');
const path = require('path');
const { openApp, sleep } = require('./harness');
const { keys, http, service, URL } = require('../parity/harness');

const DOMAIN = 'report.smartscan.test';
const tag = crypto.randomBytes(3).toString('hex');
const password = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;
const people = { owner: { email: `owner-${tag}@${DOMAIN}`, username: `owner${tag}` }, employee: { email: `emp-${tag}@${DOMAIN}`, username: `emp${tag}` } };
const shots = process.env.SHOTS;

async function deleteTestUsers() {
  const listed = await http('GET', '/auth/v1/admin/users?per_page=200', { key: keys().service });
  for (const u of (listed.data.users || []).filter((x) => String(x.email).endsWith(`@${DOMAIN}`))) {
    await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: keys().service });
  }
}

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
// Centered first, so a tap never lands on the tab bar fixed over the bottom of the screen.
const tap = async (page, sel) => { await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' })); await page.click(sel); };
const shown = (page, sel) => page.$eval(sel, (e) => !e.closest('.hidden') && e.offsetParent !== null);

(async () => {
  await deleteTestUsers();
  const store = await service('test_create_store', { p_name: 'Report Test Store' });
  let app;
  try {
    const members = [];
    for (const [role, p] of Object.entries(people)) {
      const made = await http('POST', '/auth/v1/admin/users', { key: keys().service, body: { email: p.email, password, email_confirm: true } });
      assert.ok(made.status < 300, JSON.stringify(made.data));
      members.push({ userId: made.data.id, username: p.username, role, permissions: [], email: p.email });
    }
    await service('test_add_members', { p_store: store, users: members });
    await service('test_seed', { p_store: store, data: { slots: [{ box: 1, slot: 1, price: 20 }] } });

    const supportAnswers = [];
    app = await openApp({
      signedIn: false,
      configJs: `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'Report Test Store';\n`
        + `const BACKEND = 'supabase';\nconst SUPABASE_URL = '${URL}';\nconst SUPABASE_ANON_KEY = '${keys().anon}';\n`,
      handle: () => { throw new Error('the Apps Script backend was called'); },
    });
    const { page, base } = app;
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    page.on('response', async (res) => {
      if (res.url().endsWith('/functions/v1/support') && res.request().method() === 'POST') supportAnswers.push(await res.json());
    });
    const signIn = async (who) => {
      await page.goto(base + 'login.html');
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await page.goto(base + 'login.html');
      await page.type('#username', people[who].email);
      await page.type('#password', password);
      await page.click('#form button[type="submit"]');
      await page.waitForFunction(() => location.pathname.endsWith('index.html'), { timeout: 20000 });
    };

    // ---- Owner: More ----
    await signIn('owner');
    await page.goto(base + 'more.html');
    await page.waitForFunction(() => document.getElementById('storeInfoSub').textContent === 'Add your address and phone', { timeout: 15000 });
    assert.equal(await shown(page, '#storeInfoRow'), true);
    assert.equal(await shown(page, 'a[href="report.html"]'), true);
    if (shots) await page.screenshot({ path: `${shots}/more-owner.png`, fullPage: true });

    // ---- Store Info ----
    await page.goto(base + 'store.html');
    await page.waitForFunction(() => !document.getElementById('saveBtn').disabled, { timeout: 15000 });
    const storeId = Number(await text(page, '#storeId'));
    assert.ok(storeId >= 10001, `store id ${storeId}`);
    assert.equal(await page.$eval('#name', (e) => e.value), 'Report Test Store');
    assert.equal(await page.$eval('#state', (e) => e.value), 'CA');
    await page.type('#street', '100 Route 66');
    await page.type('#city', 'Barstow');
    await page.type('#zip', '9231');
    await page.type('#phone', '7605550100');
    await tap(page, '#saveBtn');
    await page.waitForFunction(() => document.getElementById('formMessage').textContent);
    assert.equal(await text(page, '#formMessage'), 'Enter the 5-digit ZIP code.');
    await page.type('#zip', '1');
    await tap(page, '#saveBtn');
    await page.waitForFunction(() => document.getElementById('formMessage').textContent === 'Store info saved.');
    assert.equal(await page.$eval('#phone', (e) => e.value), '(760) 555-0100');
    if (shots) await page.screenshot({ path: `${shots}/store-info.png`, fullPage: true });
    await page.goto(base + 'more.html');
    await page.waitForSelector('#storeInfoRow'); await sleep(1500);
    assert.equal(await text(page, '#storeInfoSub'), 'Store ID, address and phone');

    // ---- Report from Slots: Slots is picked; checks; a screenshot; sent ----
    await page.goto(base + 'slots.html'); await sleep(300);
    await page.goto(base + 'report.html');
    await page.waitForSelector('#areas button');
    assert.equal(await text(page, '#areas button.active'), 'Slots');
    await page.type('#description', 'Too short');
    await tap(page, '#sendBtn');
    assert.equal(await text(page, '#formMessage'), 'Tell us a bit more: what did you tap, and what happened?');
    const input = await page.$('#shotInput');
    await input.uploadFile(path.join(__dirname, '..', '..', 'src', 'icons', 'icon-192.png'));
    await page.waitForSelector('.shot img');
    await page.type('#description', ': the Slots page showed the wrong price for slot 1.');
    if (shots) await page.screenshot({ path: `${shots}/report-new.png`, fullPage: true });
    await tap(page, '#sendBtn');
    await page.waitForFunction(() => !document.getElementById('sentView').classList.contains('hidden'), { timeout: 30000 });
    const sent = supportAnswers.pop();
    assert.equal(sent.ok, true, JSON.stringify(sent));
    const number = sent.data.number;
    assert.equal(await text(page, '#sentTitle'), `Report #${number} Sent`);
    if (shots) await page.screenshot({ path: `${shots}/report-sent.png`, fullPage: true });
    // The email support would get.
    const mail = sent.testEmail;
    assert.equal(mail.subject, `Problem #${number} · Report Test Store · Slots`);
    for (const line of [`Store:      Report Test Store (Store ID ${storeId})`, 'Address:    100 Route 66, Barstow, CA 92311',
      'Phone:      (760) 555-0100', `By:         ${people.owner.username} (Owner) <${people.owner.email}>`, 'Where:      Slots',
      'Too short: the Slots page showed the wrong price for slot 1.', 'Screenshots: 1 attached']) {
      assert.ok(mail.text.includes(line), `email is missing "${line}":\n${mail.text}`);
    }
    assert.match(mail.text, /store\.html: Enter the 5-digit ZIP code\./, 'the red message from Store Info');
    assert.equal(mail.replyTo, people.owner.email);
    assert.equal(mail.attachments, 1);
    const files = await http('POST', '/storage/v1/object/list/problem-screenshots', { key: keys().service, body: { prefix: `${store}/${number}` } });
    assert.deepEqual(files.data.map((f) => f.name), ['1.jpg'], JSON.stringify(files.data));

    // My Reports.
    await tap(page, '#viewMine');
    await page.waitForSelector('.problem-card');
    assert.equal(await text(page, '.problem-name'), `#${number} · Slots`);
    assert.equal(await text(page, '.problem-card .chip'), 'Received');
    assert.match(await text(page, '.problem-meta'), new RegExp(`· ${people.owner.username} · 1 screenshot$`));

    // ---- Employee ----
    await signIn('employee');
    await page.goto(base + 'more.html'); await sleep(500);
    assert.equal(await shown(page, '#storeInfoRow'), false);
    assert.equal(await shown(page, 'a[href="report.html"]'), true);
    await page.goto(base + 'report.html?tab=mine');
    await page.waitForSelector('.empty-title');
    assert.equal(await text(page, '.empty-title'), 'No Reports Yet');
    if (shots) await page.screenshot({ path: `${shots}/report-empty.png`, fullPage: true });
    await tap(page, '#tabs button[data-tab="new"]');
    await tap(page, '#areas button[data-area="close"]');
    await page.type('#description', 'Close Day froze after Submit.');
    await tap(page, '#sendBtn');
    await page.waitForFunction(() => !document.getElementById('sentView').classList.contains('hidden'), { timeout: 30000 });
    const mine = supportAnswers.pop();
    assert.match(mine.testEmail.text, new RegExp(`By:         ${people.employee.username} \\(Employee\\)`));
    await tap(page, '#viewMine');
    await page.waitForSelector('.problem-card');
    assert.deepEqual(await page.$$eval('.problem-name', (e) => e.map((x) => x.textContent)), [`#${mine.data.number} · Close Day`]);

    // ---- Support marks the owner's report Fixed; the owner sees it ----
    await service('service_set_problem_status', { p_store: store, p_report: number, p_status: 'fixed', p_note: 'Fixed in version 54.' });
    await signIn('owner');
    await page.goto(base + 'report.html?tab=mine');
    await page.waitForSelector('.problem-card');
    assert.deepEqual(await page.$$eval('.problem-name', (e) => e.map((x) => x.textContent)),
      [`#${mine.data.number} · Close Day`, `#${number} · Slots`]);
    assert.equal(await page.$$eval('.problem-card .chip', (e) => e[1].textContent), 'Fixed');
    assert.match(await page.$$eval('.problem-note', (e) => e[0].textContent), /^Support, .+: Fixed in version 54\.$/);
    if (shots) await page.screenshot({ path: `${shots}/report-mine.png`, fullPage: true });
    await app.close();
    app = null;

    // ---- On Sheets: neither row, and the pages say they start Dec 1 ----
    app = await openApp({ role: 'owner', handle: () => ({}) });
    await app.page.goto(app.base + 'more.html'); await sleep(300);
    assert.equal(await shown(app.page, '#storeInfoRow'), false);
    assert.equal(await shown(app.page, 'a[href="report.html"]'), false);
    await app.page.goto(app.base + 'report.html'); await sleep(200);
    assert.equal(await shown(app.page, '#notYet'), true);
    console.log('DB REPORT CHECKS PASS');
  } finally {
    if (app) await app.close();
    const files = await http('POST', '/storage/v1/object/list/problem-screenshots', { key: keys().service, body: { prefix: store } });
    for (const dir of files.data || []) {
      const inside = await http('POST', '/storage/v1/object/list/problem-screenshots', { key: keys().service, body: { prefix: `${store}/${dir.name}` } });
      const paths = (inside.data || []).map((f) => `${store}/${dir.name}/${f.name}`);
      if (paths.length) await http('DELETE', '/storage/v1/object/problem-screenshots', { key: keys().service, body: { prefixes: paths } });
    }
    await service('test_drop_store', { p_store: store });
    await deleteTestUsers();
  }
})().catch((e) => { console.error(e); process.exit(1); });
