// The password rule (owner 2026-10-27): at least 8 characters with a capital letter, a lowercase letter, a number and one
// of ? ! @ # $ % &. It's written three times (the pages' api.js, the Sheets backend's Auth.js, the members Edge Function);
// all three must say exactly the same about every password. Then, on the Sheets backend: a new password can't be the one
// it replaces (Reset Password and Change My Password). Run: node test/password-rule.js
const fs = require('fs'); const vm = require('vm'); const path = require('path'); const assert = require('assert/strict');
const crypto = require('crypto');
const { fakeSheet, fakeSpreadsheet } = require('./fakes');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const pages = vm.createContext({ console });
vm.runInContext(src('src/api.js').replace(/^if \('serviceWorker'[\s\S]*?\n}\n/m, ''), pages);
const sheets = vm.createContext({ console });
vm.runInContext(`class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }
${src('src/apps-script/Auth.js').match(/function validateNewPassword[\s\S]*?\n}\n/)[0]}`, sheets);
// The Edge Function's copy, with its TypeScript types taken off.
const ts = src('supabase/functions/members/index.ts').match(/function passwordProblem[\s\S]*?\n}\n/)[0]
  .replace(/\(password: string\): string/, '(password)').replace(/const missing: string\[\] =/, 'const missing =');
const edge = vm.createContext({});
vm.runInContext(ts, edge);

const fromSheets = (p) => { try { vm.runInContext(`validateNewPassword(${JSON.stringify(p)})`, sheets); return ''; } catch (e) { assert.equal(e.code, 'bad_password'); return e.message; } };
const cases = {
  'Store#2026': '',
  'aB3?aaaa': '',
  'Route66&Liquor': '',
  '': 'Password needs at least 8 characters, a capital letter, a lowercase letter, a number and one of ? ! @ # $ % &.',
  'Ab1!': 'Password needs at least 8 characters.',
  'password': 'Password needs a capital letter, a number and one of ? ! @ # $ % &.',
  'PASSWORD1!': 'Password needs a lowercase letter.',
  'Password1': 'Password needs one of ? ! @ # $ % &.',
  'Password1*': 'Password needs one of ? ! @ # $ % &.', // other signs are allowed but don't count
  'Password!': 'Password needs a number.',
  'password1!': 'Password needs a capital letter.',
};
for (const [p, expected] of Object.entries(cases)) {
  assert.equal(vm.runInContext(`passwordProblem(${JSON.stringify(p)})`, pages), expected, `pages: ${p}`);
  assert.equal(fromSheets(p), expected, `Sheets: ${p}`);
  assert.equal(vm.runInContext(`passwordProblem(${JSON.stringify(p)})`, edge), expected, `Edge Function: ${p}`);
}
console.log('password rule: pages, Sheets and the Edge Function agree — OK');

// ---------- Sheets: not the same password again ----------
const sameMessage = "The new password can't be the same as the last one.";
for (const copy of ['src/api.js', 'src/apps-script/Auth.js', 'supabase/functions/members/index.ts']) {
  assert.ok(src(copy).includes(`const SAME_PASSWORD_MESSAGE = "${sameMessage}";`), `${copy} says it the same way`);
}
const bytes = (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map((b) => b & 255)));
const month = fakeSpreadsheet('m', { Users: fakeSheet(['username', 'password_hash', 'salt', 'role', 'active', 'created_date', 'permissions']),
  Sessions: fakeSheet(['token', 'username', 'issued_at', 'expires_at']) });
const users = vm.createContext({ console,
  Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, input) => [...crypto.createHash('sha256').update(bytes(input)).digest()].map((b) => (b > 127 ? b - 256 : b)),
    base64Encode: (b) => bytes(b).toString('base64') },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) } });
for (const f of ['Schema.js', 'Sheets.js', 'Auth.js', 'Permissions.js', 'Users.js']) vm.runInContext(src(`src/apps-script/${f}`), users);
users.openCurrentMonth = () => month;
const code = (js) => { try { vm.runInContext(js, users); return 'ok'; } catch (e) { return e.message; } };
assert.equal(code(`createUser('sam', 'First#pass1', 'employee')`), 'ok');
// The owner's Reset Password: their current one is refused, a new one is fine, and then that one is the one refused.
assert.equal(code(`resetPassword('sam', 'First#pass1')`), sameMessage);
assert.equal(code(`resetPassword('sam', 'Second#pass2')`), 'ok');
assert.equal(code(`resetPassword('sam', 'Second#pass2')`), sameMessage);
assert.equal(code(`resetPassword('nobody', 'Second#pass2')`), 'No such user.');
// Change My Password: the current one again is refused (after the current password is checked).
assert.equal(code(`changeOwnPassword({ username: 'sam' }, 'Wrong#pass9', 'Third#pass3')`), 'Your current password is wrong.');
assert.equal(code(`changeOwnPassword({ username: 'sam' }, 'Second#pass2', 'Second#pass2')`), sameMessage);
assert.equal(code(`changeOwnPassword({ username: 'sam' }, 'Second#pass2', 'Third#pass3')`), 'ok');
assert.equal(code(`changeOwnPassword({ username: 'sam' }, 'Third#pass3', 'Second#pass2')`), 'ok', 'only the last one is refused');
console.log('same password: refused on Reset Password and Change My Password (Sheets) — OK');
