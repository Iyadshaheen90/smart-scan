// The camera comes back by itself (owner's bug 2026-09-29: after "Clear all scans" the picture froze). iOS pauses
// the camera video while a confirm pop-up is open and never restarts it; here the test pauses it the same way, and
// also shuts the camera off, and the scanner must bring it back. Once the day is closed the camera stays off.
// Run: node test/browser/camera-revive.js
const assert = require('assert/strict');
const { openApp, sleep } = require('./harness');

const pack = (g, p, t) => ({ gameNumber: g, packNumber: p, exposedTicket: t, remaining: t + 1, price: 5 });
const slots = [{ box: 1, slot: 1, pack: pack('1747', '1263622', 40) }, { box: 1, slot: 2, pack: pack('1718', '1279742', 20) }];
let closed = null;
const handle = (b) => {
  if (b.action === 'closeStatus') return { today: '2026-09-29', largeSaleTickets: 50, closed, slots };
  if (b.action === 'submitClose') { closed = { date: '2026-09-29', ticketsSold: 7, liveSlots: 2 }; return closed; }
  return {};
};

(async () => {
  const app = await openApp({ role: 'employee', handle });
  const { page, base } = app;
  const camera = () => page.$eval('#video', (v) => ({
    playing: !v.paused, live: !!v.srcObject && v.srcObject.getVideoTracks().some((t) => t.readyState === 'live') }));
  const waitPlaying = () => page.waitForFunction(() => {
    const v = document.getElementById('video');
    return !v.paused && v.srcObject && v.srcObject.getVideoTracks().some((t) => t.readyState === 'live');
  }, { timeout: 5000 });

  await page.goto(base + 'close.html');
  await page.waitForSelector('#closeView:not(.hidden)');
  await waitPlaying();

  // Scan, then Clear all scans (confirm accepted by the harness) while iOS pauses the video.
  await page.type('#typed', '1747-1263622-4-035'); await page.click('#typedForm button');
  await page.$eval('#video', (v) => v.pause());
  await page.$eval('#clearBtn', (b) => b.click()); await sleep(100);
  assert.equal(await page.$eval('#flash', (e) => e.textContent), 'All scans cleared. Start again from the first slot.');
  await waitPlaying();
  console.log('after Clear all + pause:', JSON.stringify(await camera()));

  // The camera shut off completely (as iOS can do in the background): it's opened again.
  await page.$eval('#video', (v) => v.srcObject.getTracks().forEach((t) => t.stop()));
  assert.equal((await camera()).live, false);
  await waitPlaying();
  console.log('after camera shut off:', JSON.stringify(await camera()));

  // Scanning still works after it came back.
  await page.type('#typed', '1747-1263622-4-035'); await page.click('#typedForm button');
  await page.type('#typed', '1718-1279742-6-018'); await page.click('#typedForm button');
  assert.match(await page.$eval('#progressText', (e) => e.textContent), /2 of 2/);

  // Submitted: the day is closed and the camera is turned off for good, not reopened.
  await page.$eval('#submitBtn', (b) => b.click());
  await page.waitForSelector('#closedView:not(.hidden)');
  await sleep(2500);
  assert.equal((await camera()).live, false, 'camera stays off once the day is closed');

  console.log('CAMERA REVIVE CHECKS PASS');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
