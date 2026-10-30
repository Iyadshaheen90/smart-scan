// Sign-in on the database backend, against a throwaway test store on the dev project (smart-scan-dev): the pages run with
// BACKEND 'supabase' and talk to the real database, Supabase Auth and the members Edge Function.
// Sign in by email (wrong password, Forgot Password), the owner invites an employee by email (a test store hands the invite
// link back instead of emailing it) and sends it again (the old link stops working), the employee opens the link and
// chooses a password, changes it, signs out and in; Resend Invite is refused once the owner set someone's password;
// the owner sees them signed in, sets their password, turns them off (signed out on their next page, can't sign in);
// an access token that ran out is renewed by itself, and a session the server no longer takes goes to Sign In.
// Run: node test/browser/db-sign-in.js   (needs the Supabase CLI signed in, like test/parity)
const assert = require('assert/strict');
const crypto = require('crypto');
const { openApp, sleep } = require('./harness');
const { keys, http, service, URL } = require('../parity/harness');

const DOMAIN = 'signin.smartscan.test';
const tag = crypto.randomBytes(3).toString('hex');
const ownerEmail = `owner-${tag}@${DOMAIN}`;
const newbieEmail = `newbie-${tag}@${DOMAIN}`;
const laterEmail = `later-${tag}@${DOMAIN}`;
const ownerPassword = `${crypto.randomBytes(12).toString('base64url')}Aa1!`; // the password rule: capital, lowercase, number, sign

async function deleteTestUsers() {
  const listed = await http('GET', '/auth/v1/admin/users?per_page=200', { key: keys().service });
  for (const u of (listed.data.users || []).filter((x) => String(x.email).endsWith(`@${DOMAIN}`))) {
    await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: keys().service });
  }
}

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const visible = (page, sel) => page.$eval(sel, (e) => !e.closest('.hidden') && e.offsetParent !== null);

(async () => {
  await deleteTestUsers();
  const store = await service('test_create_store', { p_name: 'Sign-in Test Store' });
  let app;
  try {
    const made = await http('POST', '/auth/v1/admin/users', { key: keys().service,
      body: { email: ownerEmail, password: ownerPassword, email_confirm: true } });
    assert.ok(made.status < 300, JSON.stringify(made.data));
    await service('test_add_members', { p_store: store, users: [{ userId: made.data.id, username: `owner${tag}`, role: 'owner', permissions: [], email: ownerEmail }] });
    await service('test_seed', { p_store: store, data: { slots: [{ box: 1, slot: 1, price: 20 }] } });

    const recovers = [];
    let promptAnswer = null;
    app = await openApp({
      signedIn: false,
      configJs: `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'Sign-in Test Store';\n`
        + `const BACKEND = 'supabase';\nconst SUPABASE_URL = '${URL}';\nconst SUPABASE_ANON_KEY = '${keys().anon}';\n`,
      // Forgot Password would email a real link: answer it here instead.
      intercept: async (req) => {
        if (!req.url().includes('/auth/v1/recover')) return false;
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' };
        if (req.method() === 'OPTIONS') { await req.respond({ status: 204, headers: cors }); return true; }
        recovers.push({ url: req.url(), body: JSON.parse(req.postData()) });
        await req.respond({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
        return true;
      },
      onDialog: (d) => (d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept()),
      handle: () => { throw new Error('the Apps Script backend was called'); },
    });
    const { page, base } = app;
    // Sign In as someone else on this phone (forgets whoever is signed in, without telling the server).
    const signIn = async (email, password) => {
      await page.goto(base + 'login.html');
      await page.evaluate(() => localStorage.removeItem('smartScanSession'));
      await page.goto(base + 'login.html');
      await page.type('#username', email);
      await page.type('#password', password);
      await page.click('#form button[type="submit"]');
    };

    // ---- Sign In page ----
    await page.goto(base + 'login.html');
    assert.equal(await text(page, 'label[for="username"]'), 'Email');
    assert.equal(await page.$eval('#username', (e) => e.type), 'email');
    assert.equal(await visible(page, '#forgot'), true);
    assert.equal(await page.$eval('#setupLine', (e) => e.classList.contains('hidden')), true);
    await page.click('#forgot');
    assert.equal(await text(page, '#message'), 'Type your email above first, then tap Forgot Password.');
    await page.type('#username', ownerEmail);
    await page.click('#forgot');
    await page.waitForFunction(() => /is on its way/.test(document.querySelector('#message').textContent));
    assert.equal(recovers.length, 1);
    assert.equal(recovers[0].body.email, ownerEmail);
    assert.equal(new globalThis.URL(recovers[0].url).searchParams.get('redirect_to'), base + 'set-password.html');

    await signIn(ownerEmail, 'not-the-password');
    await page.waitForFunction(() => document.querySelector('#message').textContent);
    assert.equal(await text(page, '#message'), 'Wrong email or password.');

    // ---- The owner signs in and reaches home (a real ownerHome from the database) ----
    await signIn(ownerEmail, ownerPassword);
    await page.waitForFunction(() => location.pathname.endsWith('index.html'));
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession')));
    assert.equal(session.storeId, store);
    assert.equal(session.username, `owner${tag}`);
    assert.equal(session.role, 'owner');
    assert.equal(session.email, ownerEmail);
    await page.waitForFunction(() => !document.body.textContent.includes('Loading'), { timeout: 20000 });
    assert.equal(await text(page, '.user-pill .name'), `owner${tag}`);

    // ---- Manage Employees: the owner's card shows the email; add an employee by email ----
    await page.goto(base + 'users.html');
    await page.waitForSelector('#list .card');
    assert.match(await text(page, '#list .card'), new RegExp(ownerEmail.replace(/[.]/g, '\\.')));
    assert.equal(await page.$eval('#passwordField', (e) => e.classList.contains('hidden')), true);
    assert.equal(await visible(page, '#email'), true);
    // Refused before any account is made: a bad username, then a bad email.
    await page.type('#username', 'x');
    await page.type('#email', newbieEmail);
    await page.click('#addForm button');
    await page.waitForFunction(() => document.querySelector('#addMessage').textContent);
    assert.equal(await text(page, '#addMessage'), 'Username must be 3-30 characters: letters, numbers, dot, dash or underscore.');
    await page.$eval('#addForm', (f) => f.reset());
    await page.type('#username', 'Newbie');
    await page.type('#email', 'not-an-email@');
    await page.$eval('#email', (e) => { e.type = 'text'; });
    await page.click('#addForm button');
    await page.waitForFunction(() => /email address/.test(document.querySelector('#addMessage').textContent));
    await page.$eval('#email', (e) => { e.type = 'email'; });
    await page.$eval('#addForm', (f) => f.reset());

    await page.type('#username', 'Newbie');
    await page.type('#email', newbieEmail);
    const invited = page.waitForResponse((r) => r.url().includes('/functions/v1/members') && r.request().method() === 'POST');
    await page.click('#addForm button');
    const answer = await (await invited).json();
    assert.equal(answer.ok, true, JSON.stringify(answer));
    assert.ok(answer.testLink, 'a test store gets the invite link back');
    await page.waitForFunction(() => /invite is on its way/.test(document.querySelector('#addMessage').textContent));
    const cards = await page.$$eval('#list .card', (cs) => cs.map((c) => c.textContent));
    assert.equal(cards.length, 2);
    assert.match(cards[1], /newbie/);
    assert.match(cards[1], /Employee · Invited/);
    assert.match(cards[1], new RegExp(newbieEmail.replace(/[.]/g, '\\.')));
    // The same username or email again is refused.
    await page.type('#username', 'newbie');
    await page.type('#email', `other-${tag}@${DOMAIN}`);
    await page.click('#addForm button');
    await page.waitForFunction(() => /already taken/.test(document.querySelector('#addMessage').textContent));
    await page.$eval('#addForm', (f) => f.reset());
    await page.type('#username', 'newbie2');
    await page.type('#email', newbieEmail.toUpperCase());
    await page.click('#addForm button');
    await page.waitForFunction(() => /already on the list \(newbie\)/.test(document.querySelector('#addMessage').textContent));
    await page.$eval('#addForm', (f) => f.reset());

    // ---- Resend Invite: a new link; the old one stops working ----
    const cardOf = async (name) => {
      for (const c of await page.$$('#list .card')) if ((await c.$eval('strong', (e) => e.textContent)) === name) return c;
      throw new Error(`no card for ${name}`);
    };
    const buttonOn = async (name, label) => (await cardOf(name)).$(`xpath/.//button[text()="${label}"]`);
    assert.ok(await buttonOn('newbie', 'Resend Invite'), 'an invited employee has Resend Invite');
    const resent = page.waitForResponse((r) => r.url().includes('/functions/v1/members') && r.request().method() === 'POST');
    await (await buttonOn('newbie', 'Resend Invite')).click();
    const resentAnswer = await (await resent).json();
    assert.equal(resentAnswer.ok, true, JSON.stringify(resentAnswer));
    assert.ok(resentAnswer.testLink && resentAnswer.testLink !== answer.testLink, 'a new link');
    await page.waitForFunction(() => /new invite is on its way/.test(document.querySelector('#listMessage').textContent));
    assert.equal(await text(page, '#listMessage'), `A new invite is on its way to ${newbieEmail}. The old link no longer works.`);
    assert.match(await (await cardOf('newbie')).evaluate((c) => c.textContent), /Employee · Invited/);

    // The owner set a password for someone invited: no new invite (they sign in with that password).
    await page.type('#username', 'later');
    await page.type('#email', laterEmail);
    await page.click('#addForm button');
    await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 3);
    promptAnswer = 'Later-pass1!';
    await (await buttonOn('later', 'Reset Password')).click();
    await page.waitForFunction(() => /Password for later changed/.test(document.querySelector('#listMessage').textContent));
    await (await buttonOn('later', 'Resend Invite')).click();
    await page.waitForFunction(() => /already has a password/.test(document.querySelector('#listMessage').textContent), { timeout: 20000 });
    assert.equal(await text(page, '#listMessage'), 'later already has a password (you set one). They can sign in with it, or use Forgot Password.');

    // The first link no longer works.
    await page.goto(answer.testLink);
    await page.waitForFunction(() => location.pathname.endsWith('set-password.html') && document.querySelector('#message').textContent, { timeout: 20000 });
    assert.match(await text(page, '#message'), /expired or was already used/);
    answer.testLink = resentAnswer.testLink;

    // ---- The employee opens the invite link (on this phone: it replaces the owner's sign-in) ----
    await page.goto(answer.testLink);
    await page.waitForFunction(() => location.pathname.endsWith('set-password.html'), { timeout: 20000 });
    assert.equal(await page.evaluate(() => location.hash), '', 'the sign-in is taken out of the address');
    assert.match(await text(page, '#intro'), /Welcome to Smart Scan/);
    await page.type('#password', 'First-pass1!');
    await page.type('#confirm', 'first-pasz');
    await page.click('#form button[type="submit"]');
    assert.equal(await text(page, '#message'), "The two passwords don't match.");
    await page.$eval('#confirm', (e) => { e.value = ''; });
    await page.type('#confirm', 'First-pass1!');
    await page.click('#form button[type="submit"]');
    await page.waitForFunction(() => /Password saved/.test(document.querySelector('#message').textContent));
    assert.equal(await text(page, '#message'), "Password saved. You're signed in as newbie.");
    assert.equal(await visible(page, '#appNote'), true);
    await page.click('#continue');
    await page.waitForFunction(() => location.pathname.endsWith('index.html'));
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession')))).role, 'employee');
    await page.waitForFunction(() => document.querySelector('.user-pill .name') && document.querySelector('.user-pill .name').textContent === 'newbie');

    // An invite link used once doesn't work again.
    await page.goto(answer.testLink);
    await page.waitForFunction(() => location.pathname.endsWith('set-password.html') && document.querySelector('#message').textContent, { timeout: 20000 });
    assert.match(await text(page, '#message'), /expired or was already used/);
    assert.equal(await page.$eval('#form', (e) => e.classList.contains('hidden')), true);

    // ---- Change My Password ----
    await page.goto(base + 'account.html');
    assert.equal(await page.$eval('.password-rule', (e) => e.getAttribute('aria-label')), 'At least 8 characters, with a capital letter, a lowercase letter, a number and one of ? ! @ # $ % &');
    assert.deepEqual(await page.$$eval('.password-rule li', (lis) => lis.map((li) => li.textContent)),
      ['At least 8 characters', 'A capital letter', 'A lowercase letter', 'A number', 'One of ? ! @ # $ % &']);
    // A new password that breaks the rule is refused on the page, before anything is sent.
    await page.type('#current', 'First-pass1!');
    await page.type('#next', 'secondpass');
    await page.type('#confirm', 'secondpass');
    await page.click('#form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#message').textContent);
    assert.equal(await text(page, '#message'), 'Password needs a capital letter, a number and one of ? ! @ # $ % &.');
    for (const id of ['#current', '#next', '#confirm']) await page.$eval(id, (e) => { e.value = ''; });
    await page.$eval('#message', (e) => { e.textContent = ''; });
    // The current password as the new one: refused on the page.
    await page.type('#current', 'First-pass1!');
    await page.type('#next', 'First-pass1!');
    await page.type('#confirm', 'First-pass1!');
    await page.click('#form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#message').textContent);
    assert.equal(await text(page, '#message'), "The new password can't be the same as the last one.");
    for (const id of ['#current', '#next', '#confirm']) await page.$eval(id, (e) => { e.value = ''; });
    await page.$eval('#message', (e) => { e.textContent = ''; });
    // And if it got past the page, Supabase Auth refuses it too.
    assert.equal(await page.evaluate(() => api('changePassword', { currentPassword: 'First-pass1!', newPassword: 'First-pass1!' })
      .then(() => 'saved', (e) => e.message)), "The new password can't be the same as the last one.");
    await page.type('#current', 'wrong-pass');
    await page.type('#next', 'Second-pass2!');
    await page.type('#confirm', 'Second-pass2!');
    await page.click('#form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#message').textContent);
    assert.equal(await text(page, '#message'), 'Your current password is wrong.');
    await page.$eval('#current', (e) => { e.value = ''; });
    await page.type('#current', 'First-pass1!');
    await page.click('#form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#message').textContent === 'Password changed.');

    // ---- An access token that ran out is renewed by itself ----
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('smartScanSession'));
      localStorage.setItem('smartScanSession', JSON.stringify({ ...s, accessExpiresAt: 0 }));
    });
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession')).refreshToken);
    await page.goto(base + 'slots.html');
    await page.waitForFunction(() => document.querySelector('.slot-num') || document.querySelector('#loadMessage').textContent
      || !location.pathname.endsWith('slots.html'), { timeout: 20000 });
    assert.equal(await page.evaluate(() => location.pathname + ' ' + (document.querySelector('#loadMessage') || {}).textContent), '/slots.html ');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('smartScanSession')));
    assert.notEqual(after.refreshToken, before);
    assert.ok(after.accessExpiresAt > Date.now());

    // ---- Sign out, then in with the new password ----
    await page.evaluate(() => signOut());
    await page.waitForFunction(() => location.pathname.endsWith('login.html'));
    assert.equal(await page.evaluate(() => localStorage.getItem('smartScanSession')), null);
    await signIn(newbieEmail, 'First-pass1!');
    await page.waitForFunction(() => document.querySelector('#message').textContent);
    assert.equal(await text(page, '#message'), 'Wrong email or password.');
    await signIn(newbieEmail, 'Second-pass2!');
    await page.waitForFunction(() => location.pathname.endsWith('index.html'));
    const newbieSession = await page.evaluate(() => localStorage.getItem('smartScanSession'));

    // ---- The owner: newbie has signed in; set their password; turn them off ----
    await signIn(ownerEmail, ownerPassword);
    await page.waitForFunction(() => location.pathname.endsWith('index.html'));
    await page.goto(base + 'users.html');
    await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 3);
    const newbieCard = async () => (await page.$$('#list .card'))[1];
    assert.match(await (await newbieCard()).evaluate((c) => c.textContent), /Employee(?! · Invited)/);
    assert.doesNotMatch(await (await newbieCard()).evaluate((c) => c.textContent), /Invited/);
    assert.equal(await (await newbieCard()).$('xpath/.//button[text()="Resend Invite"]'), null, 'no Resend Invite once signed in');
    const button = async (label) => (await newbieCard()).$(`xpath/.//button[text()="${label}"]`);
    promptAnswer = '123';
    await (await button('Reset Password')).click();
    await page.waitForFunction(() => document.querySelector('#listMessage').textContent);
    assert.equal(await text(page, '#listMessage'), 'Password needs at least 8 characters, a capital letter, a lowercase letter and one of ? ! @ # $ % &.');
    promptAnswer = 'Thirdpass3';
    await (await button('Reset Password')).click();
    await page.waitForFunction(() => /one of/.test(document.querySelector('#listMessage').textContent));
    assert.equal(await text(page, '#listMessage'), 'Password needs one of ? ! @ # $ % &.');
    // Their current password again: refused (the database compares it; the admin API wouldn't).
    promptAnswer = 'Second-pass2!';
    await (await button('Reset Password')).click();
    await page.waitForFunction(() => /same as the last/.test(document.querySelector('#listMessage').textContent), { timeout: 20000 });
    assert.equal(await text(page, '#listMessage'), "The new password can't be the same as the last one.");
    promptAnswer = 'Third-pass3!';
    await (await button('Reset Password')).click();
    await page.waitForFunction(() => /Password for newbie changed/.test(document.querySelector('#listMessage').textContent));
    await (await button('Deactivate')).click();
    await page.waitForFunction(() => /Inactive/.test(document.querySelectorAll('#list .card')[1].textContent));

    // Turned off: their phone is signed out on its next page, and they can't sign in again.
    await page.evaluate((s) => localStorage.setItem('smartScanSession', s), newbieSession);
    await page.goto(base + 'slots.html');
    await page.waitForFunction(() => location.pathname.endsWith('login.html'), { timeout: 20000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('smartScanSession')), null);
    await signIn(newbieEmail, 'Third-pass3!');
    await page.waitForFunction(() => document.querySelector('#message').textContent);
    assert.equal(await text(page, '#message'), 'This account is no longer active.');

    // ---- A session the server no longer takes (refresh token gone) goes to Sign In ----
    await signIn(ownerEmail, ownerPassword);
    await page.waitForFunction(() => location.pathname.endsWith('index.html'));
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('smartScanSession'));
      localStorage.setItem('smartScanSession', JSON.stringify({ ...s, accessExpiresAt: 0, refreshToken: 'gone' }));
    });
    await page.goto(base + 'slots.html');
    await page.waitForFunction(() => location.pathname.endsWith('login.html'), { timeout: 20000 });
    await sleep(100);
    console.log('database sign-in: all passed');
  } finally {
    if (app) await app.close();
    await service('test_drop_store', { p_store: store });
    await deleteTestUsers();
  }
})().catch((e) => { console.error(e); process.exit(1); });
