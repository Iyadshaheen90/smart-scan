// The move from the monthly spreadsheets to the database, for Route 66 Liquor's real data.
//
//   node scripts/import-sheets.js export   Signs in to the live Sheets backend as the owner (password typed, not shown),
//                                           downloads every month with exportMonth (read only) and keeps them in
//                                           ~/.smart-scan/export/ (outside the repo: the store's sales never go in git).
//   node scripts/import-sheets.js check    Builds the database rows from those months and the emails in
//                                           ~/.smart-scan/members.json, lists anything that doesn't fit, then imports
//                                           them into a throwaway test store on smart-scan-dev and checks every read the
//                                           pages use answers the same as the sheets did at the moment of the export.
//   node scripts/import-sheets.js prod     Runs the check above first (it must pass), then imports the same rows into
//                                           the real store on smart-scan-prod. Each person gets an account with their
//                                           real email but NO email is sent (owner 2026-11-10: invites wait). A store that
//                                           already has data (the side-by-side copy) is emptied first, only after the
//                                           store's name is typed; its people, Store Info and retailer number stay.
//   node scripts/import-sheets.js lock | unlock
//                                           The cutover's lock on the Sheets backend (docs/cutover.md): after the last
//                                           export, "lock" makes every action except signing in and the export answer
//                                           "Smart Scan was updated…", so a phone on an old page can't save to Sheets.
//                                           "unlock" is for a rollback. Signs in as the owner (password typed).
//   node scripts/import-sheets.js invite <username…> | --all
//                                           Sends the invite email (choose a password) on prod to those people, only
//                                           after "send" is typed. Someone who already set a password is skipped.
const fs = require('fs'); const os = require('os'); const path = require('path'); const readline = require('readline');
const { execFileSync } = require('child_process');
const { buildImport } = require('./import-map');

const HOME = path.join(os.homedir(), '.smart-scan');
const EXPORT_DIR = path.join(HOME, 'export');
const MEMBERS = path.join(HOME, 'members.json');
const API_URL = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.js'), 'utf8').match(/SMART_SCAN_API_URL = '([^']+)'/)[1];
const CONFIG = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.js'), 'utf8');
const STORE_NAME = CONFIG.match(/STORE_NAME = '([^']+)'/)[1];
// The production project (docs/supabase.md). The folder stays linked to dev, so prod is always named here.
const PROD_REF = 'ulxiphcgningbjgrvdui';
const PROD_URL = `https://${PROD_REF}.supabase.co`;
// The real store's id on prod, saved when it's made (outside the repo, like the emails).
const PROD_STORE = path.join(HOME, 'prod-store.json');
// Where an invite email's button lands: the page where they choose a password (src/api.js setPasswordUrl).
const SET_PASSWORD_URL = 'https://iyadshaheen90.github.io/smart-scan/src/set-password.html';

// Asks a question on the terminal; hidden: what's typed isn't shown.
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

async function sheetsApi(body) {
  const res = await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  const answer = await res.json();
  if (!answer.ok) throw new Error(`${body.action}: ${answer.code} ${answer.error}`);
  return answer.data;
}

// The store's local time now, "YYYY-MM-DD HH:MM:SS".
function storeNow(timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

async function exportAll() {
  const username = await ask('Owner username: ');
  const password = await ask('Password: ', true);
  const session = await sheetsApi({ action: 'login', username, password });
  if (session.role !== 'owner') throw new Error('That account isn\'t the owner.');
  try {
    const list = await sheetsApi({ action: 'exportMonth', token: session.token });
    fs.mkdirSync(EXPORT_DIR, { recursive: true, mode: 0o700 });
    const exportedAt = storeNow(list.timeZone);
    for (const m of list.months) {
      const month = await sheetsApi({ action: 'exportMonth', token: session.token, label: m.label });
      const file = path.join(EXPORT_DIR, `${m.label}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...month, exportedAt }), { mode: 0o600 });
      const rows = Object.fromEntries(Object.entries(month.tabs).map(([t, r]) => [t, r.length - 1]));
      console.log(`${m.label} (${m.status}): ${JSON.stringify(rows)}`);
    }
    console.log(`Saved in ${EXPORT_DIR} at ${exportedAt} (store time). Don't change anything in the app until the check has run.`);
  } finally {
    await sheetsApi({ action: 'logout', token: session.token }).catch(() => {});
  }
}

// Locks or unlocks the Sheets backend (WebApp.js setMoved).
async function setLock(on) {
  const username = await ask('Owner username: ');
  const password = await ask('Password: ', true);
  const session = await sheetsApi({ action: 'login', username, password });
  try {
    const r = await sheetsApi({ action: 'setMoved', token: session.token, on });
    console.log(r.moved ? 'The Sheets backend is LOCKED: nothing can be saved there now.' : 'The Sheets backend is unlocked.');
  } finally {
    await sheetsApi({ action: 'logout', token: session.token }).catch(() => {});
  }
}

// The day before a "YYYY-MM-DD" day.
function dayBefore(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// The newest Close Day in the export. A close still waiting on a phone (no connection) isn't in the sheets, so it
// isn't in the export either; after the switch the database would refuse it and its sales would land in the next day.
function newestClose(rows) {
  return rows.dailyCloses.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).pop() || null;
}

function loadExport() {
  const files = fs.existsSync(EXPORT_DIR) ? fs.readdirSync(EXPORT_DIR).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort() : [];
  if (!files.length) throw new Error(`No months in ${EXPORT_DIR}: run "node scripts/import-sheets.js export" first.`);
  const months = files.map((f) => JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, f), 'utf8')));
  const at = [...new Set(months.map((m) => m.exportedAt))];
  if (at.length !== 1) throw new Error('The months were exported at different times: export them again together.');
  return { months, exportedAt: at[0] };
}

// The check (see the top): returns the rows, or stops (exit code 1) when anything doesn't fit or doesn't match.
async function check() {
  const { months, exportedAt } = loadExport();
  const members = JSON.parse(fs.readFileSync(MEMBERS, 'utf8'));
  const { rows, problems } = buildImport(months, members);
  console.log(`Months ${months.map((m) => m.label).join(', ')}, exported ${exportedAt}.`);
  if (problems.length) {
    console.log(`${problems.length} thing(s) the database can't take as they are:`);
    for (const p of problems) console.log(`  - ${p}`);
    throw new Error('Nothing was imported.');
  }
  console.log(`Rows: ${Object.entries(rows).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  const { sheetsVm, compareOnDev } = require('./import-compare');
  const [day, time] = exportedAt.split(' ');
  const [h, m] = time.split(':').map(Number);
  const sheets = sheetsVm({ today: day, minute: h * 60 + m }, months);
  const { checked, counts } = await compareOnDev(rows, sheets, `${day} ${time.slice(0, 5)}:00`);
  console.log(`Imported into a dev test store: ${JSON.stringify(counts)}`);
  console.log(`${checked} reads the same as the sheets at ${exportedAt}. The test store is deleted again.`);
  const last = newestClose(rows);
  console.log(last ? `Newest Close Day in the export: ${last.date} (by ${last.closedBy || '?'}, ${last.closedAt || 'time not kept'}).`
    : 'There is no Close Day in the export.');
  return { rows, exportedAt };
}

// ---------- Production ----------

let prodKeys = null;
function prodSecret() {
  if (!prodKeys) {
    const out = execFileSync('npx', ['--yes', 'supabase@2.122.0', 'projects', 'api-keys', '--project-ref', PROD_REF, '-o', 'json'],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    prodKeys = JSON.parse(out);
  }
  const key = (prodKeys.find((k) => k.name === 'service_role') || {}).api_key;
  if (!key) throw new Error('No service key for the prod project from the Supabase CLI.');
  return key;
}

async function prodHttp(method, url, body) {
  const key = prodSecret();
  const res = await fetch(PROD_URL + url, { method, headers: { apikey: key, Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function prodRpc(fn, body) {
  const r = await prodHttp('POST', `/rest/v1/rpc/${fn}`, body);
  if (r.status >= 300) {
    const e = new Error(`${fn}: ${(r.data && r.data.message) || r.status}`);
    e.hint = r.data && r.data.hint;
    throw e;
  }
  return r.data;
}

// Every account on prod, by lowercase email.
async function prodAccounts() {
  const byEmail = {};
  for (let page = 1; ; page += 1) {
    const r = await prodHttp('GET', `/auth/v1/admin/users?per_page=200&page=${page}`);
    if (r.status >= 300) throw new Error(`Listing accounts: ${r.status} ${JSON.stringify(r.data)}`);
    const users = r.data.users || [];
    for (const u of users) byEmail[String(u.email).toLowerCase()] = u;
    if (users.length < 200) return byEmail;
  }
}

async function prod() {
  const { rows, exportedAt } = await check();
  // The last close must be in the export (see newestClose): refused when it's older than yesterday, asked otherwise.
  const last = newestClose(rows);
  const exportDay = exportedAt.split(' ')[0];
  if (!last || (last.date !== exportDay && last.date !== dayBefore(exportDay))) {
    throw new Error(`The newest Close Day in the export is ${last ? last.date : 'missing'}, but it was exported on ${exportDay}. `
      + 'A close is missing (still waiting on a phone?). Send it, export again, then run this again. Nothing was imported.');
  }
  console.log(`\nThe newest Close Day in this export is ${last.date}. Anything saved on Sheets after ${exportedAt} is NOT in it.`);
  if ((await ask(`Is ${last.date} the last close before the switch (or is this a practice import)? Type "yes": `)) !== 'yes') {
    throw new Error('Stopped: nothing was imported.');
  }
  console.log(`\nNow the real store on smart-scan-prod (${PROD_REF}).`);

  // The store: made once, its id kept in ~/.smart-scan/prod-store.json.
  let storeId = fs.existsSync(PROD_STORE) ? JSON.parse(fs.readFileSync(PROD_STORE, 'utf8')).storeId : null;
  if (!storeId) {
    storeId = await prodRpc('service_create_store', { p_name: STORE_NAME });
    fs.writeFileSync(PROD_STORE, JSON.stringify({ storeId, name: STORE_NAME, ref: PROD_REF }), { mode: 0o600 });
    console.log(`Made the store "${STORE_NAME}".`);
  }

  // Accounts: an existing one (same email) is reused; a new one is made with no password and NOT emailed.
  const accounts = await prodAccounts();
  const members = [];
  for (const p of rows.people) {
    let user = accounts[p.email.toLowerCase()];
    if (!user) {
      const made = await prodHttp('POST', '/auth/v1/admin/users', { email: p.email, email_confirm: false });
      if (made.status >= 300) throw new Error(`Account for ${p.username}: ${made.status} ${JSON.stringify(made.data)}`);
      user = made.data;
      console.log(`  account made for ${p.username} (no email sent)`);
    }
    members.push({ ...p, userId: user.id });
  }

  const data = { ...rows, members };
  let counts;
  try {
    counts = await prodRpc('service_import_store', { p_store: storeId, data });
  } catch (e) {
    if (e.hint !== 'not_empty') throw e;
    console.log(`\nThe store already has data (an earlier import or the side-by-side checks). To replace it with the months`);
    console.log(`exported at ${exportedAt}, type the store's name. Its people, Store Info and retailer number stay.`);
    const typed = await ask(`Store name (${STORE_NAME}): `);
    if (typed !== STORE_NAME) throw new Error('Not the store name: nothing was changed.');
    const cleared = await prodRpc('service_clear_store', { p_store: storeId, p_confirm_name: typed });
    console.log(`Cleared: ${JSON.stringify(cleared)}`);
    counts = await prodRpc('service_import_store', { p_store: storeId, data });
  }

  // Every table holds exactly the rows the check proved.
  const expected = { members: members.length, slots: rows.slots.length, games: rows.games.length, packs: rows.packs.length,
    closeEntries: rows.closeEntries.length, dailyCloses: rows.dailyCloses.length, shiftCloses: rows.shiftCloses.length,
    shiftEntries: rows.shiftEntries.length, shipments: rows.shipments.length, adjustments: rows.adjustments.length };
  const off = Object.keys(expected).filter((k) => counts[k] !== expected[k]);
  console.log(`Imported into prod: ${JSON.stringify(counts)}`);
  if (off.length) throw new Error(`These don't match the check: ${off.map((k) => `${k} ${counts[k]} (expected ${expected[k]})`).join(', ')}`);
  console.log(`Everything matches the check. No invite emails were sent; use "invite" when the owner says so.`);
}

async function invite() {
  const names = process.argv.slice(3);
  if (!names.length) throw new Error('Name who gets the invite: node scripts/import-sheets.js invite <username…> | --all');
  const members = JSON.parse(fs.readFileSync(MEMBERS, 'utf8'));
  const chosen = names.includes('--all') ? members
    : names.map((n) => members.find((m) => String(m.username).toLowerCase() === n.toLowerCase())
      || (() => { throw new Error(`${n} isn't in ${MEMBERS}.`); })());
  const accounts = await prodAccounts();
  const send = []; const skip = [];
  for (const m of chosen) {
    const user = accounts[String(m.email).toLowerCase()];
    if (!user) skip.push(`${m.username}: no account on prod yet (run "prod" first)`);
    else if (user.email_confirmed_at) skip.push(`${m.username}: already has a password`);
    else send.push(m);
  }
  for (const x of skip) console.log(`  skipped ${x}`);
  if (!send.length) { console.log('Nobody to invite.'); return; }
  console.log(`Invite emails will go to: ${send.map((m) => m.username).join(', ')}`);
  if ((await ask('Type "send" to send them now: ')) !== 'send') { console.log('Nothing was sent.'); return; }
  for (const m of send) {
    const r = await prodHttp('POST', `/auth/v1/invite?redirect_to=${encodeURIComponent(SET_PASSWORD_URL)}`, { email: m.email });
    console.log(r.status < 300 ? `  sent to ${m.username}` : `  NOT sent to ${m.username}: ${r.status} ${JSON.stringify(r.data)}`);
    if (r.status >= 300) process.exitCode = 1;
  }
}

const command = process.argv[2];
const run = { export: exportAll, check, prod, invite, lock: () => setLock(true), unlock: () => setLock(false) }[command];
if (!run) {
  console.log('Use: node scripts/import-sheets.js export | check | prod | lock | unlock | invite <username…>|--all');
  process.exit(1);
}
run().catch((e) => { console.error(e.message || e); process.exit(1); });
