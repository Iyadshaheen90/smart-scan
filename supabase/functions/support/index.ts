// Report a Problem (owner 2026-10-31): saves the report as the person who sent it (public.report_problem checks them
// and their store), keeps the screenshots in the private bucket problem-screenshots, and emails support. The report is
// saved first, so a failed email never loses it (the row keeps email_error).
//
//   POST { action: 'report', storeId, area, description, page, appVersion, device, recentErrors: [text],
//          screenshots: [{ type: 'image/jpeg' | 'image/png', data: base64 }] }  -> { ok, data: { number, emailed } }
//   errors: { ok: false, code, error }, like the Apps Script backend.
//
// A test store gets the email back as testEmail instead of sending it (the browser test reads it), unless the request
// says sendTestEmail: true (to check a real email arrives).
//
// Updating a report from the email (owner 2026-11-10): the email has Received / Working on It / Fixed buttons. Each
// opens report-status.html (GitHub Pages: a function can't show a web page on the supabase.co address) with a link
// signed here (HMAC-SHA256 with STATUS_LINK_SECRET; one report, 60 days). Nothing changes until Save is tapped there,
// so a mail app opening links to scan them can't change a status. The page calls, with no sign-in (the link is the key):
//   POST { action: 'linkReport', link }                       -> { ok, data: report }
//   POST { action: 'linkSetStatus', link, status, note }      -> { ok, data: report }
// Email: Gmail over SMTPS port 465 (Edge Functions can't use 25 or 587; 465 checked 2026-10-31). Secrets (never in the
// repo): SMTP_USER, SMTP_PASS (the Gmail app password), SUPPORT_EMAIL — set with sh scripts/push-function-secrets.sh.
// STATUS_LINK_SECRET (the links' key) is set the same way; without it the email has no buttons, only the command.
// Deploy: npx --yes supabase@2.122.0 functions deploy support --use-api

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'problem-screenshots';
// Where the email's buttons open the Update Report page (the app's pages on GitHub Pages).
const APP_URL = Deno.env.get('APP_URL') || 'https://iyadshaheen90.github.io/smart-scan/src/';
const LINK_DAYS = 60;
const NOTE_MAX = 300;
const MAX_SHOT_BYTES = 3 * 1024 * 1024;

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

type Shot = { type: string; bytes: Uint8Array };

// The screenshots from the request, checked before anything is saved.
function readShots(list: unknown): Shot[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > 3) throw new ApiError('too_many_screenshots', 'Add up to 3 screenshots.');
  return list.map((s) => {
    const type = s && typeof s.type === 'string' ? s.type : '';
    if (type !== 'image/jpeg' && type !== 'image/png') throw new ApiError('bad_screenshot', 'Screenshots need to be pictures (JPEG or PNG).');
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(String(s.data || '')), (c) => c.charCodeAt(0));
    } catch {
      throw new ApiError('bad_screenshot', "A screenshot couldn't be read. Try adding it again.");
    }
    if (!bytes.length) throw new ApiError('bad_screenshot', "A screenshot couldn't be read. Try adding it again.");
    if (bytes.length > MAX_SHOT_BYTES) throw new ApiError('screenshot_too_big', 'A screenshot is too big. Try a smaller one.');
    return { type, bytes };
  });
}

const extOf = (type: string) => (type === 'image/png' ? 'png' : 'jpg');

async function upload(path: string, shot: Shot) {
  const res = await fetch(`${URL}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', body: shot.bytes,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': shot.type, 'x-upsert': 'true' } });
  if (!res.ok) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`);
}

// ---------- Signed links (the email's buttons) ----------

const utf8 = (text: string) => new TextEncoder().encode(text);
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromB64url(text: string): Uint8Array {
  const s = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

async function linkKey() {
  const secret = Deno.env.get('STATUS_LINK_SECRET') || '';
  if (!secret) return null;
  return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// "payload.signature": the store, the report and when the link stops working, signed so it can't be changed or made up.
async function signLink(storeUuid: string, number: number) {
  const key = await linkKey();
  if (!key) return null;
  const payload = b64url(utf8(JSON.stringify({ s: storeUuid, r: number, e: Math.floor(Date.now() / 1000) + LINK_DAYS * 86400 })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(payload)));
  return `${payload}.${b64url(signature)}`;
}

const BAD_LINK = "This link isn't right. Open it again from the support email.";
async function readLink(link: unknown): Promise<{ store: string; report: number }> {
  const key = await linkKey();
  if (!key) throw new ApiError('no_links', 'Status links are turned off. Use the command in the support email.');
  const [payload, signature, extra] = String(link || '').split('.');
  if (!payload || !signature || extra !== undefined) throw new ApiError('bad_link', BAD_LINK);
  let ok = false;
  let data: { s?: unknown; r?: unknown; e?: unknown } = {};
  try {
    // verify compares in constant time.
    ok = await crypto.subtle.verify('HMAC', key, fromB64url(signature), utf8(payload));
    if (ok) data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  } catch {
    ok = false;
  }
  if (!ok || typeof data.s !== 'string' || typeof data.r !== 'number' || typeof data.e !== 'number') {
    throw new ApiError('bad_link', BAD_LINK);
  }
  if (data.e < Date.now() / 1000) {
    throw new ApiError('expired_link', `This link has expired (they last ${LINK_DAYS} days). Use the command in the support email instead.`);
  }
  return { store: data.s, report: data.r };
}

async function linkReport(req: Record<string, unknown>) {
  const { store, report } = await readLink(req.link);
  return { data: await rpc('service_problem_for_link', { p_store: store, p_report: report }, SERVICE) };
}

async function linkSetStatus(req: Record<string, unknown>) {
  const { store, report } = await readLink(req.link);
  const status = String(req.status || '');
  if (!['received', 'working', 'fixed'].includes(status)) throw new ApiError('bad_status', 'Choose Received, Working on It or Fixed.');
  const note = String(req.note ?? '').trim();
  if (note.length > NOTE_MAX) throw new ApiError('note_too_long', `Keep the note under ${NOTE_MAX} characters.`);
  await rpc('service_set_problem_status', { p_store: store, p_report: report, p_status: status, p_note: note || null }, SERVICE);
  return { data: await rpc('service_problem_for_link', { p_store: store, p_report: report }, SERVICE) };
}

// ---------- The email ----------

type Report = {
  number: number; storeUuid: string; isTest: boolean; sentAt: string; username: string; role: string; email: string | null;
  areaLabel: string; description: string; page: string | null; appVersion: string | null; device: string | null;
  recentErrors: string[]; screenshots: number;
  store: { storeId: number; name: string; street: string | null; city: string | null; state: string; zip: string | null; phoneLabel: string | null };
};

const STATUS_BUTTONS: [string, string, string][] = [
  ['working', 'Working on It', '#f5b83d'],
  ['fixed', 'Fixed', '#4cc58a'],
  ['received', 'Received', '#9aa3a0'],
];

const escapeHtml = (text: unknown) => String(text ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function emailFor(r: Report, link: string | null) {
  const s = r.store;
  const address = s.street ? `${s.street}, ${s.city}, ${s.state} ${s.zip}` : 'Not added yet';
  const subject = `Problem #${r.number} · ${s.name} · ${r.areaLabel}`;
  const lines = [
    `Problem report #${r.number}`,
    '',
    `Store:      ${s.name} (Store ID ${s.storeId})`,
    `Address:    ${address}`,
    `Phone:      ${s.phoneLabel || 'Not added yet'}`,
    `Sent:       ${r.sentAt} (store time)`,
    `By:         ${r.username} (${r.role === 'owner' ? 'Owner' : 'Employee'})${r.email ? ` <${r.email}>` : ''}`,
    `Where:      ${r.areaLabel}`,
    '',
    'What happened:',
    r.description,
    '',
    `App:        ${r.appVersion || '?'} · page ${r.page || '?'}`,
    `Device:     ${r.device || '?'}`,
    'Last red messages on this phone:',
    ...(r.recentErrors.length ? r.recentErrors.map((e) => `  - ${e}`) : ['  (none)']),
    `Screenshots: ${r.screenshots ? `${r.screenshots} attached` : 'none'}`,
    '',
  ];
  const urls = link ? STATUS_BUTTONS.map(([status, label]) => [label, `${APP_URL}report-status.html?status=${status}#${link}`]) : [];
  if (urls.length) {
    lines.push('Update its status (they see it in My Reports). Each link opens a page; nothing changes until you tap Save:');
    for (const [label, url] of urls) lines.push(`  ${`${label}:`.padEnd(15)}${url}`);
    lines.push('');
  }
  lines.push(`Or on the Mac: node scripts/report-status.js ${r.storeUuid} ${r.number} working|fixed "note"`);
  // The same email with buttons, for mail apps that show HTML (the text above is kept for the rest).
  const rows = lines.slice(2, lines.indexOf('What happened:') - 1).map((l) => {
    const i = l.indexOf(':');
    return `<tr><td style="padding:2px 12px 2px 0;color:#6b7370;white-space:nowrap;vertical-align:top">${escapeHtml(l.slice(0, i))}</td>`
      + `<td style="padding:2px 0">${escapeHtml(l.slice(i + 1).trim())}</td></tr>`;
  }).join('');
  const buttons = link ? `<p style="margin:22px 0 6px;font-weight:600">Update its status</p>`
    + `<p style="margin:0 0 10px;color:#6b7370;font-size:13px">Opens a page; nothing changes until you tap Save. They see it in My Reports.</p>`
    + STATUS_BUTTONS.map(([status, label, color]) => `<a href="${escapeHtml(`${APP_URL}report-status.html?status=${status}#${link}`)}" `
      + `style="display:inline-block;margin:0 8px 8px 0;padding:11px 18px;border-radius:999px;background:${color};color:#0b1a12;`
      + `font-weight:700;text-decoration:none">${escapeHtml(label)}</a>`).join('') : '';
  const errors = r.recentErrors.length ? r.recentErrors.map((e) => `<li>${escapeHtml(e)}</li>`).join('') : '<li>(none)</li>';
  const html = `<!doctype html><html><body style="margin:0;padding:20px;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111">`
    + `<h2 style="margin:0 0 12px;font-size:19px">Problem report #${r.number}</h2>`
    + `<table style="border-collapse:collapse;font-size:14px">${rows}</table>`
    + `<p style="margin:16px 0 4px;font-weight:600">What happened</p>`
    + `<p style="margin:0;white-space:pre-wrap">${escapeHtml(r.description)}</p>`
    + buttons
    + `<p style="margin:22px 0 4px;font-size:13px;color:#6b7370">App ${escapeHtml(r.appVersion || '?')} · page ${escapeHtml(r.page || '?')}`
    + ` · ${escapeHtml(r.device || '?')} · Screenshots: ${r.screenshots ? `${r.screenshots} attached` : 'none'}</p>`
    + `<p style="margin:8px 0 2px;font-size:13px;color:#6b7370">Last red messages on this phone:</p>`
    + `<ul style="margin:0;padding-left:18px;font-size:13px;color:#6b7370">${errors}</ul>`
    + `</body></html>`;
  return { subject, text: lines.join('\n'), html, replyTo: r.email };
}

// Base64 in lines of 76, as email expects.
function b64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{76}/g, '$&\r\n');
}
const header = (text: string) => `=?UTF-8?B?${btoa(String.fromCharCode(...utf8(text)))}?=`;

function mime(from: string, to: string, mail: { subject: string; text: string; html: string; replyTo: string | null }, shots: Shot[]) {
  const boundary = `ss-${crypto.randomUUID()}`;
  const alt = `ss-alt-${crypto.randomUUID()}`;
  const parts = [
    `From: ${header('Smart Scan')} <${from}>`,
    `To: <${to}>`,
    ...(mail.replyTo ? [`Reply-To: <${mail.replyTo}>`] : []),
    `Subject: ${header(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@smart-scan>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    // The text and the same email with buttons; the mail app shows the best one it can.
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(utf8(mail.text)),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(utf8(mail.html)),
    `--${alt}--`,
  ];
  shots.forEach((shot, i) => {
    parts.push(`--${boundary}`, `Content-Type: ${shot.type}; name="screenshot-${i + 1}.${extOf(shot.type)}"`,
      'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="screenshot-${i + 1}.${extOf(shot.type)}"`,
      '', b64(shot.bytes));
  });
  parts.push(`--${boundary}--`, '');
  return parts.join('\r\n');
}

// A plain SMTP conversation with Gmail over TLS (every line of the message is base64 or a header, so no line starts
// with a dot).
async function sendMail(to: string, message: string) {
  const user = Deno.env.get('SMTP_USER') || '';
  const pass = Deno.env.get('SMTP_PASS') || '';
  if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASS not set');
  const conn = await Deno.connectTls({ hostname: 'smtp.gmail.com', port: 465 });
  const decoder = new TextDecoder();
  let pending = '';
  // The server's full answer (the last line is "250 ..." with a space after the code).
  async function reply(expect: string) {
    const buf = new Uint8Array(4096);
    for (;;) {
      const done = pending.split('\r\n').find((l) => /^\d{3} /.test(l));
      if (done) {
        const text = pending;
        pending = '';
        if (!done.startsWith(expect)) throw new Error(`SMTP: expected ${expect}, got ${text.trim()}`);
        return text;
      }
      const n = await conn.read(buf);
      if (n === null) throw new Error(`SMTP: connection closed (${pending.trim()})`);
      pending += decoder.decode(buf.subarray(0, n));
    }
  }
  async function send(line: string, expect: string) {
    await conn.write(utf8(`${line}\r\n`));
    return reply(expect);
  }
  try {
    await reply('220');
    await send('EHLO smart-scan', '250');
    await send('AUTH LOGIN', '334');
    await send(btoa(user), '334');
    await send(btoa(pass), '235');
    await send(`MAIL FROM:<${user}>`, '250');
    await send(`RCPT TO:<${to}>`, '250');
    await send('DATA', '354');
    await conn.write(utf8(message));
    await send('\r\n.', '250');
    await send('QUIT', '221').catch(() => {});
  } finally {
    try { conn.close(); } catch { /* already closed */ }
  }
}

// ---------- The action ----------

async function report(token: string, req: Record<string, unknown>) {
  const shots = readShots(req.screenshots);
  const storeId = String(req.storeId || '');
  const saved = await rpc('report_problem', { p_store: storeId, req: { area: req.area, description: req.description,
    screenshots: shots.length, page: req.page, appVersion: req.appVersion, device: req.device, recentErrors: req.recentErrors } }, token);
  const number = saved.number;
  let error: string | null = null;
  let testEmail: unknown;
  try {
    for (const [i, shot] of shots.entries()) await upload(`${storeId}/${number}/${i + 1}.${extOf(shot.type)}`, shot);
    const r: Report = await rpc('service_problem_for_email', { p_store: storeId, p_report: number }, SERVICE);
    const mail = emailFor(r, await signLink(storeId, number));
    if (r.isTest && req.sendTestEmail !== true) {
      testEmail = { ...mail, attachments: shots.length };
    } else {
      const to = Deno.env.get('SUPPORT_EMAIL') || '';
      if (!to) throw new Error('SUPPORT_EMAIL not set');
      await sendMail(to, mime(Deno.env.get('SMTP_USER')!, to, mail, shots));
    }
  } catch (e) {
    error = (e as Error).message;
    console.error(`report ${number}: ${error}`);
  }
  await rpc('service_problem_emailed', { p_store: storeId, p_report: number, p_error: error }, SERVICE).catch(() => {});
  return { data: { number, emailed: !error }, ...(testEmail ? { testEmail } : {}) };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const req = await request.json().catch(() => ({}));
    const run = req.action === 'report' ? () => report(token, req)
      : req.action === 'linkReport' ? () => linkReport(req)
        : req.action === 'linkSetStatus' ? () => linkSetStatus(req) : null;
    if (!run) throw new ApiError('unknown_action', 'Unknown action.');
    return answer({ ok: true, ...(await run()) });
  } catch (e) {
    if (e instanceof ApiError) return answer({ ok: false, code: e.code, error: e.message });
    console.error(e);
    return answer({ ok: false, code: 'server_error', error: 'Something went wrong on the server. Try again.' });
  }
});
