-- Many stores, steps 4 and 5 (migration 20261114000029): an account that already exists is added to a second store
-- (and never twice); the members function can tell how many stores an account is on (the Reset Password rule); an
-- employee leaves a store, the owner can't; the owner deletes the store only by typing its name, and everything it
-- had is gone while the other store is untouched; an account that owns a store can't be deleted.
-- Everything is rolled back at the end.
-- Run: node test/db/run.js switch_and_deletion
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000d1', 'owner-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d2', 'Owner-B@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000d3', 'helper-a@test.invalid', 'authenticated', 'authenticated');

-- ---- Two owners, each sets up a store ----
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated", "email": "owner-a@test.invalid"}';
do $$
declare r jsonb;
begin
  r := public.create_store('{"name": "Corner Market", "street": "1 Main St", "city": "Barstow", "state": "CA", "zip": "92311",
    "phone": "7605550100", "username": "boss", "lotteryState": "CA", "timeZone": "America/Los_Angeles", "dayEndHour": 0,
    "ticketOrder": "descending", "boxes": [[20, 10, 5]], "retailerNumber": "123456"}');
  perform set_config('test.a', r ->> 'storeId', false);
end $$;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated", "email": "owner-b@test.invalid"}';
do $$
declare r jsonb; h text;
begin
  r := public.create_store('{"name": "Second Stop", "street": "2 Main St", "city": "Barstow", "state": "CA", "zip": "92311",
    "phone": "7605550101", "username": "pat", "lotteryState": "CA", "timeZone": "America/Los_Angeles", "dayEndHour": 0,
    "ticketOrder": "descending", "boxes": [[5, 5]]}');
  perform set_config('test.b', r ->> 'storeId', false);
  -- A signed-in person can't run the service functions.
  begin
    perform public.service_account_info('{"email": "owner-a@test.invalid"}'); assert false, 'a signed-in person read an account';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- The owner's check answers what the function needs ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated", "email": "owner-a@test.invalid"}';
do $$
declare a uuid := current_setting('test.a')::uuid; r jsonb;
begin
  r := public.member_admin_check(a, '{"action": "invite", "username": " Pat ", "email": " OWNER-B@test.invalid "}');
  assert r = jsonb_build_object('username', 'pat', 'email', 'owner-b@test.invalid', 'isTest', false, 'storeName', 'Corner Market'), r::text;
end $$;

-- ---- The members function (service key): an existing account joins a second store, once ----
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
do $$
declare a uuid := current_setting('test.a')::uuid; r jsonb; h text;
begin
  r := public.service_account_info('{"email": " OWNER-B@test.invalid "}');
  assert r = jsonb_build_object('userId', '00000000-0000-4000-8000-0000000000d2', 'email', 'owner-b@test.invalid', 'stores', 1), r::text;
  r := public.service_account_info('{"email": "nobody@test.invalid"}');
  assert r = jsonb_build_object('userId', null, 'stores', 0), r::text;

  r := public.service_add_member(a, '00000000-0000-4000-8000-0000000000d2', '{"username": "pat", "email": "owner-b@test.invalid"}');
  assert jsonb_array_length(r) = 2, r::text;
  begin
    perform public.service_add_member(a, '00000000-0000-4000-8000-0000000000d2', '{"username": "pat2", "email": "other@test.invalid"}');
    assert false, 'the same account was added twice';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'email_exists', h;
  end;
  begin
    perform public.service_add_member(a, '00000000-0000-4000-8000-0000000000d3', '{"username": "PAT", "email": "helper-a@test.invalid"}');
    assert false, 'a username was used twice';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'user_exists', h;
  end;
  r := public.service_add_member(a, '00000000-0000-4000-8000-0000000000d3', '{"username": "sam", "email": "helper-a@test.invalid"}');
  assert jsonb_array_length(r) = 3, r::text;

  -- The Reset Password rule's question: on how many stores is this account?
  assert public.service_account_info('{"userId": "00000000-0000-4000-8000-0000000000d2"}') ->> 'stores' = '2', 'pat is on two stores';
  assert public.service_account_info('{"userId": "00000000-0000-4000-8000-0000000000d3"}') ->> 'stores' = '1', 'sam is on one store';
end $$;

-- ---- The owner's check hands the function the person's email (for the reset email) ----
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated", "email": "owner-a@test.invalid"}';
do $$
declare a uuid := current_setting('test.a')::uuid; r jsonb; h text;
begin
  r := public.member_admin_check(a, '{"action": "setPassword", "username": "pat"}');
  assert r ->> 'email' = 'owner-b@test.invalid' and r ->> 'userId' = '00000000-0000-4000-8000-0000000000d2', r::text;
  begin
    perform public.member_admin_check(a, '{"action": "invite", "username": "pat3", "email": "owner-b@test.invalid"}');
    assert false, 'an email on the list was invited again';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'email_exists', h;
  end;
end $$;

-- ---- One person on two stores: owner of one, employee of the other ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated", "email": "owner-b@test.invalid"}';
do $$
declare a uuid := current_setting('test.a')::uuid; b uuid := current_setting('test.b')::uuid; r jsonb; h text;
begin
  r := public.my_stores();
  assert jsonb_array_length(r) = 2 and r -> 0 ->> 'storeName' = 'Corner Market' and r -> 0 ->> 'role' = 'employee'
    and r -> 1 ->> 'storeName' = 'Second Stop' and r -> 1 ->> 'role' = 'owner', r::text;
  -- An account that owns a store can't be deleted.
  begin
    perform public.account_delete_check(); assert false, 'an owner''s account could be deleted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint; assert h = 'owns_store', h;
    assert sqlerrm = 'You own Second Stop. Delete the store first, then delete your account.', sqlerrm;
  end;
  -- An employee can't delete the store they only work at.
  begin
    perform public.delete_store(a, '{"name": "Corner Market"}'); assert false, 'an employee deleted the store';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'forbidden', h;
  end;
  -- The owner can't leave their own store.
  begin
    perform public.leave_store(b, '{}'); assert false, 'the owner left';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'owner_cant_leave', h;
  end;
end $$;

-- ---- An employee leaves ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d3", "role": "authenticated", "email": "helper-a@test.invalid"}';
do $$
declare a uuid := current_setting('test.a')::uuid; r jsonb; h text;
begin
  assert public.account_delete_check() = '{"stores": 1}'::jsonb, 'an employee''s account can be deleted';
  r := public.leave_store(a, '{}');
  assert r = '{"left": true, "storeName": "Corner Market"}'::jsonb, r::text;
  assert public.my_stores() = '[]'::jsonb, 'still on the store after leaving';
  begin
    perform public.list_slots(a, '{}'); assert false, 'got in after leaving';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'forbidden', h;
  end;
  assert public.account_delete_check() = '{"stores": 0}'::jsonb, 'after leaving';
end $$;

-- ---- The owner deletes the store ----
reset role;
insert into app.problem_reports (store_id, username, role, area, description, screenshots)
  values (current_setting('test.a')::uuid, 'boss', 'owner', 'other', 'with pictures', 2),
    (current_setting('test.a')::uuid, 'boss', 'owner', 'other', 'without', 0),
    (current_setting('test.b')::uuid, 'pat', 'owner', 'other', 'the other store''s', 1);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated", "email": "owner-a@test.invalid"}';
do $$
declare a uuid := current_setting('test.a')::uuid; b uuid := current_setting('test.b')::uuid; r jsonb; h text;
begin
  assert jsonb_array_length(public.list_users(a, '{}')) = 2, 'boss and pat are left';
  begin
    perform public.delete_store(a, '{"name": "Corner"}'); assert false, 'deleted with the wrong name';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint; assert h = 'wrong_name', h;
    assert sqlerrm = 'Type the store''s name to delete it: Corner Market', sqlerrm;
  end;
  begin
    perform public.delete_store(a, '{}'); assert false, 'deleted without a name';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'wrong_name', h;
  end;
  begin
    perform public.delete_store(b, '{"name": "Second Stop"}'); assert false, 'deleted someone else''s store';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'forbidden', h;
  end;
  assert jsonb_array_length(public.list_slots(a, '{}')) = 3, 'a refused delete took something';

  r := public.delete_store(a, '{"name": "  corner market "}');
  assert r ->> 'deleted' = 'true' and r ->> 'storeName' = 'Corner Market' and jsonb_array_length(r -> 'screenshotReports') = 1, r::text;
  assert public.my_stores() = '[]'::jsonb, 'the owner still has the store';
  assert public.account_delete_check() = '{"stores": 0}'::jsonb, 'the owner''s account can go now';
  begin
    perform public.list_slots(a, '{}'); assert false, 'the deleted store still answers';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'forbidden', h;
  end;
end $$;

-- Nothing of store A is left anywhere; store B is whole.
reset role;
do $$
declare a uuid := current_setting('test.a')::uuid; b uuid := current_setting('test.b')::uuid; t text; n integer;
begin
  foreach t in array array['slots', 'games', 'packs', 'close_entries', 'daily_closes', 'shift_closes', 'shift_entries', 'shipments',
    'stock_adjustments', 'problem_reports', 'store_members'] loop
    execute format('select count(*) from app.%I where store_id = $1', t) into n using a;
    assert n = 0, format('%s rows of the deleted store are left in %s', n, t);
  end loop;
  assert not exists (select 1 from app.stores where id = a), 'the store row is left';
  assert not exists (select 1 from vault.secrets where name = app.retailer_secret_name(a)), 'the retailer number is left';
  assert (select count(*) from app.slots where store_id = b) = 2 and (select count(*) from app.problem_reports where store_id = b) = 1
    and (select count(*) from app.store_members where store_id = b) = 1, 'the other store lost something';
  -- The accounts themselves stay.
  assert (select count(*) from auth.users where id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2',
    '00000000-0000-4000-8000-0000000000d3')) = 3, 'an account was removed';
end $$;

-- ---- The other owner is back to one store ----
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated", "email": "owner-b@test.invalid"}';
do $$
declare r jsonb;
begin
  r := public.my_stores();
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'storeName' = 'Second Stop', r::text;
end $$;

-- ---- Nobody signed in ----
set local request.jwt.claims = '';
do $$
declare h text;
begin
  begin
    perform public.account_delete_check(); assert false, 'checked without signing in';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'unauthorized', h;
  end;
end $$;

reset role;
select 'switch and deletion: existing account joins, store count, leave, delete store, account check' as result;
rollback;
