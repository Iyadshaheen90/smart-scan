-- The real import, twice (migration 20261110000022): a store is imported, refuses a second import on top, is cleared
-- only with its exact name, keeps its people (and who signed in), Store Info and retailer number when cleared, and
-- takes the import again with the people updated from the sheets and a new person added. Signed-in people can't call
-- either service function. Everything is rolled back at the end.
-- Run: node test/db/run.js prod_import
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000c1', 'owner-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c2', 'emp-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c3', 'new-c@test.invalid', 'authenticated', 'authenticated');
insert into app.stores (id, name, street) values ('00000000-0000-4000-8000-00000000000c', 'Store C', '1 Main St');

-- ---- Signed in: neither function ----
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
do $$
begin
  begin perform public.service_clear_store('00000000-0000-4000-8000-00000000000c', 'Store C'); raise exception 'x';
  exception when insufficient_privilege then null; end;
  begin perform public.service_import_store('00000000-0000-4000-8000-00000000000c', '{}'); raise exception 'x';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- The rows to import, kept in a setting so every block below (and role) can read them.
select set_config('test.import', jsonb_build_object(
    'members', jsonb_build_array(
      jsonb_build_object('userId', '00000000-0000-4000-8000-0000000000c1', 'username', 'boss', 'role', 'owner', 'permissions', '[]'::jsonb,
        'active', true, 'email', 'owner-c@test.invalid', 'createdOn', '2026-09-22'),
      jsonb_build_object('userId', '00000000-0000-4000-8000-0000000000c2', 'username', 'sara', 'role', 'employee',
        'permissions', '["load_packs"]'::jsonb, 'active', true, 'email', 'emp-c@test.invalid', 'createdOn', '2026-09-22')),
    'slots', jsonb_build_array(jsonb_build_object('box', 1, 'slot', 1, 'price', 10, 'order', 'descending', 'lastGame', '1111')),
    'games', jsonb_build_array(jsonb_build_object('game', '1111', 'price', 10, 'size', 50, 'inBack', 2, 'endedOn', null)),
    'packs', jsonb_build_array(jsonb_build_object('game', '1111', 'pack', '0000001', 'status', 'live', 'box', 1, 'slot', 1,
      'order', 'descending', 'price', 10, 'activationTicket', 49, 'top', 40, 'activatedOn', '2026-11-01',
      'lastCloseOn', '2026-11-09', 'tookFromBack', true)),
    'closeEntries', jsonb_build_array(jsonb_build_object('date', '2026-11-09', 'box', 1, 'slot', 1, 'game', '1111',
      'pack', '0000001', 'previous', 49, 'current', 40, 'tickets', 9, 'price', 10, 'dollars', 90, 'remainingAfter', 41,
      'type', 'close', 'late', false, 'performedBy', 'sara', 'loggedAt', '2026-11-09 22:50:00')),
    'dailyCloses', jsonb_build_array(jsonb_build_object('date', '2026-11-09', 'tickets', 9, 'dollars', 90, 'liveSlots', 1,
      'inventory', 1410, 'closeId', 'c1', 'closedBy', 'sara', 'closedAt', '2026-11-09 22:50:00')),
    'shiftCloses', '[]'::jsonb, 'shiftEntries', '[]'::jsonb, 'shipments', '[]'::jsonb, 'adjustments', '[]'::jsonb)::text, true);

-- ---- The service key: the first import, then never twice on top of itself ----
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000c'; d jsonb := current_setting('test.import')::jsonb; r jsonb;
begin
  r := public.service_import_store(s, d);
  assert r = '{"members": 2, "slots": 1, "games": 1, "packs": 1, "closeEntries": 1, "dailyCloses": 1, "shiftCloses": 0,
    "shiftEntries": 0, "shipments": 0, "adjustments": 0}'::jsonb, r::text;
  begin perform public.service_import_store(s, d); raise exception 'x';
  exception when others then assert sqlerrm = 'This store already has data; the import only fills an empty store.', sqlerrm; end;
end $$;
reset role;

-- Sara signs in during the side-by-side week; the owner saves the retailer number.
update app.store_members set signed_in_at = '2026-11-10 09:00:00-08' where user_id = '00000000-0000-4000-8000-0000000000c2';
select vault.create_secret('123456', 'retailer_number:00000000-0000-4000-8000-00000000000c', 'test');

-- ---- The service key: the wrong name or store clears nothing; the right name clears the sales ----
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000c'; r jsonb;
begin
  begin perform public.service_clear_store(s, 'Store c'); raise exception 'x';
  exception when others then assert sqlerrm = 'The store name doesn''t match; nothing was cleared.', sqlerrm; end;
  begin perform public.service_clear_store('00000000-0000-4000-8000-0000000000ff', 'Store C'); raise exception 'x';
  exception when others then assert sqlerrm = 'No such store.', sqlerrm; end;
  r := public.service_clear_store(s, 'Store C');
  assert r = '{"packs": 1, "closeEntries": 1, "dailyCloses": 1, "shiftCloses": 0}'::jsonb, r::text;
end $$;
reset role;

do $$
declare s uuid := '00000000-0000-4000-8000-00000000000c';
begin
  assert (select count(*) from app.packs where store_id = s) = 0, 'packs gone';
  assert (select count(*) from app.slots where store_id = s) = 0, 'slots gone';
  assert (select count(*) from app.games where store_id = s) = 0, 'games gone';
  assert (select count(*) from app.close_entries where store_id = s) = 0, 'close lines gone';
  assert (select count(*) from app.daily_closes where store_id = s) = 0, 'day totals gone';
  assert (select count(*) from app.store_members where store_id = s) = 2, 'people kept';
  assert (select street from app.stores where id = s) = '1 Main St', 'store info kept';
  assert exists (select 1 from vault.secrets where name = 'retailer_number:' || s::text), 'retailer number kept';
end $$;

-- ---- The service key: the final import (Sara gets another permission, the owner renamed, a new person turned off) ----
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000c'; d jsonb := current_setting('test.import')::jsonb; r jsonb;
begin
  d := jsonb_set(jsonb_set(d, '{members,1,permissions}', '["load_packs", "return_packs"]'::jsonb), '{members,0,username}', '"boss2"');
  d := jsonb_set(d, '{members}', (d -> 'members') || jsonb_build_array(jsonb_build_object(
    'userId', '00000000-0000-4000-8000-0000000000c3', 'username', 'newbie', 'role', 'employee', 'permissions', '[]'::jsonb,
    'active', false, 'email', 'new-c@test.invalid', 'createdOn', '2026-11-20')));
  r := public.service_import_store(s, d);
  assert (r ->> 'members')::int = 3 and (r ->> 'packs')::int = 1 and (r ->> 'closeEntries')::int = 1, r::text;
end $$;
reset role;

do $$
declare s uuid := '00000000-0000-4000-8000-00000000000c';
begin
  assert (select permissions from app.store_members where store_id = s and username = 'sara') = array['load_packs', 'return_packs'], 'sara updated';
  assert (select signed_in_at from app.store_members where store_id = s and username = 'sara') = '2026-11-10 09:00:00-08', 'sara keeps when she signed in';
  assert exists (select 1 from app.store_members where store_id = s and username = 'boss2' and role = 'owner'), 'owner renamed';
  assert exists (select 1 from app.store_members where store_id = s and username = 'newbie' and not active and signed_in_at is null), 'newbie added';
end $$;

select 'prod import ok' as result;
rollback;
