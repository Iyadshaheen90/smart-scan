// Help & FAQ (owner 2026-10-29): src/faq.js checked as data, then help.html in headless Chrome.
// Data: every question in English, Spanish and Arabic; who is a role or a real permission and every permission has
// questions; Go There pages exist; no dollar sign in anything an employee can see (except the password rule's signs);
// every page's data-help is a section. Page: the owner sees every section, an employee only theirs (plus their
// permissions'), search narrows and says when nothing matches, the language is picked and remembered (Arabic right to
// left), and a page's ? opens Help at its section with a back pill to that page, the name pill staying top right.
// Run: node test/browser/help.js   (SHOTS=dir saves screenshots)
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { openApp, sleep } = require('./harness');
const { FAQ, HELP_LANGS, HELP_WORDS, faqVisible } = require('../../src/faq.js');

const SRC = path.join(__dirname, '../../src');
const PERMISSIONS = JSON.parse(fs.readFileSync(path.join(SRC, 'apps-script/Permissions.js'), 'utf8')
  .match(/const PERMISSIONS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const RULE_SIGNS = '? ! @ # $ % &';
const LANGS = HELP_LANGS.map((l) => l.id);
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shownSections = (page) => page.$$eval('.faq-section:not(.hidden)', (els) => els.map((e) => e.id.slice(2)));
const shownItems = (page) => page.$$eval('.faq-item:not(.hidden)', (els) => els.map((e) => e.dataset.id));

function checkData() {
  assert.deepEqual(LANGS, ['en', 'es', 'ar']);
  for (const words of Object.values(HELP_WORDS)) for (const l of LANGS) assert.ok(words[l], `HELP_WORDS ${l}`);
  const seen = new Set();
  const covered = new Set();
  for (const section of FAQ) {
    for (const l of LANGS) assert.ok(section.title[l], `${section.id} title ${l}`);
    for (const item of section.items) {
      const key = `${section.id}/${item.id}/${item.backend || 'both'}`;
      assert.ok(!seen.has(key), `${key} twice`);
      seen.add(key);
      for (const part of ['q', 'a']) for (const l of LANGS) assert.ok(item[part][l] && item[part][l].trim(), `${key} ${part} ${l}`);
      for (const who of [].concat(item.who)) {
        assert.ok(['everyone', 'employee', 'owner', ...PERMISSIONS].includes(who), `${key}: who ${who}`);
        covered.add(who);
      }
      assert.ok([undefined, 'sheets', 'supabase'].includes(item.backend), `${key} backend`);
      if (item.go) assert.ok(fs.existsSync(path.join(SRC, item.go.split('?')[0])), `${key}: ${item.go} exists`);
      for (const l of LANGS) assert.ok(!/CA Lottery/i.test(item.q[l] + item.a[l]), `${key}: no CA Lottery`);
    }
  }
  for (const p of PERMISSIONS) assert.ok(covered.has(p), `a question for ${p}`);

  // Both backends: the same question never shows twice, and sign-in has its own version on each.
  for (const backend of ['sheets', 'supabase']) {
    const owner = { role: 'owner' };
    const keys = FAQ.flatMap((s) => s.items.filter((i) => faqVisible(i, owner, backend)).map((i) => `${s.id}/${i.id}`));
    assert.equal(new Set(keys).size, keys.length, `${backend}: no question twice`);
    assert.ok(keys.includes('start/sign-in') && keys.includes('employees/add'), backend);
  }
  // An employee with every permission still sees no dollar sign (the password rule's signs aside), in any language.
  const employee = { role: 'employee', permissions: PERMISSIONS };
  for (const backend of ['sheets', 'supabase']) {
    for (const item of FAQ.flatMap((s) => s.items).filter((i) => faqVisible(i, employee, backend))) {
      for (const l of LANGS) {
        const text = (item.q[l] + item.a[l]).split(RULE_SIGNS).join('');
        assert.ok(!text.includes('$'), `${item.id} (${l}) shows $ to employees`);
      }
    }
  }
  // Nobody signed in sees nothing; an employee without permissions doesn't see owner questions.
  assert.equal(faqVisible(FAQ[0].items[0], null, 'sheets'), false);
  const owners = FAQ.flatMap((s) => s.items).filter((i) => [].concat(i.who).every((w) => w === 'owner'));
  assert.ok(owners.length && owners.every((i) => !faqVisible(i, { role: 'employee', permissions: [] }, i.backend || 'sheets')));

  // Every page's ? points at a section that exists (close.html also sets 'shift' in shift mode).
  const ids = FAQ.map((s) => s.id);
  const helps = ['shift'];
  for (const name of fs.readdirSync(SRC).filter((f) => f.endsWith('.html'))) {
    for (const m of fs.readFileSync(path.join(SRC, name), 'utf8').matchAll(/data-help="([^"]+)"/g)) helps.push(m[1]);
  }
  assert.ok(helps.length >= 6, 'the ? pages');
  for (const h of helps) assert.ok(ids.includes(h), `section ${h}`);
}

(async () => {
  checkData();
  const handle = (b) => (b.action === 'closeStatus' ? { slots: [], permissions: [] } : {});
  const allSections = FAQ.map((s) => s.id);
  const everyoneSections = ['start', 'close', 'shift', 'slots', 'problems', 'about'];

  // ---- Owner: More → Help & FAQ, every section (the Sheets versions while BACKEND is 'sheets') ----
  let app = await openApp({ role: 'owner', handle });
  let { page, base } = app;
  await page.evaluate(() => localStorage.removeItem('smartScanHelpLang'));
  await page.goto(base + 'more.html');
  await page.click('a[href="help.html"]');
  await page.waitForSelector('.faq-item');
  assert.deepEqual(await shownSections(page), allSections);
  const ownerCount = (await shownItems(page)).length;
  assert.equal(ownerCount, FAQ.flatMap((s) => s.items).filter((i) => faqVisible(i, { role: 'owner' }, 'sheets')).length);
  assert.equal(await page.$eval('#helpBody', (e) => e.dir), 'ltr');
  assert.match(await page.$eval('[data-id="sign-in"] .faq-answer', (e) => e.textContent), /username/);
  assert.equal(await page.$('#header .back'), null, 'opened from More: no back pill');
  // A question opens; its Go There goes to the page.
  await page.click('[data-id="how-close"] summary');
  assert.equal(await page.$eval('[data-id="how-close"]', (e) => e.open), true);
  assert.equal(await page.$$eval('[data-id="how-close"] ol li', (els) => els.length), 4);
  assert.equal(await page.$eval('[data-id="how-close"] .faq-go', (e) => [e.textContent, e.getAttribute('href')].join(' ')), 'Go There close.html');
  assert.equal(await page.$$eval('[data-id="permissions"] ul li', (els) => els.length), PERMISSIONS.length);
  // Search: every word must match; nothing matching says so.
  await page.type('#helpSearch', 'sold OUT');
  const found = await shownItems(page);
  assert.ok(found.includes('sold-out-midday') && found.includes('how-close') && !found.includes('arrows'), found.join());
  assert.equal(await page.$eval('#noMatch', (e) => e.classList.contains('hidden')), true);
  await page.type('#helpSearch', ' zebra');
  assert.deepEqual(await shownItems(page), []);
  assert.equal(await page.$eval('#noMatch', (e) => e.textContent), HELP_WORDS.noMatch.en);
  assert.equal(await page.$eval('#noMatch', (e) => e.classList.contains('hidden')), false);
  await page.$eval('#helpSearch', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
  assert.equal((await shownItems(page)).length, ownerCount);
  await shot(page, 'help-owner-en');

  // ---- Languages: Spanish, then Arabic (right to left), remembered on the phone; search works in each ----
  await page.click('#langSwitch button[lang="es"]');
  assert.equal(await page.$eval('#helpIntro', (e) => e.textContent), HELP_WORDS.intro.es);
  assert.equal(await page.$eval('#s-close h2', (e) => e.textContent), FAQ.find((s) => s.id === 'close').title.es);
  assert.equal(await page.$eval('#langSwitch .active', (e) => e.lang), 'es');
  await page.type('#helpSearch', 'codigo');
  assert.ok((await shownItems(page)).includes('scan'), 'accents ignored: codigo finds código');
  await page.$eval('#helpSearch', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
  await page.click('#langSwitch button[lang="ar"]');
  assert.equal(await page.$eval('#helpBody', (e) => e.dir), 'rtl');
  assert.equal(await page.$eval('[data-id="how-close"] summary', (e) => e.textContent), FAQ[1].items[0].q.ar);
  assert.ok(await noSideScroll(page), 'Arabic fits a phone');
  await page.click('[data-id="permissions"] summary');
  await shot(page, 'help-owner-ar');
  await page.reload();
  await page.waitForSelector('.faq-item');
  assert.equal(await page.$eval('#helpBody', (e) => e.dir), 'rtl', 'Arabic remembered');
  await page.click('#langSwitch button[lang="en"]');
  await app.close();

  // ---- Employee with no permissions: only the everyone sections, no $ on the page ----
  app = await openApp({ role: 'employee', permissions: [], handle });
  ({ page, base } = app);
  await page.goto(base + 'help.html');
  await page.waitForSelector('.faq-item');
  assert.deepEqual(await shownSections(page), everyoneSections);
  assert.ok((await shownItems(page)).includes('view-only'));
  for (const lang of ['en', 'es', 'ar']) {
    await page.click(`#langSwitch button[lang="${lang}"]`);
    const words = (await page.$eval('#faq', (e) => e.textContent)).split(RULE_SIGNS).join('');
    assert.ok(!words.includes('$'), `employee page (${lang}) shows $`);
  }
  await page.click('#langSwitch button[lang="en"]');
  await shot(page, 'help-employee');
  await app.close();

  // ---- Employee with Load Packs + Theft Report: those questions, not the owner-only ones beside them ----
  app = await openApp({ role: 'employee', permissions: ['load_packs', 'theft_report'], handle });
  ({ page, base } = app);
  await page.goto(base + 'help.html');
  await page.waitForSelector('.faq-item');
  assert.deepEqual(await shownSections(page), ['start', 'close', 'shift', 'slots', 'packs', 'reports', 'problems', 'about']);
  const items = await shownItems(page);
  for (const id of ['put-in', 'wrong-slot', 'put-back', 'theft-when', 'theft-send']) assert.ok(items.includes(id), id);
  for (const id of ['return', 'move-swap', 'month-sales', 'settling', 'days']) assert.ok(!items.includes(id), id);
  await app.close();

  // ---- A page's ?: Help at that page's section, back pill to the page, name pill still top right ----
  app = await openApp({ role: 'owner', handle });
  ({ page, base } = app);
  const pages = [
    ['close.html', 'close', 'Close Day'], ['close.html?shift=1', 'shift', 'Close Shift'],
    ['activate.html?box=1&slot=3', 'packs', 'Slot'], ['backstock.html', 'backstock', 'Back Stock'],
    ['users.html', 'employees', 'Employees'], ['theft-report.html', 'reports', 'Theft Report'],
  ];
  for (const [from, section, label] of pages) {
    await page.goto(base + from);
    await page.waitForSelector('.app-header .help-link');
    const href = await page.$eval('.app-header .help-link', (e) => e.getAttribute('href'));
    assert.equal(href, `help.html?from=${encodeURIComponent(from)}&section=${section}`, from);
    // The ? shares the title's row; the name pill keeps its place.
    const row = await page.$eval('.app-header', (h) => {
      const r = (s) => { const b = h.querySelector(s).getBoundingClientRect(); return { top: b.top, height: b.height, right: b.right }; };
      return { help: r('.help-link'), h1: r('h1'), pill: r('.user-pill'), width: window.innerWidth };
    });
    assert.ok(Math.abs(row.help.top + row.help.height / 2 - (row.h1.top + row.h1.height / 2)) < 8, `${from}: ? beside the title`);
    assert.ok(row.pill.right > row.width - 40, `${from}: name pill on the right`);
    await page.click('.app-header .help-link');
    await page.waitForFunction(() => location.pathname.endsWith('help.html') && document.querySelector('.faq-item'));
    assert.equal(await page.$eval('#header .back-label', (e) => e.textContent), label);
    assert.equal(await page.$eval('#header .back', (e) => e.getAttribute('href')), from);
    assert.equal(await page.$eval(`#s-${section}`, (e) => e.classList.contains('faq-target')), true, section);
    const top = await page.$eval('#header', (h) => [h.querySelector('.back').getBoundingClientRect().top, h.querySelector('.user-pill').getBoundingClientRect().top]);
    assert.ok(Math.abs(top[0] - top[1]) < 12, `${from}: back pill and name pill on one row`);
    await page.click('#header .back');
    await page.waitForFunction((f) => location.pathname + location.search === '/' + f, {}, from);
  }
  await shot(page, 'help-from-theft');
  // A page that isn't one of the ? pages gets no back pill.
  for (const bad of ['https://example.com/x.html', 'index.html', 'close.html?x=<b>']) {
    await page.goto(`${base}help.html?from=${encodeURIComponent(bad)}`);
    await page.waitForSelector('.faq-item');
    assert.equal(await page.$('#header .back'), null, bad);
  }
  // Pages without data-help have no ?.
  await page.goto(base + 'slots.html');
  await sleep(100);
  assert.equal(await page.$('.help-link'), null);
  await app.close();

  console.log('help: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
