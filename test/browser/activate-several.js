// Activate Several (owner 2026-11-10; database only) against a throwaway test store on the dev project: the page runs
// with BACKEND 'supabase' and talks to the real activate_several / undo_activate_several.
// Slots: 1-1 empty (last game 1747), 1-2 live 1747, 1-3 empty $10 (last game 2222), 1-4 empty $5, 2-1 and 2-2 live 3333.
// A pack of 1747 goes to the empty 1-1 first, the next to 1-2 (asks Sold Out / Returned); 3333 is live in two slots, so
// the row shows both with tickets left, then Returned asks the top ticket; 2222 goes to 1-3; a new game picks 1-4 by
// hand, enters its price, and changes the slot price. Same pack twice is refused. The list survives a reload.
// Activate All saves everything; Undo All puts it back and the packs return to the list; on Sheets nothing shows.
// Run: node test/browser/activate-several.js   (needs the Supabase CLI signed in, like test/parity; SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const crypto = require('crypto');
const { openApp, sleep } = require('./harness');
const { keys, http, service, URL } = require('../parity/harness');

const DOMAIN = 'bulk.smartscan.test';
const tag = crypto.randomBytes(3).toString('hex');
const password = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;
const owner = { email: `owner-${tag}@${DOMAIN}`, username: `owner${tag}` };
const shots = process.env.SHOTS;

async function deleteTestUsers() {
  const listed = await http('GET', '/auth/v1/admin/users?per_page=200', { key: keys().service });
  for (const u of (listed.data.users || []).filter((x) => String(x.email).endsWith(`@${DOMAIN}`))) {
    await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: keys().service });
  }
}

const SEED = {
  slots: [{ box: 1, slot: 1, price: 20, lastGame: '1747' }, { box: 1, slot: 2, price: 20 }, { box: 1, slot: 3, price: 10, lastGame: '2222' },
    { box: 1, slot: 4, price: 5 }, { box: 2, slot: 1, price: 20 }, { box: 2, slot: 2, price: 20 }],
  games: [{ game: '1747', price: 20, size: 30 }, { game: '2222', price: 10, size: 50, inBack: 2 }, { game: '3333', price: 20, size: 30 }],
  packs: [
    { game: '1747', pack: '0000001', status: 'live', box: 1, slot: 2, price: 20, top: 5, activationTicket: 29, activatedOn: '2026-11-01', tookFromBack: true },
    { game: '1747', pack: '0000002', status: 'in_back' },
    { game: '3333', pack: '0000001', status: 'live', box: 2, slot: 1, price: 20, top: 10, activationTicket: 29, activatedOn: '2026-11-01', tookFromBack: true },
    { game: '3333', pack: '0000002', status: 'live', box: 2, slot: 2, price: 20, top: 20, activationTicket: 29, activatedOn: '2026-11-01', tookFromBack: true },
  ],
};

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const tap = async (page, sel) => { await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' })); await page.click(sel); };
const shown = (page, sel) => page.$eval(sel, (e) => !e.closest('.hidden') && e.offsetParent !== null);
const row = (key) => `.bulk-row[data-key="${key}"]`;
// Waits for the database's check of the latest list (the button stops saying Checking…).
const checked = (page) => page.waitForFunction(() => !/Checking/.test(document.getElementById('activateAllBtn').textContent), { timeout: 15000 });
async function enter(page, printed) {
  await page.$eval('#typed', (e) => { e.value = ''; });
  await page.type('#typed', printed);
  await tap(page, '#typedForm button');
  await sleep(50);
}

(async () => {
  await deleteTestUsers();
  const store = await service('test_create_store', { p_name: 'Bulk Test Store' });
  let app;
  try {
    const made = await http('POST', '/auth/v1/admin/users', { key: keys().service, body: { email: owner.email, password, email_confirm: true } });
    assert.ok(made.status < 300, JSON.stringify(made.data));
    await service('test_add_members', { p_store: store, users: [{ userId: made.data.id, username: owner.username, role: 'owner', permissions: [], email: owner.email }] });
    await service('test_seed', { p_store: store, data: SEED });

    app = await openApp({
      signedIn: false,
      configJs: `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'Bulk Test Store';\n`
        + `const BACKEND = 'supabase';\nconst SUPABASE_URL = '${URL}';\nconst SUPABASE_ANON_KEY = '${keys().anon}';\n`,
      handle: () => { throw new Error('the Apps Script backend was called'); },
    });
    const { page, base } = app;
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(base + 'login.html');
    await page.type('#username', owner.email);
    await page.type('#password', password);
    await page.click('#form button[type="submit"]');
    await page.waitForFunction(() => location.pathname.endsWith('index.html'), { timeout: 20000 });

    // Slots: the Activate Several row, at the top.
    await page.goto(base + 'slots.html');
    await page.waitForSelector('#list .card', { timeout: 15000 });
    assert.equal(await shown(page, '#bulkLink'), true);
    assert.match(await text(page, '#bulkLink'), /Activate Several ?Scan many packs/);
    await tap(page, '#bulkLink');
    await page.waitForFunction(() => !document.getElementById('scanView').classList.contains('hidden'), { timeout: 15000 });
    assert.equal(await shown(page, '#bulkBar'), false, 'no bar before a scan');

    // 1747: the empty slot it was last in first, then the slot where it's still live (asks what happened to that pack).
    await enter(page, '1747-0000002-4-029');
    await checked(page);
    assert.match(await text(page, `${row('1747-0000002')} .bulk-slot`), /Box 1 · Slot 1 ?\$20 Slot/);
    assert.match(await text(page, `${row('1747-0000002')} .tag`), /Ready/);
    assert.equal(await text(page, '#activateAllBtn'), 'Activate 1 Pack');
    await enter(page, '1747-0000003-4-029');
    await checked(page);
    assert.match(await text(page, `${row('1747-0000003')} .bulk-slot`), /Box 1 · Slot 2/);
    assert.match(await text(page, `${row('1747-0000003')} .bulk-end`), /Still has pack 1747-0000001 \(6 left\)/);
    assert.match(await text(page, `${row('1747-0000003')} .tag`), /Needs a Fix/);
    assert.equal(await text(page, '#activateAllBtn'), '1 Pack Needs a Fix');
    assert.equal(await page.$eval('#activateAllBtn', (b) => b.disabled), true);
    await tap(page, `${row('1747-0000003')} [data-end="sold_out"]`);
    await checked(page);
    assert.match(await text(page, `${row('1747-0000003')} .bulk-end`), /Sold out: 6 sold today \(\$120\)/);

    // The same pack again: refused, nothing added.
    await enter(page, '1747-0000002-4-029');
    assert.match(await text(page, '#message'), /Pack 1747-0000002 is already on the list/);
    assert.equal(await page.$$eval('.bulk-row', (r) => r.length), 2);

    // 3333 is live in two slots: one button each with its tickets left; pick 2-2, Returned, then its top ticket.
    await enter(page, '3333-0000009-4-029');
    await checked(page);
    assert.deepEqual(await page.$$eval(`${row('3333-0000009')} .bulk-choices button`, (bs) => bs.map((b) => b.textContent)),
      ['Box 2 · Slot 111 Left', 'Box 2 · Slot 221 Left']);
    await tap(page, `${row('3333-0000009')} .bulk-choices button:nth-child(2)`);
    await checked(page);
    await tap(page, `${row('3333-0000009')} [data-end="returned"]`);
    await checked(page);
    assert.match(await text(page, `${row('3333-0000009')} .bulk-end`), /Scan the top ticket still in pack 3333-0000002/);
    assert.match(await text(page, `${row('3333-0000009')} .tag`), /Needs a Fix/);
    await page.type(`${row('3333-0000009')} input[data-field="oldTop"]`, '015');
    await checked(page);
    assert.match(await text(page, `${row('3333-0000009')} .bulk-end`), /Returned with top ticket 015: 5 sold today \(\$100\), 16 going back/);
    assert.match(await text(page, `${row('3333-0000009')} .tag`), /Ready/);

    // 2222: the empty slot it was last in.
    await enter(page, '2222-0000005-4-049');
    await checked(page);
    assert.match(await text(page, `${row('2222-0000005')} .bulk-slot`), /Box 1 · Slot 3 ?\$10 Slot/);

    // A new game: no slot known, so Pick a Slot (slots on the list greyed), then its price, then the slot price.
    await enter(page, '9999-0000001-4-049');
    await checked(page);
    assert.match(await text(page, `${row('9999-0000001')} .bulk-slot`), /Pick a Slot/);
    await tap(page, `${row('9999-0000001')} .bulk-slot`);
    assert.equal(await page.$eval('#slotDialog', (e) => e.classList.contains('hidden')), false);
    assert.deepEqual(await page.$$eval('#pickGrid button', (bs) => bs.map((b) => [b.dataset.slot, b.disabled, b.querySelector('.s').textContent])),
      [['1', true, 'On List'], ['2', true, 'On List'], ['3', true, 'On List'], ['4', false, 'Empty']]);
    if (shots) await page.screenshot({ path: `${shots}/activate-several-picker.png` });
    await page.click('#pickGrid button[data-slot="4"]');
    await checked(page);
    assert.match(await text(page, row('9999-0000001')), /First time this game has been seen/);
    await page.type(`${row('9999-0000001')} input[data-field="gamePrice"]`, '10');
    await checked(page);
    assert.equal(await page.$eval(`${row('9999-0000001')} input[data-field="size"]`, (e) => e.value), '50', 'the usual size for $10');
    assert.match(await text(page, row('9999-0000001')), /Game 9999 is \$10, but this is a \$5 slot/);
    await tap(page, `${row('9999-0000001')} .bulk-fix`);
    await checked(page);
    assert.equal(await text(page, '#activateAllBtn'), 'Activate All 5 Packs');
    if (shots) await page.screenshot({ path: `${shots}/activate-several-list.png`, fullPage: true });

    // A reload keeps the list (this phone's draft), checked again.
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.bulk-row').length === 5, { timeout: 15000 });
    await checked(page);
    assert.equal(await text(page, '#activateAllBtn'), 'Activate All 5 Packs');

    // Remove one, then Activate All.
    await tap(page, `${row('2222-0000005')} .bulk-remove`);
    await checked(page);
    assert.equal(await text(page, '#activateAllBtn'), 'Activate All 4 Packs');
    await tap(page, '#activateAllBtn');
    await page.waitForFunction(() => !document.getElementById('doneView').classList.contains('hidden'), { timeout: 15000 });
    assert.equal(await text(page, '#doneTitle'), '4 Packs Activated');
    const done = await text(page, '#doneLines');
    assert.match(done, /Box 1 · Slot 2: 1747-0000003 ?Pack 1747-0000001 marked sold out \(6 sold today\)/);
    assert.match(done, /Box 2 · Slot 2: 3333-0000009 ?Pack 3333-0000002 marked returned \(5 sold today, 16 going back\)/);
    if (shots) await page.screenshot({ path: `${shots}/activate-several-done.png`, fullPage: true });
    // The database has them.
    const after = await page.evaluate(() => api('listSlots'));
    const live = (b, s) => { const x = after.find((y) => y.box === b && y.slot === s); return x.pack ? `${x.pack.gameNumber}-${x.pack.packNumber}` : null; };
    assert.deepEqual([live(1, 1), live(1, 2), live(1, 4), live(2, 2)], ['1747-0000002', '1747-0000003', '9999-0000001', '3333-0000009']);
    assert.equal(after.find((y) => y.box === 1 && y.slot === 4).slotPrice, 10);

    // Undo All: everything back as it was, the packs on the list again.
    await tap(page, '#undoAllBtn');
    await page.waitForFunction(() => !document.getElementById('scanView').classList.contains('hidden'), { timeout: 15000 });
    assert.match(await text(page, '#message'), /Undone/);
    assert.equal(await page.$$eval('.bulk-row', (r) => r.length), 4);
    const back = await page.evaluate(() => api('listSlots'));
    const at = (b, s) => back.find((y) => y.box === b && y.slot === s);
    assert.equal(at(1, 1).pack, null);
    assert.equal(`${at(1, 2).pack.gameNumber}-${at(1, 2).pack.packNumber}`, '1747-0000001');
    assert.equal(at(2, 2).pack.exposedTicket, 20);
    assert.equal(at(1, 4).pack, null);
    assert.equal(at(1, 4).slotPrice, 5);
    await checked(page);
    assert.equal(await text(page, '#activateAllBtn'), 'Activate All 4 Packs');

    // Clear List empties it (after a confirm).
    await tap(page, '#clearBtn');
    await sleep(200);
    assert.equal(await page.$$eval('.bulk-row', (r) => r.length), 0);
    assert.equal(await shown(page, '#bulkBar'), false);
    console.log('ACTIVATE SEVERAL CHECKS PASS (database)');
  } finally {
    if (app) await app.close();
    await service('test_drop_store', { p_store: store });
    await deleteTestUsers();
  }

  // On Sheets: no row on Slots, and the page says it comes with the database.
  const sheets = await openApp({ role: 'owner', handle: (b) => (b.action === 'listSlots' ? [] : {}) });
  try {
    await sheets.page.goto(sheets.base + 'slots.html'); await sleep(400);
    assert.equal(await sheets.page.$eval('#bulkGroup', (e) => e.classList.contains('hidden')), true);
    await sheets.page.goto(sheets.base + 'activate-several.html'); await sleep(300);
    assert.equal(await shown(sheets.page, '#notOnDatabase'), true);
    assert.equal(await sheets.page.$eval('#scanView', (e) => e.classList.contains('hidden')), true);
  } finally {
    await sheets.close();
  }
  console.log('ACTIVATE SEVERAL CHECKS PASS (sheets)');
})().catch((e) => { console.error(e); process.exit(1); });
