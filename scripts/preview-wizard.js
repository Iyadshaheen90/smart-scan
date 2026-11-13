// Lets the owner try the setup wizard (and the store it makes) in a browser, on the DEV project (test data only):
// serves src/ on this Mac with a dev config (database backend, sign-up open) and makes a fresh test account with no
// store. Sign in with the email and password it prints; the wizard opens. The live app and prod are not touched.
//   node scripts/preview-wizard.js           start (Ctrl+C stops it and cleans up)
//   node scripts/preview-wizard.js --clean   remove preview accounts and their stores left from an earlier run
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const os = require('os');
const { keys, http: call, service, URL } = require('../test/parity/harness');

const SRC = path.join(__dirname, '..', 'src');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const CONFIG = `const SMART_SCAN_API_URL = 'https://script.google.com/never-called';\nconst STORE_NAME = 'Smart Scan';\n`
  + `const BACKEND = 'supabase';\nconst SIGN_UP_OPEN = true;\nconst SUPABASE_URL = '${URL}';\nconst SUPABASE_ANON_KEY = '${keys().anon}';\n`;
const isPreview = (email) => /^preview-[0-9a-f]{6}@test\.invalid$/.test(String(email));

// Preview accounts, the stores they set up (handed to test_claim_store, then dropped), then the accounts themselves.
async function clean() {
  const listed = await call('GET', '/auth/v1/admin/users?per_page=200', { key: keys().service });
  for (const u of (listed.data.users || []).filter((x) => isPreview(x.email))) {
    const signedIn = await call('POST', '/auth/v1/admin/generate_link', { key: keys().service, body: { type: 'magiclink', email: u.email } });
    const token = signedIn.data && signedIn.data.hashed_token;
    let stores = [];
    if (token) {
      const session = await call('POST', '/auth/v1/verify', { key: keys().anon, body: { type: 'magiclink', token_hash: token } });
      if (session.data && session.data.access_token) {
        const mine = await call('POST', '/rest/v1/rpc/my_stores', { key: keys().anon, token: session.data.access_token, body: {} });
        stores = Array.isArray(mine.data) ? mine.data : [];
      }
    }
    for (const s of stores) {
      try { await service('test_claim_store', { p_store: s.storeId }); await service('test_drop_store', { p_store: s.storeId }); console.log(`removed store ${s.storeName}`); }
      catch (e) { console.log(`could not remove store ${s.storeName} (older than an hour?): ${e.message}`); }
    }
    await call('DELETE', `/auth/v1/admin/users/${u.id}`, { key: keys().service });
    console.log(`removed account ${u.email}`);
  }
}

(async () => {
  if (process.argv.includes('--clean')) { await clean(); return; }
  const email = `preview-${crypto.randomBytes(3).toString('hex')}@test.invalid`;
  const password = `${crypto.randomBytes(6).toString('base64url')}Aa1!`;
  const made = await call('POST', '/auth/v1/admin/users', { key: keys().service, body: { email, password, email_confirm: true } });
  if (made.status >= 300) throw new Error(JSON.stringify(made.data));
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]);
    if (name === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(CONFIG); }
    // No service worker here: every page comes fresh from the files on this Mac.
    if (name === '/sw.js') { res.writeHead(404); return res.end(); }
    const file = path.join(SRC, name === '/' ? 'login.html' : name);
    if (!file.startsWith(SRC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(8766, () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    console.log(`\nSetup wizard preview (dev project, test data only)\n  On this Mac:   http://localhost:8766/login.html`
      + (lan ? `\n  On the phone:  http://${lan.address}:8766/login.html  (same Wi-Fi)` : '')
      + `\n  Email:         ${email}\n  Password:      ${password}\n\nCtrl+C stops it and removes the account and its stores.`);
  });
  process.on('SIGINT', async () => { server.close(); try { await clean(); } catch (e) { console.log(e.message); } process.exit(0); });
  process.on('SIGTERM', async () => { server.close(); try { await clean(); } catch (e) { console.log(e.message); } process.exit(0); });
})().catch((e) => { console.error(e); process.exit(1); });
