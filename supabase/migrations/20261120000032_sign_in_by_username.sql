-- Sign in by username (owner 2026-11-12; decided 2026-11-20): Sign In has one box, "Email or Username". A username is
-- unique only inside a store, so the phone sends the store it remembers (storeId) or the Store ID typed in
-- (storeNumber). The signin Edge Function asks this function with the service key; only a right password gets the
-- account's email back, and the function then signs in with it. So a stranger never learns an email, and wrong
-- passwords never reach Supabase Auth (its sign-in limit is per IP, and every Edge Function call shares one).
-- 5 wrong tries for a username at a store → that username waits 15 minutes (owner 2026-11-20).
-- Answers { ok, ... } instead of raising: a raised error would roll back the wrong-try count.

create table app.sign_in_tries (
  key text primary key,            -- '<store id or "#"store number>:<lowercase username>'
  fails integer not null default 0,
  last_fail timestamptz,
  locked_until timestamptz
);
-- Only the function below (owned by postgres, like the others that read auth.users) uses it; the app's own role
-- may not see a row.
alter table app.sign_in_tries enable row level security;
alter table app.sign_in_tries force row level security;
create policy nobody on app.sign_in_tries for all to smart_scan_api using (false) with check (false);

create or replace function public.service_sign_in_check(req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who text := app.norm_username(req -> 'username');
  s app.stores; m app.store_members; u auth.users;
  k text; t app.sign_in_tries;
  by_number boolean := nullif(btrim(coalesce(req ->> 'storeId', '')), '') is null;
  wrong text;
begin
  perform app.require_service_role();
  wrong := case when by_number then 'Wrong Store ID, username or password.' else 'Wrong username or password.' end;
  if by_number then
    if coalesce(req ->> 'storeNumber', '') ~ '^\s*\d{1,9}\s*$' then
      select * into s from app.stores where store_number = btrim(req ->> 'storeNumber')::integer;
    end if;
    k := '#' || btrim(coalesce(req ->> 'storeNumber', '')) || ':' || who;
  else
    if req ->> 'storeId' ~* '^[0-9a-f-]{36}$' then select * into s from app.stores where id = (req ->> 'storeId')::uuid; end if;
    k := coalesce(s.id::text, btrim(req ->> 'storeId')) || ':' || who;
  end if;
  -- The same key either way once the store is known, so typing the Store ID doesn't get 5 more tries.
  if s.id is not null then k := s.id::text || ':' || who; end if;

  select * into t from app.sign_in_tries where key = k;
  if t.locked_until is not null and t.locked_until > now() then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts', 'message', 'Too many tries. Wait 15 minutes.');
  end if;

  if s.id is not null and who <> '' then
    select * into m from app.store_members where store_id = s.id and lower(username) = who and active;
    if m.user_id is not null then select * into u from auth.users where id = m.user_id; end if;
  end if;

  if u.id is not null and coalesce(u.encrypted_password, '') <> ''
     and extensions.crypt(coalesce(req ->> 'password', ''), u.encrypted_password) = u.encrypted_password then
    delete from app.sign_in_tries where key = k;
    return jsonb_build_object('ok', true, 'email', lower(u.email), 'storeId', s.id);
  end if;

  -- Invited but never chose a password: the same answer as signing in by email.
  if u.id is not null and u.email_confirmed_at is null and coalesce(u.encrypted_password, '') = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_login', 'message', 'Tap the link in your invite email first.');
  end if;

  -- A wrong try (unknown store or username too, so the answer never tells which). Tries older than 15 minutes
  -- don't count; the 5th within 15 minutes locks the username for 15 minutes.
  insert into app.sign_in_tries as x (key, fails, last_fail) values (k, 1, now())
  on conflict (key) do update set
    fails = case when x.last_fail < now() - interval '15 minutes' then 1 else x.fails + 1 end,
    last_fail = now(),
    locked_until = case when (case when x.last_fail < now() - interval '15 minutes' then 1 else x.fails + 1 end) >= 5
      then now() + interval '15 minutes' else null end
  returning * into t;
  if t.locked_until is not null then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts', 'message', 'Too many tries. Wait 15 minutes.');
  end if;
  return jsonb_build_object('ok', false, 'code', 'bad_login', 'message', wrong);
end $$;
revoke execute on function public.service_sign_in_check(jsonb) from public, anon, authenticated;
grant execute on function public.service_sign_in_check(jsonb) to service_role;

-- Rows are tiny (one per username that ever mistyped); a right password deletes its row.
