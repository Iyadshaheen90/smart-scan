// Username/password logins, sessions, and role checks. Users and Sessions live in the current
// month's spreadsheet; Start New Month carries Users forward but not Sessions (everyone signs in again).

const ROLES = ['owner', 'employee'];
const SESSION_HOURS = 12;
const HASH_ITERATIONS = 1000;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;
const OWNER_SETUP_CODE_PROPERTY = 'OWNER_SETUP_CODE';
const OWNER_SETUP_CODE_MINUTES = 60;

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// --- Passwords and tokens ---

function hashPassword(password, salt, iterations = HASH_ITERATIONS) {
  let bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${salt}:${password}`, Utilities.Charset.UTF_8);
  for (let i = 1; i < iterations; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  return `sha256$${iterations}$${Utilities.base64Encode(bytes)}`;
}

function verifyPassword(password, salt, stored) {
  const iterations = Number(String(stored).split('$')[1]);
  if (!iterations) return false;
  const actual = hashPassword(password, salt, iterations);
  // Compare every character so timing doesn't reveal how much matched.
  let diff = actual.length ^ stored.length;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ String(stored).charCodeAt(i);
  return diff === 0;
}

function randomToken() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

// Sessions store only a hash of the token, so someone reading the sheet can't sign in as anyone.
function hashToken(token) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8)
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, '0'))
    .join('');
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function validateNewCredentials(username, password) {
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    throw new ApiError('bad_username', 'Username must be 3-30 characters: letters, numbers, dot, dash or underscore.');
  }
  validateNewPassword(password);
}

// Password rule (owner 2026-10-27): at least 8 characters with a capital letter, a lowercase letter, a number and one of
// ? ! @ # $ % &. Same check and words as passwordProblem in api.js. Only new passwords are checked: existing ones still sign in.
// A new password can't be the one it replaces (owner 2026-10-27). Same words in api.js and the members Edge Function.
const SAME_PASSWORD_MESSAGE = "The new password can't be the same as the last one.";

function validateNewPassword(password) {
  const p = String(password || '');
  const missing = [];
  if (p.length < 8) missing.push('at least 8 characters');
  if (!/[A-Z]/.test(p)) missing.push('a capital letter');
  if (!/[a-z]/.test(p)) missing.push('a lowercase letter');
  if (!/[0-9]/.test(p)) missing.push('a number');
  if (!/[?!@#$%&]/.test(p)) missing.push('one of ? ! @ # $ % &');
  if (!missing.length) return;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  throw new ApiError('bad_password', `Password needs ${list}.`);
}

// --- Sessions ---

function monthSheet(name) {
  return openCurrentMonth().getSheetByName(name);
}

function findUser(username) {
  return readTable(monthSheet('Users')).find((u) => u.username === username) || null;
}

function startSession(user) {
  const token = randomToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  const sessions = monthSheet('Sessions');
  deleteRowsWhere(sessions, (s) => new Date(s.expires_at) < now);
  appendObject(sessions, { token: hashToken(token), username: user.username, issued_at: now, expires_at: expires });
  return { token, username: user.username, role: user.role, permissions: permissionsOf(user), expiresAt: expires.toISOString() };
}

function login(username, password) {
  username = normalizeUsername(username);
  const cache = CacheService.getScriptCache();
  const failKey = `loginFailures:${username}`;
  const failures = Number(cache.get(failKey) || 0);
  if (failures >= MAX_LOGIN_FAILURES) {
    throw new ApiError('too_many_attempts', 'Too many wrong attempts. Try again in 15 minutes.');
  }

  const user = findUser(username);
  if (!user || user.active !== true || !verifyPassword(String(password || ''), user.salt, user.password_hash)) {
    cache.put(failKey, String(failures + 1), LOGIN_LOCKOUT_SECONDS);
    throw new ApiError('bad_login', 'Wrong username or password.');
  }
  cache.remove(failKey);
  return withLock(() => startSession(user));
}

function logout(token) {
  if (!token) return {};
  const hash = hashToken(token);
  withLock(() => deleteRowsWhere(monthSheet('Sessions'), (s) => s.token === hash));
  return {};
}

// Returns { username, role, permissions } for a valid session, or throws. Pass 'owner' to require the owner.
function requireSession(token, requiredRole) {
  if (!token) throw new ApiError('unauthorized', 'Please sign in.');
  const hash = hashToken(token);
  const session = readTable(monthSheet('Sessions')).find((s) => s.token === hash);
  if (!session || new Date(session.expires_at) < new Date()) {
    throw new ApiError('unauthorized', 'Your session has ended. Please sign in again.');
  }
  const user = findUser(session.username);
  if (!user || user.active !== true) {
    throw new ApiError('unauthorized', 'This account is no longer active.');
  }
  if (requiredRole === 'owner' && user.role !== 'owner') {
    throw new ApiError('forbidden', 'Only the owner can do that.');
  }
  return { username: user.username, role: user.role, permissions: permissionsOf(user) };
}

function endSessionsFor(username) {
  deleteRowsWhere(monthSheet('Sessions'), (s) => s.username === username);
}

// --- First owner account ---

// Run by hand from the Apps Script editor. Logs a one-time code that the owner enters on
// setup-owner.html to create their login. Only works while no owner exists.
function createOwnerSetupCode() {
  if (readTable(monthSheet('Users')).some((u) => u.role === 'owner')) {
    throw new Error('An owner account already exists.');
  }
  const code = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  const expires = Date.now() + OWNER_SETUP_CODE_MINUTES * 60 * 1000;
  PropertiesService.getScriptProperties().setProperty(OWNER_SETUP_CODE_PROPERTY, JSON.stringify({ code, expires }));
  Logger.log('Owner setup code: %s (valid for %s minutes)', code, OWNER_SETUP_CODE_MINUTES);
}

function claimOwner(setupCode, username, password) {
  return withLock(() => {
    const props = PropertiesService.getScriptProperties();
    const saved = JSON.parse(props.getProperty(OWNER_SETUP_CODE_PROPERTY) || 'null');
    const entered = String(setupCode || '').trim().toUpperCase();
    if (!saved || saved.expires < Date.now() || saved.code !== entered) {
      throw new ApiError('bad_setup_code', 'That setup code is wrong or has expired.');
    }
    if (readTable(monthSheet('Users')).some((u) => u.role === 'owner')) {
      throw new ApiError('owner_exists', 'An owner account already exists.');
    }
    username = normalizeUsername(username);
    validateNewCredentials(username, password);
    const user = addUser(username, password, 'owner');
    props.deleteProperty(OWNER_SETUP_CODE_PROPERTY);
    return startSession(user);
  });
}
