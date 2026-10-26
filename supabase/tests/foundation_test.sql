-- Store separation and the sign-in check (migration 20261023000001_foundation.sql). Two stores, A and B: an owner of
-- each, and at store A an employee with theft_report and an inactive employee. Everything is rolled back at the end.
-- Run: node test/db/run.js   (on the linked dev project, smart-scan-dev)
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000a2', 'emp-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000a3', 'gone-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b1', 'owner-b@test.invalid', 'authenticated', 'authenticated');
insert into app.stores (id, name) values
  ('00000000-0000-4000-8000-00000000000a', 'Store A'),
  ('00000000-0000-4000-8000-00000000000b', 'Store B');
insert into app.store_members (store_id, user_id, username, role, permissions, active) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1', 'ownera', 'owner', '{}', true),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a2', 'sara', 'employee', '{theft_report}', true),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a3', 'gone', 'employee', '{}', false),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b1', 'ownerb', 'owner', '{}', true);
insert into app.slots (store_id, box, slot_number, price) values
  ('00000000-0000-4000-8000-00000000000a', 1, 1, 20), ('00000000-0000-4000-8000-00000000000a', 1, 2, 10),
  ('00000000-0000-4000-8000-00000000000b', 1, 1, 5);

-- A bad username for a permission is refused by the table itself.
do $$ begin
  insert into app.store_members (store_id, user_id, username, role, permissions)
    values ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000a2', 'x', 'employee', '{fly}');
  raise exception 'unknown permission was saved';
exception when check_violation then null;
end $$;

-- ---- Signed-in owner of A, through the API (role authenticated) ----
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
declare r jsonb; h text;
begin
  r := public.my_stores();
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'storeName' = 'Store A' and r -> 0 ->> 'role' = 'owner', r::text;
  r := public.me('00000000-0000-4000-8000-00000000000a');
  assert r ->> 'username' = 'ownera' and r ->> 'storeName' = 'Store A', r::text;
  -- Another store: refused.
  begin
    r := public.me('00000000-0000-4000-8000-00000000000b');
    raise exception 'owner of A got into B: %', r;
  exception when raise_exception then
    get stacked diagnostics h = pg_exception_hint;
    assert h = 'forbidden', h;
  end;
  -- The tables themselves are out of reach.
  begin
    perform count(*) from app.slots;
    raise exception 'authenticated read app.slots';
  exception when insufficient_privilege then null;
  end;
  begin
    perform app.enter_store('00000000-0000-4000-8000-00000000000a');
    raise exception 'authenticated called app.enter_store';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- Inactive employee and nobody signed in ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}';
do $$
declare h text;
begin
  assert jsonb_array_length(public.my_stores()) = 0, 'inactive member listed';
  begin
    perform public.me('00000000-0000-4000-8000-00000000000a');
    raise exception 'inactive member got in';
  exception when raise_exception then
    -- Signed out, as requireSession does for an account the owner turned off (migration 0012).
    get stacked diagnostics h = pg_exception_hint;
    assert h = 'unauthorized', h;
  end;
end $$;
set local request.jwt.claims = '';
do $$
declare h text;
begin
  perform public.me('00000000-0000-4000-8000-00000000000a');
  raise exception 'no sign-in got in';
exception when raise_exception then
  get stacked diagnostics h = pg_exception_hint;
  assert h = 'unauthorized', h;
end $$;
reset role;

-- ---- anon (not signed in at all) can't call the API ----
set local role anon;
do $$ begin
  perform public.my_stores();
  raise exception 'anon called my_stores';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ---- Inside the API role: enter_store's checks, and RLS binding every query to the entered store ----
set local role smart_scan_api;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
-- This whole test is one transaction, so forget the store an earlier API call entered (each real request is its own).
set local app.store_id = '';
do $$
declare h text; m app.store_members; n int;
begin
  -- Before entering a store, every table looks empty (even with no where clause).
  select count(*) into n from app.slots;
  assert n = 0, format('saw %s slots before entering', n);
  -- Employee sara (theft_report): any-member and her permission are fine; owner-only and others aren't.
  begin
    perform app.enter_store('00000000-0000-4000-8000-00000000000a', '{owner}');
    raise exception 'employee passed owner-only';
  exception when raise_exception then
    get stacked diagnostics h = pg_exception_hint;
    assert h = 'forbidden', h;
  end;
  begin
    perform app.enter_store('00000000-0000-4000-8000-00000000000a', '{load_packs,return_packs}');
    raise exception 'employee passed load_packs';
  exception when raise_exception then
    get stacked diagnostics h = pg_exception_hint;
    assert h = 'forbidden', h;
  end;
  m := app.enter_store('00000000-0000-4000-8000-00000000000a', '{theft_report}');
  assert m.username = 'sara', m.username;
  -- Entered A: only A's rows, with no where clause at all.
  select count(*) into n from app.slots;
  assert n = 2, format('saw %s slots in A', n);
  select count(*) into n from app.stores;
  assert n = 1, format('saw %s stores', n);
  select count(*) into n from app.store_members;
  assert n = 3, format('saw %s members of A', n);
  -- Writing a row for store B is refused; changing B's rows changes nothing.
  begin
    insert into app.slots (store_id, box, slot_number, price) values ('00000000-0000-4000-8000-00000000000b', 1, 9, 5);
    raise exception 'wrote a slot into B';
  exception when insufficient_privilege then null;
  end;
  update app.slots set price = 1 where store_id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  assert n = 0, 'changed B''s slot';
  delete from app.slots;
  get diagnostics n = row_count;
  assert n = 2, format('deleted %s slots (only A''s 2)', n);
end $$;
reset role;

-- B's slot is untouched.
do $$ begin
  assert (select price from app.slots where store_id = '00000000-0000-4000-8000-00000000000b' and box = 1 and slot_number = 1) = 5;
end $$;

rollback;
select 'foundation tests passed' as result;
