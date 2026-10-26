// Parity tests for the database move: the same steps run on the Sheets backend (the real src/apps-script code on an
// in-memory spreadsheet, the answer key) and on the Supabase dev project (smart-scan-dev, a throwaway test store), and
// every answer must match. Needs the Supabase CLI signed in and linked (see CLAUDE.md "Supabase").
//
//   const p = await parity({ today: '2026-10-06' });
//   await p.seed({ slots, games, packs, closes });       // the same starting rows on both sides
//   await p.both('o', 'listSlots');                       // asserts the answers match, returns the Sheets one
//   await p.both('sara', 'activatePack', { box: 1, … }); // errors must match too (code and message)
//   await p.setClock('2026-10-07', '22:50:00');
//   await p.done();                                       // deletes the test store and users
//
// People: 'o' (owner) and employees 'e' (no permissions), 'loader' (load_packs, return_packs), 'sara' (all of them).
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const crypto = require('crypto'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const { fakeSheet } = require('../fakes');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'src', 'apps-script');
const REF = fs.readFileSync(path.join(ROOT, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
const URL = `https://${REF}.supabase.co`;
const EMAIL_DOMAIN = 'parity.smartscan.test';
const ALL = ['load_packs', 'return_packs', 'receive_shipments', 'count_stock', 'full_pack_sale', 'ticket_order', 'theft_report'];
const PEOPLE = {
  o: { role: 'owner', permissions: [] },
  e: { role: 'employee', permissions: [] },
  loader: { role: 'employee', permissions: ['load_packs', 'return_packs'] },
  sara: { role: 'employee', permissions: ALL },
};

// ---------- Sheets side ----------

function sheetsBackend(clock) {
  const ctx = { console,
    Utilities: { formatDate: (d, tz, fmt) => (tz === 'UTC' ? d.toISOString().slice(0, 10)
      : fmt === 'yyyy-MM-dd HH:mm:ss' ? `${clock.today} ${clock.time}` : fmt === 'yyyy-MM-dd HH:mm' ? `${clock.today} ${clock.time.slice(0, 5)}`
        : fmt === 'h:mm a' ? clock.time : clock.today) },
    Session: { getScriptTimeZone: () => 'x' }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: (() => { const props = {}; return { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) }; })(),
    fakeSheetFn: fakeSheet, CLOCK: clock };
  vm.createContext(ctx);
  for (const f of ['Schema.js', 'Sheets.js', 'Tickets.js', 'Slots.js', 'Close.js', 'Backstock.js', 'FullPacks.js', 'Shifts.js',
    'Permissions.js', 'Reports.js', 'Store.js', 'Months.js', 'Home.js', 'Auth.js', 'Users.js', 'WebApp.js']) {
    vm.runInContext(fs.readFileSync(path.join(SCRIPT, f), 'utf8'), ctx);
  }
  // ApiError comes from Auth.js.
  vm.runInContext(`let sheets = {};
    function resetSheets() { sheets = {}; for (const [n, h] of Object.entries(MONTHLY_TABS)) sheets[n] = fakeSheetFn(h); return sheets; }
    resetSheets();
    function monthSheet(n) { return sheets[n]; }
    // One month, today's, whose spreadsheet is the sheets above (Months.js / Home.js read it through Control).
    function getCurrentMonth() { return { label: CLOCK.today.slice(0, 7), spreadsheetId: 'current' }; }
    function getControlSpreadsheet() {
      const months = fakeSheetFn(CONTROL_TABS.Months);
      months.rows.push([CLOCK.today.slice(0, 7), 'current', '', 'active']);
      return { getSheetByName: () => months };
    }
    const SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => sheets[n] }) };`, ctx);
  const addRow = (sheets, tab, obj) => sheets[tab].rows.push(sheets[tab].rows[0].map((h) => (h in obj ? obj[h] : '')));
  return {
    seed(state) {
      const sheets = vm.runInContext('resetSheets()', ctx);
      // The same people as the test store's members, in the same order (listUsers lists them in row order).
      for (const [username, person] of Object.entries(PEOPLE)) {
        addRow(sheets, 'Users', { username, role: person.role, active: true, created_date: '2026-10-01',
          permissions: person.permissions.join(',') });
      }
      for (const s of state.slots || []) {
        addRow(sheets, 'SlotConfig', { box: s.box, slot_number: s.slot, price_per_ticket: s.price, ticket_order: s.order || '' });
        const p = (state.packs || []).find((x) => x.status === 'live' && x.box === s.box && x.slot === s.slot);
        addRow(sheets, 'SlotState', p ? {
          box: s.box, slot_number: s.slot, pack_key: `${p.game}-${p.pack}`, game_number: p.game, pack_number: p.pack,
          price_per_ticket: p.price, current_exposed_ticket_number: p.top, activation_date: p.activatedOn || '',
          last_close_date: p.lastCloseOn || '', price_before_activation: p.priceBefore ?? '', took_from_reserve: p.tookFromBack ?? '',
          ticket_order: p.order || '',
        } : { box: s.box, slot_number: s.slot, last_game_number: s.lastGame || '' });
      }
      for (const g of state.games || []) {
        addRow(sheets, 'ReserveInventory', { game_number: g.game, price_per_ticket: g.price, tickets_per_pack: g.size,
          packs_in_reserve: g.inBack || 0, tickets_in_reserve: (g.inBack || 0) * g.size, ended_date: g.endedOn || '' });
      }
      for (const p of (state.packs || []).filter((x) => x.status !== 'live')) {
        addRow(sheets, 'PackHistory', { game_number: p.game, pack_number: p.pack, box: p.box ?? '', slot_number: p.slot ?? '',
          price_per_ticket: p.price, activation_date: p.activatedOn || '', end_date: p.endedOn, end_reason: p.endReason,
          remaining_at_return: p.remainingAtEnd ?? '', performed_by: p.performedBy || '', ticket_order: p.order || '' });
      }
      for (const c of state.closes || []) {
        addRow(sheets, 'DailySummary', { close_date: c.date, total_tickets_sold: c.tickets, total_dollars_sold: c.dollars,
          occupied_slot_count: c.liveSlots, total_inventory_value: c.inventory, close_id: c.closeId || '',
          closed_by: c.closedBy || '', closed_at: c.closedAt || '' });
      }
    },
    // Through the router, exactly as doPost runs it (owner-only and permission checks included).
    call(who, action, req = {}) {
      const user = { username: who, ...PEOPLE[who] };
      const entry = vm.runInContext('SIGNED_IN_ACTIONS', ctx)[action];
      const ApiError = vm.runInContext('ApiError', ctx);
      if (!entry) throw new Error(`no Sheets action ${action}`);
      try {
        if (entry.owner && user.role !== 'owner') throw new ApiError('forbidden', 'Only the owner can do that.');
        if (entry.allow && !entry.allow.some((p) => ctx.can(user, p))) throw new ApiError('forbidden', 'The owner hasn\'t turned this on for you.');
        return { ok: true, data: JSON.parse(JSON.stringify(entry.run(req, user) ?? {})) };
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        return { ok: false, code: e.code, error: e.message };
      }
    },
    ctx,
  };
}

// ---------- Supabase side ----------

let keyCache = null;
function keys() {
  if (keyCache) return keyCache;
  const out = execFileSync('npx', ['--yes', 'supabase@2.122.0', 'projects', 'api-keys', '--project-ref', REF, '-o', 'json'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const list = JSON.parse(out);
  const find = (name) => (list.find((k) => k.name === name) || {}).api_key;
  keyCache = { anon: find('anon'), service: find('service_role') };
  assert.ok(keyCache.anon && keyCache.service, 'no API keys from the CLI');
  return keyCache;
}

async function http(method, url, { key, token, body } = {}) {
  const res = await fetch(URL + url, { method, headers: { apikey: key, Authorization: `Bearer ${token || key}`,
    'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

async function service(fn, body) {
  const r = await http('POST', `/rest/v1/rpc/${fn}`, { key: keys().service, body });
  if (r.status >= 300) throw new Error(`${fn}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

// listSlots -> list_slots
const snake = (action) => action.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

async function dbBackend() {
  const { anon, service: secret } = keys();
  // Leftover test users from a run that crashed.
  const listed = await http('GET', '/auth/v1/admin/users?per_page=200', { key: secret });
  for (const u of (listed.data.users || []).filter((x) => String(x.email).endsWith(`@${EMAIL_DOMAIN}`))) {
    await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: secret });
  }
  const store = await service('test_create_store', { p_name: 'Parity Test Store' });
  const tokens = {}; const ids = [];
  const password = crypto.randomBytes(18).toString('base64url');
  const members = [];
  for (const [username, person] of Object.entries(PEOPLE)) {
    const email = `${username}-${store.slice(0, 8)}@${EMAIL_DOMAIN}`;
    const made = await http('POST', '/auth/v1/admin/users', { key: secret, body: { email, password, email_confirm: true } });
    assert.ok(made.status < 300, JSON.stringify(made.data));
    ids.push(made.data.id);
    members.push({ userId: made.data.id, username, role: person.role, permissions: person.permissions });
    const signIn = await http('POST', '/auth/v1/token?grant_type=password', { key: anon, body: { email, password } });
    assert.ok(signIn.status < 300, JSON.stringify(signIn.data));
    tokens[username] = signIn.data.access_token;
  }
  await service('test_add_members', { p_store: store, users: members });
  return {
    store,
    seed: (state) => service('test_seed', { p_store: store, data: state }),
    setClock: (today, time) => service('test_set_clock', { p_store: store, p_now: `${today} ${time}` }),
    async call(who, action, req = {}) {
      const r = await http('POST', `/rest/v1/rpc/${snake(action)}`, { key: anon, token: tokens[who], body: { p_store: store, req } });
      if (r.status < 300) return { ok: true, data: r.data };
      if (r.data && r.data.hint) return { ok: false, code: r.data.hint, error: r.data.message };
      throw new Error(`${action}: ${r.status} ${JSON.stringify(r.data)}`);
    },
    async done() {
      await service('test_drop_store', { p_store: store });
      for (const id of ids) await http('DELETE', `/auth/v1/admin/users/${id}`, { key: secret });
    },
  };
}

// ---------- Both ----------

async function parity({ today, time = '12:00:00' }) {
  const clock = { today, time };
  const sheets = sheetsBackend(clock);
  const db = await dbBackend();
  await db.setClock(today, time);
  let steps = 0;
  return {
    sheets, db,
    async seed(state) { sheets.seed(state); await db.seed(state); },
    async setClock(day, t = '12:00:00') { clock.today = day; clock.time = t; await db.setClock(day, t); },
    // Runs the step on both and asserts the same answer. normalize(answer) can drop what's allowed to differ.
    async both(who, action, req = {}, normalize = (x) => x) {
      steps += 1;
      const expected = sheets.call(who, action, req);
      const actual = await db.call(who, action, req);
      assert.deepEqual(normalize(actual), normalize(expected), `step ${steps}: ${who} ${action} ${JSON.stringify(req)}`);
      if (!expected.ok) return expected;
      return expected.data;
    },
    done: () => db.done(),
  };
}

// keys/http/service/URL also serve the database browser test (test/browser/db-sign-in.js).
module.exports = { parity, PEOPLE, keys, http, service, URL };
