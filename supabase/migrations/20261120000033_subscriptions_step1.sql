-- Subscriptions, build step 1 (~/.claude/plans/smart-scan-subscriptions-design.md; owner's decisions there):
-- one subscription row per store, app.store_access() = pro | basic | read_only from it, read-only enforced in
-- app.lock_store (the few things a read-only store may still do use app.lock_store_any), Pro-only features and the
-- employee limits, Settling's numbers only on Pro, and `subscription` in the first answers pages load.
-- No payments yet: rows are set with the service key (service_set_subscription). Every store that exists now is
-- comp (Route 66 Liquor: free forever, counts as Pro); test stores start comp so the other tests keep their Pro;
-- a new real store starts with none (read-only until it subscribes or starts a trial: steps 2-3).
-- Functions changed in place (CREATE OR REPLACE keeps owner and grants) by patching their live text, so nothing
-- else in them changes: pg_temp.patch fails the migration if an anchor isn't found exactly once.
grant create on schema app, public to smart_scan_api;

create function pg_temp.patch(fn regprocedure, old text, new text, times integer default 1) returns void
language plpgsql as $$
declare def text := pg_get_functiondef(fn); n integer;
begin
  n := (length(def) - length(replace(def, old, ''))) / length(old);
  if (times > 0 and n <> times) or (times = 0 and n < 1) then
    raise exception 'patch %: found % time(s): %', fn, n, left(old, 80);
  end if;
  execute replace(def, old, new);
end $$;

-- ---------- The row ----------

create table app.store_subscriptions (
  store_id uuid primary key references app.stores on delete cascade,
  plan text check (plan in ('basic', 'pro')),
  status text not null default 'none' check (status in ('none', 'trialing', 'active', 'billing_issue', 'expired', 'comp')),
  source text check (source in ('app_store', 'play_store', 'stripe', 'comp')),
  product_id text,
  will_renew boolean not null default false,
  period_end timestamptz,
  trial_end timestamptz,
  billing_issue_since timestamptz,
  bought_by uuid,
  provider_checked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table app.store_subscriptions enable row level security;
alter table app.store_subscriptions force row level security;
create policy entered_store on app.store_subscriptions for all to smart_scan_api
  using (store_id = app.current_store_id()) with check (store_id = app.current_store_id());
-- my_stores reads every store of the signed-in person before entering one.
create policy my_stores on app.store_subscriptions for select to smart_scan_api
  using (exists (select 1 from app.store_members m where m.store_id = store_subscriptions.store_id and m.user_id = app.uid() and m.active));
grant select, insert, update, delete on app.store_subscriptions to smart_scan_api;

-- Every store that exists now: comp (Route 66 Liquor on prod; test stores on dev).
insert into app.store_subscriptions (store_id, status, source) select id, 'comp', 'comp' from app.stores;

-- A new store gets its row (the store is entered while it's made: create_store, service_create_store,
-- test_create_store all set app.store_id first). Only a store an owner sets up (create_store, the setup wizard)
-- starts with none; stores made with the service key (the import, support, tests) start comp, as every store is today.
create function app.new_store_subscription() returns trigger language plpgsql set search_path = '' as $$
declare st text := case when new.is_test then 'comp'
  else coalesce(nullif(current_setting('app.new_store_status', true), ''), 'comp') end;
begin
  insert into app.store_subscriptions (store_id, status, source) values (new.id, st, case when st = 'comp' then 'comp' end);
  perform set_config('app.new_store_status', '', true);  -- for this one store only
  return new;
end $$;
create trigger new_store_subscription after insert on app.stores for each row execute function app.new_store_subscription();
select pg_temp.patch('public.create_store(jsonb)',
  $x$  perform set_config('app.store_id', new_id::text, true);
  insert into app.stores (id, name, street,$x$,
  $x$  perform set_config('app.store_id', new_id::text, true);
  perform set_config('app.new_store_status', 'none', true);
  insert into app.stores (id, name, street,$x$);

-- An employee over the plan's limit after a downgrade (step 3 sets it); not the same as the owner turning someone off.
alter table app.store_members add column paused boolean not null default false;

-- ---------- What a store may do ----------

-- pro | basic | read_only (design: "What a store may do"). Margin 48 hours after paid time or a trial ends, so a late
-- message never locks a store mid-close. A refund is written as expired: no margin. No row: read_only.
create function app.store_access(p_store uuid default null) returns text language sql stable set search_path = '' as $$
  select coalesce((select case
      when s.status = 'comp' then 'pro'
      when s.status = 'trialing' and s.trial_end is not null and now() < s.trial_end + interval '48 hours' then 'pro'
      when s.status = 'billing_issue' then coalesce(s.plan, 'basic')
      when s.status = 'active' and (s.period_end is null or now() < s.period_end + interval '48 hours') then coalesce(s.plan, 'basic')
      else 'read_only' end
    from app.store_subscriptions s where s.store_id = coalesce(p_store, app.current_store_id())), 'read_only')
$$;

-- Employees (besides the owner) a plan covers (owner 2026-10-30): Basic 2, Pro 10.
create function app.employee_limit(p_store uuid default null) returns integer language sql stable set search_path = '' as $$
  select case when app.store_access(p_store) = 'pro' then 10 else 2 end
$$;
create function app.employees_on(p_store uuid, but text default null) returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from app.store_members m
  where m.store_id = p_store and m.role = 'employee' and m.active and not m.paused and lower(m.username) is distinct from but
$$;

-- What pages get (subscription: { access, status, plan, trialEndsOn, renewsOn, willRenew, source, canBuy }).
-- Dates are the store's calendar day. canBuy: the owner only.
create function app.subscription_json(p_store uuid, is_owner boolean) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('access', app.store_access(p_store), 'status', coalesce(s.status, 'none'), 'plan', s.plan,
    'trialEndsOn', to_char((s.trial_end at time zone st.time_zone)::date, 'YYYY-MM-DD'),
    'renewsOn', to_char((s.period_end at time zone st.time_zone)::date, 'YYYY-MM-DD'),
    'willRenew', coalesce(s.will_renew, false), 'source', s.source, 'canBuy', is_owner)
  from app.stores st left join app.store_subscriptions s on s.store_id = st.id
  where st.id = p_store
$$;

create or replace function app.has_pro(feature text) returns boolean language sql stable set search_path = '' as $$
  select app.store_access() = 'pro'
$$;

-- ---------- Read-only: every save, except the few a read-only store may still do ----------

create function app.lock_store_any() returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(app.current_store_id()::text, 0))
$$;
create or replace function app.lock_store() returns void language plpgsql set search_path = '' as $$
begin
  if app.store_access() = 'read_only' then
    if exists (select 1 from app.store_members m where m.store_id = app.current_store_id() and m.user_id = app.uid() and m.role = 'owner') then
      perform app.fail('subscription_ended', 'Your subscription has ended. Reports and downloads still work.');
    end if;
    perform app.fail('subscription_ended', 'Your store''s subscription has ended. Ask the owner.');
  end if;
  perform app.lock_store_any();
end $$;

-- Still allowed read-only (design): Report a Problem, Manage Employees, the retailer number, Store Settings (Store
-- Info), leaving or deleting the store, and the members function adding someone (service key).
do $$
declare f regprocedure;
begin
  foreach f in array array['public.report_problem(uuid, jsonb)', 'public.set_user_active(uuid, jsonb)',
      'public.set_user_permissions(uuid, jsonb)', 'public.service_add_member(uuid, uuid, jsonb)',
      'public.set_retailer_number(uuid, jsonb)', 'public.set_store_settings(uuid, jsonb)',
      'public.leave_store(uuid, jsonb)', 'public.delete_store(uuid, jsonb)']::regprocedure[] loop
    perform pg_temp.patch(f, 'app.lock_store()', 'app.lock_store_any()', 0);
  end loop;
end $$;

-- ---------- Paused employees can't use the store ----------

select pg_temp.patch('app.enter_store(uuid, text[])',
  $x$  if not m.active then perform app.fail('unauthorized', 'This account is no longer active.'); end if;$x$,
  $x$  if not m.active then perform app.fail('unauthorized', 'This account is no longer active.'); end if;
  if m.paused then
    perform app.fail('unauthorized', format('Your store''s plan covers %s employees. Ask the owner.', app.employee_limit(p_store)));
  end if;$x$);

-- ---------- Pro only ----------

-- Theft Report (checked first: the report's own checks come after; someone not on the store sees no row = not Pro).
select pg_temp.patch('public.theft_report(uuid, jsonb)',
  $x$  report := app.theft_report_body(p_store, req);$x$,
  $x$  if app.store_access(p_store) <> 'pro' then perform app.fail('needs_pro', 'Theft Report comes with Pro.'); end if;
  report := app.theft_report_body(p_store, req);$x$);

-- Basic: one shift close per business day for the whole store (owner 2026-11-12); deleting it frees the day again.
select pg_temp.patch('public.submit_shift_close(uuid, jsonb)',
  $x$    perform app.fail('already_closed', 'Today has already been closed, so there''s no shift left to close.');
  end if;$x$,
  $x$    perform app.fail('already_closed', 'Today has already been closed, so there''s no shift left to close.');
  end if;
  if not app.has_pro('shift closes') and exists (select 1 from app.shift_closes s where s.shift_date = today) then
    perform app.fail('needs_pro', 'Basic has one shift close a day. Pro has no limit.');
  end if;$x$);

-- Employees: Basic 2, Pro 10 (adding one, or turning one back on).
select pg_temp.patch('public.member_admin_check(uuid, jsonb)',
  $x$    return jsonb_build_object('username', who, 'email', new_email, 'isTest', test_store, 'storeName', shop);$x$,
  $x$    perform app.check_employee_room(p_store, null);
    return jsonb_build_object('username', who, 'email', new_email, 'isTest', test_store, 'storeName', shop);$x$);
select pg_temp.patch('public.set_user_active(uuid, jsonb)',
  $x$  update app.store_members set active = coalesce(req -> 'active' = 'true'::jsonb, false)$x$,
  $x$  if req -> 'active' = 'true'::jsonb and exists (select 1 from app.store_members x
      where x.store_id = app.current_store_id() and lower(x.username) = who and x.role = 'employee' and not x.active) then
    perform app.check_employee_room(app.current_store_id(), who);
  end if;
  update app.store_members set active = coalesce(req -> 'active' = 'true'::jsonb, false)$x$);

create function app.check_employee_room(p_store uuid, but text) returns void language plpgsql stable set search_path = '' as $$
begin
  if app.employees_on(p_store, but) < app.employee_limit(p_store) then return; end if;
  if app.store_access(p_store) = 'pro' then perform app.fail('employee_limit', 'Pro covers up to 10 employees.'); end if;
  perform app.fail('needs_pro', 'Basic covers 2 employees. Pro covers up to 10.');
end $$;

-- Settling: Basic gets no activation day or days active on slots (so no Settling page and no 50-day badge).
select pg_temp.patch('app.slot_json(app.slots, date)',
  $x$'activationDate', app.date_label(p.activated_on),$x$,
  $x$'activationDate', case when app.has_pro('Settling') then app.date_label(p.activated_on) end,$x$);
select pg_temp.patch('app.slot_json(app.slots, date)',
  $x$'daysActive', today - p.activated_on,$x$,
  $x$'daysActive', case when app.has_pro('Settling') then today - p.activated_on end,$x$);

-- ---------- subscription in the first answers ----------

select pg_temp.patch('public.my_stores()',
  $x$'timeZone', st.time_zone, 'dayEndHour', st.day_end_hour)$x$,
  $x$'timeZone', st.time_zone, 'dayEndHour', st.day_end_hour, 'subscription', app.subscription_json(st.id, m.role = 'owner'))$x$);
select pg_temp.patch('public.me(uuid)',
  $x$'storeName', (select name from app.stores where id = p_store));$x$,
  $x$'storeName', (select name from app.stores where id = p_store), 'subscription', app.subscription_json(p_store, m.role = 'owner'));$x$);

-- close_status and owner_home: the old functions move to app (as theft_report did) and the public ones add it.
alter function public.close_status(uuid, jsonb) set schema app;
alter function app.close_status(uuid, jsonb) rename to close_status_body;
alter function public.owner_home(uuid, jsonb) set schema app;
alter function app.owner_home(uuid, jsonb) rename to owner_home_body;
revoke execute on function app.close_status_body(uuid, jsonb), app.owner_home_body(uuid, jsonb) from public, anon, authenticated;
grant execute on function app.close_status_body(uuid, jsonb), app.owner_home_body(uuid, jsonb) to smart_scan_api;

create function public.close_status(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare answer jsonb := app.close_status_body(p_store, req);
begin
  return answer || jsonb_build_object('subscription', app.subscription_json(p_store,
    exists (select 1 from app.store_members m where m.store_id = p_store and m.user_id = app.uid() and m.role = 'owner')));
end $$;
create function public.owner_home(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare answer jsonb := app.owner_home_body(p_store, req);
begin
  return answer || jsonb_build_object('subscription', app.subscription_json(p_store, true));
end $$;

-- ---------- Setting a row by hand (service key): tests now, comp stores, support ----------

create function public.service_set_subscription(p_store uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  if not exists (select 1 from app.stores where id = p_store) then perform app.fail('no_store', 'No such store.'); end if;
  update app.store_subscriptions set
    plan = req ->> 'plan', status = coalesce(req ->> 'status', 'none'), source = req ->> 'source',
    product_id = req ->> 'productId', will_renew = coalesce((req ->> 'willRenew')::boolean, false),
    period_end = (req ->> 'periodEnd')::timestamptz, trial_end = (req ->> 'trialEnd')::timestamptz,
    billing_issue_since = (req ->> 'billingIssueSince')::timestamptz, updated_at = now()
  where store_id = p_store;
  return app.subscription_json(p_store, true);
end $$;

-- ---------- Owners and grants (like every migration: smart_scan_api owns, signed-in people call public ones) ----------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.new_store_subscription', 'app.store_access', 'app.employee_limit', 'app.employees_on', 'app.subscription_json',
      'app.has_pro', 'app.lock_store_any', 'app.lock_store', 'app.check_employee_room', 'public.close_status',
      'public.owner_home', 'public.service_set_subscription')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function app.store_access(uuid), app.employee_limit(uuid), app.employees_on(uuid, text),
  app.subscription_json(uuid, boolean), app.lock_store_any(), app.lock_store(), app.check_employee_room(uuid, text),
  app.new_store_subscription() to smart_scan_api;
grant execute on function public.close_status(uuid, jsonb), public.owner_home(uuid, jsonb) to authenticated;
grant execute on function public.service_set_subscription(uuid, jsonb) to service_role;

revoke create on schema app, public from smart_scan_api;
