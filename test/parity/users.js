// Parity: Manage Employees (listUsers, setUserActive, setUserPermissions) on Sheets vs Supabase: the list, refusals
// (yourself, no such user, unknown permission, the owner), switches kept in PERMISSIONS order, turning someone off and
// back on. Then the database only: a turned-off account is signed out on its next request.
// Run: node test/parity/users.js
const assert = require('assert/strict');
const { parity } = require('./harness');

// The database also says each person's email and whether they've signed in yet; the sheets have neither, and their
// created dates come from different places.
const sameFields = (r) => (r.ok ? { ...r, data: r.data.map(({ createdDate, email, signedIn, ...u }) => u) } : r);

(async () => {
  const p = await parity({ today: '2026-10-26' });
  try {
    await p.seed({ slots: [{ box: 1, slot: 1, price: 20 }] });
    const list = await p.both('o', 'listUsers', {}, sameFields);
    assert.deepEqual(list.map((u) => [u.username, u.role, u.active]), [['o', 'owner', true], ['e', 'employee', true],
      ['loader', 'employee', true], ['sara', 'employee', true]]);
    await p.both('e', 'listUsers', {}, sameFields);

    // Permissions: refusals, then saved in PERMISSIONS order whatever order they came in.
    await p.both('o', 'setUserPermissions', { username: 'e', permissions: ['load_packs', 'fly'] }, sameFields);
    await p.both('o', 'setUserPermissions', { username: 'e', permissions: 'load_packs' }, sameFields);
    await p.both('o', 'setUserPermissions', { username: 'e', permissions: [7] }, sameFields);
    await p.both('o', 'setUserPermissions', { username: 'nobody', permissions: [] }, sameFields);
    await p.both('o', 'setUserPermissions', { username: 'o', permissions: [] }, sameFields);
    await p.both('sara', 'setUserPermissions', { username: 'e', permissions: [] }, sameFields);
    const after = await p.both('o', 'setUserPermissions', { username: ' E ', permissions: ['theft_report', 'load_packs', 'load_packs'] }, sameFields);
    assert.deepEqual(after.find((u) => u.username === 'e').permissions, ['load_packs', 'theft_report']);
    await p.both('o', 'setUserPermissions', { username: 'sara', permissions: [] }, sameFields);

    // Turning someone off and on.
    await p.both('o', 'setUserActive', { username: 'o', active: false }, sameFields);
    await p.both('o', 'setUserActive', { username: 'nobody', active: false }, sameFields);
    await p.both('o', 'setUserActive', { username: 'loader', active: 'yes' }, sameFields);
    await p.both('o', 'setUserActive', { username: 'loader', active: true }, sameFields);
    await p.both('o', 'setUserActive', { username: 'Loader', active: false }, sameFields);

    // The database signs a turned-off account out on its next request (the sheets end its sessions).
    const refused = await p.db.call('loader', 'closeStatus');
    assert.deepEqual(refused, { ok: false, code: 'unauthorized', error: 'This account is no longer active.' });
    await p.both('o', 'setUserActive', { username: 'loader', active: true }, sameFields);
    assert.equal((await p.db.call('loader', 'closeStatus')).ok, true);
    await p.both('o', 'listUsers', {}, sameFields);
    console.log('users parity: match');
  } finally {
    await p.done();
  }
})().catch((e) => { console.error(e); process.exit(1); });
