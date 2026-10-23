-- closeStatus → public.close_status (Close Day, employee home): today, whether it's closed, the employee's own shift
-- close today, their permissions, and every slot.
grant create on schema app, public to smart_scan_api;

-- Every slot in order (listSlots).
create or replace function app.slots_json(today date) returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(app.slot_json(s, today) order by s.box, s.slot_number), '[]'::jsonb) from app.slots s
$$;

create or replace function public.list_slots(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store);
  return app.slots_json(app.today());
end $$;

-- "22:52" -> "10:52 PM" in the store's time zone (closedAtLabel).
create or replace function app.time_label(t timestamptz) returns text language sql stable set search_path = '' as $$
  select to_char(t at time zone s.time_zone, 'FMHH12:MI AM') from app.stores s where s.id = app.current_store_id()
$$;

-- A Close Day as the pages get it (summaryFor): no dollar amounts for employees; closedBy/closedAt only when known.
create or replace function app.summary_json(d app.daily_closes, is_owner boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('date', app.date_label(d.close_date), 'ticketsSold', d.total_tickets,
      'liveSlots', d.live_slot_count, 'closedBy', d.closed_by, 'closedAt', app.time_label(d.closed_at)))
    || case when is_owner then jsonb_build_object('dollarsSold', d.total_dollars, 'inventoryValue', d.inventory_value)
       else '{}'::jsonb end
$$;

-- A shift close as the pages get it (shiftFor): no dollar amounts for employees.
create or replace function app.shift_json(s app.shift_closes, is_owner boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('shiftId', s.id, 'date', app.date_label(s.shift_date), 'closedBy', s.closed_by,
      'closedAt', app.time_label(s.closed_at), 'since', app.time_label(s.started_at), 'ticketsSold', s.tickets_sold,
      'slotsScanned', s.slots_scanned)
    || case when is_owner then jsonb_build_object('dollarsSold', s.dollars_sold, 'endedTickets', s.ended_tickets,
         'endedDollars', s.ended_dollars) else '{}'::jsonb end
$$;

-- LARGE_SALE_TICKETS: a slot selling more than this in a day is flagged on the phone before submitting.
create or replace function app.large_sale_tickets() returns integer language sql immutable set search_path = '' as $$ select 50 $$;

create or replace function public.close_status(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; today date; d app.daily_closes; mine app.shift_closes;
begin
  m := app.enter_store(p_store);
  today := app.today();
  select * into d from app.daily_closes where close_date = today;
  if m.role <> 'owner' then
    select * into mine from app.shift_closes where shift_date = today and closed_by = m.username order by closed_at desc limit 1;
  end if;
  return jsonb_build_object(
    'today', app.date_label(today),
    'largeSaleTickets', app.large_sale_tickets(),
    'closed', case when d.close_date is null then null else app.summary_json(d, m.role = 'owner') end,
    'myShiftToday', case when mine.id is null then null else app.shift_json(mine, false) end,
    'permissions', to_jsonb(m.permissions),
    'slots', app.slots_json(today));
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.slots_json(date)', 'app.time_label(timestamptz)', 'app.summary_json(app.daily_closes, boolean)',
    'app.shift_json(app.shift_closes, boolean)', 'app.large_sale_tickets()', 'public.list_slots(uuid, jsonb)',
    'public.close_status(uuid, jsonb)'] loop
    execute format('alter function %s owner to smart_scan_api', f);
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on all functions in schema app to smart_scan_api;
grant execute on function public.list_slots(uuid, jsonb), public.close_status(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
