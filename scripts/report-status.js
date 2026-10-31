// Support: moves a problem report to Received / Working on It / Fixed, with an optional note the person sees in My
// Reports (owner 2026-10-31). Every support email ends with this command, store and report filled in.
// Works on the linked Supabase project (supabase/.temp/project-ref) with its service key, read through the CLI.
//   node scripts/report-status.js <store uuid> <report number> received|working|fixed ["note for the person"]
const { service } = require('../test/parity/harness');

const [store, number, status, note] = process.argv.slice(2);
if (!store || !/^\d+$/.test(number || '') || !['received', 'working', 'fixed'].includes(status)) {
  console.error('Usage: node scripts/report-status.js <store uuid> <report number> received|working|fixed ["note"]');
  process.exit(1);
}

service('service_set_problem_status', { p_store: store, p_report: Number(number), p_status: status, p_note: note || null })
  .then((r) => console.log(`#${r.number} · ${r.areaLabel}: ${r.status}${r.statusNote ? ` — ${r.statusNote}` : ''}`))
  .catch((e) => { console.error(e.message); process.exit(1); });
