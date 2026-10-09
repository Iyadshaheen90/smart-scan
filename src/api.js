// Talks to the Apps Script backend and remembers who is signed in on this phone.
// Needs config.js loaded first (for SMART_SCAN_API_URL).

const SESSION_STORAGE_KEY = 'smartScanSession';

// Makes the app installable to the home screen (see sw.js).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

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
        const summary = await api('submitClose', { closeId: pending.closeId, date: pending.date, entries: pending.entries });
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
  button.textContent = 'Try again';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Loading…';
    if (await load()) { el.className = 'message'; el.textContent = ''; }
  });
  el.append(button);
}

// CA Lottery settles (charges the store for) a pack 50–60 days after it's activated, sold or not.
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
  return `Game ${gameNumber}: ${packs} ${packs === 1 ? 'pack' : 'packs'} in back stock`;
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
