-- Restock from the back (migration 20261116000031). Store A: 1-1 empty $20 (last game 1747), 1-2 holding 1747 pack
-- 0000001, 1-3 empty $10 (last game 2222, ended), 1-4 empty $20 (last game 3333, none in the back), 1-5 empty $5 (last
-- game 4444: two packs from the sheets + 0000009 by number). 1747 in the back: 0000004 and 0000005 (10 days ago),
-- 0000003 (2 days ago). The list shows 1-1 (oldest 0000004) and 1-5 (from the sheets); one slot works while it has a
-- pack; a newer pack asks (not_oldest), a same-day one doesn't, notOldestOk and goingOut go ahead; a numbered pack
-- of 4444 asks because of the sheets' packs; Load Packs needed; not Pro: needs_pro and no asking. Rolled back.
-- Run: node test/db/run.js restock
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
  ('00000000-0000-4000-8000-00000000000a', 1, 2, 20, '1747'),
  ('00000000-0000-4000-8000-00000000000a', 1, 3, 10, '2222'),
  ('00000000-0000-4000-8000-00000000000a', 1, 4, 20, '3333'),
  ('00000000-0000-4000-8000-00000000000a', 1, 5, 5, '4444');
insert into app.games (store_id, game_number, price, tickets_per_pack, ended_on, unnumbered_in_back) values
  ('00000000-0000-4000-8000-00000000000a', '1747', 20, 30, null, 0),
  ('00000000-0000-4000-8000-00000000000a', '2222', 10, 50, current_date - 1, 0),
  ('00000000-0000-4000-8000-00000000000a', '3333', 20, 30, null, 0),
  ('00000000-0000-4000-8000-00000000000a', '4444', 5, 80, null, 2);
insert into app.packs (store_id, game_number, pack_number, status, box, slot_number, price, top_ticket, activation_ticket,
  activated_on, took_from_back, received_on) values
  ('00000000-0000-4000-8000-00000000000a', '1747', '0000001', 'live', 1, 2, 20, 5, 29, current_date - 3, true, current_date - 20),
  ('00000000-0000-4000-8000-00000000000a', '1747', '0000005', 'in_back', null, null, null, null, null, null, null, current_date - 10),
  ('00000000-0000-4000-8000-00000000000a', '1747', '0000004', 'in_back', null, null, null, null, null, null, null, current_date - 10),
  ('00000000-0000-4000-8000-00000000000a', '1747', '0000003', 'in_back', null, null, null, null, null, null, null, current_date - 2),
  ('00000000-0000-4000-8000-00000000000a', '2222', '0000001', 'in_back', null, null, null, null, null, null, null, current_date - 5),
  ('00000000-0000-4000-8000-00000000000a', '4444', '0000009', 'in_back', null, null, null, null, null, null, null, current_date - 1);

-- ---- Owner ----
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000a'; r jsonb; h text; msg text;
begin
  -- The list: only empty slots whose game isn't ended and has packs in the back.
  r := public.restock_list(s, '{}');
  assert jsonb_array_length(r) = 2, r::text;
  assert r -> 0 @> '{"box": 1, "slot": 1, "gameNumber": "1747", "packsInBack": 3}', r::text;
  assert r -> 0 -> 'oldest' ->> 'packNumber' = '0000004', 'same day: lower pack number first ' || r::text;
  assert r -> 0 -> 'oldest' ->> 'receivedOn' = to_char(current_date - 10, 'YYYY-MM-DD'), r::text;
  assert r -> 1 @> '{"box": 1, "slot": 5, "gameNumber": "4444", "packsInBack": 3, "oldest": {"unnumbered": true}}', r::text;

  -- One slot, while it still has a pack: its game.
  r := public.restock_list(s, '{"box": 1, "slot": 2}');
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'gameNumber' = '1747', r::text;
  assert jsonb_array_length(public.restock_list(s, '{"box": 1, "slot": 3}')) = 0, 'ended game';
  assert jsonb_array_length(public.restock_list(s, '{"box": 1, "slot": 4}')) = 0, 'none in the back';

  -- A newer pack asks, naming the oldest.
  begin
    perform public.activate_pack(s, '{"box": 1, "slot": 1, "gameNumber": "1747", "packNumber": "0000003", "ticketNumber": 29}');
    assert false, 'a newer pack went in without asking';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'not_oldest', h || ': ' || msg;
    assert msg like 'Pack 1747-0000003 isn''t the oldest: pack 1747-0000004 came % Use this one anyway?', msg;
  end;
  -- Packs also going out on the same list don't count: with 0000004 going out, 0000005 (same day) is the oldest.
  begin
    perform public.activate_pack(s, '{"box": 1, "slot": 1, "gameNumber": "1747", "packNumber": "0000003", "ticketNumber": 29,
      "goingOut": ["0000004"]}');
    assert false, 'still older ones';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'not_oldest' and msg like '%pack 1747-0000005%', msg;
  end;
  r := public.activate_several(s, '{"check": true, "packs": [{"box": 1, "slot": 1, "gameNumber": "1747", "packNumber": "0000003",
    "ticketNumber": 29, "goingOut": ["0000004", "0000005"]}]}');
  assert (r -> 'rows' -> 0 ->> 'ok')::boolean, r::text;
  r := public.activate_several(s, '{"check": true, "packs": [{"box": 1, "slot": 1, "gameNumber": "1747", "packNumber": "0000003",
    "ticketNumber": 29}]}');
  assert r -> 'rows' -> 0 ->> 'code' = 'not_oldest', 'Activate Several asks on the row ' || r::text;

  -- A pack from the same day as the oldest goes in without asking.
  r := public.activate_pack(s, '{"box": 1, "slot": 1, "gameNumber": "1747", "packNumber": "0000005", "ticketNumber": 29}');
  assert r ->> 'packKey' = '1747-0000005', r::text;
  -- notOldestOk: the person chose it anyway.
  r := public.activate_pack(s, '{"box": 1, "slot": 4, "gameNumber": "1747", "packNumber": "0000003", "ticketNumber": 29,
    "notOldestOk": true}');
  assert r ->> 'packKey' = '1747-0000003', r::text;
  -- The slot that got a pack leaves the list.
  r := public.restock_list(s, '{}');
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'gameNumber' = '4444', r::text;

  -- Packs from the sheets are older than any numbered one.
  begin
    perform public.activate_pack(s, '{"box": 1, "slot": 5, "gameNumber": "4444", "packNumber": "0000009", "ticketNumber": 79}');
    assert false, 'the sheets'' packs are older';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'not_oldest' and msg = 'Game 4444 has older packs in the back (from before pack numbers were kept). Use pack 4444-0000009 anyway?', msg;
  end;
  -- A pack the database doesn't know (one of the sheets' packs) never asks.
  r := public.activate_pack(s, '{"box": 1, "slot": 5, "gameNumber": "4444", "packNumber": "0000002", "ticketNumber": 79}');
  assert r ->> 'packKey' = '4444-0000002', r::text;
end $$;

-- ---- Employee with Load Packs: allowed ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
do $$
begin
  assert jsonb_typeof(public.restock_list('00000000-0000-4000-8000-00000000000a', '{}')) = 'array';
end $$;

-- ---- Employee without it: refused ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}';
do $$
declare h text;
begin
  begin
    perform public.restock_list('00000000-0000-4000-8000-00000000000a', '{}');
    assert false, 'an employee without Load Packs got the list';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint;
    assert h = 'forbidden', h;
  end;
end $$;

-- ---- Not Pro (what the subscriptions build will make possible): locked, and no asking ----
reset role;
create or replace function app.has_pro(feature text) returns boolean language sql stable set search_path = '' as $$ select false $$;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000a'; h text; r jsonb;
begin
  begin
    perform public.restock_list(s, '{}');
    assert false, 'not Pro got the list';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint;
    assert h = 'needs_pro', h;
  end;
  r := public.activate_pack(s, '{"box": 1, "slot": 3, "gameNumber": "4444", "packNumber": "0000009", "ticketNumber": 79,
    "overridePrice": true}');
  assert r ->> 'packKey' = '4444-0000009', 'Basic: no oldest check ' || r::text;
end $$;

reset role;
select 'restock: list, one slot, oldest first, same day, notOldestOk, goingOut, sheets packs, permissions, not Pro' as result;
rollback;
