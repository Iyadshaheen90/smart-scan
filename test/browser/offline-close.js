// Close Day with no connection: the close is saved on the phone, resent until the server has it,
// never saved twice, and a refusal goes back to the scans. Run: node test/browser/offline-close.js
const assert = require('assert/strict');
const { openApp, ABORT, sleep } = require('./harness');

const TODAY = '2026-09-26';
const pack = (g, p, t) => ({ gameNumber: g, packNumber: p, exposedTicket: t, remaining: t + 1, price: 5 });
const slots = [{ box: 1, slot: 1, pack: pack('1747', '1263622', 40) }, { box: 1, slot: 2, pack: pack('1718', '1279742', 20) }];
let net = 'ok';        // 'ok', 'down' (no connection) or 'lose-answer' (saved, but the phone never hears back)
let refuse = null;     // an error code the server answers submitClose with
const saved = [];      // closes the fake server saved
let calls = 0;

function handle(body) {
  if (body.action === 'closeStatus') {
    if (net === 'down') return ABORT;
    const closed = saved.length ? { date: TODAY, ticketsSold: 7, liveSlots: 2 } : null;
    return { today: TODAY, largeSaleTickets: 50, closed, slots };
  }
  if (body.action === 'submitClose') {
    calls++;
    if (net === 'down') return ABORT;
    if (refuse) throw { code: refuse, message: 'Box 1, slot 1 now holds another pack. Reload Close Day.' };
    const dup = saved.find((s) => s.closeId === body.closeId);
    if (!dup) { assert.equal(saved.length, 0, 'a second, different close was saved'); saved.push(body); }
    if (net === 'lose-answer') return ABORT;
    return { date: TODAY, ticketsSold: 7, liveSlots: 2, ...(dup ? { alreadySent: true } : {}) };
  }
  return {};
}

(async () => {
  const app = await openApp({ role: 'employee', handle });
  const { page, base } = app;
  const visible = (id) => page.$eval('#' + id, (el) => !el.classList.contains('hidden'));
  const text = (id) => page.$eval('#' + id, (el) => el.textContent);
  async function scanBoth() {
    await page.goto(base + 'close.html'); await page.waitForSelector('#closeView:not(.hidden)');
    for (const t of ['1747-1263622-4-035', '1718-1279742-6-018']) { await page.type('#typed', t); await page.click('#typedForm button'); }
  }

  // 1. No connection at submit: saved, pending view, nothing reached the server.
  await scanBoth(); net = 'down';
  await page.click('#submitBtn'); await sleep(300);
  assert.ok(await visible('pendingView')); assert.ok(!(await visible('closeView')));
  console.log('pending view:', await text('pendingInfo')); console.log('  message:', await text('pendingMessage'));
  assert.equal(saved.length, 0);
  // Reload while offline: still pending (and closeStatus isn't needed).
  await page.reload(); await sleep(300);
  assert.ok(await visible('pendingView'));
  // 2. Connection back but the answer is lost: server saves it, phone still waits.
  net = 'lose-answer'; await page.click('#retryBtn'); await sleep(300);
  assert.equal(saved.length, 1); assert.ok(await visible('pendingView'));
  // 3. Next try gets through: same closeId, server returns the saved close, nothing duplicated.
  net = 'ok'; await page.click('#retryBtn'); await sleep(300);
  assert.equal(saved.length, 1); assert.ok(await visible('closedView'));
  console.log('closed view:', await text('summary'));
  assert.equal(await page.evaluate(() => localStorage.getItem('smartScanPendingClose')), null);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('smartScanCloseDraft')).length), 0);
  assert.equal(saved[0].date, TODAY); assert.equal(saved[0].entries.length, 2); assert.equal(saved[0].entries[0].ticketNumber, 35);

  // 4. Home page sends a saved close by itself when opened online.
  saved.length = 0; await scanBoth(); net = 'down'; await page.click('#submitBtn'); await sleep(300);
  await page.goto(base + 'index.html'); await sleep(300);
  console.log('home offline:', await text('pendingClose'));
  net = 'ok'; await page.reload(); await sleep(400);
  console.log('home online:', await text('pendingClose')); assert.equal(saved.length, 1);

  // 5. Server refuses (slot changed): saved close dropped, back to scanning with the reason, draft kept.
  saved.length = 0; await scanBoth(); refuse = 'slots_changed';
  await page.click('#submitBtn'); await page.waitForSelector('#closeView:not(.hidden)'); await sleep(200);
  console.log('refused:', await text('flash'));
  assert.match(await text('flash'), /wasn't saved/); assert.equal(await page.evaluate(() => localStorage.getItem('smartScanPendingClose')), null);
  assert.match(await text('progressText'), /2 of 2/);
  // 6. Stop sending: back to the scans.
  refuse = null; net = 'down'; await page.click('#submitBtn'); await sleep(300); assert.ok(await visible('pendingView'));
  net = 'ok'; await page.click('#cancelPendingBtn'); await page.waitForSelector('#closeView:not(.hidden)');
  assert.match(await text('progressText'), /2 of 2/); assert.equal(saved.length, 0);
  console.log('ALL OFFLINE CLOSE CHECKS PASS; submit calls:', calls);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
