-- A pack the database took out for a count or Manage Packs − can come back (migration 20261112000027). Store A: game
-- 1747 ($20, 30 tickets), packs 0000011-13 in the back by number, two empty $20 slots. A count of 2 takes 0000013 out
-- (the newest); it can then be activated, sold as a full pack, or received again. A pack taken out as returned stays
-- refused. Everything is rolled back at the end.
-- Run: node test/db/run.js counted_out_packs
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@test.invalid', 'authenticated', 'authenticated');
insert into app.stores (id, name) values ('00000000-0000-4000-8000-00000000000a', 'Store A');
insert into app.store_members (store_id, user_id, username, role, permissions, active, email) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1', 'ownera', 'owner', '{}', true, 'owner-a@test.invalid');
insert into app.slots (store_id, box, slot_number, price) values
  ('00000000-0000-4000-8000-00000000000a', 1, 1, 20), ('00000000-0000-4000-8000-00000000000a', 1, 2, 20);
insert into app.games (store_id, game_number, price, tickets_per_pack, unnumbered_in_back) values
  ('00000000-0000-4000-8000-00000000000a', '1747', 20, 30, 0);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000a'; r jsonb; got text; got_msg text;
  status_of text; loose integer;
begin
  perform public.save_back_stock(s, '{"mode": "shipment", "lines": [{"gameNumber": "1747", "packs": 3, "packNumbers": ["0000011", "0000012", "0000013"]}]}');

  -- A count of 2 takes the newest pack out; a count of 3 adds one without a number.
  perform public.save_back_stock(s, '{"mode": "count", "lines": [{"gameNumber": "1747", "packs": 2}]}');
  perform public.save_back_stock(s, '{"mode": "count", "lines": [{"gameNumber": "1747", "packs": 3}]}');
  reset role;
  select status || '/' || removed_reason into status_of from app.packs where store_id = s and pack_number = '0000013';
  assert status_of = 'removed/count', 'counted out: ' || status_of;
  select unnumbered_in_back into loose from app.games where store_id = s and game_number = '1747';
  assert loose = 1, 'one without a number';
  set local role authenticated;

  -- Activated: it takes the pack without a number, so the back goes from 3 to 2. Undo puts it back by number.
  r := public.activate_pack(s, '{"box": 1, "slot": 1, "gameNumber": "1747", "packNumber": "0000013", "ticketNumber": 29}');
  assert (r ->> 'packsInBack')::integer = 2, 'activated: ' || r::text;
  reset role;
  assert (select status = 'live' and removed_reason is null and ended_on is null and took_from_back from app.packs
    where store_id = s and pack_number = '0000013'), 'live, nothing left of the removal';
  assert (select count(*) from app.packs where store_id = s and pack_number = '0000013') = 1, 'the same row';
  set local role authenticated;
  r := public.undo_activation(s, '{"box": 1, "slot": 1}');
  assert (r ->> 'packsInBack')::integer = 3 and (r ->> 'returnedToBack')::boolean, 'undone: ' || r::text;

  -- Counted out again (Manage Packs -1 takes the newest: 0000013), nothing left without a number: still activates,
  -- as a pack that wasn't in the back.
  perform public.adjust_back_stock(s, '{"gameNumber": "1747", "change": -1}');
  reset role;
  select status || '/' || removed_reason into status_of from app.packs where store_id = s and pack_number = '0000013';
  assert status_of = 'removed/adjust', 'taken out by Manage Packs: ' || status_of;
  set local role authenticated;
  r := public.activate_pack(s, '{"box": 1, "slot": 1, "gameNumber": "1747", "packNumber": "0000013", "ticketNumber": 29}');
  assert (r ->> 'packsInBack')::integer = 2, 'activated with none loose: ' || r::text;
  r := public.undo_activation(s, '{"box": 1, "slot": 1}');
  assert not (r ->> 'returnedToBack')::boolean and (r ->> 'packsInBack')::integer = 2, 'undone: ' || r::text;
  reset role;
  assert not exists (select 1 from app.packs where store_id = s and pack_number = '0000013'), 'forgotten, as an unknown pack is';
  set local role authenticated;

  -- Received again: back in the back by number.
  perform public.save_back_stock(s, '{"mode": "count", "lines": [{"gameNumber": "1747", "packs": 1}]}');   -- takes 0000012 out
  r := public.save_back_stock(s, '{"mode": "shipment", "lines": [{"gameNumber": "1747", "packs": 1, "packNumbers": ["0000012"]}]}');
  assert (r #>> '{results,0,after}')::integer = 2, 'received again: ' || r::text;
  reset role;
  assert (select status = 'in_back' and removed_reason is null and ended_on is null and received_on is not null
    from app.packs where store_id = s and pack_number = '0000012'), 'in the back again';
  set local role authenticated;

  -- Sold as a full pack: needs one counted without a number, like an unknown pack.
  perform public.save_back_stock(s, '{"mode": "count", "lines": [{"gameNumber": "1747", "packs": 1}]}');   -- takes 0000012 out again
  begin
    perform public.sell_full_pack(s, '{"gameNumber": "1747", "packNumber": "0000012"}');
    assert false, 'sold with nothing loose';
  exception when sqlstate 'P0001' then
    get stacked diagnostics got = pg_exception_hint;
    assert got = 'not_in_back', 'hint ' || got;
  end;
  perform public.save_back_stock(s, '{"mode": "count", "lines": [{"gameNumber": "1747", "packs": 2}]}');   -- one more, no number
  r := public.sell_full_pack(s, '{"gameNumber": "1747", "packNumber": "0000012"}');
  assert (r ->> 'after')::integer = 1, 'sold whole: ' || r::text;
  reset role;
  assert (select status = 'full_pack_sale' and removed_reason is null from app.packs where store_id = s and pack_number = '0000012'), 'sold';
  assert (select unnumbered_in_back from app.games where store_id = s and game_number = '1747') = 0, 'took the loose one';
  set local role authenticated;

  -- Taken out as returned: still refused everywhere.
  perform public.remove_back_stock(s, '{"gameNumber": "1747", "packs": 1, "reason": "returned"}');          -- 0000011
  begin
    perform public.activate_pack(s, '{"box": 1, "slot": 1, "gameNumber": "1747", "packNumber": "0000011", "ticketNumber": 29}');
    assert false, 'activated a returned pack';
  exception when sqlstate 'P0001' then
    get stacked diagnostics got = pg_exception_hint, got_msg = message_text;
    assert got = 'pack_ended' and got_msg = 'Pack 1747-0000011 was taken out of back stock (returned).', got || ' ' || got_msg;
  end;
  begin
    perform public.save_back_stock(s, '{"mode": "shipment", "lines": [{"gameNumber": "1747", "packs": 1, "packNumbers": ["0000011"]}]}');
    assert false, 'received a returned pack';
  exception when sqlstate 'P0001' then
    get stacked diagnostics got = pg_exception_hint;
    assert got = 'pack_used', 'hint ' || got;
  end;
end $$;

reset role;
select 'counted-out packs: activate, undo, receive again, full pack sale; returned stays refused' as result;
rollback;
