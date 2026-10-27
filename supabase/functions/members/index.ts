// Manage Employees on the database: adding an employee (invite by email) and the owner setting someone's password. Only
// the service key can make an account or change another person's password, so the page calls this function instead of
// the database. Every request is checked first with the caller's own sign-in by public.member_admin_check (owner of
// that store, the username and email rules), so this function only does what the owner may do.
//
//   POST { action: 'invite', storeId, username, email, redirectTo }  -> { ok, data: users } (+ testLink on a test store)
//   POST { action: 'setPassword', storeId, username, newPassword }   -> { ok, data: users }
//   errors: { ok: false, code, error }, like the Apps Script backend.
//
// The invite email's link opens redirectTo (set-password.html), where the employee chooses a password. A test store
// gets the link back instead of an email (the browser test opens it).
// Deploy: npx --yes supabase@2.122.0 functions deploy members --use-api

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const answer = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } });

// A database function, as the caller (their token) or with the service key.
async function rpc(fn: string, body: unknown, token: string) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(body),
    headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => null);
  if (res.ok) return data;
  if (data && data.hint) throw new ApiError(data.hint, data.message);
  if (res.status === 401) throw new ApiError('unauthorized', 'Your session has ended. Please sign in again.');
  throw new Error(`${fn}: ${res.status} ${JSON.stringify(data)}`);
}

// Supabase Auth's admin API (service key).
async function admin(method: string, path: string, body?: unknown) {
  const res = await fetch(`${URL}/auth/v1${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function invite(token: string, req: Record<string, string>) {
  const checked = await rpc('member_admin_check', { p_store: req.storeId, req: { action: 'invite', username: req.username, email: req.email } }, token);
  const redirectTo = String(req.redirectTo || '');
  // A test store: make the account and hand back its link (nothing is emailed). Otherwise Supabase emails the invite.
  const made = checked.isTest
    ? await admin('POST', '/admin/generate_link', { type: 'invite', email: checked.email, redirect_to: redirectTo })
    : await admin('POST', `/invite?redirect_to=${encodeURIComponent(redirectTo)}`, { email: checked.email });
  if (!made.ok) {
    const code = made.data && (made.data.error_code || made.data.code);
    if (code === 'email_exists' || /already been registered/i.test(JSON.stringify(made.data))) {
      throw new ApiError('email_exists', 'That email already has a Smart Scan account. Use a different email.');
    }
    if (made.status === 429) throw new ApiError('too_many_emails', 'Too many invite emails just now. Try again in an hour.');
    throw new Error(`invite: ${made.status} ${JSON.stringify(made.data)}`);
  }
  const user = checked.isTest ? made.data.user || made.data : made.data;
  try {
    const users = await rpc('service_add_member', { p_store: req.storeId, p_user: user.id, req: { username: checked.username, email: checked.email } }, SERVICE);
    return checked.isTest ? { data: users, testLink: made.data.action_link || made.data.properties?.action_link } : { data: users };
  } catch (e) {
    // Don't leave an account that isn't on any store.
    await admin('DELETE', `/admin/users/${user.id}`);
    throw e;
  }
}

// Password rule (owner 2026-10-27): at least 8 characters with a capital letter, a lowercase letter, a number and one of
// ? ! @ # $ % &. Same check and words as passwordProblem in src/api.js and validateNewPassword in Auth.js.
function passwordProblem(password: string): string {
  const p = String(password || '');
  const missing: string[] = [];
  if (p.length < 8) missing.push('at least 8 characters');
  if (!/[A-Z]/.test(p)) missing.push('a capital letter');
  if (!/[a-z]/.test(p)) missing.push('a lowercase letter');
  if (!/[0-9]/.test(p)) missing.push('a number');
  if (!/[?!@#$%&]/.test(p)) missing.push('one of ? ! @ # $ % &');
  if (!missing.length) return '';
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Password needs ${list}.`;
}

async function setPassword(token: string, req: Record<string, string>) {
  // resetPassword's order: the password first, then the person.
  const problem = passwordProblem(req.newPassword);
  if (problem) throw new ApiError('bad_password', problem);
  const checked = await rpc('member_admin_check', { p_store: req.storeId, req: { action: 'setPassword', username: req.username } }, token);
  // Confirmed too, so someone who never opened the invite email can sign in with the password the owner gives them.
  const changed = await admin('PUT', `/admin/users/${checked.userId}`, { password: req.newPassword, email_confirm: true });
  if (!changed.ok) {
    const code = changed.data && (changed.data.error_code || changed.data.code);
    if (code === 'weak_password') throw new ApiError('bad_password', 'That password is too easy to guess. Try a different one.');
    throw new Error(`setPassword: ${changed.status} ${JSON.stringify(changed.data)}`);
  }
  return { data: await rpc('list_users', { p_store: req.storeId, req: {} }, token) };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const req = await request.json();
    const run = req.action === 'invite' ? invite : req.action === 'setPassword' ? setPassword : null;
    if (!run) throw new ApiError('bad_request', 'Unknown request.');
    return answer({ ok: true, ...(await run(token, req)) });
  } catch (e) {
    if (e instanceof ApiError) return answer({ ok: false, code: e.code, error: e.message });
    console.error(e);
    return answer({ ok: false, code: 'server_error', error: 'Something went wrong on the server. Try again.' });
  }
});
