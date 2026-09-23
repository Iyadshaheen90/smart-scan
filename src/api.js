// Talks to the Apps Script backend and remembers who is signed in on this phone.
// Needs config.js loaded first (for SMART_SCAN_API_URL).

const SESSION_STORAGE_KEY = 'smartScanSession';

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
