// Restock from the back (Pro; owner 2026-11-16; database only) against a throwaway test store on the dev project.
// Slots: 1-1 empty $20 (last game 1747), 1-2 live 1747, 1-3 empty $10 (last game 2222, none in the back), 1-4 empty $5
// (last game 4444, two packs from the sheets + 0000009 received yesterday). 1747 in the back: 0000004 (10 days ago) and 0000003 (2 days ago).
// Home and Slots say 2 slots are ready; Ready to Restock lists 1-1 (oldest 0000004) and 1-4 (game only); a row opens
// the slot with the oldest pack above the scanner and Back to Restock; a newer pack or another game warns at the scan
// (the oldest goes in without a warning or a question; Use This Pack Anyway doesn't ask again); Sold Out on 1-2 offers the oldest pack of its game; Activate Several shows Use This Pack
// Anyway on a newer pack; on Sheets nothing shows.
// Run: node test/browser/restock.js   (needs migration 0031 on dev and the Supabase CLI signed in; SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const crypto = require('crypto');
const path = require('path');
const { openApp, sleep } = require('./harness');
const { keys, http, service, URL } = require('../parity/harness');

const DOMAIN = 'restock.smartscan.test';
const tag = crypto.randomBytes(3).toString('hex');
const password = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;
const owner = { email: `owner-${tag}@${DOMAIN}`, username: `owner${tag}` };
const shots = process.env.SHOTS;

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const short = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

async function deleteTestUsers() {
  const listed = await http('GET', '/auth/v1/admin/users?per_page=200', { key: keys().service });
  for (const u of (listed.data.users || []).filter((x) => String(x.email).endsWith(`@${DOMAIN}`))) {
    await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: keys().service });
  }
}

const SEED = {
  slots: [{ box: 1, slot: 1, price: 20, lastGame: '1747' }, { box: 1, slot: 2, price: 20, lastGame: '1747' },
    { box: 1, slot: 3, price: 10, lastGame: '2222' }, { box: 1, slot: 4, price: 5, lastGame: '4444' }],
  games: [{ game: '1747', price: 20, size: 30 }, { game: '2222', price: 10, size: 50 }, { game: '4444', price: 5, size: 80, inBack: 2 }],
  packs: [
    { game: '1747', pack: '0000001', status: 'live', box: 1, slot: 2, price: 20, top: 5, activationTicket: 29, activatedOn: iso(daysAgo(3)), tookFromBack: true },
    { game: '1747', pack: '0000003', status: 'in_back', receivedOn: iso(daysAgo(2)) },
    { game: '1747', pack: '0000004', status: 'in_back', receivedOn: iso(daysAgo(10)) },
    { game: '4444', pack: '0000009', status: 'in_back', receivedOn: iso(daysAgo(1)) },
  ],
};

const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').replace(/\u2011/g, '-').trim());
const shown = (page, sel) => page.$eval(sel, (e) => !e.closest('.hidden') && e.offsetParent !== null);
const tap = async (page, sel) => { await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' })); await page.click(sel); };
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name) }); };
async function enter(page, printed) {
  await page.$eval('#typed', (e) => { e.value = ''; });
  await page.type('#typed', printed);
  await tap(page, '#typedForm button');
  await sleep(50);
}

(async () => {
  await deleteTestUsers();
  const store = await service('test_create_store', { p_name: 'Restock Test Store' });
  const dialogs = [];
  let answer = true;
  let app;
  try {
    const made = await http('POST', '/auth/v1/admin/users', { key: keys().service, body: { email: owner.email, password, email_confirm: true } });
    assert.ok(made.status < 300, JSON.stringify(made.data));
    await service('test_add_members', { p_store: store, users: [{ userId: made.data.id, username: owner.username, role: 'owner', permissions: [], email: owner.email }] });
    await service('test_seed', { p_store: store, data: SEED });

    app = await openApp({
      signedIn: false,
      configJs: `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'Restock Test Store';\n`
        + `const BACKEND = 'supabase';\nconst SUPABASE_URL = '${URL}';\nconst SUPABASE_ANON_KEY = '${keys().anon}';\n`,
      handle: () => { throw new Error('the Apps Script backend was called'); },
      onDialog: (d) => { dialogs.push(d.message()); return answer ? d.accept() : d.dismiss(); },
    });
    const { page, base } = app;
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(base + 'login.html');
    await page.type('#username', owner.email);
    await page.type('#password', password);
    await page.click('#form button[type="submit"]');
    await page.waitForFunction(() => location.pathname.endsWith('index.html'), { timeout: 20000 });

    // 1. Home: the card, only while a slot is ready.
    await page.waitForFunction(() => !document.getElementById('restockCard').classList.contains('hidden'), { timeout: 15000 });
    assert.equal(await text(page, '#restockCard'), 'Ready to Restock 2 empty slots have packs in the back');
    await shot(page, 'restock-home.png');

    // 2. Slots: the row above Activate Several, with the count.
    await page.goto(base + 'slots.html');
    await page.waitForFunction(() => !document.getElementById('restockRow').classList.contains('hidden'), { timeout: 15000 });
    assert.equal(await text(page, '#restockRow'), 'Ready to Restock 2 empty slots have packs in the back 2');
    await shot(page, 'restock-slots.png');

    // 3. The list: each ready slot with the oldest pack; 1-2 (live) and 1-3 (none in the back) aren't on it.
    await tap(page, '#restockRow');
    await page.waitForFunction(() => document.querySelectorAll('#list .group-row').length === 2, { timeout: 15000 });
    assert.equal(await text(page, '[data-slot="1-1"]'), `Box 1 · Slot 1 Oldest: 1747-0000004 Received ${short(daysAgo(10))} 2 in Back`);
    assert.equal(await text(page, '[data-slot="1-4"]'), 'Box 1 · Slot 4 Oldest: Game 4444 No pack number yet 3 in Back');
    assert.equal(await shown(page, '#empty'), false);
    await shot(page, 'restock-list.png');

    // 4. A row opens the slot: the oldest pack above the scanner, and Back goes to the list.
    await tap(page, '[data-slot="1-1"]');
    await page.waitForFunction(() => !document.getElementById('restockPick').classList.contains('hidden'), { timeout: 15000 });
    assert.equal(await text(page, '#restockPick'), `OLDEST IN THE BACK 1747-0000004 Received ${short(daysAgo(10))} · 2 Packs of Game 1747 in the Back`);
    assert.match(await text(page, '#back'), /Restock/);
    await shot(page, 'restock-slot.png');

    // 5. Warned at the scan, before Activate (owner 2026-11-17): a newer pack of the game, then another game; each
    //    "Scan … Instead" goes back to the scanner. The oldest goes in with no warning and no question.
    await enter(page, '1747-0000003-4-029');
    await page.waitForFunction(() => !document.getElementById('scanWarn').classList.contains('hidden'), { timeout: 15000 });
    assert.equal(await text(page, '#scanWarn'), 'Not the Oldest Pack Use pack 1747-0000004.');
    assert.equal(await text(page, '#activateBtn'), 'Use This Pack Anyway');
    assert.equal(await text(page, '#rescanBtn'), 'Scan the Oldest Pack');
    await shot(page, 'restock-warn-pack.png');
    await tap(page, '#rescanBtn');
    assert.equal(await shown(page, '#restockPick'), true);
    await enter(page, '2222-0000005-4-049');
    assert.equal(await text(page, '#scanWarn'), 'Wrong Game This slot is game 1747. Use pack 1747-0000004.');
    assert.equal(await text(page, '#activateBtn'), 'Put Game 2222 Here');
    assert.equal(await text(page, '#rescanBtn'), 'Scan Game 1747 Instead');
    await shot(page, 'restock-warn-game.png');
    await tap(page, '#rescanBtn');
    await enter(page, '1747-0000004-4-029');
    await sleep(1500);   // the oldest-pack check answers; it must not warn
    assert.equal(await shown(page, '#scanWarn'), false);
    assert.equal(await text(page, '#activateBtn'), 'Activate Pack');
    await tap(page, '#activateBtn');
    await page.waitForFunction(() => /Pack 1747-0000004 is live\./.test(document.getElementById('message').textContent), { timeout: 15000 });
    assert.equal(dialogs.length, 0, 'the oldest pack never asks');

    // 6. Sold Out on 1-2: the oldest pack of its game is offered, and shows while scanning.
    await page.goto(base + 'activate.html?box=1&slot=2');
    await page.waitForFunction(() => !document.getElementById('oldStep').classList.contains('hidden'), { timeout: 15000 });
    await tap(page, '#soldOutBtn');
    assert.match(await text(page, '#nextPrompt'), /sold out: .+ Put the oldest pack of game 1747 in now\?$/);
    await tap(page, '#replaceBtn');
    assert.equal(await text(page, '#restockName'), '1747-0000003');
    await shot(page, 'restock-sold-out.png');

    // 7. Activate Several: a pack from the sheets' game 4444 by number asks on its row; Use This Pack Anyway clears it.
    await page.goto(base + 'activate-several.html');
    await page.waitForFunction(() => !document.getElementById('scanView').classList.contains('hidden'), { timeout: 15000 });
    await enter(page, '4444-0000009-1-079');
    await page.waitForFunction(() => /Use This Pack Anyway/.test(document.body.innerText), { timeout: 15000 });
    assert.match(await text(page, '.bulk-row[data-key="4444-0000009"]'), /Game 4444 has older packs in the back/);
    await page.evaluate(() => [...document.querySelectorAll('.bulk-fix')].find((b) => b.textContent === 'Use This Pack Anyway').click());
    await page.waitForFunction(() => /Activate 1 Pack/.test(document.getElementById('activateAllBtn').textContent), { timeout: 15000 });

    // 8. Slot 1-4 (game 4444, packs from the sheets in the back): a numbered pack warns at the scan; Use This Pack
    //    Anyway puts it in without asking again.
    await page.goto(base + 'activate.html?box=1&slot=4');
    await page.waitForFunction(() => !document.getElementById('restockPick').classList.contains('hidden'), { timeout: 15000 });
    await enter(page, '4444-0000009-1-079');
    await page.waitForFunction(() => !document.getElementById('scanWarn').classList.contains('hidden'), { timeout: 15000 });
    assert.equal(await text(page, '#scanWarn'), 'Not the Oldest Pack Use an older pack of game 4444.');
    await tap(page, '#activateBtn');
    await page.waitForFunction(() => /Pack 4444-0000009 is live\./.test(document.getElementById('message').textContent), { timeout: 15000 });
    assert.equal(dialogs.length, 0, 'Use This Pack Anyway never asks twice');
    await page.evaluate(() => localStorage.clear());
    console.log('RESTOCK CHECKS PASS (database)');
  } finally {
    if (app) await app.close();
    await service('test_drop_store', { p_store: store });
    await deleteTestUsers();
  }

  // On Sheets: no card on Home, no row on Slots, and the page says it comes with the database.
  const sheets = await openApp({ role: 'owner', handle: (b) => (b.action === 'listSlots' ? [] : {}) });
  try {
    await sheets.page.goto(sheets.base + 'slots.html'); await sleep(400);
    assert.equal(await sheets.page.$eval('#restockRow', (e) => e.closest('.hidden') !== null), true);
    await sheets.page.goto(sheets.base + 'index.html'); await sleep(400);
    assert.equal(await sheets.page.$eval('#restockCard', (e) => e.classList.contains('hidden')), true);
    await sheets.page.goto(sheets.base + 'restock.html'); await sleep(300);
    assert.equal(await shown(sheets.page, '#notOnDatabase'), true);
  } finally {
    await sheets.close();
  }
  console.log('RESTOCK CHECKS PASS (sheets)');
})().catch((e) => { console.error(e); process.exit(1); });
