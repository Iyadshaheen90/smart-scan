// The move from the monthly spreadsheets to the database, for Route 66 Liquor's real data.
//
//   node scripts/import-sheets.js export   Signs in to the live Sheets backend as the owner (password typed, not shown),
//                                           downloads every month with exportMonth (read only) and keeps them in
//                                           ~/.smart-scan/export/ (outside the repo: the store's sales never go in git).
//   node scripts/import-sheets.js check    Builds the database rows from those months and the emails in
//                                           ~/.smart-scan/members.json, lists anything that doesn't fit, then imports
//                                           them into a throwaway test store on smart-scan-dev and checks every read the
//                                           pages use answers the same as the sheets did at the moment of the export.
//
// The real import into the production project comes at cutover (prod project still to make).
const fs = require('fs'); const os = require('os'); const path = require('path'); const readline = require('readline');
const { buildImport } = require('./import-map');

const HOME = path.join(os.homedir(), '.smart-scan');
const EXPORT_DIR = path.join(HOME, 'export');
const MEMBERS = path.join(HOME, 'members.json');
const API_URL = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.js'), 'utf8').match(/SMART_SCAN_API_URL = '([^']+)'/)[1];

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

function loadExport() {
  const files = fs.existsSync(EXPORT_DIR) ? fs.readdirSync(EXPORT_DIR).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort() : [];
  if (!files.length) throw new Error(`No months in ${EXPORT_DIR}: run "node scripts/import-sheets.js export" first.`);
  const months = files.map((f) => JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, f), 'utf8')));
  const at = [...new Set(months.map((m) => m.exportedAt))];
  if (at.length !== 1) throw new Error('The months were exported at different times: export them again together.');
  return { months, exportedAt: at[0] };
}

async function check() {
  const { months, exportedAt } = loadExport();
  const members = JSON.parse(fs.readFileSync(MEMBERS, 'utf8'));
  const { rows, problems } = buildImport(months, members);
  console.log(`Months ${months.map((m) => m.label).join(', ')}, exported ${exportedAt}.`);
  if (problems.length) {
    console.log(`${problems.length} thing(s) the database can't take as they are:`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Rows: ${Object.entries(rows).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  const { sheetsVm, compareOnDev } = require('./import-compare');
  const [day, time] = exportedAt.split(' ');
  const [h, m] = time.split(':').map(Number);
  const sheets = sheetsVm({ today: day, minute: h * 60 + m }, months);
  const { checked, counts } = await compareOnDev(rows, sheets, `${day} ${time.slice(0, 5)}:00`);
  console.log(`Imported into a dev test store: ${JSON.stringify(counts)}`);
  console.log(`${checked} reads the same as the sheets at ${exportedAt}. The test store is deleted again.`);
}

const command = process.argv[2];
const run = { export: exportAll, check }[command];
if (!run) {
  console.log('Use: node scripts/import-sheets.js export | check');
  process.exit(1);
}
run().catch((e) => { console.error(e.message || e); process.exit(1); });
