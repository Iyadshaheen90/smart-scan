// Employee permissions (owner's request 2026-10-08): the owner turns on, per employee, Load packs, Return
// packs, Receive shipments, Manage Stock and Full pack sale on Manage employees. An employee then gets
// just those (home links, tappable slots, the slot page's matching buttons, Back stock's matching modes)
// and never sees dollar amounts. Without any, nothing changes for them.
// Run: node test/browser/permissions.js   (SHOTS=dir also saves screenshots)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const ALL = ['load_packs', 'return_packs', 'receive_shipments', 'count_stock', 'full_pack_sale', 'ticket_order'];
const slot = { box: 1, slot: 7, slotPrice: 5, endedToday: null, lastGame: null,
  pack: { gameNumber: '1747', packNumber: '1263622', price: 5, exposedTicket: 75, remaining: 76,
    activationDate: '2026-09-20', lastCloseDate: '2026-09-30', daysActive: 11, packsInBack: 2, ticketsPerPack: 150, standardPackSize: 150 } };
const emptySlot = { box: 1, slot: 8, slotPrice: 10, pack: null, lastGame: null,
  endedToday: { packKey: '2222-0000001', reason: 'sold_out' } };
const stock = [{ gameNumber: '1747', price: 5, ticketsPerPack: 150, standardPackSize: 150, packsInBack: 2, ticketsInBack: 300,
  endedDate: null, liveSlots: 1, liveIn: [{ box: 1, slot: 7 }] }];
const status = (permissions) => ({ today: '2026-10-08', largeSaleTickets: 100, closed: null, myShiftToday: null, slots: [slot], permissions });

const visible = (page, sel) => page.$eval(sel, (el) => !el.classList.contains('hidden') && el.offsetParent !== null);
const text = (page, sel) => page.$eval(sel, (el) => el.textContent);
const noDollars = async (page, where) => {
  const body = await page.evaluate(() => document.body.innerText);
  assert.ok(!/\$\d/.test(body.replace(/\$\d+ [Ss]lot/g, '').replace(/Game \d+ · \$\d+/g, '')), `${where}: no dollar amounts\n${body}`);
};

async function manageEmployees() {
  let users = [
    { username: 'o', role: 'owner', active: true, permissions: ALL },
    { username: 'sara', role: 'employee', active: true, permissions: [] },
    { username: 'old', role: 'employee', active: false, permissions: [] },
  ];
  const sent = [];
  const app = await openApp({ role: 'owner', handle: (b) => {
    if (b.action === 'listUsers') return users;
    if (b.action === 'setUserPermissions') {
      sent.push(b.permissions);
      users = users.map((u) => (u.username === b.username ? { ...u, permissions: b.permissions } : u));
      return users;
    }
    return {};
  } });
  const { page } = app;
  await page.goto(app.base + 'users.html');
  await page.waitForSelector('input.toggle');
  // Six switches per employee (owner has none); an inactive employee's are off and locked.
  const cards = await page.$$eval('#list .card', (els) => els.map((c) => ({
    name: c.querySelector('strong').textContent,
    toggles: [...c.querySelectorAll('input.toggle')].map((i) => ({ on: i.checked, locked: i.disabled })),
  })));
  assert.equal(cards[0].toggles.length, 0, 'owner has no switches');
  assert.deepEqual(cards[1].toggles.map((t) => t.on), [false, false, false, false, false, false]);
  assert.ok(cards[2].toggles.every((t) => t.locked), 'inactive employee: locked');

  // The switches start folded under "Permissions · None on"; tapping the row opens them (and they stay open
  // through each save, which redraws the list).
  const folded = () => page.$$eval('#list details.perm-details', (ds) => ds.map((d) => [d.open, d.querySelector('summary').textContent]));
  assert.deepEqual(await folded(), [[false, 'PermissionsNone On'], [false, 'PermissionsNone On']]);
  assert.ok(await page.$eval('#list .card:nth-child(2) details.perm-details', (d) => d.getBoundingClientRect().height < 70), 'folded: just the Permissions row');
  await page.click('#list .card:nth-child(2) details.perm-details summary'); await sleep(100);

  // Turn on Load packs, then Full pack sale: each saves the whole list at once.
  const toggle = async (i) => {
    const sw = await page.$$('#list .card:nth-child(2) input.toggle');
    await sw[i].click(); await sleep(150);
  };
  await toggle(0);
  await toggle(4);
  assert.deepEqual(sent, [['load_packs'], ['load_packs', 'full_pack_sale']]);
  assert.deepEqual(await folded(), [[true, 'Permissions2 of 6 On'], [false, 'PermissionsNone On']], 'still open after saving, count updated');
  assert.match(await text(page, '#listMessage'), /sara: Full Pack Sale turned on/);
  // Tapping the words also flips the switch (the row is its label).
  await page.click('#list .card:nth-child(2) .perm-row:nth-of-type(2) strong'); await sleep(150);
  assert.deepEqual(sent.at(-1), ['load_packs', 'return_packs', 'full_pack_sale']);
  // Turn all on / off.
  let all = await page.$('#list .card:nth-child(2) .perm-all');
  assert.equal(await page.evaluate((b) => b.textContent, all), 'Turn All On');
  await all.click(); await sleep(150);
  assert.deepEqual(sent.at(-1), ALL);
  const states = await page.$$eval('#list .card:nth-child(2) input.toggle', (els) => els.map((i) => i.checked));
  assert.deepEqual(states, [true, true, true, true, true, true]);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/permissions-users.png`, fullPage: true });
  all = await page.$('#list .card:nth-child(2) .perm-all');
  assert.equal(await page.evaluate((b) => b.textContent, all), 'Turn All Off');
  await all.click(); await sleep(150);
  assert.deepEqual(sent.at(-1), []);
  await app.close();
}

async function employeeHome() {
  // Signed in with none; the owner turned some on since: home picks them up from closeStatus.
  let perms = ['load_packs', 'receive_shipments'];
  const app = await openApp({ role: 'employee', permissions: [], handle: (b) => (b.action === 'closeStatus' ? status(perms) : {}) });
  const { page } = app;
  await page.goto(app.base + 'index.html');
  await page.waitForFunction(() => !document.getElementById('extraActions').classList.contains('hidden'));
  assert.equal(await text(page, '#loadPacksText'), 'Load Packs');
  const links = await page.$$eval('#extraActions a:not(.hidden)', (els) => els.map((a) => a.getAttribute('href')));
  assert.deepEqual(links, ['slots.html', 'backstock.html?mode=shipment']);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession')).permissions), perms);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/permissions-home.png`, fullPage: true });
  // Turned off again: the links go.
  perms = [];
  await page.reload();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('smartScanSession')).permissions.length === 0);
  await sleep(100);
  assert.equal(await visible(page, '#extraActions'), false);
  await app.close();
}

async function slotsPage() {
  for (const [permissions, tappable] of [[[], false], [['receive_shipments'], false], [['return_packs'], true]]) {
    const app = await openApp({ role: 'employee', permissions, handle: (b) => (b.action === 'listSlots' ? [slot] : {}) });
    await app.page.goto(app.base + 'slots.html');
    await app.page.waitForSelector('#list .card');
    assert.equal(await app.page.$eval('#list .card', (c) => c.tagName === 'A'), tappable, `slots with ${permissions}`);
    await app.close();
  }
  // No permission to open a slot: the slot page sends them home.
  const app = await openApp({ role: 'employee', permissions: ['count_stock'], handle: () => [] });
  await app.page.goto(app.base + 'activate.html?box=1&slot=7');
  await app.page.waitForFunction(() => location.pathname.endsWith('index.html'));
  await app.close();
}

async function slotPage() {
  // Load packs only: Sold out (no $), replace; no Returned; the owner's forms stay hidden.
  const saves = [];
  let app = await openApp({ role: 'employee', permissions: ['load_packs'], handle: (b) => {
    if (b.action === 'listSlots') return [slot, emptySlot];
    saves.push(b);
    if (b.action === 'activatePack' && !b.gamePrice) { const e = new Error('Game 9999 is new. Enter its ticket price and how many tickets are in a pack.'); e.code = 'unknown_game'; throw e; }
    return { box: 1, slot: 7, packKey: '9999-0000001', packsInBack: 0, backWasEmpty: true,
      oldPack: { packKey: '1747-1263622', reason: 'sold_out', ticketsSoldToday: 76, remainingReturned: 0 } };
  } });
  let { page } = app;
  await page.goto(app.base + 'activate.html?box=1&slot=7');
  await page.waitForFunction(() => !document.getElementById('oldStep').classList.contains('hidden'));
  assert.ok(await visible(page, '#soldOutBtn'));
  assert.equal(await visible(page, '#returnedBtn'), false);
  for (const id of ['priceForm', 'sizeForm', 'swapForm']) assert.equal(await visible(page, '#' + id), false, id);
  await page.click('#soldOutBtn'); await sleep(100);
  assert.equal(await text(page, '#nextPrompt'), 'Pack 1747-1263622 sold out: 76 sold today. Put a new pack in now?');
  await page.click('#replaceBtn'); await sleep(100);
  await page.type('#typed', '9999-0000001-4-029'); await page.click('#typedForm button'); await sleep(200);
  // A new game: they enter its price, like the owner.
  await page.click('#activateBtn'); await sleep(200);
  assert.ok(await visible(page, '#newGame'), 'new game fields for a Load Packs employee');
  await page.type('#gamePrice', '5'); await page.$eval('#ticketsPerPack', (el) => { el.value = '30'; });
  await page.click('#activateBtn'); await sleep(200);
  assert.equal(saves.at(-1).gamePrice, '5'); assert.equal(saves.at(-1).oldPackEnd, 'sold_out');
  await noDollars(page, 'slot page (load)');
  // Put back a pack marked sold out today.
  await page.goto(app.base + 'activate.html?box=1&slot=8');
  await page.waitForFunction(() => !document.getElementById('undoEndBtn').classList.contains('hidden'));
  await app.close();

  // Return packs only: Returned, then only Mark out of stock; empty slot: nothing to do.
  app = await openApp({ role: 'employee', permissions: ['return_packs'], handle: (b) => (b.action === 'listSlots' ? [slot, emptySlot] : {}) });
  page = app.page;
  await page.goto(app.base + 'activate.html?box=1&slot=7');
  await page.waitForFunction(() => !document.getElementById('oldStep').classList.contains('hidden'));
  assert.equal(await visible(page, '#soldOutBtn'), false);
  assert.ok(await visible(page, '#returnedBtn'));
  assert.equal(await visible(page, '#undoBtn'), false, 'undo a wrong slot needs Load Packs');
  await page.click('#returnedBtn'); await sleep(100);
  await page.type('#typed', '1747-1263622-4-045'); await page.click('#typedForm button'); await sleep(200);
  assert.equal(await text(page, '#nextPrompt'), 'Pack 1747-1263622 returned with top ticket 045: 30 sold today, 46 going back.');
  assert.equal(await visible(page, '#replaceBtn'), false);
  assert.ok(await visible(page, '#leaveEmptyBtn'));
  await noDollars(page, 'slot page (return)');
  await page.goto(app.base + 'activate.html?box=1&slot=8');
  await page.waitForFunction(() => document.getElementById('message').textContent.length > 0);
  assert.equal(await visible(page, '#undoEndBtn'), false, 'a sold out pack is put back with Load Packs only');
  assert.equal(await visible(page, '#scanStep'), false);
  assert.match(await text(page, '#message'), /hasn't turned on loading packs/);
  await app.close();
}

async function backStock() {
  // Receive shipments only: just the shipment scanner (no search, list, mode switch or $).
  const saves = [];
  let app = await openApp({ role: 'employee', permissions: ['receive_shipments'], handle: (b) => {
    if (b.action === 'listBackStock') return stock;
    saves.push(b);
    return { results: [{ gameNumber: '1747', before: 2, after: 3 }], backStock: stock };
  } });
  let { page } = app;
  await page.goto(app.base + 'backstock.html?mode=count');
  await page.waitForFunction(() => !document.body.classList.contains('showing-saved') && document.getElementById('modeHint').textContent);
  await sleep(200);
  for (const sel of ['#searchSection', '#stockSection', '#modeSwitch']) assert.equal(await visible(page, sel), false, sel);
  assert.match(await text(page, '#modeHint'), /delivery/, 'a mode they lack falls back to theirs');
  await page.type('#typed', '1747'); await page.click('#typedForm button');
  await page.waitForFunction(() => !document.getElementById('shipDialog').classList.contains('hidden'));
  await page.click('#shipSave'); await sleep(200);
  assert.equal(saves[0].mode, 'shipment');
  await noDollars(page, 'back stock (shipments)');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/permissions-backstock.png`, fullPage: true });
  await app.close();

  // Manage Stock + Full pack sale: both modes; the sale pop-up shows tickets, not $.
  app = await openApp({ role: 'employee', permissions: ['count_stock', 'full_pack_sale'], handle: (b) => {
    if (b.action === 'listBackStock') return stock;
    return { packKey: '1747-1263699', gameNumber: '1747', before: 2, after: 1, backStock: stock };
  } });
  page = app.page;
  await page.goto(app.base + 'backstock.html?mode=fullpack');
  await page.waitForFunction(() => !document.body.classList.contains('showing-saved') && document.getElementById('modeHint').textContent);
  await sleep(200);
  const modes = await page.$$eval('#modeSwitch button', (els) => els.filter((b) => !b.classList.contains('hidden')).map((b) => b.dataset.mode));
  assert.deepEqual(modes, ['count', 'fullpack']);
  await page.type('#typed', '1747-1263699-4-149'); await page.click('#typedForm button');
  await page.waitForFunction(() => !document.getElementById('sellDialog').classList.contains('hidden'));
  assert.equal(await text(page, '#sellValue'), '150 tickets');
  await noDollars(page, 'sell pop-up');
  await page.click('#sellSave'); await sleep(200);
  assert.match(await text(page, '#flash'), /^Sold full pack 1747-1263699\. Game 1747: 2 → 1/);
  await app.close();

  // None of the three: Back stock sends them home.
  app = await openApp({ role: 'employee', permissions: ['load_packs'], handle: () => [] });
  await app.page.goto(app.base + 'backstock.html');
  await app.page.waitForFunction(() => location.pathname.endsWith('index.html'));
  await app.close();
}

(async () => {
  await manageEmployees();
  await employeeHome();
  await slotsPage();
  await slotPage();
  await backStock();
  console.log('permissions: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
