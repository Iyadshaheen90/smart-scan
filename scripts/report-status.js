// Support: moves a problem report to Received / Working on It / Fixed, with an optional note the person sees in My
// Reports (owner 2026-10-31). Every support email ends with this command, store and report filled in.
// Real reports are on the production project (smart-scan-prod), so that's where it works; --dev uses the dev project
// (test reports). The service key is read through the Supabase CLI and never printed.
//   node scripts/report-status.js <store uuid> <report number> received|working|fixed ["note for the person"] [--dev]
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROD_REF = 'ulxiphcgningbjgrvdui';
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const [store, number, status, note] = args.filter((a) => a !== '--dev');
if (!store || !/^\d+$/.test(number || '') || !['received', 'working', 'fixed'].includes(status)) {
  console.error('Usage: node scripts/report-status.js <store uuid> <report number> received|working|fixed ["note"] [--dev]');
  process.exit(1);
}

const ref = dev ? fs.readFileSync(path.join(ROOT, 'supabase', '.temp', 'project-ref'), 'utf8').trim() : PROD_REF;
const keys = JSON.parse(execFileSync('npx', ['--yes', 'supabase@2.122.0', 'projects', 'api-keys', '--project-ref', ref, '-o', 'json'],
  { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const key = (keys.find((k) => k.name === 'service_role') || {}).api_key;
if (!key) {
  console.error('No service key from the Supabase CLI.');
  process.exit(1);
}

fetch(`https://${ref}.supabase.co/rest/v1/rpc/service_set_problem_status`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_store: store, p_report: Number(number), p_status: status, p_note: note || null }),
}).then(async (res) => {
  const r = await res.json();
  if (!res.ok) throw new Error(r.message || `${res.status}`);
  console.log(`${dev ? '[dev] ' : ''}#${r.number} · ${r.areaLabel}: ${r.status}${r.statusNote ? ` — ${r.statusNote}` : ''}`);
}).catch((e) => { console.error(e.message); process.exit(1); });
