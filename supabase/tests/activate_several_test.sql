-- Activate Several (migration 20261111000025): many scanned packs, one Activate All. Store A with three slots:
-- 1-1 empty (last game 1747), 1-2 holding 1747 pack 0000001, 1-3 empty $10. Game 1747 ($20, 30 tickets) has pack
-- 0000002 in the back by number. A check answers every row and keeps nothing; a save with one bad row keeps nothing;
-- a good list saves every row (old pack sold out, new game added); Undo All puts everything back. An employee with
-- Load Packs may use it, one without may not. Everything is rolled back at the end.
-- Run: node test/db/run.js activate_several
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000a2', 'loader-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000a3', 'emp-a@test.invalid', 'authenticated', 'authenticated');
insert into app.stores (id, name) values ('00000000-0000-4000-8000-00000000000a', 'Store A');
insert into app.store_members (store_id, user_id, username, role, permissions, active, email) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1', 'ownera', 'owner', '{}', true, 'owner-a@test.invalid'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a2', 'loader', 'employee', '{load_packs}', true, 'loader-a@test.invalid'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a3', 'sara', 'employee', '{}', true, 'emp-a@test.invalid');
insert into app.slots (store_id, box, slot_number, price, last_game_number) values
  ('00000000-0000-4000-8000-00000000000a', 1, 1, 20, '1747'),
  ('00000000-0000-4000-8000-00000000000a', 1, 2, 20, null),
  ('00000000-0000-4000-8000-00000000000a', 1, 3, 10, null),
  -- Two more empty slots, so a list of five packs fits (the cap is the store's slot count, migration 0028).
  ('00000000-0000-4000-8000-00000000000a', 1, 4, 5, null),
  ('00000000-0000-4000-8000-00000000000a', 1, 5, 5, null);
insert into app.games (store_id, game_number, price, tickets_per_pack) values
  ('00000000-0000-4000-8000-00000000000a', '1747', 20, 30),
  ('00000000-0000-4000-8000-00000000000a', '2222', 10, 50);
insert into app.packs (store_id, game_number, pack_number, status, box, slot_number, price, top_ticket, activation_ticket,
  activated_on, took_from_back) values
  ('00000000-0000-4000-8000-00000000000a', '1747', '0000001', 'live', 1, 2, 20, 5, 29, current_date - 3, true),
  ('00000000-0000-4000-8000-00000000000a', '1747', '0000002', 'in_back', null, null, null, null, null, null, null);

-- ---- Owner ----
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000a'; r jsonb; rows jsonb; h text;
  a jsonb := '{"box": 1, "slot": 1, "gameNumber": "1747", "packNumber": "0000002", "ticketNumber": 29}';
  b jsonb := '{"box": 1, "slot": 2, "gameNumber": "1747", "packNumber": "0000003", "ticketNumber": 29}';
  c jsonb := '{"box": 1, "slot": 3, "gameNumber": "9999", "packNumber": "0000001", "ticketNumber": 49}';
begin
  -- A check: every row answered on its own row, nothing kept.
  r := public.activate_several(s, jsonb_build_object('check', true, 'packs', jsonb_build_array(a, b, c,
    '{"gameNumber": "2222", "packNumber": "0000009", "ticketNumber": 49}'::jsonb, a)));
  rows := r -> 'rows';
  assert (r ->> 'saved')::boolean = false and jsonb_array_length(rows) = 5, r::text;
  assert (rows -> 0 ->> 'ok')::boolean and rows -> 0 ->> 'packKey' = '1747-0000002' and (rows -> 0 ->> 'packsInBack')::int = 0, rows::text;
  assert rows -> 1 ->> 'code' = 'slot_occupied' and rows -> 1 ->> 'message' like '%still has pack 1747-0000001%', rows::text;
  assert rows -> 2 ->> 'code' = 'unknown_game', rows::text;
  assert rows -> 3 ->> 'code' = 'pick_slot', rows::text;
  assert rows -> 4 ->> 'code' = 'pack_twice', rows::text;
  reset role; assert (select status from app.packs where pack_number = '0000002') = 'in_back', 'a check keeps nothing'; set local role authenticated;
  reset role; assert not exists (select 1 from app.games where game_number = '9999'); set local role authenticated;

  -- The same slot twice.
  r := public.activate_several(s, jsonb_build_object('check', true, 'packs', jsonb_build_array(a,
    '{"box": 1, "slot": 1, "gameNumber": "2222", "packNumber": "0000009", "ticketNumber": 49}'::jsonb)));
  assert r -> 'rows' -> 1 ->> 'code' = 'slot_twice', r::text;

  -- A save with one bad row (old pack not dealt with) saves nothing, not even the good rows.
  r := public.activate_several(s, jsonb_build_object('packs', jsonb_build_array(a, b)));
  assert (r ->> 'saved')::boolean = false and (r -> 'rows' -> 0 ->> 'ok')::boolean and r -> 'rows' -> 1 ->> 'code' = 'slot_occupied', r::text;
  reset role; assert (select status from app.packs where pack_number = '0000002') = 'in_back'; set local role authenticated;
  reset role; assert (select status from app.packs where game_number = '1747' and pack_number = '0000001') = 'live'; set local role authenticated;

  -- A price that doesn't match the slot: asks first, like the slot page.
  r := public.activate_several(s, jsonb_build_object('check', true, 'packs', jsonb_build_array(
    '{"box": 1, "slot": 3, "gameNumber": "1747", "packNumber": "0000002", "ticketNumber": 29}'::jsonb)));
  assert r -> 'rows' -> 0 ->> 'code' = 'price_mismatch', r::text;

  -- Everything good: saved together.
  b := b || '{"oldPackEnd": "sold_out"}';
  c := c || '{"gamePrice": 10, "ticketsPerPack": 50}';
  r := public.activate_several(s, jsonb_build_object('packs', jsonb_build_array(a, b, c)));
  rows := r -> 'rows';
  assert (r ->> 'saved')::boolean and rows -> 1 -> 'oldPack' ->> 'reason' = 'sold_out'
    and (rows -> 1 -> 'oldPack' ->> 'ticketsSoldToday')::int = 6, r::text;
  reset role; assert (select status || box || slot_number from app.packs where pack_number = '0000002') = 'live11'; set local role authenticated;
  reset role; assert (select status from app.packs where game_number = '1747' and pack_number = '0000001') = 'sold_out'; set local role authenticated;
  reset role; assert (select status || box || slot_number from app.packs where game_number = '1747' and pack_number = '0000003') = 'live12'; set local role authenticated;
  reset role; assert (select price from app.games where game_number = '9999') = 10; set local role authenticated;

  -- Undo All: last first; the sold-out pack is live again, the numbered pack back in the back, the new pack gone.
  r := public.undo_activate_several(s, '{"slots": [{"box": 1, "slot": 1, "oldPack": false}, {"box": 1, "slot": 2, "oldPack": true},
    {"box": 1, "slot": 3, "oldPack": false}]}');
  assert (r ->> 'undone')::int = 3, r::text;
  reset role; assert (select status from app.packs where pack_number = '0000002') = 'in_back'; set local role authenticated;
  reset role; assert (select status || top_ticket from app.packs where game_number = '1747' and pack_number = '0000001') = 'live5'; set local role authenticated;
  reset role; assert not exists (select 1 from app.packs where game_number in ('9999') or pack_number = '0000003'); set local role authenticated;

  -- Undo again: refused with the slot named, and nothing changes.
  begin
    perform public.undo_activate_several(s, '{"slots": [{"box": 1, "slot": 3, "oldPack": false}]}');
    assert false, 'undo of an empty slot went through';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint;
    assert h = 'slot_empty', h;
  end;
  begin
    perform public.activate_several(s, '{"packs": []}');
    assert false, 'an empty list went through';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint;
    assert h = 'bad_request', h;
  end;
end $$;

-- ---- Employee with Load Packs: allowed ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
do $$
declare r jsonb;
begin
  r := public.activate_several('00000000-0000-4000-8000-00000000000a', '{"check": true, "packs": [{"box": 1, "slot": 1,
    "gameNumber": "1747", "packNumber": "0000002", "ticketNumber": 29}]}');
  assert (r -> 'rows' -> 0 ->> 'ok')::boolean, r::text;
end $$;

-- ---- Employee without it: refused ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}';
do $$
declare h text;
begin
  begin
    perform public.activate_several('00000000-0000-4000-8000-00000000000a', '{"check": true, "packs": [{"box": 1, "slot": 1,
      "gameNumber": "1747", "packNumber": "0000002", "ticketNumber": 29}]}');
    assert false, 'an employee without Load Packs got in';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint;
    assert h = 'forbidden', h;
  end;
end $$;

reset role;
select 'activate several: check, all or nothing, save, undo all, permissions' as result;
rollback;
