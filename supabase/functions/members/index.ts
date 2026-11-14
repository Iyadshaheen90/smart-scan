// Manage Employees on the database: adding an employee (invite by email), sending the invite again, and the owner
// setting someone's password. Only the service key can make an account or change another person's password, so the
// page calls this function instead of the database. Every request is checked first with the caller's own sign-in by
// public.member_admin_check (owner of that store, the username and email rules), so this function only does what the
// owner may do. Also here, because they need the service key too: deleting a store's screenshots with the store, and
// deleting the caller's own account.
//
//   POST { action: 'invite', storeId, username, email, redirectTo }  -> { ok, data: users } (+ testLink on a test store)
//        an email that already has an account is added to the store and gets a plain "you were added" email instead:
//        -> { ok, data: users, existing: true, emailed } (+ testEmail on a test store, nothing sent)
//   POST { action: 'passwordHelp', storeId, username }               -> { ok, data: { how: 'set' | 'email' } }
//   POST { action: 'setPassword', storeId, username, newPassword }   -> { ok, data: users }; refused (shared_account)
//        for someone who is on another store too
//   POST { action: 'sendReset', storeId, username, redirectTo }      -> { ok, data: {} } (+ testLink on a test store)
//   POST { action: 'resendInvite', storeId, username, redirectTo }   -> { ok, data: users } (+ testLink on a test store)
//   POST { action: 'deleteStore', storeId, name }                    -> { ok, data: { deleted, storeName } }
//   POST { action: 'deleteAccount', password }                       -> { ok, data: { deleted } }
//   errors: { ok: false, code, error }, like the Apps Script backend.
//
// The invite email's link opens redirectTo (set-password.html), where the employee chooses a password. A test store
// gets the link back instead of an email (the browser test opens it).
//
// Reset Password rule (owner 2026-11-12): the owner types a password only for an account whose only store is theirs.
// Someone on another store too (as an employee or its owner) gets a reset email instead, so one owner can never take
// over an account that another store relies on.
// Deploy: npx --yes supabase@2.122.0 functions deploy members --use-api

import { type Mail, sendMail } from './mail.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Where the app's pages are (the "you were added" email's Sign In button).
const APP_URL = Deno.env.get('APP_URL') || 'https://iyadshaheen90.github.io/smart-scan/src/';
// Problem report screenshots (the support function keeps them here, under <store id>/<report number>/).
const BUCKET = 'problem-screenshots';

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

const escapeHtml = (text: unknown) => String(text ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The email for someone who already has a Smart Scan account and was added to another store. No lottery names,
// logos or pictures (owner's rule); the independent-tool line at the bottom, as in the invite.
function addedEmail(storeName: string, email: string): Mail {
  const signIn = `${APP_URL}login.html`;
  const fine = 'Smart Scan is an independent bookkeeping tool for retailers. It is not affiliated with, endorsed by or approved by any lottery.';
  const text = [
    `${storeName} added you to its store on Smart Scan.`,
    '',
    `Sign in with this email (${email}) and the password you already use. Then pick ${storeName} from your stores:`,
    'More > Switch Store.',
    '',
    `Sign in: ${signIn}`,
    '',
    "Forgot your password? Tap Forgot Password on the sign-in page.",
    "If you weren't expecting this, sign in and use More > Leave Store, or ignore this email.",
    '',
    fine,
  ].join('\n');
  const html = `<div style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #111; max-width: 480px;">`
    + `<h2 style="margin: 0 0 12px;">You Were Added to ${escapeHtml(storeName)}</h2>`
    + `<p>${escapeHtml(storeName)} added you to its store on Smart Scan.</p>`
    + `<p>Sign in with this email (${escapeHtml(email)}) and the password you already use. Then pick ${escapeHtml(storeName)} from your stores: More &rsaquo; Switch Store.</p>`
    + `<p style="margin: 24px 0;"><a href="${escapeHtml(signIn)}" style="background: #2f9e67; color: #fff; text-decoration: none; font-weight: bold; padding: 12px 20px; border-radius: 10px; display: inline-block;">Sign In</a></p>`
    + `<p>Forgot your password? Tap Forgot Password on the sign-in page.</p>`
    + `<p style="color: #666; font-size: 13px;">If you weren't expecting this, sign in and use More &rsaquo; Leave Store, or ignore this email.</p>`
    + `<p style="color: #666; font-size: 12px;">${escapeHtml(fine)}</p></div>`;
  return { subject: `You Were Added to ${storeName} on Smart Scan`, text, html };
}

async function invite(token: string, req: Record<string, string>) {
  const checked = await rpc('member_admin_check', { p_store: req.storeId, req: { action: 'invite', username: req.username, email: req.email } }, token);
  const redirectTo = String(req.redirectTo || '');
  const member = { username: checked.username, email: checked.email };
  // An email that already has a Smart Scan account (it works at, or owns, another store): it joins this store with
  // the sign-in it has, and gets a plain email saying so. The account itself isn't touched.
  const account = await rpc('service_account_info', { req: { email: checked.email } }, SERVICE);
  if (account.userId) {
    const users = await rpc('service_add_member', { p_store: req.storeId, p_user: account.userId, req: member }, SERVICE);
    const mail = addedEmail(checked.storeName, checked.email);
    if (checked.isTest) return { data: users, existing: true, emailed: false, testEmail: mail };
    // They are on the store either way; the owner is told when the email didn't go.
    let emailed = true;
    try {
      await sendMail(checked.email, mail);
    } catch (e) {
      emailed = false;
      console.error(`added email: ${(e as Error).message}`);
    }
    return { data: users, existing: true, emailed };
  }
  // A test store: make the account and hand back its link (nothing is emailed). Otherwise Supabase emails the invite.
  const made = checked.isTest
    ? await admin('POST', '/admin/generate_link', { type: 'invite', email: checked.email, redirect_to: redirectTo })
    : await admin('POST', `/invite?redirect_to=${encodeURIComponent(redirectTo)}`, { email: checked.email });
  if (!made.ok) {
    if (made.status === 429) throw new ApiError('too_many_emails', 'Too many invite emails just now. Try again in an hour.');
    throw new Error(`invite: ${made.status} ${JSON.stringify(made.data)}`);
  }
  const user = checked.isTest ? made.data.user || made.data : made.data;
  try {
    const users = await rpc('service_add_member', { p_store: req.storeId, p_user: user.id, req: member }, SERVICE);
    return checked.isTest ? { data: users, testLink: made.data.action_link || made.data.properties?.action_link } : { data: users };
  } catch (e) {
    // Don't leave an account (one this request made) that isn't on any store.
    await admin('DELETE', `/admin/users/${user.id}`);
    throw e;
  }
}

// Resend Invite (owner 2026-10-29): a new invite email for someone who hasn't signed in yet (the old link expired or
// got lost). Supabase Auth sends a fresh one to an account that isn't confirmed; once the owner set them a password it's
// confirmed, so Auth refuses and they sign in with that password.
async function resendInvite(token: string, req: Record<string, string>) {
  const checked = await rpc('member_admin_check', { p_store: req.storeId, req: { action: 'resendInvite', username: req.username } }, token);
  const redirectTo = String(req.redirectTo || '');
  const sent = checked.isTest
    ? await admin('POST', '/admin/generate_link', { type: 'invite', email: checked.email, redirect_to: redirectTo })
    : await admin('POST', `/invite?redirect_to=${encodeURIComponent(redirectTo)}`, { email: checked.email });
  if (!sent.ok) {
    const code = sent.data && (sent.data.error_code || sent.data.code);
    if (code === 'email_exists' || /already been registered/i.test(JSON.stringify(sent.data))) {
      throw new ApiError('has_password', `${checked.username} already has a password. They can sign in with it, or use Forgot Password.`);
    }
    if (sent.status === 429) throw new ApiError('too_many_emails', 'Too many invite emails just now. Try again in an hour.');
    throw new Error(`resendInvite: ${sent.status} ${JSON.stringify(sent.data)}`);
  }
  const users = await rpc('list_users', { p_store: req.storeId, req: {} }, token);
  return checked.isTest ? { data: users, testLink: sent.data.action_link || sent.data.properties?.action_link } : { data: users };
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

// A new password can't be the one it replaces (owner 2026-10-27). Same words in src/api.js and Auth.js.
const SAME_PASSWORD_MESSAGE = "The new password can't be the same as the last one.";

async function setPassword(token: string, req: Record<string, string>) {
  // resetPassword's order: the password first, then the person.
  const problem = passwordProblem(req.newPassword);
  if (problem) throw new ApiError('bad_password', problem);
  const checked = await rpc('member_admin_check', { p_store: req.storeId, req: { action: 'setPassword', username: req.username } }, token);
  if (await onAnotherStore(checked.userId)) {
    throw new ApiError('shared_account', `${checked.username} also uses Smart Scan at another store, so only they can choose their password. Tap Reset Password to email them a link.`);
  }
  // The admin API doesn't refuse their current password (signing in and Forgot Password do): the database compares it.
  if (await rpc('service_is_current_password', { p_user: checked.userId, p_password: req.newPassword }, SERVICE)) {
    throw new ApiError('bad_password', SAME_PASSWORD_MESSAGE);
  }
  // Confirmed too, so someone who never opened the invite email can sign in with the password the owner gives them.
  const changed = await admin('PUT', `/admin/users/${checked.userId}`, { password: req.newPassword, email_confirm: true });
  if (!changed.ok) {
    const code = changed.data && (changed.data.error_code || changed.data.code);
    if (code === 'weak_password') throw new ApiError('bad_password', 'That password is too easy to guess. Try a different one.');
    throw new Error(`setPassword: ${changed.status} ${JSON.stringify(changed.data)}`);
  }
  return { data: await rpc('list_users', { p_store: req.storeId, req: {} }, token) };
}

// Is this account on any store besides the one asking? (The Reset Password rule.)
async function onAnotherStore(userId: string) {
  const account = await rpc('service_account_info', { req: { userId } }, SERVICE);
  return Number(account.stores) > 1;
}

// What Reset Password does for this person: 'set' (the owner types a password) or 'email' (a reset link goes to them).
async function passwordHelp(token: string, req: Record<string, string>) {
  const checked = await rpc('member_admin_check', { p_store: req.storeId, req: { action: 'setPassword', username: req.username } }, token);
  return { data: { how: await onAnotherStore(checked.userId) ? 'email' : 'set', username: checked.username } };
}

// Emails the person a link to choose a new password (the same email as Forgot Password). A test store gets the link
// back instead.
async function sendReset(token: string, req: Record<string, string>) {
  const checked = await rpc('member_admin_check', { p_store: req.storeId, req: { action: 'setPassword', username: req.username } }, token);
  const account = await rpc('service_account_info', { req: { userId: checked.userId } }, SERVICE);
  if (!account.email) throw new ApiError('no_email', `${checked.username} has no email on file.`);
  const redirectTo = String(req.redirectTo || '');
  if (checked.isTest) {
    const made = await admin('POST', '/admin/generate_link', { type: 'recovery', email: account.email, redirect_to: redirectTo });
    if (!made.ok) throw new Error(`sendReset: ${made.status} ${JSON.stringify(made.data)}`);
    return { data: {}, testLink: made.data.action_link || made.data.properties?.action_link };
  }
  const res = await fetch(`${URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST',
    body: JSON.stringify({ email: account.email }), headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' } });
  if (res.status === 429) throw new ApiError('too_many_emails', 'Too many emails just now. Try again in an hour.');
  if (!res.ok) throw new Error(`sendReset: ${res.status} ${await res.text()}`);
  return { data: {} };
}

// Delete Store (owner): the database checks the owner and the typed name and removes everything the store has; the
// screenshots of its problem reports are files, removed here. The store is already gone if that fails, so it only logs.
async function deleteStore(token: string, req: Record<string, string>) {
  const storeId = String(req.storeId || '');
  const gone = await rpc('delete_store', { p_store: storeId, req: { name: req.name } }, token);
  const storage = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  try {
    const paths: string[] = [];
    for (const number of gone.screenshotReports || []) {
      const folder = `${storeId}/${number}`;
      const listed = await fetch(`${URL}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: storage,
        body: JSON.stringify({ prefix: folder, limit: 10 }) });
      if (!listed.ok) throw new Error(`list ${folder}: ${listed.status}`);
      for (const file of await listed.json()) paths.push(`${folder}/${file.name}`);
    }
    if (paths.length) {
      const removed = await fetch(`${URL}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: storage, body: JSON.stringify({ prefixes: paths }) });
      if (!removed.ok) throw new Error(`remove: ${removed.status} ${await removed.text()}`);
    }
  } catch (e) {
    console.error(`deleteStore ${storeId} screenshots: ${(e as Error).message}`);
  }
  return { data: { deleted: true, storeName: gone.storeName } };
}

// Delete My Account: the caller's own sign-in, for good. Refused while the account owns a store (the database says
// which); the password is asked again, so a phone left open can't do it. Their places on stores go with the account;
// what they did keeps their username.
async function deleteAccount(token: string, req: Record<string, string>) {
  const who = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!who.ok) throw new ApiError('unauthorized', 'Your session has ended. Please sign in again.');
  const user = await who.json();
  await rpc('account_delete_check', {}, token);
  const signIn = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST',
    body: JSON.stringify({ email: user.email, password: String(req.password || '') }),
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' } });
  if (signIn.status === 429) throw new ApiError('too_many_attempts', 'Too many tries. Wait a few minutes and try again.');
  if (!signIn.ok) throw new ApiError('bad_password', 'Your password is wrong.');
  const removed = await admin('DELETE', `/admin/users/${user.id}`);
  if (!removed.ok) throw new Error(`deleteAccount: ${removed.status} ${JSON.stringify(removed.data)}`);
  return { data: { deleted: true } };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const req = await request.json();
    const actions: Record<string, (token: string, req: Record<string, string>) => Promise<Record<string, unknown>>> = {
      invite, setPassword, resendInvite, passwordHelp, sendReset, deleteStore, deleteAccount };
    const run = Object.hasOwn(actions, String(req.action)) ? actions[String(req.action)] : null;
    if (!run) throw new ApiError('bad_request', 'Unknown request.');
    return answer({ ok: true, ...(await run(token, req)) });
  } catch (e) {
    if (e instanceof ApiError) return answer({ ok: false, code: e.code, error: e.message });
    console.error(e);
    return answer({ ok: false, code: 'server_error', error: 'Something went wrong on the server. Try again.' });
  }
});
