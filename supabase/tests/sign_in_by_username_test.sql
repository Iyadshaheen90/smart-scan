-- Sign in by username (migration 20261120000032): the signin Edge Function's check. A right password (by the store
-- the phone remembers, or by the Store ID typed in) gets the email back; anything wrong gets one answer that never
-- says which part was wrong; 5 wrong tries lock that username at that store for 15 minutes, by either way of naming
-- the store; tries older than 15 minutes don't count; invited-but-never-set-up and turned-off accounts can't sign in;
-- a signed-in person can't call it. Everything is rolled back at the end.
-- Run: node test/db/run.js sign_in_by_username
begin;

insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'owner-a@test.invalid', 'authenticated', 'authenticated',
    extensions.crypt('Owner1!pass', extensions.gen_salt('bf')), now()),
  ('00000000-0000-4000-8000-0000000000e2', 'emp-a@test.invalid', 'authenticated', 'authenticated',
    extensions.crypt('Helper1!pass', extensions.gen_salt('bf')), now()),
  ('00000000-0000-4000-8000-0000000000e3', 'new-c@test.invalid', 'authenticated', 'authenticated', '', null),
  ('00000000-0000-4000-8000-0000000000e4', 'gone-a@test.invalid', 'authenticated', 'authenticated',
    extensions.crypt('Gone1!pass', extensions.gen_salt('bf')), now());

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated", "email": "owner-a@test.invalid"}';
do $$
declare r jsonb;
begin
  r := public.create_store('{"name": "Corner Market", "street": "1 Main St", "city": "Barstow", "state": "CA", "zip": "92311",
    "phone": "7605550100", "username": "boss", "lotteryState": "CA", "timeZone": "America/Los_Angeles", "dayEndHour": 0,
    "ticketOrder": "descending", "boxes": [[20, 10]]}');
  perform set_config('test.a', r ->> 'storeId', false);
  -- A signed-in person can't run the check.
  begin
    perform public.service_sign_in_check('{"username": "boss", "password": "x"}'); assert false, 'a signed-in person ran the check';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('test.n', (select store_number::text from app.stores where id = current_setting('test.a')::uuid), false);

set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
do $$
declare a uuid := current_setting('test.a')::uuid; n text := current_setting('test.n'); r jsonb; i int;
begin
  perform public.service_add_member(a, '00000000-0000-4000-8000-0000000000e2', '{"username": "sam", "email": "emp-a@test.invalid"}');
  perform public.service_add_member(a, '00000000-0000-4000-8000-0000000000e3', '{"username": "newbie", "email": "new-c@test.invalid"}');
  perform public.service_add_member(a, '00000000-0000-4000-8000-0000000000e4', '{"username": "gone", "email": "gone-a@test.invalid"}');
end $$;

-- The owner turned gone off.
reset role;
update app.store_members set active = false where user_id = '00000000-0000-4000-8000-0000000000e4';
set local role service_role;

do $$
declare a uuid := current_setting('test.a')::uuid; n text := current_setting('test.n'); r jsonb; i int;
begin

  -- Right password: by the remembered store, by the Store ID typed in (spaces, capitals), owner and employee.
  r := public.service_sign_in_check(jsonb_build_object('storeId', a, 'username', 'sam', 'password', 'Helper1!pass'));
  assert r = jsonb_build_object('ok', true, 'email', 'emp-a@test.invalid', 'storeId', a), r::text;
  r := public.service_sign_in_check(jsonb_build_object('storeNumber', ' ' || n || ' ', 'username', ' BOSS ', 'password', 'Owner1!pass'));
  assert r = jsonb_build_object('ok', true, 'email', 'owner-a@test.invalid', 'storeId', a), r::text;

  -- Wrong password, unknown username, unknown store: one answer each way, never which part.
  r := public.service_sign_in_check(jsonb_build_object('storeId', a, 'username', 'boss', 'password', 'nope'));
  assert r = '{"ok": false, "code": "bad_login", "message": "Wrong username or password."}', r::text;
  r := public.service_sign_in_check(jsonb_build_object('storeId', a, 'username', 'nobody', 'password', 'Owner1!pass'));
  assert r = '{"ok": false, "code": "bad_login", "message": "Wrong username or password."}', r::text;
  r := public.service_sign_in_check('{"storeNumber": "99999999", "username": "boss", "password": "Owner1!pass"}');
  assert r = '{"ok": false, "code": "bad_login", "message": "Wrong Store ID, username or password."}', r::text;
  r := public.service_sign_in_check(jsonb_build_object('storeNumber', n, 'username', 'sam', 'password', 'Owner1!pass'));
  assert r ->> 'message' = 'Wrong Store ID, username or password.', r::text;
  r := public.service_sign_in_check('{"storeNumber": "abc", "username": "boss", "password": "x"}');
  assert r ->> 'code' = 'bad_login', r::text;
  r := public.service_sign_in_check('{"storeId": "not-a-uuid", "username": "boss", "password": "x"}');
  assert r ->> 'code' = 'bad_login', r::text;

  -- Invited, never chose a password: told to use the email link. Turned off: just wrong.
  r := public.service_sign_in_check(jsonb_build_object('storeId', a, 'username', 'newbie', 'password', ''));
  assert r = '{"ok": false, "code": "bad_login", "message": "Tap the link in your invite email first."}', r::text;
  r := public.service_sign_in_check(jsonb_build_object('storeId', a, 'username', 'gone', 'password', 'Gone1!pass'));
  assert r ->> 'message' = 'Wrong username or password.', r::text;

end $$;

-- A right password clears the count: boss had 1 wrong try above, then signs in.
reset role;
do $$ begin assert (select fails from app.sign_in_tries where key = current_setting('test.a') || ':boss') = 1; end $$;
set local role service_role;
do $$ declare r jsonb; begin
  r := public.service_sign_in_check(jsonb_build_object('storeId', current_setting('test.a'), 'username', 'boss', 'password', 'Owner1!pass'));
  assert r ->> 'ok' = 'true', r::text;
end $$;
reset role;
do $$ begin assert not exists (select 1 from app.sign_in_tries where key = current_setting('test.a') || ':boss'); end $$;
set local role service_role;

do $$
declare a uuid := current_setting('test.a')::uuid; n text := current_setting('test.n'); r jsonb; i int;
begin

  -- 5 wrong tries (by the store and by the Store ID: the same count) → locked, even with the right password.
  -- sam has 1 already (the Store ID try with the owner's password above), so 3 more here, then the 5th.
  for i in 1..3 loop
    r := public.service_sign_in_check(jsonb_build_object(case when i % 2 = 0 then 'storeNumber' else 'storeId' end,
      case when i % 2 = 0 then n else a::text end, 'username', 'sam', 'password', 'wrong'));
    assert r ->> 'code' = 'bad_login', i || ' ' || r::text;
  end loop;
  r := public.service_sign_in_check(jsonb_build_object('storeId', a, 'username', 'sam', 'password', 'wrong'));
  assert r = '{"ok": false, "code": "too_many_attempts", "message": "Too many tries. Wait 15 minutes."}', r::text;
  r := public.service_sign_in_check(jsonb_build_object('storeNumber', n, 'username', 'SAM', 'password', 'Helper1!pass'));
  assert r ->> 'code' = 'too_many_attempts', r::text;
  -- Another username at the store isn't locked.
  r := public.service_sign_in_check(jsonb_build_object('storeId', a, 'username', 'boss', 'password', 'Owner1!pass'));
  assert r ->> 'ok' = 'true', r::text;

  -- Old wrong tries (below) start with 4 wrong for boss.
  for i in 1..4 loop
    perform public.service_sign_in_check(jsonb_build_object('storeId', a, 'username', 'boss', 'password', 'wrong'));
  end loop;
end $$;

-- 16 minutes pass (moved back by hand).
reset role;
update app.sign_in_tries set locked_until = now() - interval '1 second', last_fail = now() - interval '16 minutes'
  where key in (current_setting('test.a') || ':sam', current_setting('test.a') || ':boss');
set local role service_role;
do $$
declare a uuid := current_setting('test.a')::uuid; r jsonb;
begin
  -- After the 15 minutes: the right password works again.
  r := public.service_sign_in_check(jsonb_build_object('storeId', a, 'username', 'sam', 'password', 'Helper1!pass'));
  assert r ->> 'ok' = 'true', r::text;
  -- Old wrong tries don't count: 4 wrong 16 minutes ago, 1 more wrong now = 1, not locked.
  r := public.service_sign_in_check(jsonb_build_object('storeId', a, 'username', 'boss', 'password', 'wrong'));
  assert r ->> 'code' = 'bad_login', r::text;
end $$;
reset role;
do $$ begin assert (select fails from app.sign_in_tries where key = current_setting('test.a') || ':boss') = 1; end $$;

reset role;
select 'sign in by username: right password both ways, one wrong answer, 5 tries lock 15 min, invited, turned off' as result;
rollback;
