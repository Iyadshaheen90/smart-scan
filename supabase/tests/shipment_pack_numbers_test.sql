-- Shipment Received by pack number (migration 20261111000026). Store A: game 1747 ($20, 30 tickets) with 2 packs in the
-- back without numbers, pack 0000001 live in box 1 slot 1, 0000002 sold out, 0000003 in the back by number; slot 1-2 is
-- an empty $20 slot. Scanned packs go in by number (typed ones without); a pack number the database already has is
-- refused with why and nothing in the shipment is saved; the same pack twice too; a count ignores pack numbers; a
-- received pack is then activated by its number. Everything is rolled back at the end.
-- Run: node test/db/run.js shipment_pack_numbers
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@test.invalid', 'authenticated', 'authenticated');
insert into app.stores (id, name) values ('00000000-0000-4000-8000-00000000000a', 'Store A');
insert into app.store_members (store_id, user_id, username, role, permissions, active, email) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1', 'ownera', 'owner', '{}', true, 'owner-a@test.invalid');
insert into app.slots (store_id, box, slot_number, price, last_game_number) values
  ('00000000-0000-4000-8000-00000000000a', 1, 1, 20, null),
  ('00000000-0000-4000-8000-00000000000a', 1, 2, 20, null);
insert into app.games (store_id, game_number, price, tickets_per_pack, unnumbered_in_back) values
  ('00000000-0000-4000-8000-00000000000a', '1747', 20, 30, 2);
insert into app.packs (store_id, game_number, pack_number, status, box, slot_number, price, top_ticket, activation_ticket,
  activated_on, ended_on, received_on) values
  ('00000000-0000-4000-8000-00000000000a', '1747', '0000001', 'live', 1, 1, 20, 5, 29, current_date - 3, null, null),
  ('00000000-0000-4000-8000-00000000000a', '1747', '0000002', 'sold_out', 1, 1, 20, null, 29, current_date - 9, '2026-10-28', null),
  ('00000000-0000-4000-8000-00000000000a', '1747', '0000003', 'in_back', null, null, null, null, null, null, null, '2026-11-03');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000a'; h text; msg text; got text; got_msg text;
  ship jsonb;
begin
  -- Refused, each with why; nothing saved, not even the good line before it.
  for ship, h, msg in values
    ('[{"gameNumber": "1747", "packs": 1, "packNumbers": ["0000001"]}]'::jsonb, 'pack_used', 'Pack 1747-0000001 is live in box 1, slot 1.'),
    ('[{"gameNumber": "1747", "packs": 1, "packNumbers": ["0000002"]}]'::jsonb, 'pack_used', 'Pack 1747-0000002 already sold out on %'),
    ('[{"gameNumber": "1747", "packs": 1, "packNumbers": ["0000003"]}]'::jsonb, 'pack_used', 'Pack 1747-0000003 is already in the back (received %'),
    ('[{"gameNumber": "9000", "packs": 1, "gamePrice": 5, "packNumbers": ["0000001"]}, {"gameNumber": "1747", "packs": 2, "packNumbers": ["0000010", "0000003"]}]'::jsonb,
      'pack_used', 'Pack 1747-0000003 is already in the back%'),
    ('[{"gameNumber": "1747", "packs": 2, "packNumbers": ["0000010", "0000010"]}]'::jsonb, 'pack_twice', 'Pack 1747-0000010 is on the list twice.'),
    ('[{"gameNumber": "1747", "packs": 1, "packNumbers": ["0000010", "0000011"]}]'::jsonb, 'bad_request', '%pack numbers don''t match%'),
    ('[{"gameNumber": "1747", "packs": 1, "packNumbers": ["12345"]}]'::jsonb, 'bad_request', '"12345" isn''t a pack number.')
  loop
    begin
      perform public.save_back_stock(s, jsonb_build_object('mode', 'shipment', 'lines', ship));
      assert false, 'saved: ' || ship::text;
    exception when sqlstate 'P0001' then
      get stacked diagnostics got = pg_exception_hint, got_msg = message_text;
      assert got = h and got_msg like msg, format('%s: %s %s', ship, got, got_msg);
    end;
  end loop;
  reset role;
  assert (select count(*) from app.shipments where store_id = '00000000-0000-4000-8000-00000000000a') = 0, 'a refused shipment saves nothing';
  assert not exists (select 1 from app.games where store_id = '00000000-0000-4000-8000-00000000000a' and game_number = '9000'), 'not even the new game on the good line';
  assert (select count(*) from app.packs where store_id = '00000000-0000-4000-8000-00000000000a') = 3, 'line 53';
  set local role authenticated;
end $$;

-- The exact words of the main refusals.
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000a'; h text; msg text;
begin
  begin
    perform public.save_back_stock(s, '{"mode": "shipment", "lines": [{"gameNumber": "1747", "packs": 1, "packNumbers": ["0000001"]}]}');
    assert false, 'line 63';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'pack_used' and msg = 'Pack 1747-0000001 is live in box 1, slot 1.', msg;
  end;
  begin
    perform public.save_back_stock(s, '{"mode": "shipment", "lines": [{"gameNumber": "1747", "packs": 1, "packNumbers": ["0000002"]}]}');
    assert false, 'line 70';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'pack_used' and msg like 'Pack 1747-0000002 already sold out on 2026-10-28.', msg;
  end;
  begin
    perform public.save_back_stock(s, '{"mode": "shipment", "lines": [{"gameNumber": "1747", "packs": 1, "packNumbers": ["0000003"]}]}');
    assert false, 'line 77';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'pack_used' and msg like 'Pack 1747-0000003 is already in the back (received 2026-11-03).', msg;
  end;
  begin
    perform public.save_back_stock(s, '{"mode": "shipment", "lines": [{"gameNumber": "1747", "packs": 2, "packNumbers": ["0000010", "0000010"]}]}');
    assert false, 'line 84';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'pack_twice' and msg = 'Pack 1747-0000010 is on the list twice.', msg;
  end;
end $$;

-- A good shipment: 1747 gets 3 packs (2 scanned, 1 typed), a new game 9000 gets 1 scanned. Back: 3 + 3 = 6.
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000a'; r jsonb;
begin
  r := public.save_back_stock(s, '{"mode": "shipment", "notes": "inv 55", "lines": [
    {"gameNumber": "1747", "packs": 3, "packNumbers": ["0000010", "0000011"]},
    {"gameNumber": "9000", "packs": 1, "gamePrice": 5, "packNumbers": ["0000001"]}]}');
  assert r -> 'results' -> 0 ->> 'before' = '3' and r -> 'results' -> 0 ->> 'after' = '6', r::text;
  assert r -> 'results' -> 1 ->> 'after' = '1', r::text;
  reset role;
  assert (select unnumbered_in_back from app.games where store_id = '00000000-0000-4000-8000-00000000000a' and game_number = '1747') = 3, 'only the typed pack is unnumbered';
  assert (select count(*) from app.packs where store_id = '00000000-0000-4000-8000-00000000000a' and game_number = '1747' and status = 'in_back' and received_on = app.today()
    and shipment_id is not null and performed_by = 'ownera') = 2, 'line 102: 2 numbered packs in';
  assert (select unnumbered_in_back from app.games where store_id = '00000000-0000-4000-8000-00000000000a' and game_number = '9000') = 0, 'line 104';
  assert exists (select 1 from app.packs where store_id = '00000000-0000-4000-8000-00000000000a' and game_number = '9000' and pack_number = '0000001' and status = 'in_back'), 'line 105';
  assert (select count(*) from app.shipments where store_id = '00000000-0000-4000-8000-00000000000a' and notes = 'inv 55') = 2, 'line 106';
  set local role authenticated;

  -- Received once, never again.
  begin
    perform public.save_back_stock(s, '{"mode": "shipment", "lines": [{"gameNumber": "1747", "packs": 1, "packNumbers": ["0000011"]}]}');
    assert false, 'the same pack received twice';
  exception when sqlstate 'P0001' then null;
  end;

  -- A shipment without pack numbers (Sheets-style, a typed game) still counts packs as before.
  r := public.save_back_stock(s, '{"mode": "shipment", "lines": [{"gameNumber": "1747", "packs": 1}]}');
  assert r -> 'results' -> 0 ->> 'after' = '7', r::text;

  -- A count ignores pack numbers.
  r := public.save_back_stock(s, '{"mode": "count", "lines": [{"gameNumber": "1747", "packs": 7, "packNumbers": ["0000001"]}]}');
  assert r -> 'results' -> 0 ->> 'after' = '7', r::text;

  -- A received pack put in a slot comes out of the back by its number (the unnumbered count stays).
  r := public.activate_pack(s, '{"box": 1, "slot": 2, "gameNumber": "1747", "packNumber": "0000010", "ticketNumber": 29}');
  assert (r ->> 'packsInBack')::int = 6, r::text;
  reset role;
  assert (select status from app.packs where store_id = '00000000-0000-4000-8000-00000000000a' and game_number = '1747' and pack_number = '0000010') = 'live', 'line 128';
  assert (select unnumbered_in_back from app.games where store_id = '00000000-0000-4000-8000-00000000000a' and game_number = '1747') = 4, 'line 129';
  set local role authenticated;
end $$;

reset role;
select 'shipment pack numbers: by number, refusals with why, all or nothing, count ignores, activation by number' as result;
rollback;
