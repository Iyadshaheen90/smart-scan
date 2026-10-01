// Slot page, Sold out / Returned (owner, 2026-10-01): before anything is saved the screen shows what
// ending the pack counts as today ("30 sold today ($150), 46 going back"), and a Cancel button goes back
// to "What happened to it?" from every step after Sold out or Returned, with nothing sent to the backend.
// Run: node test/browser/slot-end-cancel.js   (SHOTS=dir also saves screenshots)
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const slot = { box: 1, slot: 7, slotPrice: 5, endedToday: null, lastGame: null,
  pack: { gameNumber: '1747', packNumber: '1263622', price: 5, exposedTicket: 75, remaining: 76,
    activationDate: '2026-09-20', lastCloseDate: '2026-09-30', daysActive: 11, packsInBack: 2, ticketsPerPack: 150, standardPackSize: 150 } };

(async () => {
  const saves = [];
  const app = await openApp({ role: 'owner', handle: (b) => {
    if (b.action === 'listSlots') return [slot];
    saves.push(b.action);
    return {};
  } });
  const { page } = app;
  const visible = (id) => page.$eval('#' + id, (el) => !el.classList.contains('hidden'));
  const text = (id) => page.$eval('#' + id, (el) => el.textContent);
  const typed = async (t) => { await page.type('#typed', t); await page.click('#typedForm button'); await sleep(150); };
  const cancel = async () => {
    await page.click('#cancelEndBtn'); await sleep(100);
    assert.ok(await visible('oldStep'), 'back at What happened to it?');
    for (const id of ['nextStep', 'scanStep', 'confirmStep', 'cancelEndBtn']) assert.equal(await visible(id), false, id);
  };

  await page.goto(app.base + 'activate.html?box=1&slot=7');
  await page.waitForFunction(() => !document.getElementById('oldStep').classList.contains('hidden'));
  assert.equal(await visible('cancelEndBtn'), false, 'no Cancel before a choice');

  // Sold out: all 76 left count as sold today. Cancel goes back.
  await page.click('#soldOutBtn'); await sleep(100);
  assert.equal(await text('nextPrompt'), 'Pack 1747-1263622 sold out: 76 sold today ($380). Put a new pack in now?');
  assert.ok(await visible('cancelEndBtn'));
  await cancel();

  // Returned: Cancel while waiting for the top ticket.
  await page.click('#returnedBtn'); await sleep(100);
  assert.ok(await visible('scanStep')); assert.ok(await visible('cancelEndBtn'));
  await cancel();

  // Returned with top ticket 045: 30 sold ($150), 46 going back. Then Cancel from the replacement scan
  // and from the new-pack confirm step.
  await page.click('#returnedBtn'); await sleep(100);
  await typed('1747-1263622-4-045');
  assert.equal(await text('nextPrompt'),
    'Pack 1747-1263622 returned with top ticket 045: 30 sold today ($150), 46 going back. Put a new pack in now?');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/slot-returned.png`, fullPage: true });
  await page.click('#replaceBtn'); await sleep(100);
  assert.ok(await visible('scanStep')); assert.ok(await visible('cancelEndBtn'));
  await page.$eval('#typed', (el) => { el.value = ''; });
  await typed('1747-1263623-4-149');
  assert.ok(await visible('confirmStep')); assert.ok(await visible('cancelEndBtn'));
  await cancel();

  // After Cancel, Returned asks for the top ticket again (the old scan is forgotten).
  await page.click('#returnedBtn'); await sleep(100);
  assert.equal(await text('scanPrompt'), 'Scan the returned pack');
  assert.deepEqual(saves, [], 'nothing was saved');

  // Saving still works and hides Cancel.
  await page.$eval('#typed', (el) => { el.value = ''; });
  await typed('1747-1263622-4-045');
  await page.click('#leaveEmptyBtn'); await sleep(200);
  assert.deepEqual(saves, ['endPack']);
  assert.equal(await visible('cancelEndBtn'), false);

  console.log('slot-end-cancel: all checks passed');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
