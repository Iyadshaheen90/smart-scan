// The move from the sheets: proves an import is right. The rows from scripts/import-map.js go into a throwaway test store
// on smart-scan-dev, with made-up sign-ins for the same people, and every read the pages use must answer the same as the
// Sheets code does over the same months (run in a vm), at the same moment. Shared by test/import-check.js (made-up
// months) and `node scripts/import-sheets.js check` (the store's real months). The test store and sign-ins are deleted
// afterwards, pass or fail.
const fs = require('fs'); const vm = require('vm'); const path = require('path'); const crypto = require('crypto');
const assert = require('assert/strict');
const { fakeSheet, fakeSpreadsheet, fakeGoogle } = require('../test/fakes');
const { keys, http, service } = require('../test/parity/harness');

const SCRIPT = path.join(__dirname, '..', 'src', 'apps-script');
const EMAIL_DOMAIN = 'import.smartscan.test';
const pad = (n) => String(n).padStart(2, '0');
const plain = (x) => JSON.parse(JSON.stringify(x ?? null));

// The Sheets code in a vm over fake spreadsheets, with a store clock: "now" is clock.today at clock.minute (minutes
// after midnight); any other date is a cell value, shown as it is (UTC). `months` (exportMonth answers) fill the
// spreadsheets; none gives an empty Control to build months in.
function sheetsVm(clock, months = []) {
  const nowParts = () => ({ y: clock.today.slice(0, 4), M: clock.today.slice(5, 7), d: clock.today.slice(8, 10),
    H: pad(Math.floor(clock.minute / 60)), m: pad(clock.minute % 60), s: '00' });
  function formatDate(d, tz, fmt) {
    const isNow = Math.abs(d.getTime() - Date.now()) < 60000;
    const p = isNow && tz !== 'UTC' ? nowParts() : { y: d.getUTCFullYear(), M: pad(d.getUTCMonth() + 1), d: pad(d.getUTCDate()),
      H: pad(d.getUTCHours()), m: pad(d.getUTCMinutes()), s: pad(d.getUTCSeconds()) };
    return fmt.replace('yyyy', p.y).replace('MM', p.M).replace('dd', p.d).replace('HH', p.H).replace('mm', p.m).replace('ss', p.s);
  }
  const control = fakeSpreadsheet('control', { Months: fakeSheet(['month_label', 'spreadsheet_id', 'created_date', 'status']) });
  const google = fakeGoogle(control);
  const ctx = { console, ...google, Session: { getScriptTimeZone: () => 'America/Los_Angeles' }, Utilities: { formatDate },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } } };
  vm.createContext(ctx);
  for (const f of fs.readdirSync(SCRIPT).filter((x) => x.endsWith('.js'))) vm.runInContext(fs.readFileSync(`${SCRIPT}/${f}`, 'utf8'), ctx);
  const tabs = plain(vm.runInContext('MONTHLY_TABS', ctx));
  for (const m of months) {
    const id = `month-${m.label}`;
    google.add(`Smart Scan — ${m.label}`, fakeSpreadsheet(id, Object.fromEntries(Object.entries(tabs).map(([name, headers]) => {
      const sheet = fakeSheet(headers, null, 100000);
      const rows = m.tabs[name];
      if (rows) {
        // Back under the full header (the export left out Sessions and the password columns).
        const [h, ...body] = rows;
        for (const r of body) sheet.rows.push(headers.map((col) => (h.includes(col) ? r[h.indexOf(col)] : '')));
      }
      return [name, sheet];
    }))));
    control.tabs.Months.appendRow([m.label, id, '', m.status]);
  }
  return { ctx, google, control, tabs, nowParts, run: (code) => vm.runInContext(code, ctx) };
}

// What the database does differently on purpose: no spreadsheets (links, the month to start).
function noSheets(x) {
  if (Array.isArray(x)) return x.map(noSheets);
  if (x && typeof x === 'object') {
    return Object.fromEntries(Object.entries(x).filter(([k]) => !['url', 'currentUrl', 'next', 'canStart'].includes(k))
      .map(([k, v]) => [k, noSheets(v)]));
  }
  return x;
}

// Imports `rows` into a new test store and compares every read at `now` ('YYYY-MM-DD HH:MM:SS', store time) against the
// Sheets code in `sheets` (a sheetsVm at the same moment). Returns { checked, counts }.
async function compareOnDev(rows, sheets, now) {
  const { anon, service: secret } = keys();
  const listed = await http('GET', '/auth/v1/admin/users?per_page=200', { key: secret });
  for (const u of (listed.data.users || []).filter((x) => String(x.email).endsWith(`@${EMAIL_DOMAIN}`))) {
    await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: secret });
  }
  const store = await service('test_create_store', { p_name: 'Import Check Store' });
  const ids = []; const tokens = {};
  try {
    // Made-up sign-ins: the real emails only ever go to the production project.
    const password = `${crypto.randomBytes(18).toString('base64url')}Aa1!`; // the password rule: capital, lowercase, number, sign
    const members = [];
    for (const p of rows.people) {
      const email = `${p.username.toLowerCase()}-${store.slice(0, 8)}@${EMAIL_DOMAIN}`;
      const made = await http('POST', '/auth/v1/admin/users', { key: secret, body: { email, password, email_confirm: true } });
      assert.ok(made.status < 300, JSON.stringify(made.data));
      ids.push(made.data.id);
      members.push({ ...p, userId: made.data.id, email });
      if (p.active) {
        const signIn = await http('POST', '/auth/v1/token?grant_type=password', { key: anon, body: { email, password } });
        tokens[p.username] = signIn.data.access_token;
      }
    }
    const counts = await service('service_import_store', { p_store: store, data: { ...rows, members } });
    const again = await http('POST', '/rest/v1/rpc/service_import_store', { key: secret, body: { p_store: store, data: { ...rows, members } } });
    assert.equal(again.data.hint, 'not_empty', 'a second import into the same store is refused');
    await service('test_set_clock', { p_store: store, p_now: now });

    const actions = sheets.run('SIGNED_IN_ACTIONS');
    const snake = (a) => a.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    let checked = 0;
    const same = async (person, action, req = {}, adjust = (x) => x) => {
      const user = sheets.run(`(${JSON.stringify({ username: person.username, role: person.role, permissions: person.permissions })})`);
      const expected = adjust(noSheets(plain(actions[action].run(req, user))));
      const r = await http('POST', `/rest/v1/rpc/${snake(action)}`, { key: anon, token: tokens[person.username], body: { p_store: store, req } });
      assert.ok(r.status < 300, `${action}: ${JSON.stringify(r.data)}`);
      assert.deepEqual(adjust(noSheets(r.data)), expected, `${person.username} ${action} ${JSON.stringify(req)}`);
      checked += 1;
    };
    const owner = rows.people.find((p) => p.role === 'owner');
    const employees = rows.people.filter((p) => p.role === 'employee' && p.active);
    for (const p of [owner, ...employees]) {
      await same(p, 'listSlots');
      await same(p, 'closeStatus');
      await same(p, 'shiftStatus');
    }
    await same(owner, 'ownerHome');
    await same(owner, 'monthsPage');
    await same(owner, 'listMonths');
    for (const m of plain(sheets.run('listMonths()'))) await same(owner, 'monthSummary', { label: m.label });
    await same(owner, 'reportsPage');
    await same(owner, 'listShipments');
    await same(owner, 'listReturns');
    await same(owner, 'listBackStock');
    for (const p of employees.filter((e) => ['receive_shipments', 'count_stock', 'full_pack_sale'].some((x) => e.permissions.includes(x)))) {
      await same(p, 'listBackStock');
    }
    await same(owner, 'listFullPackSales');
    await same(owner, 'listShiftCloses');
    // On purpose different: the database also lists each email and whether they've signed in yet. Only the day an
    // account was made is compared (Sheets reads a date typed as text as UTC midnight; the import keeps the store's).
    await same(owner, 'listUsers', {}, (x) => x.map(({ email, signedIn, createdDate, ...u }) => ({ ...u, createdOn: String(createdDate).slice(0, 10) })));
    await same(owner, 'theftReport', {});
    return { checked, counts };
  } finally {
    await service('test_drop_store', { p_store: store });
    for (const id of ids) await http('DELETE', `/auth/v1/admin/users/${id}`, { key: secret });
  }
}

module.exports = { sheetsVm, compareOnDev, noSheets, plain };
