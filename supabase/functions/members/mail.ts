// A plain email from the members function (the "you were added to a store" note). Same sending as the support
// function: Gmail over SMTPS port 465 (Edge Functions can't use 25 or 587), secrets SMTP_USER / SMTP_PASS (never in the
// repo), set with sh scripts/push-function-secrets.sh.

const utf8 = (text: string) => new TextEncoder().encode(text);

// Base64 in lines of 76, as email expects.
function b64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{76}/g, '$&\r\n');
}
const header = (text: string) => `=?UTF-8?B?${btoa(String.fromCharCode(...utf8(text)))}?=`;

export type Mail = { subject: string; text: string; html: string };

// The text and the same email as HTML; the mail app shows the best one it can.
function mime(from: string, to: string, mail: Mail) {
  const alt = `ss-alt-${crypto.randomUUID()}`;
  return [
    `From: ${header('Smart Scan')} <${from}>`,
    `To: <${to}>`,
    `Subject: ${header(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@smart-scan>`,
    'MIME-Version: 1.0',
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
    '',
  ].join('\r\n');
}

// A plain SMTP conversation with Gmail over TLS (every line of the message is base64 or a header, so no line starts
// with a dot).
export async function sendMail(to: string, mail: Mail) {
  const user = Deno.env.get('SMTP_USER') || '';
  const pass = Deno.env.get('SMTP_PASS') || '';
  if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASS not set');
  const message = mime(user, to, mail);
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
