// Sign in by username (owner 2026-11-12; decided 2026-11-20). A username is unique only inside a store, so the phone
// sends the store it remembers (storeId) or the Store ID typed in (storeNumber), the username and the password. The
// database (service_sign_in_check, migration 0032) checks the password against the stored hash and counts wrong
// tries (5 → wait 15 minutes); only a right password gets the account's email back, and only then does this sign in
// with Supabase Auth. So the email never reaches someone who doesn't know the password, and wrong passwords never
// use up Supabase Auth's sign-in limit (per IP, and every call from here shares one).
//
//   POST { storeId | storeNumber, username, password } (the anon key as the bearer, nobody is signed in yet)
//     -> { ok: true, data: { storeId, tokens: <Supabase Auth's password sign-in answer> } }
//     -> { ok: false, code, error }   bad_login | too_many_attempts | server_error
// Deploy: npx --yes supabase@2.122.0 functions deploy signin --use-api

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const answer = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } });
const refuse = (code: string, error: string) => answer({ ok: false, code, error });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const req = await request.json().catch(() => ({}));
    const ask = {
      storeId: String(req.storeId || ''), storeNumber: String(req.storeNumber || ''),
      username: String(req.username || ''), password: String(req.password || ''),
    };
    const checked = await fetch(`${URL}/rest/v1/rpc/service_sign_in_check`, { method: 'POST', body: JSON.stringify({ req: ask }),
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' } });
    const check = await checked.json().catch(() => null);
    if (!checked.ok || !check) throw new Error(`service_sign_in_check: ${checked.status} ${JSON.stringify(check)}`);
    if (!check.ok) return refuse(check.code, check.message);

    const signIn = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST',
      body: JSON.stringify({ email: check.email, password: ask.password }),
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' } });
    const tokens = await signIn.json().catch(() => null);
    if (signIn.status === 429) return refuse('too_many_attempts', 'Too many tries. Wait a few minutes.');
    if (tokens && (tokens.error_code || tokens.code) === 'email_not_confirmed') return refuse('bad_login', 'Tap the link in your invite email first.');
    // The database said the password is right, so Auth refusing it is unexpected (e.g. the account was banned).
    if (!signIn.ok) return refuse('bad_login', 'Wrong username or password.');
    return answer({ ok: true, data: { storeId: check.storeId, tokens } });
  } catch (e) {
    console.error(e);
    return refuse('server_error', 'Something went wrong on the server. Try again.');
  }
});
