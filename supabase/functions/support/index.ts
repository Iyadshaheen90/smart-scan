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
// Email: Gmail over SMTPS port 465 (Edge Functions can't use 25 or 587; 465 checked 2026-10-31). Secrets (never in the
// repo): SMTP_USER, SMTP_PASS (the Gmail app password), SUPPORT_EMAIL — set with sh scripts/push-function-secrets.sh.
// Deploy: npx --yes supabase@2.122.0 functions deploy support --use-api

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'problem-screenshots';
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

// ---------- The email ----------

type Report = {
  number: number; storeUuid: string; isTest: boolean; sentAt: string; username: string; role: string; email: string | null;
  areaLabel: string; description: string; page: string | null; appVersion: string | null; device: string | null;
  recentErrors: string[]; screenshots: number;
  store: { storeId: number; name: string; street: string | null; city: string | null; state: string; zip: string | null; phoneLabel: string | null };
};

function emailFor(r: Report) {
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
    `To change its status (My Reports): node scripts/report-status.js ${r.storeUuid} ${r.number} working|fixed "note"`,
  ];
  return { subject, text: lines.join('\n'), replyTo: r.email };
}

// Base64 in lines of 76, as email expects.
function b64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{76}/g, '$&\r\n');
}
const utf8 = (text: string) => new TextEncoder().encode(text);
const header = (text: string) => `=?UTF-8?B?${btoa(String.fromCharCode(...utf8(text)))}?=`;

function mime(from: string, to: string, mail: { subject: string; text: string; replyTo: string | null }, shots: Shot[]) {
  const boundary = `ss-${crypto.randomUUID()}`;
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
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(utf8(mail.text)),
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
    const mail = emailFor(r);
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
    if (req.action !== 'report') throw new ApiError('unknown_action', 'Unknown action.');
    return answer({ ok: true, ...(await report(token, req)) });
  } catch (e) {
    if (e instanceof ApiError) return answer({ ok: false, code: e.code, error: e.message });
    console.error(e);
    return answer({ ok: false, code: 'server_error', error: 'Something went wrong on the server. Try again.' });
  }
});
