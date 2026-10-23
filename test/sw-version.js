// Guards the service worker's CACHE (owner approved 2026-10-14: pages open from the phone's saved copy). The phone
// only downloads a deploy when sw.js changes, so any change to a file the pages use without a new CACHE would never
// reach the phone. This keeps a fingerprint of those files with the CACHE it was recorded under, and fails when the
// files changed but CACHE didn't. Also: every page and script in src/ must be in SHELL, so all of it is saved at once.
// Run: node test/sw-version.js            after bumping CACHE: node test/sw-version.js --update
const assert = require('assert/strict');
const crypto = require('crypto'); const fs = require('fs'); const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const RECORD = path.join(__dirname, 'sw-version.json');
const sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8');
const cache = sw.match(/const CACHE = '([^']+)'/)[1];
const shell = JSON.parse(`[${sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].replace(/'/g, '"').replace(/,\s*$/, '')}]`);

// Pages and scripts that are dev or one-time tools, opened from the network the rare time they're used.
const NOT_SAVED = ['backend-test.html', 'setup-owner.html', 'sw.js', 'barcode.test.js'];
const served = fs.readdirSync(SRC).filter((f) => /\.(html|js|css|webmanifest)$/.test(f) && !NOT_SAVED.includes(f));
const missing = served.filter((f) => !shell.includes(f));
assert.deepEqual(missing, [], `Add to SHELL in sw.js: ${missing.join(', ')}`);
for (const f of shell) assert.ok(fs.existsSync(path.join(SRC, f)), `SHELL lists ${f}, which doesn't exist`);

// Every saved file, plus sw.js itself without its CACHE line.
const hash = crypto.createHash('sha256');
for (const f of [...shell].sort()) hash.update(`${f}\n`).update(fs.readFileSync(path.join(SRC, f)));
hash.update(sw.replace(/const CACHE = '[^']+';/, ''));
const fingerprint = hash.digest('hex');

if (process.argv.includes('--update')) {
  const old = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, 'utf8')) : null;
  assert.ok(!old || old.cache !== cache || old.fingerprint === fingerprint, `Bump CACHE in sw.js first (still ${cache}).`);
  fs.writeFileSync(RECORD, `${JSON.stringify({ cache, fingerprint }, null, 2)}\n`);
  console.log(`recorded ${cache}`);
  process.exit(0);
}
const recorded = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
if (recorded.fingerprint !== fingerprint) {
  assert.notEqual(cache, recorded.cache, `Files the phone saves changed but CACHE is still ${cache}: bump it in sw.js, `
    + 'then run node test/sw-version.js --update');
  assert.fail(`CACHE is now ${cache}: record it with node test/sw-version.js --update`);
}
assert.equal(recorded.cache, cache, 'CACHE changed with no file change: run node test/sw-version.js --update');
console.log(`sw version ok (${cache})`);
