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

// Launch log (temporary, owner 2026-10-26: a header flashes before the launch screen on opening the app). Every page
// opened adds a line on this phone: when, which page, how it was opened, when it first drew, and what the launch screen
// did (window.splashNote from splash.js; Sign In passing a signed-in user on writes its own line). Read on Scanner Test.
// Remove once the flash is found.
const LAUNCH_LOG_KEY = 'smartScanLaunchLog';
function logLaunch(line) {
  try {
    const log = JSON.parse(localStorage.getItem(LAUNCH_LOG_KEY) || '[]');
    log.push(line);
    localStorage.setItem(LAUNCH_LOG_KEY, JSON.stringify(log.slice(-60)));
  } catch (e) {}
}
function launchLine(event) {
  const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
  const paint = (performance.getEntriesByType ? performance.getEntriesByType('paint') : []).map((p) => `${p.name.replace('first-', '')} ${Math.round(p.startTime)}`).join(', ');
  return `${new Date().toTimeString().slice(0, 8)} ${location.pathname.split('/').pop() || '(none)'} · ${event} · ${nav.type || '?'}`
    + ` · drew: ${paint || 'not yet'} · splash: ${window.splashNote || 'none on this page'}`
    + ` · ${navigator.standalone ? 'app' : 'browser'}${document.referrer ? ` · from ${document.referrer.split('/').pop()}` : ''}`;
}
window.addEventListener('pageshow', (e) => { if (e.persisted) logLaunch(launchLine('back from memory')); });
window.addEventListener('load', () => setTimeout(() => logLaunch(launchLine('opened')), 0));

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
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

const USE_DATABASE = typeof BACKEND !== 'undefined' && BACKEND === 'supabase';
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

// The session for a sign-in's tokens: the person's first store (by name) and who they are there.
async function dbSessionFor(tokens) {
  const r = await dbFetch('/rest/v1/rpc/my_stores', { body: {}, token: tokens.access_token });
  if (r.status >= 300) throw (r.data && r.data.hint ? new ApiError(r.data.hint, r.data.message) : serverError());
  const store = r.data[0];
  if (!store) throw new ApiError('bad_login', 'This account is no longer active.');
  return {
    backend: 'supabase',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessExpiresAt: Date.now() + tokens.expires_in * 1000,
    email: tokens.user && tokens.user.email,
    storeId: store.storeId,
    storeName: store.storeName,
    username: store.username,
    role: store.role,
    permissions: store.permissions,
    expiresAt: new Date(Date.now() + DB_SESSION_HOURS * 3600 * 1000).toISOString(),
  };
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
      if (r.status >= 500) throw serverError();
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

// The members Edge Function (invite, setPassword); it answers { ok, data, code, error } like Apps Script.
async function dbMembers(action, params) {
  const session = getSession();
  const r = await dbFetch('/functions/v1/members', { body: { action, storeId: session && session.storeId, ...params }, token: await freshToken() });
  if (r.data && r.data.ok) return r.data.data;
  if (r.data && r.data.code) throw new ApiError(r.data.code, r.data.error);
  if (r.status === 401) throw signedOut();
  throw serverError();
}

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
    if (String(password || '').length < 6) throw new ApiError('bad_password', 'Password must be at least 6 characters.');
    const r = await dbFetch('/auth/v1/user', { method: 'PUT', body: { password }, token: tokens.access_token });
    if (r.status === 401 || r.status === 403) {
      throw new ApiError('expired_link', 'This link has expired. Ask the owner for a new one, or use Forgot Password on the sign-in page.');
    }
    if (authErrorCode(r) === 'weak_password') throw new ApiError('bad_password', 'That password is too easy to guess. Try a longer one.');
    if (r.status >= 300 && authErrorCode(r) !== 'same_password') throw serverError();
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
    if (String(newPassword || '').length < 6) throw new ApiError('bad_password', 'Password must be at least 6 characters.');
    const r = await dbFetch('/auth/v1/user', { method: 'PUT', body: { password: newPassword }, token: tokens.access_token });
    if (authErrorCode(r) === 'same_password') throw new ApiError('bad_password', 'The new password is the same as the old one.');
    if (authErrorCode(r) === 'weak_password') throw new ApiError('bad_password', 'That password is too easy to guess. Try a longer one.');
    if (r.status >= 300) throw serverError();
    // A new password ends the person's other sign-ins, this phone's saved one too: keep the one just made.
    saveSession({ ...getSession(), accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      accessExpiresAt: Date.now() + tokens.expires_in * 1000 });
    return {};
  },
  // Manage Employees: an employee is added by email (they get an invite), not with a starting password.
  createUser: ({ username, email }) => dbMembers('invite', { username, email, redirectTo: setPasswordUrl() }),
  resetPassword: ({ username, newPassword }) => dbMembers('setPassword', { username, newPassword }),
  me: () => dbRpc('me', { p_store: getSession().storeId }),
  claimOwner: async () => { throw new ApiError('bad_request', 'With the database, a store and its owner are set up by Smart Scan.'); },
};

async function dbApi(action, params) {
  try {
    if (DB_ACTIONS[action]) return await DB_ACTIONS[action](params);
    const session = getSession();
    if (!session || !session.storeId) throw signedOut();
    const fn = action.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return await dbRpc(fn, { p_store: session.storeId, req: params });
  } catch (err) {
    if (err.code === 'unauthorized') {
      clearSession();
      location.href = 'login.html';
    }
    throw err;
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
