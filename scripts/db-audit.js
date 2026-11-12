// Checks who can reach what in the database (read only): every function's owner, fixed search_path and who may call
// it; every table's forced row security and policies. Prints what isn't as docs/supabase.md says it must be.
//   node scripts/db-audit.js          the dev project (the linked one)
//   node scripts/db-audit.js --prod   the live project (reads only; run it yourself in the terminal)
// Run it after every migration and before the cutover. The query is scripts/db-audit.sql.
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROD_REF = 'ulxiphcgningbjgrvdui';
const prod = process.argv.includes('--prod');
const target = prod ? ['--linked', '--project-ref', PROD_REF] : ['--linked'];
const out = execFileSync('npx', ['--yes', 'supabase@2.122.0', 'db', 'query', ...target, '-f', path.join(__dirname, 'db-audit.sql')],
  { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const a = JSON.parse(out.slice(out.indexOf('{'))).rows[0].audit;

// The only functions postgres may own: three plain helpers and the four that must read Vault or auth.users.
const POSTGRES_PLAIN = ['app.fail', 'app.uid', 'app.current_store_id'];
const POSTGRES_DEFINER = ['app.store_retailer_number', 'app.save_retailer_number', 'app.forget_retailer_number',
  'public.service_is_current_password'];
const problems = [];
const counts = { signedIn: 0, serviceOnly: 0, internal: 0 };
for (const f of a.functions) {
  const name = f.f.replace(/\(.*/, '');
  const acl = f.acl || [];
  if (!(f.config || []).some((c) => c.startsWith('search_path='))) problems.push(`${f.f}: no fixed search_path`);
  if (acl.includes('PUBLIC') || acl.includes('anon')) problems.push(`${f.f}: callable without signing in`);
  if (f.owner === 'postgres') {
    if (!(f.secdef ? POSTGRES_DEFINER : POSTGRES_PLAIN).includes(name)) problems.push(`${f.f}: owned by postgres (it skips row security)`);
  } else if (f.owner !== 'smart_scan_api') problems.push(`${f.f}: owner ${f.owner}`);
  if (name.startsWith('app.') && (acl.includes('authenticated'))) problems.push(`${f.f}: an inside function signed-in people can call`);
  if (/^public\.(service_|test_)/.test(name) && acl.includes('authenticated')) problems.push(`${f.f}: a service function signed-in people can call`);
  if (name.startsWith('public.') && !f.secdef) problems.push(`${f.f}: not security definer`);
  if (acl.includes('authenticated')) counts.signedIn += 1;
  else if (acl.includes('service_role')) counts.serviceOnly += 1;
  else counts.internal += 1;
}
for (const t of a.tables.filter((x) => x.kind === 'r')) {
  if (!t.t.startsWith('app.')) { problems.push(`${t.t}: a table outside schema app`); continue; }
  if (!t.rls || !t.force) problems.push(`${t.t}: row security not forced`);
  if (/(anon|authenticated|service_role)=/.test(t.acl || '')) problems.push(`${t.t}: granted to an API role (${t.acl})`);
  const policies = t.policies || [];
  if (!policies.length) problems.push(`${t.t}: no policy`);
  for (const p of policies) if ((p.roles || []).join() !== 'smart_scan_api') problems.push(`${t.t}: policy ${p.name} for ${p.roles}`);
}
for (const s of a.schemas) {
  if (s.s === 'app' && /(anon|authenticated|service_role|^=|,=)/.test(s.acl.replace(/[{}]/g, ''))) problems.push(`schema app is open: ${s.acl}`);
  if (/smart_scan_api=UC/.test(s.acl)) problems.push(`smart_scan_api can still create in schema ${s.s}`);
}
for (const r of a.role) {
  if (r.r === 'smart_scan_api' && (r.bypass || r.super || r.login)) problems.push('smart_scan_api can bypass row security or log in');
}
console.log(`${prod ? 'PROD' : 'dev'}: ${a.migrations.length} migrations (last ${a.migrations[a.migrations.length - 1]}), `
  + `${a.functions.length} functions (${counts.signedIn} for signed-in people, ${counts.serviceOnly} service only, ${counts.internal} inside), `
  + `${a.tables.filter((x) => x.kind === 'r').length} tables.`);
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('Nothing out of place.');
