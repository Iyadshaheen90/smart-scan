// Talks to the backend and remembers who is signed in on this phone: the Apps Script backend, or with BACKEND
// 'supabase' the database (see "The database" below; same actions, same answers). Needs config.js loaded first.

const SESSION_STORAGE_KEY = 'smartScanSession';

// Smart Scan is a third-party tool (owner 2026-10-26, for the App Store and Google Play): it never claims a lottery
// approved it, and never shows game names, lottery logos or pictures of tickets. Shown on Sign In and More → About.
const APP_DISCLAIMER = 'Smart Scan is an independent bookkeeping tool for retailers. It is not affiliated with, endorsed by'
  + ' or approved by the California State Lottery or any other lottery. It does not sell tickets or offer any game.';
// At the end of the Theft Report (screen, shared text and PDF), so it isn't taken for an official lottery form.
const REPORT_FOOTER = 'Made with Smart Scan, a third-party tool. Not an official lottery form.';

// Makes the app installable to the home screen, and opens pages from the phone's saved copy (see sw.js).
// The phone looks for a new deploy each time a page opens; an iPhone app brought back to the front opens
// no page, so it looks then too.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((registration) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  }).catch(() => {});
}

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Password rule (owner 2026-10-27): at least 8 characters with a capital letter, a lowercase letter, a number and one of
// ? ! @ # $ % &. The same check is in the Sheets backend (Auth.js passwordProblem) and the members Edge Function; pages
// check before sending and show PASSWORD_RULE under each new password field. Existing passwords keep working.
const PASSWORD_RULE = 'At least 8 characters, with a capital letter, a lowercase letter, a number and one of ? ! @ # $ % &';
// Each part of the rule, in order: the message's words and the check.
const PASSWORD_CHECKS = [
  { words: 'at least 8 characters', ok: (p) => p.length >= 8 },
  { words: 'a capital letter', ok: (p) => /[A-Z]/.test(p) },
  { words: 'a lowercase letter', ok: (p) => /[a-z]/.test(p) },
  { words: 'a number', ok: (p) => /[0-9]/.test(p) },
  { words: 'one of ? ! @ # $ % &', ok: (p) => /[?!@#$%&]/.test(p) },
];
// What a new password is missing ("Password needs a capital letter and a number."), or '' when it's fine.
function passwordProblem(password) {
  const p = String(password || '');
  const missing = PASSWORD_CHECKS.filter((c) => !c.ok(p)).map((c) => c.words);
  if (!missing.length) return '';
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Password needs ${list}.`;
}
// A new password can't be the one it replaces (owner 2026-10-27): Change My Password, the owner's Reset Password and
// Forgot Password. Same words in Auth.js and the members Edge Function.
const SAME_PASSWORD_MESSAGE = "The new password can't be the same as the last one.";
// Under a new password field (<ul class="password-rule"> right after it): the rule as a checklist that ticks off while they type
// (redesign 2026-10-29). Read aloud as the whole rule.
function showPasswordRule(list) {
  const before = list.previousElementSibling;
  const input = before.matches('input') ? before : before.querySelector('input');
  list.setAttribute('aria-label', PASSWORD_RULE);
  list.innerHTML = '';
  const items = PASSWORD_CHECKS.map((c) => {
    const li = document.createElement('li');
    li.textContent = c.words.charAt(0).toUpperCase() + c.words.slice(1);
    list.append(li);
    return li;
  });
  const update = () => PASSWORD_CHECKS.forEach((c, i) => items[i].classList.toggle('met', c.ok(String(input.value || ''))));
  input.addEventListener('input', update);
  update();
}
function checkNewPassword(password) {
  const problem = passwordProblem(password);
  if (problem) throw new ApiError('bad_password', problem);
}

function getSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || 'null');
    if (session && new Date(session.expiresAt) > new Date()) return session;
  } catch (e) {}
  return null;
}

function saveSession(session) {
  try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session)); } catch (e) {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (e) {}
}

// The signed-in store's name (every header, the Theft Report). On Sheets the session has none: config.js's name.
// On the database with nobody signed in (an invite or password link), no store is known yet: the app's name.
function storeName() {
  const session = getSession();
  if (session && session.storeName) return session.storeName;
  return USE_DATABASE ? 'Smart Scan' : STORE_NAME;
}

// The store's business day as yyyy-MM-dd, before the server has answered: the store's own time zone and day-end hour
// (a store open past midnight counts those hours to the day before), not the phone's. Without them (Sheets, or a
// sign-in from before they were sent) it's the phone's date, as before.
function storeToday() {
  const session = getSession() || {};
  const now = new Date(Date.now() - (Number(session.dayEndHour) || 0) * 3600 * 1000);
  if (session.timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: session.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(now).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch (e) {}
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// The email of the last person who signed in on this phone (owner 2026-11-12), so after the 12-hour sign-out Sign In
// only needs the password. Kept when signing out on purpose; Sign In can be typed over for someone else.
const LAST_EMAIL_KEY = 'smartScanLastEmail';
function rememberEmail(email) {
  try { if (email) localStorage.setItem(LAST_EMAIL_KEY, String(email).trim().toLowerCase()); } catch (e) {}
}
function lastEmail() {
  try { return localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch (e) { return ''; }
}

// Each backend request takes about 2 seconds, so a page first shows its last answer saved on this phone,
// then the fresh one. While the saved one shows, the body has class "showing-saved": elements marked
// .saved-dim are dimmed and .saved-lock can't be tapped (their buttons would act on old numbers).
// show(data, fresh) draws the page; it's called up to twice. Throws if the fresh answer fails.
async function loadSaved(name, request, show) {
  const session = getSession();
  const key = `smartScanSaved:${session ? session.username : ''}:${name}`;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
  if (saved) {
    document.body.classList.add('showing-saved');
    try { show(saved, false); } catch (e) {}
  }
  const data = await request();
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  document.body.classList.remove('showing-saved');
  show(data, true);
  return data;
}

// Sent as text/plain so the browser doesn't need a CORS preflight, which Apps Script can't answer.
async function api(action, params = {}) {
  if (USE_DATABASE) return dbApi(action, params);
  const session = getSession();
  let body;
  try {
    const res = await fetch(SMART_SCAN_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: session ? session.token : undefined, ...params }),
    });
    body = await res.json();
  } catch (err) {
    throw new ApiError('network', 'Could not reach the server. Check the internet connection and try again.');
  }
  if (!body.ok) {
    if (body.code === 'unauthorized') {
      clearSession();
      location.href = 'login.html';
    }
    // The cutover's lock (WebApp.js): this page is from before the move. Fetch the new version now, so the next page
    // opened uses the database.
    if (body.code === 'moved' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
    }
    throw new ApiError(body.code, body.error);
  }
  return body.data;
}

// --- The database (BACKEND 'supabase', the database move) ---
// Every action is a database function of the same name in snake_case (listSlots -> list_slots), called with the
// store and the request: { p_store, req }. Its answer is the same JSON as the Apps Script action's, and an error
// carries the app's code in its hint. Everyone signs in with their own email (Supabase Auth): the session keeps a
// short-lived access token, renewed with the refresh token when it runs out. Adding an employee and the owner setting
// someone's password go through the members Edge Function (only the server's secret key can do those).

// One phone on the database before the cutover (owner 2026-11-10, the side-by-side week): while BACKEND is still
// 'sheets', the owner can switch their own phone to the database (More → Try the Database) and do the same closes
// there to compare; every other phone stays on Sheets. It's kept on this phone only (an iPhone's home-screen app has
// its own storage, apart from Safari). From the cutover (BACKEND 'supabase') the switch is forgotten, so a rollback to
// 'sheets' puts every phone back on Sheets.
const PHONE_BACKEND_KEY = 'smartScanPhoneBackend';
const PHONE_SWITCH_OFFERED = typeof BACKEND !== 'undefined' && BACKEND === 'sheets'
  && typeof SUPABASE_URL !== 'undefined' && Boolean(SUPABASE_URL);
const PHONE_ON_DATABASE = (() => {
  try {
    if (!PHONE_SWITCH_OFFERED) {
      localStorage.removeItem(PHONE_BACKEND_KEY);
      return false;
    }
    return localStorage.getItem(PHONE_BACKEND_KEY) === 'database';
  } catch (e) {
    return false;
  }
})();

// Switches this phone (true: to the database, false: back to Sheets) and opens Sign In, since each one has its own
// sign-in. The pages' saved answers are from the other one, so they go too. Refused while a close is still waiting to
// be sent: it belongs to the backend it was made on.
async function switchPhoneBackend(toDatabase) {
  if (getPendingClose()) {
    throw new ApiError('pending_close', 'A close on this phone is still waiting to be sent. Open Close Day to send it first, then switch.');
  }
  if (getSession()) {
    try { await api('logout'); } catch (e) {}
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('smartScanSaved:') || key.startsWith('smartScanOwnerHome:'))) localStorage.removeItem(key);
    }
    if (toDatabase) localStorage.setItem(PHONE_BACKEND_KEY, 'database');
    else localStorage.removeItem(PHONE_BACKEND_KEY);
  } catch (e) {}
  clearSession();
  location.replace('login.html');
}

const USE_DATABASE = (typeof BACKEND !== 'undefined' && BACKEND === 'supabase') || PHONE_ON_DATABASE;
// Self sign-up and the setup wizard (config.js SIGN_UP_OPEN): database only.
const SIGN_UP_IS_OPEN = USE_DATABASE && typeof SIGN_UP_OPEN !== 'undefined' && Boolean(SIGN_UP_OPEN);
// Signed in for this long, as on the Apps Script backend (Auth.js SESSION_HOURS).
const DB_SESSION_HOURS = 12;

async function dbFetch(path, { method = 'POST', body, token } = {}) {
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, {
      method,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError('network', 'Could not reach the server. Check the internet connection and try again.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  return { status: res.status, data };
}

const serverError = () => new ApiError('server_error', 'Something went wrong on the server. Try again.');
const signedOut = () => new ApiError('unauthorized', 'Your session has ended. Please sign in again.');

// Supabase Auth's error code (newer servers say error_code, older ones code or error).
function authErrorCode(r) {
  return (r.data && (r.data.error_code || r.data.code || r.data.error)) || '';
}

// The session for a sign-in's tokens: the person's store and who they are there. With one store, that one; with
// several, the one this phone used last (many stores: the switcher), or none yet, and Your Stores asks (stores.html).
async function dbSessionFor(tokens) {
  const r = await dbFetch('/rest/v1/rpc/my_stores', { body: {}, token: tokens.access_token });
  if (r.status >= 300) throw (r.data && r.data.hint ? new ApiError(r.data.hint, r.data.message) : serverError());
  const stores = r.data;
  const email = tokens.user && tokens.user.email;
  const store = stores.length === 1 ? stores[0] : stores.find((x) => x.storeId === lastStore(email));
  // An account without a store: with self sign-up open it sets one up (setup.html); otherwise it was turned off.
  if (!stores.length && !SIGN_UP_IS_OPEN) throw new ApiError('bad_login', 'This account is no longer active.');
  return {
    backend: 'supabase',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessExpiresAt: Date.now() + tokens.expires_in * 1000,
    email,
    ...storeFields(store),
    storeCount: stores.length,
    expiresAt: new Date(Date.now() + DB_SESSION_HOURS * 3600 * 1000).toISOString(),
  };
}

// What the session keeps about the person's store (a my_stores row, or create_store's answer); no store: none of it.
function storeFields(store) {
  if (!store) return { storeId: null, storeName: null, storeNumber: null, timeZone: null, dayEndHour: null, username: null, role: null, permissions: [] };
  return {
    storeId: store.storeId,
    storeName: store.storeName,
    storeNumber: store.storeNumber,
    timeZone: store.timeZone,
    dayEndHour: store.dayEndHour,
    username: store.username,
    role: store.role,
    permissions: store.permissions,
  };
}

// Signed in on the database but not in a store: a new account before the setup wizard is finished, or someone on
// several stores who hasn't picked one on this phone yet.
function needsStore(session) {
  return Boolean(session) && session.backend === 'supabase' && !session.storeId;
}

// Where a signed-in person starts: Home; Your Stores to pick one of several; the setup wizard without any.
function startPage(session) {
  if (!needsStore(session)) return 'index.html';
  if (session.storeCount > 0) return 'stores.html';
  // No store at all: set one up, or (sign-up closed: someone whose last store just went) the page that offers to
  // delete the account too or sign out.
  return SIGN_UP_IS_OPEN ? 'setup.html' : 'delete.html';
}

// ---- Several stores (many stores, step 4) ----
// One account can be on several stores, with its own username, role and permissions in each. The session holds the
// store being used; the phone remembers it per email, so the next sign-in opens the same store.
const LAST_STORE_KEY = 'smartScanLastStore:';
function lastStore(email) {
  try { return localStorage.getItem(LAST_STORE_KEY + String(email || '').toLowerCase()) || ''; } catch (e) { return ''; }
}
function rememberStore(email, storeId) {
  try {
    if (storeId) localStorage.setItem(LAST_STORE_KEY + String(email || '').toLowerCase(), storeId);
    else localStorage.removeItem(LAST_STORE_KEY + String(email || '').toLowerCase());
  } catch (e) {}
}

// What the phone keeps about one store's work: the pages' saved answers and the drafts (a half-scanned close, a
// shipment being scanned, packs lined up for Activate Several). They belong to the store they were made in.
const STORE_WORK_KEYS = ['smartScanSaved:', 'smartScanOwnerHome:', 'smartScanCloseDraft', 'smartScanLateDraft', 'smartScanShiftDraft',
  'smartScanBackStockDraft', 'smartScanActivateSeveral:', 'smartScanCloseRefused'];
function clearStoreWork() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && STORE_WORK_KEYS.some((k) => key.startsWith(k))) localStorage.removeItem(key);
    }
    sessionStorage.removeItem(LAST_PAGE_KEY);
  } catch (e) {}
}

// Moves this phone into one of the person's stores (a my_stores row, or create_store's answer). Refused while a
// close is waiting to be sent: it belongs to the store it was made in. The other store's saved answers and drafts
// are cleared, so nothing of one store shows or gets sent in another. The way back is switching again.
function enterStore(store, storeCount) {
  const session = getSession();
  if (!session) throw signedOut();
  if (session.storeId && session.storeId !== store.storeId && getPendingClose()) {
    throw new ApiError('pending_close', 'A close on this phone is still waiting to be sent. Open Close Day to send it first, then switch.');
  }
  if (session.storeId !== store.storeId) clearStoreWork();
  saveSession({ ...session, ...storeFields(store), ...(storeCount == null ? {} : { storeCount }) });
  rememberStore(session.email, store.storeId);
}

// After the person lost the store they were in (they left it, it was deleted, or the owner took them off): their
// stores are read again. One left: the phone moves into it. Several: Your Stores asks. None: signed out, or with
// `stay` (they left or deleted it themselves) still signed in without a store, on the page that offers to delete the
// account too. Returns the page to open.
async function leaveCurrentStore(stay = false) {
  const session = getSession();
  clearStoreWork();
  clearPendingClose();
  rememberStore(session.email, '');
  let stores = [];
  try { stores = await dbRpc('my_stores', {}); } catch (e) {}
  if (!stores.length && stay) {
    saveSession({ ...getSession(), ...storeFields(null), storeCount: 0 });
    return 'delete.html';
  }
  if (!stores.length) {
    try { await DB_ACTIONS.logout(); } catch (e) {}
    clearSession();
    return 'login.html';
  }
  saveSession({ ...getSession(), ...storeFields(stores.length === 1 ? stores[0] : null), storeCount: stores.length });
  if (stores.length === 1) rememberStore(session.email, stores[0].storeId);
  return startPage(getSession());
}

async function dbSignIn(email, password) {
  const r = await dbFetch('/auth/v1/token?grant_type=password', { body: { email: String(email || '').trim(), password: String(password || '') } });
  if (r.status === 429) throw new ApiError('too_many_attempts', 'Too many tries. Wait a few minutes and try again.');
  if (authErrorCode(r) === 'email_not_confirmed') {
    throw new ApiError('bad_login', 'Open the invite email first and tap its link to choose a password.');
  }
  if (r.status >= 300) throw new ApiError('bad_login', 'Wrong email or password.');
  return r.data;
}

// An access token that's good for at least another minute, renewed if needed (one renewal at a time: each refresh
// token works once).
let refreshingToken = null;
async function freshToken(force = false) {
  const session = getSession();
  if (!session || !session.refreshToken) throw signedOut();
  if (!force && session.accessExpiresAt - 60 * 1000 > Date.now()) return session.accessToken;
  if (!refreshingToken) {
    refreshingToken = (async () => {
      const r = await dbFetch('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refreshToken } });
      // Busy or rate-limited isn't signed out: try again later, keep the sign-in.
      if (r.status >= 500 || r.status === 429) throw serverError();
      if (r.status >= 300) throw signedOut();
      saveSession({ ...getSession(), accessToken: r.data.access_token, refreshToken: r.data.refresh_token,
        accessExpiresAt: Date.now() + r.data.expires_in * 1000 });
      return r.data.access_token;
    })().finally(() => { refreshingToken = null; });
  }
  return refreshingToken;
}

// A database function as the signed-in person; a token the server no longer takes is renewed once.
async function dbRpc(fn, body) {
  let r = await dbFetch(`/rest/v1/rpc/${fn}`, { body, token: await freshToken() });
  if (r.status === 401) r = await dbFetch(`/rest/v1/rpc/${fn}`, { body, token: await freshToken(true) });
  if (r.status < 300) return r.data;
  if (r.data && r.data.hint) throw new ApiError(r.data.hint, r.data.message);
  if (r.status === 401) throw signedOut();
  throw serverError();
}

// An Edge Function (members: invite, setPassword, resendInvite; support: report); it answers { ok, data, code, error }
// like Apps Script.
// whole: the full answer ({ data, …what else the function says }) instead of only its data.
async function dbEdge(name, action, params, whole = false) {
  const session = getSession();
  const r = await dbFetch(`/functions/v1/${name}`, { body: { action, storeId: session && session.storeId, ...params }, token: await freshToken() });
  if (r.data && r.data.ok) return whole ? r.data : r.data.data;
  if (r.data && r.data.code) throw new ApiError(r.data.code, r.data.error);
  if (r.status === 401) throw signedOut();
  throw serverError();
}
const dbMembers = (action, params, whole) => dbEdge('members', action, params, whole);

// Where an invite or password email's link opens (allowed in the Supabase project's redirect list).
function setPasswordUrl() {
  return new URL('set-password.html', location.href).href;
}

// The actions that aren't a database function of the same name.
const DB_ACTIONS = {
  // Returns the session to save, like the Apps Script login.
  login: async ({ email, password }) => dbSessionFor(await dbSignIn(email, password)),
  // Signs out this phone only (other phones of the same person stay signed in, as before).
  logout: async () => {
    const session = getSession();
    if (session && session.accessToken) await dbFetch('/auth/v1/logout?scope=local', { body: {}, token: session.accessToken });
    return {};
  },
  // Emails a link to choose a new password; says nothing about whether the email has an account.
  forgotPassword: async ({ email }) => {
    const r = await dbFetch(`/auth/v1/recover?redirect_to=${encodeURIComponent(setPasswordUrl())}`, { body: { email: String(email || '').trim() } });
    if (r.status === 429) throw new ApiError('too_many_emails', 'Too many emails just now. Try again in an hour.');
    if (r.status >= 300 && r.status !== 404) throw serverError();
    return {};
  },
  // From an invite or password email's link (set-password.html): its tokens, then the new password. Returns the session.
  setNewPassword: async ({ tokens, password }) => {
    checkNewPassword(password);
    const r = await dbFetch('/auth/v1/user', { method: 'PUT', body: { password }, token: tokens.access_token });
    if (r.status === 401 || r.status === 403) {
      throw new ApiError('expired_link', 'This link has expired. Ask the owner for a new one, or use Forgot Password on the sign-in page.');
    }
    if (authErrorCode(r) === 'weak_password') throw new ApiError('bad_password', 'That password is too easy to guess. Try a different one.');
    if (authErrorCode(r) === 'same_password') throw new ApiError('bad_password', SAME_PASSWORD_MESSAGE);
    if (r.status >= 300) throw serverError();
    return dbSessionFor({ ...tokens, user: r.data || tokens.user });
  },
  // As changeOwnPassword: the current password must be right, then the new one is checked and saved.
  changePassword: async ({ currentPassword, newPassword }) => {
    const session = getSession();
    let tokens;
    try {
      tokens = await dbSignIn(session.email, currentPassword);
    } catch (err) {
      if (err.code === 'bad_login') throw new ApiError('bad_password', 'Your current password is wrong.');
      throw err;
    }
    checkNewPassword(newPassword);
    const r = await dbFetch('/auth/v1/user', { method: 'PUT', body: { password: newPassword }, token: tokens.access_token });
    if (authErrorCode(r) === 'same_password') throw new ApiError('bad_password', SAME_PASSWORD_MESSAGE);
    if (authErrorCode(r) === 'weak_password') throw new ApiError('bad_password', 'That password is too easy to guess. Try a different one.');
    if (r.status >= 300) throw serverError();
    // A new password ends the person's other sign-ins, this phone's saved one too: keep the one just made.
    saveSession({ ...getSession(), accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      accessExpiresAt: Date.now() + tokens.expires_in * 1000 });
    return {};
  },
  // Manage Employees: an employee is added by email (they get an invite), not with a starting password.
  createUser: ({ username, email }) => dbMembers('invite', { username, email, redirectTo: setPasswordUrl() }),
  // The same, saying whether the email already had a Smart Scan account (it then joined with its own sign-in and got
  // a plain "you were added" email): { users, existing, emailed }.
  inviteUser: async ({ username, email }) => {
    const r = await dbMembers('invite', { username, email, redirectTo: setPasswordUrl() }, true);
    return { users: r.data, existing: Boolean(r.existing), emailed: r.emailed !== false };
  },
  resetPassword: ({ username, newPassword }) => dbMembers('setPassword', { username, newPassword }),
  // Reset Password rule (owner 2026-11-12): { how: 'set' } the owner types a password (the account's only store is
  // this one), or { how: 'email' } the person is on another store too and gets a reset link instead.
  passwordHelp: ({ username }) => dbMembers('passwordHelp', { username }),
  sendPasswordReset: ({ username }) => dbMembers('sendReset', { username, redirectTo: setPasswordUrl() }),
  // A new invite email for someone who hasn't signed in yet (database only; the sheets have no emails).
  resendInvite: ({ username }) => dbMembers('resendInvite', { username, redirectTo: setPasswordUrl() }),
  me: () => dbRpc('me', { p_store: getSession().storeId }),
  // Create Account (self sign-up): Supabase Auth emails a link to confirm the address; it opens setup.html signed in.
  // Says the same for an email that already has an account (the server doesn't tell which).
  signUp: async ({ email, password }) => {
    checkNewPassword(password);
    const to = new URL('setup.html', location.href).href;
    const r = await dbFetch(`/auth/v1/signup?redirect_to=${encodeURIComponent(to)}`, { body: { email: String(email || '').trim(), password } });
    if (r.status === 429) throw new ApiError('too_many_emails', 'Too many tries just now. Wait a few minutes and try again.');
    if (authErrorCode(r) === 'weak_password') throw new ApiError('bad_password', 'That password is too easy to guess. Try a different one.');
    if (authErrorCode(r) === 'signup_disabled') throw new ApiError('sign_up_closed', 'Creating an account isn\'t open yet.');
    if (r.status === 400 || r.status === 422) throw new ApiError('bad_email', 'Enter your email address.');
    if (r.status >= 300) throw serverError();
    return {};
  },
  // The sign-in a confirmation email's link carries (setup.html): returns the session, without a store yet.
  sessionFromLink: async ({ tokens }) => {
    const r = await dbFetch('/auth/v1/user', { method: 'GET', token: tokens.access_token });
    if (r.status >= 300) throw new ApiError('expired_link', 'This link has expired or was already used. Sign in with your email and password.');
    return dbSessionFor({ ...tokens, user: r.data });
  },
  // The setup wizard's one call: makes the store with this account as its owner, and the session moves into it.
  createStore: async (params) => {
    // Checked before the store is made (enterStore would refuse after it): this phone moves into the new store.
    if (getSession().storeId && getPendingClose()) {
      throw new ApiError('pending_close', 'A close on this phone is still waiting to be sent. Open Close Day to send it first, then set up the new store.');
    }
    const store = await dbRpc('create_store', { req: params });
    enterStore(store, (Number(getSession().storeCount) || 0) + 1);
    return store;
  },
  // Every store the signed-in person is on (Your Stores); the session learns how many there are.
  myStores: async () => {
    const stores = await dbRpc('my_stores', {});
    if (getSession()) saveSession({ ...getSession(), storeCount: stores.length });
    return stores;
  },
  // An employee takes themselves off the store they're in. Answers the page to open next.
  leaveStore: async () => {
    await dbRpc('leave_store', { p_store: getSession().storeId, req: {} });
    return { next: await leaveCurrentStore(true) };
  },
  // The owner deletes the store they're in, typing its name. Answers the page to open next.
  deleteStore: async ({ name }) => {
    await dbMembers('deleteStore', { name });
    return { next: await leaveCurrentStore(true) };
  },
  // What stands in the way of deleting this account (owns_store), before asking for the password.
  accountDeleteCheck: () => dbRpc('account_delete_check', {}),
  // Deletes the signed-in person's own account, after their password. This phone forgets them.
  deleteAccount: async ({ password }) => {
    const session = getSession();
    await dbMembers('deleteAccount', { password });
    clearStoreWork();
    clearPendingClose();
    rememberStore(session.email, '');
    try { if (lastEmail() === String(session.email || '').toLowerCase()) localStorage.removeItem(LAST_EMAIL_KEY); } catch (e) {}
    clearSession();
    return {};
  },
  // Report a Problem (database only): the support Edge Function saves it, keeps the screenshots and emails support.
  reportProblem: (params) => dbEdge('support', 'report', params),
  claimOwner: async () => { throw new ApiError('bad_request', 'With the database, a store and its owner are set up by Smart Scan.'); },
};

async function dbApi(action, params) {
  try {
    if (DB_ACTIONS[action]) return await DB_ACTIONS[action](params);
    const session = getSession();
    if (!session || !session.storeId) throw signedOut();
    const fn = action.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    try {
      return await dbRpc(fn, { p_store: session.storeId, req: params });
    } catch (err) {
      // Refused: maybe this person isn't on the store any more (taken off, or the store was deleted). Then the phone
      // moves to a store they still have, or signs out, instead of staying on pages that can't load.
      if (err.code === 'forbidden' && !(await stillOnStore(session.storeId))) location.replace(await leaveCurrentStore());
      throw err;
    }
  } catch (err) {
    if (err.code === 'unauthorized') {
      clearSession();
      location.href = 'login.html';
    }
    throw err;
  }
}

// Is the signed-in person still on this store? (True when it can't be checked, so a hiccup changes nothing.)
async function stillOnStore(storeId) {
  try {
    return (await dbRpc('my_stores', {})).some((s) => s.storeId === storeId);
  } catch (e) {
    return true;
  }
}

// --- A close waiting to be sent ---
// Submit close saves the close on this phone first, then sends it. If the connection drops, it stays
// saved and is sent again (Close Day retries, and so does the home page) until the server answers.
// Its closeId lets the server spot a close it already saved, so sending twice is safe.

const PENDING_CLOSE_KEY = 'smartScanPendingClose';

function getPendingClose() {
  try { return JSON.parse(localStorage.getItem(PENDING_CLOSE_KEY) || 'null'); } catch (e) { return null; }
}

function savePendingClose(pending) {
  localStorage.setItem(PENDING_CLOSE_KEY, JSON.stringify(pending));
}

function clearPendingClose() {
  try { localStorage.removeItem(PENDING_CLOSE_KEY); } catch (e) {}
}

function newCloseId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Worth trying again later: no connection, a server hiccup, or signed out (it's sent after signing in).
function canRetryClose(err) {
  return ['network', 'server_error', 'unauthorized'].includes(err.code);
}

// Sends the saved close and returns the day's summary. If the server refuses it (for example a slot
// changed), the saved close is dropped and the error thrown; the scans are still in Close Day's draft.
let sendingClose = null;
function sendPendingClose() {
  if (!sendingClose) {
    sendingClose = (async () => {
      const pending = getPendingClose();
      if (!pending) return null;
      try {
        const summary = await api('submitClose', { closeId: pending.closeId, date: pending.date, entries: pending.entries,
          ...(pending.late ? { late: true } : {}) });
        clearPendingClose();
        return summary;
      } catch (err) {
        if (!canRetryClose(err)) clearPendingClose();
        throw err;
      }
    })().finally(() => { sendingClose = null; });
  }
  return sendingClose;
}

// Sends the user to the sign-in page unless signed in (and, with 'owner', the owner). A list of
// permissions instead lets in the owner or an employee the owner gave one of them to.
function requireLogin(role) {
  const session = getSession();
  if (!session) {
    location.replace('login.html');
    return null;
  }
  // Not in a store: a new account goes to the setup wizard, someone on several stores picks one.
  if (needsStore(session)) {
    location.replace(startPage(session));
    return null;
  }
  const allowed = Array.isArray(role) ? role.some((p) => can(session, p)) : role !== 'owner' || session.role === 'owner';
  if (!allowed) {
    location.replace('index.html');
    return null;
  }
  return session;
}

// What the owner turned on for an employee on Manage employees (the owner can do it all): load_packs,
// return_packs, receive_shipments, count_stock, full_pack_sale. The server checks it again on every request.
function can(session, permission) {
  return Boolean(session) && (session.role === 'owner' || (session.permissions || []).includes(permission));
}

// The employee home learns the current permissions on each load (the owner may have changed them).
function updateSessionPermissions(permissions) {
  const session = getSession();
  if (session && Array.isArray(permissions)) saveSession({ ...session, permissions });
}

async function signOut() {
  try { await api('logout'); } catch (e) {}
  clearSession();
  location.href = 'login.html';
}

function showMessage(el, text, kind = 'error') {
  el.className = `message ${kind}`;
  el.textContent = text;
  if (kind === 'error') rememberError(text);
}

// Report a Problem sends the last few red messages this phone showed and the last page used (owner 2026-10-31), so
// support sees what went wrong without anyone typing it. Kept for this visit only (sessionStorage).
const RECENT_ERRORS_KEY = 'smartScanRecentErrors';
const LAST_PAGE_KEY = 'smartScanLastPage';
function pageName() {
  return location.pathname.split('/').pop() || 'index.html';
}
function rememberError(text) {
  if (!text) return;
  try {
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const list = JSON.parse(sessionStorage.getItem(RECENT_ERRORS_KEY) || '[]');
    list.push(`${time} ${pageName()}: ${String(text).slice(0, 250)}`);
    sessionStorage.setItem(RECENT_ERRORS_KEY, JSON.stringify(list.slice(-5)));
  } catch (e) {}
}
function recentErrors() {
  try { return JSON.parse(sessionStorage.getItem(RECENT_ERRORS_KEY) || '[]'); } catch (e) { return []; }
}
// Pages that aren't where a problem happens (More, Help, the report itself, …) don't count as the last page.
const NOT_A_WORK_PAGE = ['more.html', 'help.html', 'report.html', 'store.html', 'account.html', 'raw-scanner.html'];
function rememberPage() {
  const page = pageName();
  if (NOT_A_WORK_PAGE.includes(page)) return;
  try { sessionStorage.setItem(LAST_PAGE_KEY, page + location.search); } catch (e) {}
}
function lastPage() {
  try { return sessionStorage.getItem(LAST_PAGE_KEY) || ''; } catch (e) { return ''; }
}
rememberPage();

// The app's version = the saved set of files the phone runs (sw.js CACHE "smart-scan-v47" → "Version 47"); '' if unknown.
async function appVersionLabel() {
  try {
    const keys = window.caches ? await caches.keys() : [];
    const versions = keys.map((k) => Number((k.match(/^smart-scan-v(\d+)$/) || [])[1])).filter(Boolean);
    return versions.length ? `Version ${Math.max(...versions)}` : '';
  } catch (e) {
    return '';
  }
}

// A page that couldn't load shows why, with a Try again button under it (owner 2026-10-04).
// load is the page's own loader: it returns true once loaded (the message then goes away); on a new
// failure it calls showLoadError again, which puts back a fresh button.
function showLoadError(el, err, load) {
  showMessage(el, err.message);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'try-again';
  button.textContent = 'Try Again';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Loading…';
    if (await load()) { el.className = 'message'; el.textContent = ''; }
  });
  el.append(button);
}

// The lottery settles (charges the store for) a pack 50–60 days after it's activated, sold or not.
// From this many days live, a pack is marked on Slots and listed on the Settling page.
const OLD_PACK_DAYS = 50;
// From this many days, it has most likely been settled already.
const SETTLED_PACK_DAYS = 60;

// Live packs at OLD_PACK_DAYS or more, longest-live first. From listSlots (or closeStatus.slots), so a
// pack that sells out or is returned drops off by itself.
function settlingPacks(slots) {
  return slots.filter((s) => s.pack && s.pack.daysActive != null && s.pack.daysActive >= OLD_PACK_DAYS)
    .sort((a, b) => b.pack.daysActive - a.pack.daysActive || a.box - b.box || a.slot - b.slot);
}

// Ticket order, the pages' copy of Tickets.js: each pack is sold descending (last ticket → 000) or ascending
// (000 → last ticket); `order` is pack.order (or slot.slotOrder for the next pack). The server checks again.
function ticketsSold(order, last, now) {
  return order === 'ascending' ? now - last : last - now;
}

// Tickets left once `top` is the top ticket (an ascending pack needs its pack size).
function ticketsLeftAt(order, top, size) {
  return order === 'ascending' ? size - top : top + 1;
}

// True for a ticket already sold: above the last top ticket when descending, below it when ascending.
function alreadySold(order, last, ticket) {
  return order === 'ascending' ? ticket < last : ticket > last;
}

function soldSide(order) {
  return order === 'ascending' ? 'below' : 'above';
}

// "Descending (029 → 000)" style words and the matching arrow icon name.
function orderName(order) {
  return order === 'ascending' ? 'Ascending' : 'Descending';
}
function orderIcon(order) {
  return order === 'ascending' ? 'arrowUp' : 'arrowDown';
}

// "Game 1747: 2 packs in back stock" — shown where a slot is (or is about to be) out of stock,
// for the game most likely to go back in it.
function backStockText(gameNumber, packs) {
  return `Game ${gameNumber}: ${packs} ${packs === 1 ? 'Pack' : 'Packs'} in Back Stock`;
}

// Disables a form's button while a request runs, so a double tap can't submit twice.
async function whileBusy(button, busyLabel, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}
