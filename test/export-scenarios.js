// Export for the move to the database (Export.js): the month list, then one month's tabs as plain rows. Dates come out
// as text in the script's time zone, Sessions and the Users password columns are left out, a tab missing from an older
// month is skipped, and only the owner can call it (through doPost, like the import does).
// Run: node test/export-scenarios.js
const fs = require('fs'); const vm = require('vm'); const path = require('path'); const assert = require('assert/strict');
const { fakeSheet, fakeSpreadsheet, fakeGoogle } = require('./fakes');
const dir = path.join(__dirname, '..', 'src', 'apps-script');

const control = fakeSpreadsheet('control', { Months: fakeSheet(['month_label', 'spreadsheet_id', 'created_date', 'status']) });
const google = fakeGoogle(control);
// formatDate in "UTC" stands in for the script's own zone: enough to tell a plain date from one with a time.
const pad = (n) => String(n).padStart(2, '0');
const ctx = { console, ...google, Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: { formatDate: (d, tz, fmt) => fmt
    .replace('yyyy', d.getUTCFullYear()).replace('MM', pad(d.getUTCMonth() + 1)).replace('dd', pad(d.getUTCDate()))
    .replace('HH', pad(d.getUTCHours())).replace('mm', pad(d.getUTCMinutes())).replace('ss', pad(d.getUTCSeconds())) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } } };
vm.createContext(ctx);
for (const f of ['Schema.js', 'Sheets.js', 'Months.js', 'Setup.js', 'Auth.js', 'Tickets.js', 'Slots.js', 'Close.js', 'Backstock.js',
  'FullPacks.js', 'Shifts.js', 'Home.js', 'Permissions.js', 'Users.js', 'Store.js', 'Reports.js', 'Export.js', 'WebApp.js']) {
  vm.runInContext(fs.readFileSync(`${dir}/${f}`, 'utf8'), ctx);
}
const run = (code) => vm.runInContext(code, ctx);
const MONTHLY_TABS = JSON.parse(JSON.stringify(run('MONTHLY_TABS')));

// September was made before shift closes existed (no ShiftCloses / ShiftCloseLog tabs); October has them.
const month = (id, withShifts) => fakeSpreadsheet(id, Object.fromEntries(Object.entries(MONTHLY_TABS)
  .filter(([n]) => withShifts || !n.startsWith('Shift')).map(([n, h]) => [n, fakeSheet(h)])));
const sep = google.add('Smart Scan — 2026-09', month('sep', false));
const oct = google.add('Smart Scan — 2026-10', month('oct', true));
control.tabs.Months.appendRow(['2026-10', 'oct', new Date(), 'active']);
control.tabs.Months.appendRow(['2026-09', 'sep', new Date(), 'closed']);
for (const m of [sep, oct]) {
  m.tabs.Users.rows.push(['o', 'hash-o', 'salt-o', 'owner', true, new Date(Date.UTC(2026, 8, 22)), ''],
    ['e', 'hash-e', 'salt-e', 'employee', true, '2026-09-23', 'load_packs']);
  m.tabs.Sessions.rows.push(['tok', 'o', '2026-09-29', '2099-01-01']);
}
sep.tabs.SlotConfig.rows.push([1, 1, 20, ''], ['', '', '', '']); // a blank row is skipped
sep.tabs.DailySummary.rows.push([new Date(Date.UTC(2026, 8, 27)), 120, 2400, 40, 51234, 'c-1', 'e',
  new Date(Date.UTC(2026, 8, 27, 22, 52, 10))]);
sep.tabs.ReserveInventory.rows.push(['0012', 20, 30, 3, 90, '']);

// The month list, oldest first, with no spreadsheet ids.
assert.deepEqual(JSON.parse(JSON.stringify(run('exportMonth()'))), { timeZone: 'UTC',
  months: [{ label: '2026-09', status: 'closed' }, { label: '2026-10', status: 'active' }] });

const s = JSON.parse(JSON.stringify(run(`exportMonth('2026-09')`)));
assert.equal(s.label, '2026-09');
assert.equal(s.status, 'closed');
assert.deepEqual(Object.keys(s.tabs).sort(), Object.keys(MONTHLY_TABS).filter((n) => n !== 'Sessions' && !n.startsWith('Shift')).sort(),
  'every tab but Sessions; September has no shift tabs');
assert.deepEqual(s.tabs.Users[0], ['username', 'role', 'active', 'created_date', 'permissions'], 'no password columns');
assert.deepEqual(s.tabs.Users.slice(1), [['o', 'owner', true, '2026-09-22', ''], ['e', 'employee', true, '2026-09-23', 'load_packs']]);
assert.ok(!JSON.stringify(s).includes('hash-') && !JSON.stringify(s).includes('salt-') && !JSON.stringify(s).includes('tok'));
assert.deepEqual(s.tabs.SlotConfig, [MONTHLY_TABS.SlotConfig, [1, 1, 20, '']], 'header first, blank rows skipped');
assert.deepEqual(s.tabs.DailySummary[1], ['2026-09-27', 120, 2400, 40, 51234, 'c-1', 'e', '2026-09-27 22:52:10'],
  'a date stays a date, a time keeps its seconds');
assert.equal(s.tabs.ReserveInventory[1][0], '0012', 'game numbers as stored');
assert.ok(JSON.parse(JSON.stringify(run(`exportMonth('2026-10')`))).tabs.ShiftCloses, 'October has its shift tabs');
assert.equal(run(`(() => { try { exportMonth('2026-08'); } catch (e) { return e.code; } })()`), 'no_month');

// Through doPost: the owner gets it, an employee is refused.
run(`requireSession = (token, role) => {
  const user = token === 'owner' ? { username: 'o', role: 'owner' } : { username: 'e', role: 'employee', permissions: [] };
  if (role === 'owner' && user.role !== 'owner') throw new ApiError('forbidden', 'Only the owner can do that.');
  return user;
}`);
const post = (body) => JSON.parse(run(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(body))} } })`));
assert.equal(post({ action: 'exportMonth', token: 'owner' }).ok, true);
assert.equal(post({ action: 'exportMonth', token: 'employee', label: '2026-09' }).code, 'forbidden');

console.log('EXPORT CHECKS PASS');
