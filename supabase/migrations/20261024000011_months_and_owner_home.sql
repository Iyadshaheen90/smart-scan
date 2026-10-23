-- Months and the owner's home (Months.js, Home.js): monthStatus, monthSummary, listMonths, monthsPage, ownerHome, plus
-- monthWorkbook (the Excel download). In the database a month is just the dates in it, so there's no Start New Month:
-- monthStatus has no next month to start (next = null, canStart = false) and months have no spreadsheet (url = null);
-- the Months page then offers Download Month instead of Open Spreadsheet. Totals are the same as the Sheets code's
-- (test/parity/months-home.js). Months listed: today's, and every month with a close.
grant create on schema app, public to smart_scan_api;

-- '2026-10' -> the 1st of that month (null if it isn't a month label).
create or replace function app.month_of(label text) returns date language sql immutable set search_path = '' as $$
  select case when label ~ '^\d{4}-(0[1-9]|1[0-2])$' then (label || '-01')::date end
$$;

create or replace function app.month_label(d date) returns text language sql immutable set search_path = '' as $$
  select to_char(d, 'YYYY-MM')
$$;

-- Shipments and returns of any month (the reports use this month's).
create or replace function app.shipments_in(first date) returns jsonb language sql stable set search_path = '' as $$
  with lines as (
    select app.date_label(s.received_on) as date, s.game_number, s.source = 'add pack' as by_hand,
      min(s.id) as first_id, sum(s.packs)::integer as packs, (array_agg(s.price order by s.id))[1] as price,
      (array_agg(s.tickets_per_pack order by s.id))[1] as size, sum(s.packs * s.tickets_per_pack * s.price) as dollars
    from app.shipments s where s.received_on >= first and s.received_on < (first + interval '1 month')::date
    group by s.received_on, s.game_number, s.source = 'add pack')
  select jsonb_build_object('packs', coalesce(sum(l.packs), 0), 'dollars', coalesce(sum(l.dollars), 0),
    'lines', coalesce(jsonb_agg(jsonb_build_object('date', l.date, 'gameNumber', l.game_number, 'packs', l.packs, 'price', l.price,
      'ticketsPerPack', l.size, 'dollars', l.dollars, 'addedByHand', l.by_hand) order by l.date desc, l.game_number, l.first_id), '[]'::jsonb))
  from lines l
$$;

create or replace function app.shipments_json() returns jsonb language sql stable set search_path = '' as $$
  select app.shipments_in(app.month_start())
$$;

-- A month's totals from its Close Days (monthSummary). Ending inventory is the last closed day's.
create or replace function app.month_summary_json(first date) returns jsonb language sql stable set search_path = '' as $$
  with days as (
    select d.close_date, d.total_tickets, d.total_dollars, d.inventory_value from app.daily_closes d
    where d.close_date >= first and d.close_date < (first + interval '1 month')::date)
  select jsonb_build_object(
    'label', app.month_label(first),
    'status', case when first = app.month_start() then 'active' else 'archived' end,
    'url', null,
    'days', coalesce((select jsonb_agg(jsonb_build_object('date', app.date_label(x.close_date), 'ticketsSold', x.total_tickets,
      'dollarsSold', x.total_dollars, 'inventoryValue', x.inventory_value) order by x.close_date) from days x), '[]'::jsonb),
    'ticketsSold', coalesce((select sum(x.total_tickets) from days x), 0),
    'dollarsSold', coalesce((select sum(x.total_dollars) from days x), 0),
    'shipmentValue', (app.shipments_in(first) ->> 'dollars')::numeric,
    'fullPacks', (select jsonb_build_object('count', count(*), 'dollars', coalesce(sum(c.dollars), 0)) from app.close_entries c
      where c.close_type = 'full_pack' and c.close_date >= first and c.close_date < (first + interval '1 month')::date),
    'endingInventoryValue', (select x.inventory_value from days x order by x.close_date desc limit 1))
$$;

-- No month to start in the database (months are dates).
create or replace function app.month_status_json() returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('current', app.month_label(app.month_start()), 'currentUrl', null, 'next', null, 'canStart', false)
$$;

-- Today's month and every month with a close, newest first.
create or replace function app.months_json() returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', app.month_label(m.first),
      'status', case when m.first = app.month_start() then 'active' else 'archived' end, 'url', null) order by m.first desc), '[]'::jsonb)
  from (select app.month_start() as first
        union select date_trunc('month', d.close_date)::date from app.daily_closes d) m
$$;

create or replace function app.require_month(label text) returns date language plpgsql stable set search_path = '' as $$
declare first date := app.month_of(label);
begin
  if first is null or (first <> app.month_start() and not exists (select 1 from app.daily_closes d
      where d.close_date >= first and d.close_date < (first + interval '1 month')::date)) then
    perform app.fail('no_month', format('There''s nothing saved for %s.', coalesce(label, 'that month')));
  end if;
  return first;
end $$;

create or replace function public.month_status(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return app.month_status_json();
end $$;

create or replace function public.month_summary(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return app.month_summary_json(app.require_month(req ->> 'label'));
end $$;

create or replace function public.list_months(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return app.months_json();
end $$;

-- Months & Totals in one request.
create or replace function public.months_page(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return jsonb_build_object('status', app.month_status_json(), 'summary', app.month_summary_json(app.month_start()),
    'months', app.months_json());
end $$;

-- Everything on the owner's home in one request (ownerHome): Close Day's status plus the month, the last close, back
-- stock $, full packs and shift closes this month.
create or replace function public.owner_home(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare summary jsonb; latest app.shift_closes; shift_count integer;
begin
  perform app.enter_store(p_store, '{owner}');
  summary := app.month_summary_json(app.month_start());
  select * into latest from app.shift_closes s where app.in_this_month(s.shift_date) order by s.closed_at desc limit 1;
  select count(*) into shift_count from app.shift_closes s where app.in_this_month(s.shift_date);
  return public.close_status(p_store, req) || jsonb_build_object(
    'month', app.month_status_json(),
    'monthDollars', summary -> 'dollarsSold',
    'fullPacks', summary -> 'fullPacks',
    'lastClose', (select jsonb_build_object('date', app.date_label(d.close_date), 'ticketsSold', d.total_tickets,
        'dollarsSold', d.total_dollars, 'inventoryValue', d.inventory_value) from app.daily_closes d order by d.close_date desc limit 1),
    'backValue', coalesce((select sum(app.packs_in_back(g.game_number) * g.tickets_per_pack * g.price) from app.games g), 0),
    'shifts', jsonb_build_object('count', shift_count, 'last', case when latest.id is null then null else
      jsonb_build_object('date', app.date_label(latest.shift_date), 'closedAt', app.time_label(latest.closed_at), 'closedBy', latest.closed_by) end));
end $$;

-- Everything for a month's Excel file (Download Month): its totals, each day's sales lines (Close Day lines by slot, then
-- packs ended and full packs sold, as they happened), shipments and returns. Owner only.
create or replace function public.month_workbook(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare first date;
begin
  perform app.enter_store(p_store, '{owner}');
  first := app.require_month(req ->> 'label');
  return jsonb_build_object(
    'storeName', (select s.name from app.stores s where s.id = app.current_store_id()),
    'summary', app.month_summary_json(first),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'date', app.date_label(x.day),
        'closed', d.close_date is not null,
        'closedBy', d.closed_by, 'closedAt', app.time_label(d.closed_at),
        'ticketsSold', coalesce(d.total_tickets, (select sum(c.tickets_sold) from app.close_entries c where c.close_date = x.day)),
        'dollarsSold', coalesce(d.total_dollars, (select sum(c.dollars) from app.close_entries c where c.close_date = x.day)),
        'inventoryValue', d.inventory_value,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('box', c.box, 'slot', c.slot_number, 'gameNumber', p.game_number,
            'packNumber', p.pack_number, 'price', c.price, 'startTicket', c.previous_ticket, 'endTicket', c.current_ticket,
            'ticketsSold', c.tickets_sold, 'dollars', c.dollars, 'type', c.close_type, 'by', c.performed_by)
            order by c.close_type <> 'close', case when c.close_type = 'close' then c.box end, case when c.close_type = 'close' then c.slot_number end,
              c.logged_at, c.id), '[]'::jsonb)
          from app.close_entries c join app.packs p on p.id = c.pack_id where c.close_date = x.day))
        order by x.day)
      from (select d2.close_date as day from app.daily_closes d2 where d2.close_date >= first and d2.close_date < (first + interval '1 month')::date
            union select c2.close_date from app.close_entries c2 where c2.close_date >= first and c2.close_date < (first + interval '1 month')::date) x
      left join app.daily_closes d on d.close_date = x.day), '[]'::jsonb),
    'shipments', app.shipments_in(first) -> 'lines',
    'returns', (select coalesce(jsonb_agg(jsonb_build_object('date', app.date_label(a.adjusted_on), 'gameNumber', a.game_number,
        'packs', a.packs_removed, 'tickets', a.tickets_removed, 'reason', a.reason, 'notes', a.notes, 'by', a.performed_by) order by a.adjusted_on, a.id), '[]'::jsonb)
      from app.stock_adjustments a where a.adjusted_on >= first and a.adjusted_on < (first + interval '1 month')::date));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.month_of', 'app.month_label', 'app.shipments_in', 'app.shipments_json', 'app.month_summary_json', 'app.month_status_json',
      'app.months_json', 'app.require_month', 'public.month_status', 'public.month_summary', 'public.list_months',
      'public.months_page', 'public.owner_home', 'public.month_workbook')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on all functions in schema app to smart_scan_api;
grant execute on function public.month_status(uuid, jsonb), public.month_summary(uuid, jsonb), public.list_months(uuid, jsonb),
  public.months_page(uuid, jsonb), public.owner_home(uuid, jsonb), public.month_workbook(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
