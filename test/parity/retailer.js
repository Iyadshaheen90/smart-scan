// Parity: the store's retailer number (Store.js) on Sheets vs Supabase: owner only to see or set it, digits only, and on
// the Theft Report for whoever makes it (employees with theft_report too). Then the database only: it's kept encrypted in
// Vault (the stored secret isn't the number) and goes with the test store. Uses a made-up number, never a real one.
// Run: node test/parity/retailer.js
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const { parity } = require('./harness');

const ROOT = path.join(__dirname, '..', '..');
const FAKE = '9990001';

// The test store's Vault row, read with the CLI (the API can't reach Vault at all).
function vaultRow(store, number) {
  const out = execFileSync('npx', ['--yes', 'supabase@2.122.0', 'db', 'query', '--linked', '-o', 'json',
    `select count(*)::int as n, bool_and(secret <> '${number}' and position('${number}' in secret) = 0) as encrypted
     from vault.secrets where name = 'retailer_number:${store}'`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('{'))).rows[0];
}

(async () => {
  const p = await parity({ today: '2026-10-26' });
  let dropped = false;
  try {
    await p.seed({ slots: [{ box: 1, slot: 1, price: 20 }], games: [{ game: '1747', price: 20, size: 30, inBack: 1 }],
      packs: [{ game: '1747', pack: '0012345', status: 'live', box: 1, slot: 1, price: 20, top: 24, activatedOn: '2026-10-01', lastCloseOn: '2026-10-25' }] });
    // Not entered yet.
    assert.equal((await p.both('o', 'theftReport', {})).retailerNumber, null);
    await p.both('o', 'getRetailerNumber');
    // Owner only, even for an employee with every permission.
    await p.both('e', 'getRetailerNumber');
    await p.both('sara', 'getRetailerNumber');
    await p.both('sara', 'setRetailerNumber', { retailerNumber: FAKE });
    // Digits only.
    for (const retailerNumber of [undefined, null, '', 'abc', '123', '12 34 56 78 90 123', 'l045204', 12.5]) {
      await p.both('o', 'setRetailerNumber', retailerNumber === undefined ? {} : { retailerNumber });
    }
    assert.deepEqual(await p.both('o', 'setRetailerNumber', { retailerNumber: ' 999-0001 ' }), { retailerNumber: FAKE });
    assert.deepEqual(await p.both('o', 'getRetailerNumber'), { retailerNumber: FAKE });
    // On the Theft Report for the owner and an employee with theft_report (both kinds of report); still refused without it.
    assert.equal((await p.both('o', 'theftReport', { full: true })).retailerNumber, FAKE);
    assert.equal((await p.both('sara', 'theftReport', {})).retailerNumber, FAKE);
    await p.both('e', 'theftReport', {});
    // Changed: a number typed as a number works too.
    assert.deepEqual(await p.both('o', 'setRetailerNumber', { retailerNumber: 99900020 }), { retailerNumber: '99900020' });
    assert.equal((await p.both('sara', 'theftReport', {})).retailerNumber, '99900020');

    // Database only: one Vault secret for the store, and what's stored isn't the number.
    assert.deepEqual(vaultRow(p.db.store, '99900020'), { n: 1, encrypted: true });
    await p.done();
    dropped = true;
    assert.deepEqual(vaultRow(p.db.store, '99900020'), { n: 0, encrypted: null });
    console.log('retailer number parity: match; encrypted in Vault, removed with the store');
  } finally {
    if (!dropped) await p.done();
  }
})().catch((e) => { console.error(e); process.exit(1); });
