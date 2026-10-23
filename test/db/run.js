// Runs the database tests (supabase/tests/*_test.sql) on the linked dev project (smart-scan-dev), one file at a time.
// Each file does its work in a transaction it rolls back, so the dev database is left as it was. A failed assert
// makes the query fail. Needs the Supabase CLI signed in (npx supabase login) and linked (supabase/.temp/project-ref).
// Run: node test/db/run.js [name…]
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'supabase', 'tests');
const only = process.argv.slice(2);
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('_test.sql') && (!only.length || only.some((o) => f.includes(o)))).sort();
let failed = 0;
for (const f of files) {
  try {
    const out = execFileSync('npx', ['--yes', 'supabase@2.122.0', 'db', 'query', '--linked', '-f', path.join(DIR, f)],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const result = (out.match(/"result":\s*"([^"]*)"/) || [])[1];
    if (!result) throw new Error(`no result line:\n${out}`);
    console.log(`ok   ${f}: ${result}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${f}\n${(e.stderr || '') + (e.stdout || '') || e.message}`);
  }
}
if (failed) process.exit(1);
