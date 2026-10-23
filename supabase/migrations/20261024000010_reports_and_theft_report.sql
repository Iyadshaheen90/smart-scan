-- The Reports tab (Reports.js): listShipments, listReturns, reportsPage, and the Theft Report (theftReport, owner or
-- theft_report; ranges from each pack's newest count, today's shift closes included). Same answers as the Sheets code
-- (test/parity/reports.js). "This month" = the calendar month of the store's today. The Theft Report's back stock is
-- still per game, as the page shows it; listing every numbered back stock pack comes with the per-pack scan-in.
grant create on schema app, public to smart_scan_api;

create or replace function app.month_start() returns date language sql stable set search_path = '' as $$
  select date_trunc('month', app.today())::date
$$;

create or replace function app.in_this_month(d date) returns boolean language sql stable set search_path = '' as $$
  select d >= app.month_start() and d < (app.month_start() + interval '1 month')::date
$$;

-- This month's shipments, one line per game per day (scanned and added-by-hand apart), newest day first.
create or replace function app.shipments_json() returns jsonb language sql stable set search_path = '' as $$
  with lines as (
    select app.date_label(s.received_on) as date, s.game_number, s.source = 'add pack' as by_hand,
      min(s.id) as first_id, sum(s.packs)::integer as packs, (array_agg(s.price order by s.id))[1] as price,
      (array_agg(s.tickets_per_pack order by s.id))[1] as size, sum(s.packs * s.tickets_per_pack * s.price) as dollars
    from app.shipments s where app.in_this_month(s.received_on)
    group by s.received_on, s.game_number, s.source = 'add pack')
  select jsonb_build_object('packs', coalesce(sum(l.packs), 0), 'dollars', coalesce(sum(l.dollars), 0),
    'lines', coalesce(jsonb_agg(jsonb_build_object('date', l.date, 'gameNumber', l.game_number, 'packs', l.packs, 'price', l.price,
      'ticketsPerPack', l.size, 'dollars', l.dollars, 'addedByHand', l.by_hand) order by l.date desc, l.game_number, l.first_id), '[]'::jsonb))
  from lines l
$$;

-- This month's returns to the lottery: partial packs returned from a slot (one line each) and sealed packs removed
-- from the back as "returned" (one line per game per day), newest day first.
create or replace function app.returns_json() returns jsonb language sql stable set search_path = '' as $$
  with lines as (
    select app.date_label(p.ended_on) as date, 0 as kind_order, p.ended_at, p.id, jsonb_build_object('date', app.date_label(p.ended_on),
      'kind', 'slot', 'gameNumber', p.game_number, 'packNumber', p.pack_number, 'box', p.box, 'slot', p.slot_number, 'packs', 1,
      'ticketsReturned', p.remaining_at_end, 'price', p.price,
      'ticketsPerPack', coalesce(g.tickets_per_pack, app.standard_pack_size(p.price), 0),
      'dollars', p.remaining_at_end * p.price) as j, p.game_number, 1 as packs, p.remaining_at_end * p.price as dollars
    from app.packs p left join app.games g on g.game_number = p.game_number
    where p.status = 'returned' and app.in_this_month(p.ended_on)
    union all
    select app.date_label(a.adjusted_on), 1, null, min(a.id), jsonb_build_object('date', app.date_label(a.adjusted_on), 'kind', 'back',
      'gameNumber', a.game_number, 'packs', sum(a.packs_removed), 'price', coalesce(g.price, 0),
      'ticketsPerPack', case when sum(a.packs_removed) = 0 then 0 else sum(a.tickets_removed)::numeric / sum(a.packs_removed) end,
      'dollars', sum(a.tickets_removed) * coalesce(g.price, 0)), a.game_number, sum(a.packs_removed)::integer,
      sum(a.tickets_removed) * coalesce(g.price, 0)
    from app.stock_adjustments a left join app.games g on g.game_number = a.game_number
    where a.reason = 'returned' and app.in_this_month(a.adjusted_on)
    group by a.adjusted_on, a.game_number, g.price)
  select jsonb_build_object('packs', coalesce(sum(l.packs), 0), 'dollars', coalesce(sum(l.dollars), 0),
    'lines', coalesce(jsonb_agg(l.j order by l.date desc, l.game_number, l.kind_order, l.ended_at, l.id), '[]'::jsonb))
  from lines l
$$;

create or replace function public.list_shipments(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return app.shipments_json();
end $$;

create or replace function public.list_returns(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return app.returns_json();
end $$;

-- The numbers on the Reports list: sold this month (its Close Days), and both reports' totals.
create or replace function public.reports_page(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb; r jsonb;
begin
  perform app.enter_store(p_store, '{owner}');
  s := app.shipments_json();
  r := app.returns_json();
  return jsonb_build_object(
    'monthDollars', coalesce((select sum(d.total_dollars) from app.daily_closes d where app.in_this_month(d.close_date)), 0),
    'shipments', jsonb_build_object('packs', s -> 'packs', 'dollars', s -> 'dollars'),
    'returns', jsonb_build_object('packs', r -> 'packs', 'dollars', r -> 'dollars'));
end $$;

-- ---------- Theft Report ----------

-- The newest Close Day: { date, closedAt?, closedBy? } (null when there's none at all).
create or replace function app.last_known_close() returns jsonb language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('date', app.date_label(d.close_date), 'closedAt', app.time_label(d.closed_at),
    'closedBy', d.closed_by))
  from app.daily_closes d order by d.close_date desc limit 1
$$;

create or replace function public.theft_report(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m app.store_members; full_report boolean := coalesce((req -> 'full') not in ('false', '0', '""', 'null'), false);
  today date; today_closed boolean; latest app.shift_closes; live jsonb; back jsonb; report jsonb;
begin
  m := app.enter_store(p_store, '{theft_report}');
  today := app.today();
  today_closed := exists (select 1 from app.daily_closes where close_date = today);
  if not today_closed then
    select * into latest from app.shift_closes where shift_date = today order by closed_at desc limit 1;
  end if;
  -- Each live pack from its newest count: today's latest shift close that counted it (until today is closed), else
  -- a pack put in since the last close from its activation ticket, else the last close.
  with lines as (
    select p.box, p.slot_number, p.price, p.ticket_order, st.pack_key is not null as from_shift, coalesce(st.sold_out, false) as sold_out,
      coalesce(st.ticket, p.top_ticket) as top,
      case when p.ticket_order = 'ascending' then app.pack_size(p.game_number, p.price) end as size,
      jsonb_build_object('box', p.box, 'slot', p.slot_number, 'gameNumber', p.game_number, 'packNumber', p.pack_number,
        'order', p.ticket_order, 'price', p.price,
        'source', case when st.pack_key is not null then 'shift' when p.last_close_on is not null then 'close' else 'activation' end)
      || case when st.pack_key is not null then jsonb_build_object('shiftAt', app.time_label(st.closed_at), 'shiftBy', st.closed_by)
         else '{}'::jsonb end as base
    from app.packs p
    left join app.shift_starts(today) st on not today_closed and st.pack_key = app.pack_key(p)
    where p.status = 'live'),
  shaped as (
    select l.box, l.slot_number, case when l.sold_out
      then l.base || jsonb_build_object('soldOutAt', l.base ->> 'shiftAt', 'fromTicket', null, 'toTicket', null, 'tickets', 0, 'dollars', 0)
      else l.base || jsonb_build_object(
        'fromTicket', case when l.ticket_order = 'ascending' then l.top else 0 end,
        'toTicket', case when l.ticket_order = 'ascending' then l.size - 1 else l.top end,
        'tickets', app.tickets_left(l.ticket_order, l.top, l.size),
        'dollars', app.tickets_left(l.ticket_order, l.top, l.size) * l.price) end as j
    from lines l)
  select jsonb_build_object('lines', coalesce(jsonb_agg(s.j order by s.box, s.slot_number), '[]'::jsonb),
    'packs', count(*) filter (where not (s.j ? 'soldOutAt')),
    'tickets', coalesce(sum((s.j ->> 'tickets')::integer), 0), 'dollars', coalesce(sum((s.j ->> 'dollars')::numeric), 0))
  into live from shaped s;

  if full_report then
    select jsonb_build_object('lines', coalesce(jsonb_agg(x.j order by x.game_number), '[]'::jsonb),
      'packs', coalesce(sum(x.packs), 0), 'tickets', coalesce(sum(x.packs * x.size), 0), 'dollars', coalesce(sum(x.packs * x.size * x.price), 0))
    into back
    from (select g.game_number, app.packs_in_back(g.game_number) as packs, g.tickets_per_pack as size, g.price,
        jsonb_build_object('gameNumber', g.game_number, 'price', g.price, 'ticketsPerPack', g.tickets_per_pack,
          'packs', app.packs_in_back(g.game_number), 'tickets', app.packs_in_back(g.game_number) * g.tickets_per_pack,
          'dollars', app.packs_in_back(g.game_number) * g.tickets_per_pack * g.price) as j
      from app.games g where app.packs_in_back(g.game_number) > 0 and g.ended_on is null) x;
  end if;

  report := jsonb_build_object('full', full_report, 'madeAt', to_char(app.local_now(), 'YYYY-MM-DD HH24:MI'),
    'lastClose', app.last_known_close(),
    'lastShift', case when latest.id is null then null else jsonb_build_object('closedAt', app.time_label(latest.closed_at), 'closedBy', latest.closed_by) end,
    'live', live, 'back', back);
  if m.role <> 'owner' then
    -- Employees get the same packs and ranges with every dollar amount taken out.
    report := jsonb_set(report, '{live}', (report -> 'live') - 'dollars'
      || jsonb_build_object('lines', (select coalesce(jsonb_agg(x - 'dollars'), '[]'::jsonb) from jsonb_array_elements(report #> '{live,lines}') x)));
    if back is not null then
      report := jsonb_set(report, '{back}', (report -> 'back') - 'dollars'
        || jsonb_build_object('lines', (select coalesce(jsonb_agg(x - 'dollars'), '[]'::jsonb) from jsonb_array_elements(report #> '{back,lines}') x)));
    end if;
  end if;
  return report;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.month_start', 'app.in_this_month', 'app.shipments_json', 'app.returns_json', 'app.last_known_close',
      'public.list_shipments', 'public.list_returns', 'public.reports_page', 'public.theft_report')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on all functions in schema app to smart_scan_api;
grant execute on function public.list_shipments(uuid, jsonb), public.list_returns(uuid, jsonb), public.reports_page(uuid, jsonb),
  public.theft_report(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
