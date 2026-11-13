-- Many stores (migration 20261112000028): a new account sets up its own stores with create_store (every refusal, all
-- or nothing, the daily limit); one person in two stores sees nothing of the other inside a store (review finding 3:
-- users list, username check, permissions); Activate Several's cap is the store's slot count; Store Settings
-- (day-end change refused once today has a close); layout add / remove rules; a wizard-made store becomes a test
-- store only when it is one. Everything is rolled back at the end.
-- Run: node test/db/run.js many_stores
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000c1', 'new-owner@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c2', 'helper@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c3', 'real-person@example.com', 'authenticated', 'authenticated');
-- The stores this test makes are remembered in settings (test.a, test.b, test.c) for the later blocks.

-- ---- A new account: no store yet, then the wizard's one call ----
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated", "email": "New-Owner@test.invalid"}';
do $$
declare
  r jsonb; h text; t jsonb; a uuid; b uuid;
  good jsonb := '{"name": "Corner Market", "street": "1 Main St", "city": "Barstow", "state": "ca", "zip": "92311",
    "phone": "(760) 555-0100", "username": "Boss", "lotteryState": "CA", "timeZone": "America/Los_Angeles",
    "dayEndHour": 0, "ticketOrder": "descending", "boxes": [[20, 10, 5]], "retailerNumber": "12-3456"}';
begin
  assert public.my_stores() = '[]'::jsonb, 'a new account has a store';

  -- Every refusal, and nothing is kept.
  for t in select x from jsonb_array_elements('[
    {"code": "bad_store_name", "patch": {"name": " "}},
    {"code": "bad_street", "patch": {"street": ""}},
    {"code": "bad_city", "patch": {"city": ""}},
    {"code": "bad_state", "patch": {"state": "Cal"}},
    {"code": "bad_zip", "patch": {"zip": "9231"}},
    {"code": "bad_phone", "patch": {"phone": "555-0100"}},
    {"code": "bad_username", "patch": {"username": "b"}},
    {"code": "bad_lottery_state", "patch": {"lotteryState": "NV"}},
    {"code": "bad_time_zone", "patch": {"timeZone": "Mars/Phobos"}},
    {"code": "bad_day_end", "patch": {"dayEndHour": 13}},
    {"code": "bad_day_end", "patch": {"dayEndHour": 1.5}},
    {"code": "bad_day_end", "patch": {"dayEndHour": "4"}},
    {"code": "bad_order", "patch": {"ticketOrder": "sideways"}},
    {"code": "bad_layout", "patch": {"boxes": []}},
    {"code": "bad_layout", "patch": {"boxes": [[20], []]}},
    {"code": "bad_layout", "patch": {"boxes": "two"}},
    {"code": "bad_price", "patch": {"boxes": [[20, 7]]}},
    {"code": "bad_price", "patch": {"boxes": [[20, null]]}},
    {"code": "bad_retailer_number", "patch": {"retailerNumber": "12ab"}}]'::jsonb) as q(x) loop
    begin
      r := public.create_store(good || (t -> 'patch'));
      assert false, format('saved with %s', t -> 'patch');
    exception when sqlstate 'P0001' then
      get stacked diagnostics h = pg_exception_hint;
      assert h = t ->> 'code', format('%s gave %s', t -> 'patch', h);
    end;
  end loop;
  assert public.my_stores() = '[]'::jsonb, 'a refused store was kept';

  -- 21 boxes and 101 slots are too many.
  begin
    perform public.create_store(good || jsonb_build_object('boxes', (select jsonb_agg('[1]'::jsonb) from generate_series(1, 21))));
    assert false, '21 boxes saved';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint; assert h = 'bad_layout', h;
  end;
  begin
    perform public.create_store(good || jsonb_build_object('boxes', jsonb_build_array((select jsonb_agg(1) from generate_series(1, 101)))));
    assert false, '101 slots saved';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint; assert h = 'bad_layout', h;
  end;

  -- Store A: 1 box of 3 slots.
  r := public.create_store(good);
  a := (r ->> 'storeId')::uuid;
  perform set_config('test.a', (a)::text, true);
  assert r ->> 'storeName' = 'Corner Market' and r ->> 'username' = 'boss' and r ->> 'role' = 'owner'
    and (r ->> 'storeNumber')::int > 10000, r::text;
  r := public.my_stores();
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'storeId' = a::text and r -> 0 ? 'storeNumber', r::text;
  r := public.list_slots(a, '{}');
  assert jsonb_array_length(r) = 3 and (r -> 2 ->> 'slotPrice')::numeric = 5 and r -> 0 ->> 'slotOrder' = 'descending', r::text;
  r := public.store_info(a, '{}');
  assert r ->> 'state' = 'CA' and r ->> 'phone' = '7605550100' and (r ->> 'complete')::boolean, r::text;
  assert public.get_retailer_number(a, '{}') ->> 'retailerNumber' = '123456', 'retailer number';
  r := public.list_users(a, '{}');
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'email' = 'new-owner@test.invalid' and (r -> 0 ->> 'signedIn')::boolean, r::text;
  r := public.store_settings(a, '{}');
  assert r ->> 'timeZone' = 'America/Los_Angeles' and (r ->> 'dayEndHour')::int = 0
    and r -> 'boxes' = '[{"box": 1, "slots": 3, "live": 0}]'::jsonb, r::text;

  -- Store B: 3 boxes of different sizes, ascending, a day that ends at 4 am, under another username.
  r := public.create_store((good - 'retailerNumber') || '{"name": "Second Stop", "username": "boss2", "dayEndHour": 4,
    "ticketOrder": "ascending", "timeZone": "America/Denver", "boxes": [[1, 2], [3, 5, 10, 20], [30]]}'::jsonb);
  b := (r ->> 'storeId')::uuid;
  perform set_config('test.b', (b)::text, true);
  r := public.list_slots(b, '{}');
  assert jsonb_array_length(r) = 7 and (r -> 6 ->> 'box')::int = 3 and (r -> 6 ->> 'slotPrice')::numeric = 30
    and r -> 3 ->> 'slotOrder' = 'ascending', r::text;
  assert public.get_retailer_number(b, '{}') ->> 'retailerNumber' is null, 'store B got store A''s retailer number';
  r := public.my_stores();
  assert jsonb_array_length(r) = 2 and r -> 1 ->> 'storeName' = 'Second Stop' and r -> 1 ->> 'timeZone' = 'America/Denver'
    and (r -> 1 ->> 'dayEndHour')::int = 4, r::text;

  -- ---- Review finding 3: inside store A, nothing of the person's row in store B ----
  r := public.list_users(a, '{}');
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'username' = 'boss', r::text;
  r := public.member_admin_check(a, '{"action": "invite", "username": "boss2", "email": "someone@test.invalid"}');
  assert r ->> 'username' = 'boss2', r::text;
  begin
    perform public.set_user_permissions(a, '{"username": "boss2", "permissions": []}');
    assert false, 'store A changed a row of store B';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint; assert h = 'no_user', h;
  end;
  begin
    perform public.member_admin_check(a, '{"action": "setPassword", "username": "boss2"}');
    assert false, 'store A found a member of store B';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint; assert h = 'no_user', h;
  end;
  assert public.me(a) ->> 'username' = 'boss' and public.me(b) ->> 'username' = 'boss2', 'me per store';

  -- ---- The daily limit: a third store is fine, a fourth today is refused ----
  r := public.create_store(good || '{"name": "Third"}'::jsonb);
  perform set_config('test.c', r ->> 'storeId', true);
  begin
    perform public.create_store(good || '{"name": "Fourth"}'::jsonb);
    assert false, 'a fourth store today';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint; assert h = 'too_many_stores', h;
  end;
end $$;

-- ---- Activate Several's cap, Store Settings, layout (store A) ----
do $$
declare
  a uuid := current_setting('test.a')::uuid; b uuid := current_setting('test.b')::uuid;
  r jsonb; h text; m text;
begin
  -- 4 packs for 3 slots.
  begin
    perform public.activate_several(a, '{"check": true, "packs": [{}, {}, {}, {}]}');
    assert false, 'more packs than slots';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint, m = message_text;
    assert h = 'bad_request' and m like '%at most 3 at once%', m;
  end;

  -- A pack goes into slot 3; the store works like any other.
  r := public.activate_pack(a, '{"box": 1, "slot": 3, "gameNumber": "2222", "packNumber": "0000001", "ticketNumber": 79,
    "gamePrice": 5, "ticketsPerPack": 80}');
  assert r ->> 'packKey' = '2222-0000001', r::text;
  assert (public.store_settings(a, '{}') -> 'boxes' -> 0 ->> 'live')::int = 1, 'live count';
  assert public.close_status(a, '{}') is not null, 'close status';

  -- Layout: more slots, a new box, never a gap.
  r := public.add_slots(a, '{"box": 1, "count": 2, "price": 10}');
  assert r -> 'boxes' = '[{"box": 1, "slots": 5, "live": 1}]'::jsonb, r::text;
  r := public.add_slots(a, '{"box": 2, "count": 1, "price": 20}');
  assert r -> 'boxes' -> 1 = '{"box": 2, "slots": 1, "live": 0}'::jsonb, r::text;
  for r in select x from jsonb_array_elements('[
    {"code": "no_box", "req": {"box": 4, "count": 1, "price": 5}},
    {"code": "no_box", "req": {"box": 0, "count": 1, "price": 5}},
    {"code": "bad_count", "req": {"box": 1, "count": 0, "price": 5}},
    {"code": "bad_count", "req": {"box": 1, "count": 1.5, "price": 5}},
    {"code": "too_many_slots", "req": {"box": 1, "count": 96, "price": 5}},
    {"code": "bad_price", "req": {"box": 1, "count": 1, "price": 7}},
    {"code": "bad_price", "req": {"box": 1, "count": 1}}]'::jsonb) as q(x) loop
    begin
      perform public.add_slots(a, r -> 'req');
      assert false, format('added with %s', r -> 'req');
    exception when sqlstate 'P0001' then
      get stacked diagnostics h = pg_exception_hint;
      assert h = r ->> 'code', format('%s gave %s', r -> 'req', h);
    end;
  end loop;

  -- Remove: only the last slot, only when empty; only the last box.
  begin
    perform public.remove_slot(a, '{"box": 1, "slot": 3}'); assert false, 'a middle slot was removed';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'not_last_slot', h;
  end;
  begin
    perform public.remove_slot(a, '{"box": 1, "slot": 9}'); assert false, 'a missing slot was removed';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'no_slot', h;
  end;
  begin
    perform public.remove_box(a, '{"box": 1}'); assert false, 'the first box was removed';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'not_last_box', h;
  end;
  begin
    perform public.remove_box(a, '{"box": 3}'); assert false, 'a missing box was removed';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'no_box', h;
  end;
  r := public.remove_box(a, '{"box": 2}');
  assert jsonb_array_length(r -> 'boxes') = 1, r::text;
  perform public.remove_slot(a, '{"box": 1, "slot": 5}');
  r := public.remove_slot(a, '{"box": 1, "slot": 4}');
  assert r -> 'boxes' = '[{"box": 1, "slots": 3, "live": 1}]'::jsonb, r::text;
  begin
    perform public.remove_slot(a, '{"box": 1, "slot": 3}'); assert false, 'a slot with a pack was removed';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint, m = message_text;
    assert h = 'slot_occupied' and m like '%2222-0000001%', m;
  end;
  begin
    perform public.remove_box(a, '{"box": 1}'); assert false, 'the only box was removed';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'slot_occupied', h;
  end;
  -- Store B's layout wasn't touched from store A.
  assert jsonb_array_length(public.list_slots(b, '{}')) = 7, 'store B changed';
  -- A store keeps at least one slot.
  perform public.remove_box(b, '{"box": 3}');
  perform public.remove_box(b, '{"box": 2}');
  perform public.remove_slot(b, '{"box": 1, "slot": 2}');
  begin
    perform public.remove_slot(b, '{"box": 1, "slot": 1}'); assert false, 'the last slot was removed';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'last_slot', h;
  end;

  -- Store Settings: hours change while the day is untouched; new slots take the new order.
  r := public.set_store_settings(a, '{"timeZone": "America/Los_Angeles", "dayEndHour": 2, "ticketOrder": "ascending"}');
  assert (r ->> 'dayEndHour')::int = 2 and r ->> 'ticketOrder' = 'ascending', r::text;
  perform public.add_slots(a, '{"box": 1, "count": 1, "price": 1}');
  r := public.list_slots(a, '{}');
  assert r -> 3 ->> 'slotOrder' = 'ascending' and r -> 0 ->> 'slotOrder' = 'descending', r::text;
  begin
    perform public.set_store_settings(a, '{"timeZone": "Nowhere", "dayEndHour": 2, "ticketOrder": "ascending"}');
    assert false, 'a made-up time zone';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'bad_time_zone', h;
  end;
end $$;

-- Today gets a close: the hours can't move any more, the ticket order still can.
reset role;
insert into app.daily_closes (store_id, close_date, total_tickets, total_dollars, live_slot_count, inventory_value)
  values (current_setting('test.a')::uuid, (now() at time zone 'America/Los_Angeles' - interval '2 hours')::date, 0, 0, 1, 0);
set local role authenticated;
do $$
declare a uuid := current_setting('test.a')::uuid; r jsonb; h text;
begin
  begin
    perform public.set_store_settings(a, '{"timeZone": "America/Los_Angeles", "dayEndHour": 0, "ticketOrder": "ascending"}');
    assert false, 'the day end moved after a close';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'day_started', h;
  end;
  begin
    perform public.set_store_settings(a, '{"timeZone": "America/New_York", "dayEndHour": 2, "ticketOrder": "ascending"}');
    assert false, 'the time zone moved after a close';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'day_started', h;
  end;
  r := public.set_store_settings(a, '{"timeZone": "America/Los_Angeles", "dayEndHour": 2, "ticketOrder": "descending"}');
  assert r ->> 'ticketOrder' = 'descending', r::text;
end $$;

-- ---- Someone else: no way into either store, and an employee can't change settings or layout ----
reset role;
insert into app.store_members (store_id, user_id, username, role, email)
  values (current_setting('test.a')::uuid, '00000000-0000-4000-8000-0000000000c2', 'helper', 'employee', 'helper@test.invalid');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated", "email": "helper@test.invalid"}';
do $$
declare a uuid := current_setting('test.a')::uuid; b uuid := current_setting('test.b')::uuid; h text; f text;
begin
  assert jsonb_array_length(public.my_stores()) = 1, 'the employee''s stores';
  foreach f in array array['store_settings', 'set_store_settings', 'add_slots', 'remove_slot', 'remove_box'] loop
    begin
      execute format('select public.%I($1, $2)', f) using a, '{"box": 1, "slot": 4, "count": 1, "price": 5}'::jsonb;
      assert false, format('an employee ran %s', f);
    exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'forbidden', f || ' ' || h;
    end;
  end loop;
  begin
    perform public.list_slots(b, '{}'); assert false, 'got into store B';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'forbidden', h;
  end;
end $$;

-- ---- Nobody signed in ----
set local request.jwt.claims = '';
do $$
declare h text;
begin
  begin
    perform public.create_store('{}'); assert false, 'a store without signing in';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'unauthorized', h;
  end;
end $$;

-- ---- test_claim_store: only a fresh store whose people are all test addresses ----
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
do $$
declare a uuid := current_setting('test.a')::uuid; c uuid := current_setting('test.c')::uuid; h text;
begin
  perform public.test_claim_store(c);
  perform public.test_drop_store(c);
  reset role;
  assert not exists (select 1 from app.stores where id = c), 'the claimed store was not dropped';
  update app.store_members set email = 'real-person@example.com' where store_id = a and username = 'helper';
  set local role service_role;
  begin
    perform public.test_claim_store(a); assert false, 'a store with a real email was claimed';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'forbidden', h;
  end;
end $$;

reset role;
select 'many stores: create_store, two stores apart, slot cap, settings, layout, test claim' as result;
rollback;
