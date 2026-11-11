-- Store info and Report a Problem (migration 20261031000020). Two stores, A and B: an owner of each and an employee
-- at A. Store IDs are given on their own; only the owner reads or saves store info; every field is checked; a report
-- is saved for its own store only; My Reports shows the owner everything and an employee their own; the service
-- functions refuse a signed-in person. Everything is rolled back at the end.
-- Run: node test/db/run.js problem
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000a2', 'emp-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b1', 'owner-b@test.invalid', 'authenticated', 'authenticated');
insert into app.stores (id, name) values
  ('00000000-0000-4000-8000-00000000000a', 'Store A'),
  ('00000000-0000-4000-8000-00000000000b', 'Store B');
insert into app.store_members (store_id, user_id, username, role, permissions, active, email) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1', 'ownera', 'owner', '{}', true, 'owner-a@test.invalid'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a2', 'sara', 'employee', '{}', true, 'emp-a@test.invalid'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b1', 'ownerb', 'owner', '{}', true, 'owner-b@test.invalid');

-- Each store got its own Store ID, from 10001 up.
do $$
declare a integer; b integer;
begin
  select store_number into a from app.stores where id = '00000000-0000-4000-8000-00000000000a';
  select store_number into b from app.stores where id = '00000000-0000-4000-8000-00000000000b';
  assert a >= 10001 and b >= 10001 and a <> b, format('store ids %s %s', a, b);
end $$;

-- ---- Owner of A ----
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
declare r jsonb; h text; s uuid := '00000000-0000-4000-8000-00000000000a';
  good jsonb := '{"name": "Store A", "street": "1 Main St", "city": "Barstow", "state": "ca", "zip": "92311", "phone": "+1 (760) 555-0100"}';
begin
  r := public.store_info(s);
  assert r ->> 'state' = 'CA' and (r ->> 'complete')::boolean = false and r ->> 'street' is null, r::text;
  -- Each field is checked; nothing is saved by a refused request.
  foreach h in array array['name', 'street', 'city', 'state', 'zip', 'phone'] loop
    begin
      perform public.set_store_info(s, good || jsonb_build_object(h, case h when 'state' then 'Cal' when 'zip' then '9231'
        when 'phone' then '555-0100' else '' end));
      raise exception 'bad % was saved', h;
    exception when raise_exception then
      if sqlerrm like 'bad % was saved' then raise; end if;
    end;
  end loop;
  assert (public.store_info(s) ->> 'street') is null, 'a refused save changed the store';
  r := public.set_store_info(s, good);
  assert r ->> 'state' = 'CA' and r ->> 'phone' = '7605550100' and r ->> 'phoneLabel' = '(760) 555-0100'
    and (r ->> 'complete')::boolean, r::text;

  -- A report: checks first.
  begin perform public.report_problem(s, '{"area": "kitchen", "description": "Something broke here"}'); raise exception 'x';
  exception when others then get stacked diagnostics h = pg_exception_hint; assert h = 'bad_area', h; end;
  begin perform public.report_problem(s, '{"area": "close", "description": "broke"}'); raise exception 'x';
  exception when others then get stacked diagnostics h = pg_exception_hint; assert h = 'too_short', h; end;
  begin perform public.report_problem(s, '{"area": "close", "description": "It broke on me", "screenshots": 4}'); raise exception 'x';
  exception when others then get stacked diagnostics h = pg_exception_hint; assert h = 'too_many_screenshots', h; end;

  r := public.report_problem(s, '{"area": "close", "description": "  Typed 070 and it was refused  ", "screenshots": 2,
    "page": "close.html", "appVersion": "Version 53", "device": "iPhone", "recentErrors": ["a", "b", "c", "d", "e", "f"]}');
  assert r ->> 'status' = 'received' and (r ->> 'number')::bigint >= 1001, r::text;
end $$;

-- ---- Employee of A ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
do $$
declare r jsonb; h text; s uuid := '00000000-0000-4000-8000-00000000000a';
begin
  begin perform public.store_info(s); raise exception 'x';
  exception when others then get stacked diagnostics h = pg_exception_hint; assert h = 'forbidden', h; end;
  begin perform public.set_store_info(s, '{}'); raise exception 'x';
  exception when others then get stacked diagnostics h = pg_exception_hint; assert h = 'forbidden', h; end;
  -- The employee sees none of the owner's reports, only their own.
  assert jsonb_array_length(public.my_reports(s)) = 0, 'employee saw the owner''s report';
  perform public.report_problem(s, '{"area": "slots", "description": "The Slots page is blank"}');
  r := public.my_reports(s);
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'username' = 'sara' and r -> 0 ->> 'areaLabel' = 'Slots', r::text;
  -- Store B isn't theirs.
  begin perform public.report_problem('00000000-0000-4000-8000-00000000000b', '{"area": "slots", "description": "Not my store at all"}'); raise exception 'x';
  exception when others then get stacked diagnostics h = pg_exception_hint; assert h = 'forbidden', h; end;
  -- A signed-in person can't even call the service functions (no execute grant).
  begin perform public.service_problem_for_email(s, 1001); raise exception 'x';
  exception when insufficient_privilege then null; end;
  begin perform public.service_set_problem_status(s, 1001, 'fixed'); raise exception 'x';
  exception when insufficient_privilege then null; end;
  -- 10 an hour: 1 sent, 9 more are fine, the 11th is refused.
  for i in 1..9 loop perform public.report_problem(s, '{"area": "other", "description": "Another report here"}'); end loop;
  begin perform public.report_problem(s, '{"area": "other", "description": "One report too many"}'); raise exception 'x';
  exception when others then get stacked diagnostics h = pg_exception_hint; assert h = 'too_many_reports', h; end;
end $$;

-- ---- Owner of A again: sees both people's reports; owner of B sees none of them ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
declare r jsonb;
begin
  r := public.my_reports('00000000-0000-4000-8000-00000000000a');
  assert jsonb_array_length(r) = 11 and r -> 10 ->> 'username' = 'ownera' and r -> 10 ->> 'description' = 'Typed 070 and it was refused', r::text;
end $$;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
do $$
begin
  assert jsonb_array_length(public.my_reports('00000000-0000-4000-8000-00000000000b')) = 0, 'store B saw store A''s reports';
end $$;

-- ---- Service key (the support function, scripts/report-status.js) ----
reset role;
select set_config('test.first_report', min(id)::text, true) from app.problem_reports
  where store_id = '00000000-0000-4000-8000-00000000000a';
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
do $$
declare r jsonb; n bigint := current_setting('test.first_report')::bigint; s uuid := '00000000-0000-4000-8000-00000000000a';
begin
  r := public.service_problem_for_email(s, n);
  assert r -> 'store' ->> 'street' = '1 Main St' and r ->> 'email' = 'owner-a@test.invalid' and r ->> 'areaLabel' = 'Close Day'
    and jsonb_array_length(r -> 'recentErrors') = 5 and (r ->> 'screenshots')::int = 2 and r ->> 'role' = 'owner', r::text;
  perform public.service_problem_emailed(s, n, null);
  r := public.service_set_problem_status(s, n, 'fixed', 'Fixed in version 54');
  assert r ->> 'status' = 'fixed' and r ->> 'statusNote' = 'Fixed in version 54', r::text;
  -- The wrong store can't touch it.
  begin perform public.service_set_problem_status('00000000-0000-4000-8000-00000000000b', n, 'working'); raise exception 'x';
  exception when others then assert sqlerrm = 'No such report in that store.', sqlerrm; end;
  -- The email link's page (migration 0023): the report with its status and note, for its own store only.
  r := public.service_problem_for_link(s, n);
  assert (r ->> 'number')::bigint = n and r ->> 'status' = 'fixed' and r ->> 'statusNote' = 'Fixed in version 54'
    and r ->> 'storeName' = 'Store A' and (r ->> 'storeNumber')::int >= 10001 and r ->> 'role' = 'owner'
    and r ->> 'areaLabel' = 'Close Day' and r ->> 'username' = 'ownera', r::text;
  begin perform public.service_problem_for_link('00000000-0000-4000-8000-00000000000b', n); raise exception 'x';
  exception when others then assert sqlerrm = 'No such report in that store.', sqlerrm; end;
end $$;
reset role;

-- ---- Signed in: not the link's read ----
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
begin
  perform public.service_problem_for_link('00000000-0000-4000-8000-00000000000a', 1);
  raise exception 'x';
exception when insufficient_privilege then null;
end $$;

-- ---- Clearing fixed reports (migration 0024): the sender or the owner, Fixed only, shared, Undo/Restore ----
reset role;
-- Sara's first report is fixed by support; her second one isn't.
select set_config('test.sara_fixed', min(id)::text, true), set_config('test.sara_open', max(id)::text, true)
  from app.problem_reports where store_id = '00000000-0000-4000-8000-00000000000a' and username = 'sara';
update app.problem_reports set status = 'fixed' where id = current_setting('test.sara_fixed')::bigint;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000a'; r jsonb;
  mine bigint := current_setting('test.sara_fixed')::bigint; open bigint := current_setting('test.sara_open')::bigint;
  owners bigint := current_setting('test.first_report')::bigint;
begin
  -- Not hers, not fixed, nothing picked: refused, nothing cleared.
  begin perform public.clear_reports(s, jsonb_build_object('numbers', jsonb_build_array(owners))); raise exception 'x';
  exception when others then assert sqlerrm = 'That report isn''t in your reports.', sqlerrm; end;
  begin perform public.clear_reports(s, jsonb_build_object('numbers', jsonb_build_array(mine, open))); raise exception 'x';
  exception when others then assert sqlerrm = 'Only fixed reports can be cleared.', sqlerrm; end;
  begin perform public.clear_reports(s, '{"numbers": []}'); raise exception 'x';
  exception when others then assert sqlerrm = 'Pick a report first.', sqlerrm; end;
  begin perform public.clear_reports(s, '{}'); raise exception 'x';
  exception when others then assert sqlerrm = 'Pick a report first.', sqlerrm; end;
  assert jsonb_array_length(public.my_reports(s)) = 10, 'nothing cleared by a refused request';
  -- Her fixed one: gone from My Reports, listed under Show Cleared.
  r := public.clear_reports(s, jsonb_build_object('numbers', jsonb_build_array(mine)));
  assert jsonb_array_length(r) = 9 and not r @> jsonb_build_array(jsonb_build_object('number', mine)), r::text;
  r := public.my_reports(s, '{"cleared": true}');
  assert jsonb_array_length(r) = 1 and (r -> 0 ->> 'number')::bigint = mine and r -> 0 ->> 'status' = 'fixed', r::text;
  -- Undo.
  r := public.restore_reports(s, jsonb_build_object('numbers', jsonb_build_array(mine)));
  assert jsonb_array_length(r) = 10 and jsonb_array_length(public.my_reports(s, '{"cleared": true}')) = 0, r::text;
  perform public.clear_reports(s, jsonb_build_object('numbers', jsonb_build_array(mine)));
end $$;

-- Owner: Sara's cleared report is cleared for the owner too (one list); the owner clears any fixed report, all at once.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000a'; r jsonb;
  saras bigint := current_setting('test.sara_fixed')::bigint; owners bigint := current_setting('test.first_report')::bigint;
begin
  r := public.my_reports(s);
  assert jsonb_array_length(r) = 10 and not r @> jsonb_build_array(jsonb_build_object('number', saras)), 'shared list';
  r := public.restore_reports(s, jsonb_build_object('numbers', jsonb_build_array(saras)));
  assert jsonb_array_length(r) = 11, 'the owner restores an employee''s report';
  -- Clear All Fixed: the owner's and Sara's.
  r := public.clear_reports(s, jsonb_build_object('numbers', jsonb_build_array(owners, saras)));
  assert jsonb_array_length(r) = 9, r::text;
  assert jsonb_array_length(public.my_reports(s, '{"cleared": true}')) = 2, 'both under Show Cleared';
  -- Clearing again is fine (nothing changes).
  perform public.clear_reports(s, jsonb_build_object('numbers', jsonb_build_array(owners)));
end $$;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
do $$
begin
  -- Another store's owner: not theirs.
  begin perform public.restore_reports('00000000-0000-4000-8000-00000000000b',
    jsonb_build_object('numbers', jsonb_build_array(current_setting('test.first_report')::bigint))); raise exception 'x';
  exception when others then assert sqlerrm = 'That report isn''t in your reports.', sqlerrm; end;
end $$;
reset role;

reset role;
do $$
begin
  assert (select cleared_by from app.problem_reports where id = current_setting('test.sara_fixed')::bigint) = 'ownera',
    'who cleared it is kept for support';
end $$;

-- Support moves a cleared report back to Working on It: it shows again.
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
select public.service_set_problem_status('00000000-0000-4000-8000-00000000000a', current_setting('test.sara_fixed')::bigint, 'working');
reset role;
do $$
begin
  assert (select cleared_at is null and cleared_by is null from app.problem_reports where id = current_setting('test.sara_fixed')::bigint),
    'moved back from Fixed: not cleared any more';
  assert (select cleared_at is not null from app.problem_reports where id = current_setting('test.first_report')::bigint),
    'the other one stays cleared';
end $$;

select 'problem reports ok' as result;
rollback;
