// The password rule (owner 2026-10-27): at least 8 characters with a capital letter, a lowercase letter, a number and one
// of ? ! @ # $ % &. It's written three times (the pages' api.js, the Sheets backend's Auth.js, the members Edge Function);
// all three must say exactly the same about every password. Run: node test/password-rule.js
const fs = require('fs'); const vm = require('vm'); const path = require('path'); const assert = require('assert/strict');
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
