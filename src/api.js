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

// Sends the user to the sign-in page unless signed in (and, with 'owner', the owner).
function requireLogin(role) {
  const session = getSession();
  if (!session) {
    location.replace('login.html');
    return null;
  }
  if (role === 'owner' && session.role !== 'owner') {
    location.replace('index.html');
    return null;
  }
  return session;
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
