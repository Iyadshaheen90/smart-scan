-- Subscriptions, step 1 (migration 20261120000033): store_access for every row shape and its 48-hour margins; comp =
-- Pro; Basic: no Settling numbers, no Theft Report, one shift close a day, 2 employees (adding and turning back on);
-- Pro: no shift close limit, 10 employees; read-only refuses saves (owner's and employee's words) but still allows
-- reads, Manage Employees and Store Settings; a paused employee can't get in; `subscription` in my_stores / me /
-- close_status / owner_home (canBuy for the owner only); a store set up by an owner starts with none, other new stores
-- comp. Everything is rolled back at the end.
-- Run: node test/db/run.js subscriptions
begin;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000f1', 'owner-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f2', 'emp-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f3', 'emp-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f4', 'helper-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f5', 'new-owner@test.invalid', 'authenticated', 'authenticated');
insert into app.stores (id, name) values ('00000000-0000-4000-8000-00000000000f', 'Plan Store');
insert into app.store_members (store_id, user_id, username, role, permissions, active, email) values
  ('00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-0000000000f1', 'boss', 'owner', '{}', true, 'owner-a@test.invalid'),
  ('00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-0000000000f2', 'ann', 'employee', '{}', true, 'emp-a@test.invalid'),
  ('00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-0000000000f3', 'ben', 'employee', '{}', true, 'emp-c@test.invalid'),
  ('00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-0000000000f4', 'cal', 'employee', '{}', false, 'helper-a@test.invalid');
insert into app.slots (store_id, box, slot_number, price, last_game_number) values
  ('00000000-0000-4000-8000-00000000000f', 1, 1, 20, '1747'), ('00000000-0000-4000-8000-00000000000f', 1, 2, 10, null);
insert into app.games (store_id, game_number, price, tickets_per_pack, ended_on, unnumbered_in_back) values
  ('00000000-0000-4000-8000-00000000000f', '1747', 20, 30, null, 0);
insert into app.packs (store_id, game_number, pack_number, status, box, slot_number, price, top_ticket, activation_ticket,
  activated_on, took_from_back, received_on) values
  ('00000000-0000-4000-8000-00000000000f', '1747', '0000001', 'live', 1, 1, 20, 25, 29, current_date - 55, true, current_date - 60);

-- ---- store_access for every row shape (as postgres) ----
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000f';
begin
  assert (select status from app.store_subscriptions where store_id = s) = 'comp', 'a store made outside the wizard starts comp';
  assert app.store_access(s) = 'pro', 'comp';
  update app.store_subscriptions set status = 'active', plan = 'basic', period_end = now() + interval '5 days' where store_id = s;
  assert app.store_access(s) = 'basic';
  update app.store_subscriptions set period_end = now() - interval '47 hours' where store_id = s;
  assert app.store_access(s) = 'basic', 'inside the 48-hour margin';
  update app.store_subscriptions set period_end = now() - interval '49 hours' where store_id = s;
  assert app.store_access(s) = 'read_only', 'past the margin';
  update app.store_subscriptions set status = 'trialing', plan = 'basic', trial_end = now() - interval '1 hour', period_end = null where store_id = s;
  assert app.store_access(s) = 'pro', 'a trial is Pro whatever was picked';
  update app.store_subscriptions set trial_end = now() - interval '49 hours' where store_id = s;
  assert app.store_access(s) = 'read_only', 'trial over';
  update app.store_subscriptions set status = 'billing_issue', plan = 'pro', period_end = now() - interval '10 days' where store_id = s;
  assert app.store_access(s) = 'pro', 'payment problem: access kept';
  update app.store_subscriptions set status = 'expired' where store_id = s;
  assert app.store_access(s) = 'read_only', 'expired / refunded: no margin';
  update app.store_subscriptions set status = 'none', plan = null where store_id = s;
  assert app.store_access(s) = 'read_only', 'none';
  assert app.store_access('00000000-0000-4000-8000-0000000000ff') = 'read_only', 'no row';
end $$;

-- ---- Basic, set with the service key ----
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
do $$
declare r jsonb;
begin
  r := public.service_set_subscription('00000000-0000-4000-8000-00000000000f', jsonb_build_object('plan', 'basic', 'status', 'active',
    'source', 'stripe', 'willRenew', true, 'periodEnd', now() + interval '20 days'));
  assert r @> '{"access": "basic", "status": "active", "plan": "basic", "willRenew": true, "source": "stripe", "canBuy": true}', r::text;
  assert r ->> 'renewsOn' is not null, r::text;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000f'; r jsonb; h text; msg text;
begin
  -- Settling's numbers stay off the slots on Basic.
  r := public.list_slots(s, '{}');
  assert r -> 0 -> 'pack' ->> 'daysActive' is null and r -> 0 -> 'pack' ->> 'activationDate' is null, r::text;
  -- The first answers carry the plan; the owner may buy.
  assert public.me(s) -> 'subscription' @> '{"access": "basic", "canBuy": true}', public.me(s)::text;
  assert public.my_stores() -> 0 -> 'subscription' @> '{"access": "basic", "plan": "basic", "canBuy": true}', public.my_stores()::text;
  assert public.close_status(s, '{}') -> 'subscription' ->> 'access' = 'basic';
  assert public.owner_home(s, '{}') -> 'subscription' ->> 'access' = 'basic';
  -- Theft Report: Pro.
  begin
    perform public.theft_report(s, '{}'); assert false, 'Basic got the Theft Report';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'needs_pro' and msg = 'Theft Report comes with Pro.', h || ' ' || msg;
  end;
  -- One shift close a day.
  r := public.submit_shift_close(s, '{"entries": [{"box": 1, "slot": 1, "packKey": "1747-0000001", "type": "scan", "ticketNumber": 20}]}');
  begin
    perform public.submit_shift_close(s, '{"entries": [{"box": 1, "slot": 1, "packKey": "1747-0000001", "type": "scan", "ticketNumber": 18}]}');
    assert false, 'a 2nd shift close on Basic';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'needs_pro' and msg = 'Basic has one shift close a day. Pro has no limit.', h || ' ' || msg;
  end;
  -- 2 employees: a 3rd can't be added or turned back on; turning one off makes room.
  begin
    perform public.member_admin_check(s, '{"action": "invite", "username": "dee", "email": "dee@test.invalid"}');
    assert false, 'a 3rd employee on Basic';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'needs_pro' and msg = 'Basic covers 2 employees. Pro covers up to 10.', h || ' ' || msg;
  end;
  begin
    perform public.set_user_active(s, '{"username": "cal", "active": true}'); assert false, 'a 3rd employee turned on';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'needs_pro', h;
  end;
  perform public.set_user_active(s, '{"username": "ann", "active": false}');
  r := public.member_admin_check(s, '{"action": "invite", "username": "dee", "email": "dee@test.invalid"}');
  assert r ->> 'username' = 'dee', r::text;
  perform public.set_user_active(s, '{"username": "cal", "active": true}');
end $$;

-- ben and cal are on again: 2, so a 3rd is refused.
do $$
declare h text;
begin
  begin
    perform public.member_admin_check('00000000-0000-4000-8000-00000000000f', '{"action": "invite", "username": "dee", "email": "dee@test.invalid"}');
    assert false, 'still 2 employees on (ben, cal): a 3rd is refused';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'needs_pro', h;
  end;
end $$;

-- ---- Pro: no shift close limit; 10 employees ----
reset role;
update app.store_subscriptions set plan = 'pro' where store_id = '00000000-0000-4000-8000-00000000000f';
insert into auth.users (id, email, aud, role)
  select ('00000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'extra' || i || '@test.invalid', 'authenticated', 'authenticated'
  from generate_series(1, 8) i;
insert into app.store_members (store_id, user_id, username, role, permissions, active, email)
  select '00000000-0000-4000-8000-00000000000f', ('00000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
    'extra' || i, 'employee', '{}', true, 'extra' || i || '@test.invalid'
  from generate_series(1, 8) i;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000f'; r jsonb; h text; msg text;
begin
  r := public.list_slots(s, '{}');
  assert (r -> 0 -> 'pack' ->> 'daysActive')::int = 55, r::text;
  perform public.submit_shift_close(s, '{"shiftId": "pro-second", "entries": [{"box": 1, "slot": 1, "packKey": "1747-0000001", "type": "scan", "ticketNumber": 18}]}');
  -- ben, cal + 8 = 10 employees on.
  begin
    perform public.member_admin_check(s, '{"action": "invite", "username": "dee", "email": "dee@test.invalid"}');
    assert false, 'an 11th employee';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'employee_limit' and msg = 'Pro covers up to 10 employees.', h || ' ' || msg;
  end;
end $$;

-- ---- Read-only ----
reset role;
update app.store_subscriptions set status = 'expired' where store_id = '00000000-0000-4000-8000-00000000000f';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000f'; r jsonb; h text; msg text;
begin
  begin
    perform public.set_slot_price(s, '{"box": 1, "slot": 2, "price": 5}'); assert false, 'a save while read-only';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'subscription_ended' and msg = 'Your subscription has ended. Reports and downloads still work.', h || ' ' || msg;
  end;
  -- Still allowed: reads, Manage Employees.
  r := public.list_slots(s, '{}');
  assert jsonb_array_length(r) = 2;
  perform public.set_user_active(s, '{"username": "extra1", "active": false}');
  perform public.set_user_permissions(s, '{"username": "ben", "permissions": ["load_packs"]}');
  assert public.me(s) -> 'subscription' ->> 'access' = 'read_only';
end $$;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}';
do $$
declare s uuid := '00000000-0000-4000-8000-00000000000f'; h text; msg text;
begin
  assert public.me(s) -> 'subscription' @> '{"access": "read_only", "canBuy": false}', public.me(s)::text;
  begin
    perform public.submit_shift_close(s, '{"entries": []}'); assert false, 'an employee saved while read-only';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'subscription_ended' and msg = 'Your store''s subscription has ended. Ask the owner.', h || ' ' || msg;
  end;
end $$;

-- ---- A paused employee can't get in ----
reset role;
update app.store_members set paused = true where username = 'ben';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}';
do $$
declare h text; msg text;
begin
  begin
    perform public.me('00000000-0000-4000-8000-00000000000f'); assert false, 'a paused employee got in';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint, msg = message_text;
    assert h = 'unauthorized' and msg = 'Your store''s plan covers 2 employees. Ask the owner.', h || ' ' || msg;
  end;
end $$;

-- ---- New stores: set up by an owner = none (read-only); made any other way = comp ----
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f5", "role": "authenticated"}';
do $$
declare r jsonb; h text;
begin
  r := public.create_store('{"name": "Fresh Mart", "street": "3 Main St", "city": "Barstow", "state": "CA", "zip": "92311",
    "phone": "7605550102", "username": "fresh", "lotteryState": "CA", "timeZone": "America/Los_Angeles", "dayEndHour": 0,
    "ticketOrder": "descending", "boxes": [[20]]}');
  perform set_config('test.fresh', r ->> 'storeId', false);
  assert public.my_stores() -> 0 -> 'subscription' @> '{"access": "read_only", "status": "none", "canBuy": true}', public.my_stores()::text;
  begin
    perform public.set_slot_price((r ->> 'storeId')::uuid, '{"box": 1, "slot": 1, "price": 5}'); assert false, 'a new store saved';
  exception when sqlstate 'P0001' then get stacked diagnostics h = pg_exception_hint; assert h = 'subscription_ended', h;
  end;
end $$;
reset role;
insert into app.stores (id, name) values ('00000000-0000-4000-8000-0000000000ee', 'Imported');
do $$
begin
  assert (select status from app.store_subscriptions where store_id = '00000000-0000-4000-8000-0000000000ee') = 'comp', 'made after create_store: comp';
end $$;

select 'subscriptions step 1: access + margins, comp, Basic limits, Pro limits, read-only, paused, first answers, new stores' as result;
rollback;
