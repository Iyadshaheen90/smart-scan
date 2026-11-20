// Subscriptions step 2, the pages (database backend, faked): Plans (owner only; Monthly / Yearly, current plan, the
// trial line, comp, Choose not open yet), More → Subscription (each state's words), the More row, the Home banner
// (owner and employee), the Upgrade to Pro / Subscription Ended pop-up (owner: See Plans; employee: ask the owner;
// the page's own message stays empty), and nothing at all without a plan (Sheets, or the database before 0033).
// The database's rules: supabase/tests/subscriptions_test.sql.
// Run: node test/browser/plans-pages.js   (add a folder path to also save phone-size screenshots there)
const assert = require('assert/strict');
const path = require('path');
const { openApp, sleep } = require('./harness');

const DB = 'https://fake-db.smartscan.test';
const SHOTS = process.argv[2];
const CONFIG = `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'Not This Name';\n`
  + `const BACKEND = 'supabase';\nconst SIGN_UP_OPEN = false;\nconst SUPABASE_URL = '${DB}';\nconst SUPABASE_ANON_KEY = 'anon';\n`;
const STORE = 'aaaaaaaa-0000-4000-8000-000000000001';
const soon = (days) => { const d = new Date(Date.now() + days * 86400000); return d.toISOString().slice(0, 10); };
const SUBS = {
  comp: { access: 'pro', status: 'comp', plan: null, trialEndsOn: null, renewsOn: null, willRenew: false, source: 'comp', canBuy: true },
  basic: { access: 'basic', status: 'active', plan: 'basic', trialEndsOn: null, renewsOn: soon(20), willRenew: true, source: 'stripe', canBuy: true },
  ending: { access: 'pro', status: 'active', plan: 'pro', trialEndsOn: null, renewsOn: soon(9), willRenew: false, source: 'app_store', canBuy: true },
  trial: { access: 'pro', status: 'trialing', plan: 'basic', trialEndsOn: soon(2), renewsOn: null, willRenew: true, source: 'play_store', canBuy: true },
  problem: { access: 'pro', status: 'billing_issue', plan: 'pro', trialEndsOn: null, renewsOn: soon(-1), willRenew: true, source: 'stripe', canBuy: true },
  ended: { access: 'read_only', status: 'expired', plan: 'pro', trialEndsOn: null, renewsOn: soon(-5), willRenew: false, source: 'stripe', canBuy: true },
  none: { access: 'read_only', status: 'none', plan: null, trialEndsOn: null, renewsOn: null, willRenew: false, source: null, canBuy: true },
};
const session = (role, subscription) => ({ backend: 'supabase', accessToken: 'a', refreshToken: 'r', accessExpiresAt: Date.now() + 3600000,
  email: `${role}@example.test`, storeId: STORE, storeName: 'Corner Market', storeNumber: 10021, timeZone: 'America/Los_Angeles',
  dayEndHour: 0, username: role === 'owner' ? 'boss' : 'sam', role, permissions: [], storeCount: 1, subscription,
  expiresAt: new Date(Date.now() + 3600000).toISOString() });

const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
const shown = (page, sel) => page.$eval(sel, (e) => !e.closest('.hidden') && e.getClientRects().length > 0).catch(() => false);

(async () => {
  let current = SUBS.basic;
  let refuse = null;   // { hint, message } for the next rpc
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  const app = await openApp({ signedIn: false, configJs: CONFIG,
    handle: () => { throw new Error('the Apps Script backend was called'); },
    intercept: async (req) => {
      if (!req.url().startsWith(DB)) return false;
      if (req.method() === 'OPTIONS') { await req.respond({ status: 204, headers: cors }); return true; }
      const url = req.url().slice(DB.length);
      const send = (status, data) => req.respond({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(data) });
      if (refuse && url.startsWith('/rest/v1/rpc/')) { const r = refuse; refuse = null; await send(400, r); return true; }
      const fn = url.slice('/rest/v1/rpc/'.length);
      if (fn === 'me') await send(200, { username: 'boss', role: 'owner', permissions: [], storeName: 'Corner Market', subscription: current });
      else if (fn === 'owner_home' || fn === 'close_status') await send(200, { subscription: current, today: soon(0) });
      else if (fn === 'my_stores') await send(200, []);
      else await send(200, {});
      return true;
    } });
  const { page, base } = app;
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
  const as = async (role, sub, url) => {
    current = sub;
    await page.goto(base + 'login.html');
    await page.evaluate((s) => localStorage.setItem('smartScanSession', JSON.stringify(s)), session(role, sub));
    await page.goto(base + url);
    await sleep(400);
  };
  try {
    // ---- Plans: Basic now; Monthly / Yearly; Choose isn't open yet ----
    await as('owner', SUBS.basic, 'plans.html');
    assert.equal(await shown(page, '#plansPage'), true);
    const cards = await page.$$eval('.plan-card', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    assert.match(cards[0], /^Basic Current \$19\.99 \/ month or \$199\.99 \/ year/);
    assert.match(cards[1], /^Pro \$24\.99 \/ month .*Everything in Basic.*Unlimited shift closes.*Up to 10 employees.*Settling.*Theft Report.*Ready to Restock.*Choose Pro/);
    assert.equal(await page.$eval('[data-plan="basic"]', (b) => b.disabled), true, 'your own plan can\'t be chosen');
    assert.equal(await shown(page, '#trialLine'), false);
    await shot('plans-monthly');
    await page.click('[data-period="year"]');
    assert.match(await text(page, '.plan-card.pro'), /\$249\.99 \/ year Save \$49\.89 a year/);
    await page.click('[data-plan="pro"]');
    assert.equal(await text(page, '#buyMessage'), 'Buying isn\'t open yet.');
    await shot('plans-yearly');
    // A store that never had a plan sees the trial line; comp sees no buttons.
    await as('owner', SUBS.none, 'plans.html');
    assert.equal(await shown(page, '#trialLine'), true);
    await as('owner', SUBS.comp, 'plans.html');
    assert.equal(await shown(page, '#compLine'), true);
    assert.equal((await page.$$('[data-plan]')).length, 0);
    // Employees: no prices.
    await as('employee', SUBS.basic, 'plans.html');
    assert.equal(await shown(page, '#plansPage'), false);
    assert.equal(await text(page, '#message'), 'Only the owner can see plans.');
    assert.equal(await page.evaluate(() => document.body.innerText.includes('$')), false, 'no dollar sign for an employee');

    // ---- More → Subscription: each state ----
    const states = [
      ['basic', 'Basic', 'Active', `Renews ${''}`], ['ending', 'Pro', 'Ending', 'Ends '], ['trial', 'Basic', 'Free Trial', 'Free trial ends '],
      ['problem', 'Pro', 'Payment Problem', 'Update your payment to keep your plan.'], ['ended', 'Pro', 'Ended', 'Saving is off.'],
      ['comp', 'Pro', 'Free', 'Free for this store, with every Pro feature.'],
    ];
    for (const [key, name, chip, line] of states) {
      await as('owner', SUBS[key], 'subscription.html');
      assert.equal(await text(page, '#planName'), name, key);
      assert.equal(await text(page, '#planChip'), chip, key);
      assert.ok((await text(page, '#planLine')).startsWith(line.trim()), `${key}: ${await text(page, '#planLine')}`);
      assert.equal(await shown(page, '#changePlan'), key !== 'comp', key);
      if (key === 'ended') assert.equal(await text(page, '#changePlan'), 'See Plans');
      if (key === 'trial' || key === 'ended') await shot(`subscription-${key}`);
    }

    // ---- More: the row, owner only, once there's a plan ----
    await as('owner', SUBS.trial, 'more.html');
    assert.equal(await shown(page, '#subRow'), true);
    assert.equal(await text(page, '#subSub'), 'Basic · Free Trial');
    await as('employee', SUBS.trial, 'more.html');
    assert.equal(await shown(page, '#subRow'), false);
    await as('owner', null, 'more.html');
    assert.equal(await shown(page, '#subRow'), false, 'no plan in the session: no row');

    // ---- Home banner ----
    await as('owner', SUBS.trial, 'index.html');
    assert.equal(await text(page, '#planBanner'), `Free trial ends ${await page.evaluate((d) => planDay(d), SUBS.trial.trialEndsOn)}. Plans`);
    await shot('home-trial-banner');
    await as('owner', SUBS.ended, 'index.html');
    assert.equal(await text(page, '#planBanner'), 'Your subscription has ended. Saving is off. See Plans');
    await as('employee', SUBS.ended, 'index.html');
    assert.equal(await text(page, '#planBanner'), 'Your store\'s subscription has ended. Ask the owner.');
    await as('employee', SUBS.problem, 'index.html');
    assert.equal(await shown(page, '#planBanner'), false, 'an employee doesn\'t see payment problems');
    await as('owner', SUBS.basic, 'index.html');
    assert.equal(await shown(page, '#planBanner'), false, 'nothing to say');

    // ---- The pop-up: owner, then employee ----
    await as('owner', SUBS.basic, 'more.html');
    refuse = { hint: 'needs_pro', message: 'Theft Report comes with Pro.' };
    const message = await page.evaluate(() => api('theftReport').then(() => 'ok', (e) => e.message));
    assert.equal(message, '', 'the page\'s own message stays empty');
    assert.equal(await text(page, '#planPopup .dialog-title'), 'Upgrade to Pro');
    assert.equal(await text(page, '#planPopup .plan-why'), 'Theft Report comes with Pro.');
    assert.equal(await page.$$eval('#planPopup .plan-list li', (l) => l.length), 5);
    await shot('popup-owner');
    await Promise.all([page.waitForNavigation(), page.click('#planPopup [data-plans]')]);
    assert.ok(page.url().endsWith('plans.html'));
    await as('employee', SUBS.ended, 'more.html');
    refuse = { hint: 'subscription_ended', message: 'Your store\'s subscription has ended. Ask the owner.' };
    await page.evaluate(() => api('submitShiftClose', { entries: [] }).catch(() => {}));
    assert.equal(await text(page, '#planPopup .dialog-title'), 'Subscription Ended');
    assert.equal((await page.$$('#planPopup [data-plans]')).length, 0, 'an employee gets no See Plans');
    await page.click('#planPopup [data-close]');
    assert.equal(await page.$('#planPopup'), null);

    console.log('plans pages: Plans, Subscription states, More row, Home banner, pop-up for owner and employee, nothing without a plan');
  } finally {
    await app.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
