-- Shift closes (Shifts.js): shiftStatus, submitShiftClose, listShiftCloses, deleteShiftClose, and the start tickets
-- (shiftStarts) the Theft Report also uses. A shift close never changes packs, Close Day or the day's totals.
-- Same checks, messages and answers as the Sheets code (test/parity/shifts.js). "This month" for the list = the calendar
-- month of the store's today.
grant create on schema app, public to smart_scan_api;

-- 'YYYY-MM-DD HH24:MI:SS' store-local, as nowStamp() writes it (shift ids).
create or replace function app.stamp(t timestamptz) returns text language sql stable set search_path = '' as $$
  select to_char(t at time zone s.time_zone, 'YYYY-MM-DD HH24:MI:SS') from app.stores s where s.id = app.current_store_id()
$$;

-- Each pack's start for the next shift close today (shiftStarts): its ticket at today's latest shift close that counted
-- it, or, once a shift close marked it sold out, that (first) one. Packs no shift close counted today aren't listed.
create or replace function app.shift_starts(today date)
returns table (pack_key text, ticket integer, sold_out boolean, closed_at timestamptz, closed_by text)
language sql stable set search_path = '' as $$
  select distinct on (e.pack_key) e.pack_key, case when e.sold then null else e.end_ticket end, e.sold, s.closed_at, s.closed_by
  from (select x.*, x.entry_type in ('sold_out', 'sold_out_earlier') as sold from app.shift_entries x) e
  join app.shift_closes s on s.id = e.shift_id
  where s.shift_date = today and e.entry_type in ('scan', 'sold_out', 'sold_out_earlier')
  order by e.pack_key, e.sold desc, case when e.sold then s.closed_at end asc, s.closed_at desc, e.id desc
$$;

-- What the Close shift screen needs (shiftStatus): every slot with each pack's shift start in place of last night's.
create or replace function public.shift_status(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; today date; latest app.shift_closes; mine app.shift_closes; slots jsonb;
begin
  m := app.enter_store(p_store);
  today := app.today();
  select * into latest from app.shift_closes where shift_date = today order by closed_at desc limit 1;
  if m.role <> 'owner' then
    select * into mine from app.shift_closes where shift_date = today and closed_by = m.username order by closed_at desc limit 1;
  end if;
  select coalesce(jsonb_agg(case
      when st.pack_key is null then s
      when st.sold_out then jsonb_set(s, '{pack}', (s -> 'pack') || jsonb_build_object('exposedTicket', -1, 'remaining', 0,
        'soldOutAtShift', app.time_label(st.closed_at)))
      else jsonb_set(s, '{pack}', (s -> 'pack') || jsonb_build_object('exposedTicket', st.ticket,
        'remaining', app.tickets_left(s #>> '{pack,order}', st.ticket,
          coalesce((s #>> '{pack,ticketsPerPack}')::integer, (s #>> '{pack,standardPackSize}')::integer)))) end
      order by n), '[]'::jsonb)
  into slots
  from jsonb_array_elements(app.slots_json(today)) with ordinality as t(s, n)
  left join app.shift_starts(today) st on st.pack_key = (s #>> '{pack,gameNumber}') || '-' || (s #>> '{pack,packNumber}');
  return jsonb_build_object('today', app.date_label(today), 'largeSaleTickets', app.large_sale_tickets(),
    'dayClosed', exists (select 1 from app.daily_closes where close_date = today),
    'since', case when latest.id is null then null else jsonb_build_object('closedAt', app.time_label(latest.closed_at), 'closedBy', latest.closed_by) end,
    'myShiftToday', case when mine.id is null then null else app.shift_json(mine, false) end,
    'slots', slots);
end $$;

-- Packs ended and full packs sold during the shift (endedInShift): today's sales lines logged after the previous shift
-- close (since; null = the day's first) up to this one. A pack an earlier shift close counted is counted from there.
create or replace function app.ended_in_shift(today date, since timestamptz, until timestamptz)
returns table (id bigint, box smallint, slot_number smallint, pack_id bigint, pack_key text, start_ticket integer,
  end_ticket integer, sold integer, price numeric, entry_type text)
language sql stable set search_path = '' as $$
  select c.id, c.box, c.slot_number, c.pack_id, app.pack_key(p),
    case when st.pack_key is null then c.previous_ticket when st.sold_out then null else st.ticket end,
    case when st.sold_out then null when c.close_type = 'returned' then c.current_ticket end,
    case when st.pack_key is null then c.tickets_sold
      when st.sold_out then 0
      when c.close_type = 'returned' then app.tickets_sold(p.ticket_order, st.ticket, c.current_ticket)
      else app.tickets_left(p.ticket_order, st.ticket,
        case when p.ticket_order = 'ascending' then app.pack_size(p.game_number, c.price) end) end,
    c.price,
    case when c.close_type = 'full_pack' then 'full_pack' else 'ended_' || c.close_type end
  from app.close_entries c
  join app.packs p on p.id = c.pack_id
  left join app.shift_starts(today) st on c.close_type <> 'full_pack' and st.pack_key = app.pack_key(p)
  where c.close_date = today and c.close_type in ('sold_out', 'returned', 'full_pack')
    and (since is null or c.logged_at > since) and c.logged_at <= until
  order by c.id
$$;

-- req: { entries: [{ box, slot, packKey, type: 'scan' | 'sold_out', ticketNumber? }], shiftId?, date? }
create or replace function public.submit_shift_close(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m app.store_members; entries jsonb := req -> 'entries'; new_shift_id text := nullif(req ->> 'shiftId', '');
  sent app.shift_closes; mine app.shift_closes; today date; since timestamptz; until timestamptz; new_id text;
  p app.packs; st record; e jsonb; place text; start integer; size integer; t numeric; extra jsonb; live_slots jsonb;
  plan jsonb := '[]'::jsonb; r jsonb; shift app.shift_closes; e_tickets integer := 0; e_dollars numeric := 0;
begin
  m := app.enter_store(p_store);
  if entries is null or jsonb_typeof(entries) <> 'array' then perform app.fail('bad_request', 'Nothing to submit.'); end if;
  perform app.lock_store();
  if new_shift_id is not null then
    select * into sent from app.shift_closes s where s.id = new_shift_id;
    if sent.id is not null then return app.shift_json(sent, m.role = 'owner') || '{"alreadySent": true}'::jsonb; end if;
  end if;
  today := app.today();
  if coalesce(req ->> 'date', '') <> '' and req ->> 'date' <> app.date_label(today) then
    perform app.fail('wrong_day', format('This shift close was scanned on %s and wasn''t sent that day, so it wasn''t saved.', req ->> 'date'));
  end if;
  if exists (select 1 from app.daily_closes where close_date = today) then
    perform app.fail('already_closed', 'Today has already been closed, so there''s no shift left to close.');
  end if;
  if m.role <> 'owner' then
    select * into mine from app.shift_closes s where s.closed_by = m.username and s.shift_date = today order by s.closed_at limit 1;
    if mine.id is not null then
      perform app.fail('already_closed_shift', format('You already closed your shift today at %s. ', app.time_label(mine.closed_at))
        || 'Only the owner can delete it so you can close it again.');
    end if;
  end if;
  since := (select max(s.closed_at) from app.shift_closes s where s.shift_date = today);
  select coalesce(jsonb_agg(jsonb_build_array(x.box, x.slot_number)), '[]'::jsonb) into live_slots from app.packs x where x.status = 'live';

  -- Check every live slot (in order) before writing anything.
  for p in select * from app.packs where status = 'live' order by box, slot_number loop
    select * into st from app.shift_starts(today) s where s.pack_key = app.pack_key(p);
    if st.pack_key is not null and st.sold_out then
      plan := plan || jsonb_build_array(jsonb_build_object('box', p.box, 'slot', p.slot_number, 'packId', p.id, 'packKey', app.pack_key(p),
        'price', p.price, 'type', 'sold_out_earlier', 'start', null, 'end', null, 'sold', 0));
      continue;
    end if;
    place := format('Box %s, slot %s', p.box, p.slot_number);
    select x into e from jsonb_array_elements(entries) x
      where app.js_num(x -> 'box') = p.box and app.js_num(x -> 'slot') = p.slot_number limit 1;
    if e is null then perform app.fail('incomplete', format('%s hasn''t been scanned.', place)); end if;
    if (e ->> 'packKey') is distinct from app.pack_key(p) then
      perform app.fail('slots_changed', format('%s now holds pack %s, not %s. Reload Close shift.', place, app.pack_key(p), app.js_text(e -> 'packKey')));
    end if;
    if coalesce(e ->> 'type', '') not in ('scan', 'sold_out') then perform app.fail('bad_request', format('%s: unknown entry.', place)); end if;
    start := case when st.pack_key is not null then st.ticket else p.top_ticket end;
    size := case when p.ticket_order = 'ascending' then app.pack_size(p.game_number, p.price) end;
    if e ->> 'type' = 'sold_out' then
      plan := plan || jsonb_build_array(jsonb_build_object('box', p.box, 'slot', p.slot_number, 'packId', p.id, 'packKey', app.pack_key(p),
        'price', p.price, 'type', 'sold_out', 'start', start, 'end', null, 'sold', app.tickets_left(p.ticket_order, start, size)));
      continue;
    end if;
    t := app.js_num(e -> 'ticketNumber');
    if not app.is_int(t) or t < 0 or app.already_sold(p.ticket_order, start, t) or (size is not null and t >= size) then
      perform app.fail('bad_ticket', format('%s: ticket %s is %s the shift''s start ticket (%s). Rescan it.', place,
        app.js_text(e -> 'ticketNumber'), app.sold_side(p.ticket_order), start));
    end if;
    plan := plan || jsonb_build_array(jsonb_build_object('box', p.box, 'slot', p.slot_number, 'packId', p.id, 'packKey', app.pack_key(p),
      'price', p.price, 'type', 'scan', 'start', start, 'end', t, 'sold', app.tickets_sold(p.ticket_order, start, t::integer)));
  end loop;
  select x into extra from jsonb_array_elements(entries) x
    where not exists (select 1 from jsonb_array_elements(live_slots) l
      where (l ->> 0)::numeric = app.js_num(x -> 'box') and (l ->> 1)::numeric = app.js_num(x -> 'slot'))
    limit 1;
  if extra is not null then
    perform app.fail('slots_changed', format('Box %s, slot %s has no pack now. Reload Close shift.', app.js_text(extra -> 'box'),
      app.js_text(extra -> 'slot')));
  end if;

  until := app.now_tz();
  new_id := coalesce(new_shift_id, format('%s-%s-%s', app.date_label(today), app.stamp(until), m.username));
  insert into app.shift_closes (store_id, id, shift_date, closed_by, started_at, closed_at, tickets_sold, dollars_sold, slots_scanned)
  values (app.current_store_id(), new_id, today, m.username, since, until, 0, 0, 0);
  for r in select x from jsonb_array_elements(plan) x loop
    insert into app.shift_entries (store_id, shift_id, box, slot_number, pack_id, pack_key, start_ticket, end_ticket, tickets_sold,
      price, dollars, entry_type)
    values (app.current_store_id(), new_id, (r ->> 'box')::smallint, (r ->> 'slot')::smallint, (r ->> 'packId')::bigint, r ->> 'packKey',
      (r ->> 'start')::integer, (r ->> 'end')::integer, (r ->> 'sold')::integer, (r ->> 'price')::numeric,
      (r ->> 'sold')::integer * (r ->> 'price')::numeric, r ->> 'type');
  end loop;
  for st in select * from app.ended_in_shift(today, since, until) loop
    insert into app.shift_entries (store_id, shift_id, box, slot_number, pack_id, pack_key, start_ticket, end_ticket, tickets_sold,
      price, dollars, entry_type)
    values (app.current_store_id(), new_id, st.box, st.slot_number, st.pack_id, st.pack_key, st.start_ticket, st.end_ticket, st.sold,
      st.price, st.sold * st.price, st.entry_type);
    e_tickets := e_tickets + st.sold;
    e_dollars := e_dollars + st.sold * st.price;
  end loop;
  update app.shift_closes s set
    tickets_sold = (select coalesce(sum(x.tickets_sold), 0) from app.shift_entries x where x.shift_id = s.id),
    dollars_sold = (select coalesce(sum(x.dollars), 0) from app.shift_entries x where x.shift_id = s.id),
    slots_scanned = (select count(*) from jsonb_array_elements(plan) x where x ->> 'type' <> 'sold_out_earlier'),
    ended_tickets = e_tickets, ended_dollars = e_dollars
  where s.id = new_id
  returning * into shift;
  return app.shift_json(shift, m.role = 'owner');
end $$;

-- This month's shift closes, newest first, each with its rows (owner).
create or replace function app.shift_closes_json() returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('count', count(*), 'shifts', coalesce(jsonb_agg(app.shift_json(s, true) || jsonb_build_object('rows',
    coalesce((select jsonb_agg(jsonb_build_object('box', e.box, 'slot', e.slot_number, 'packKey', e.pack_key, 'start', e.start_ticket,
      'end', e.end_ticket, 'sold', e.tickets_sold, 'price', e.price, 'dollars', e.dollars, 'type', e.entry_type) order by e.id)
      from app.shift_entries e where e.shift_id = s.id), '[]'::jsonb)) order by s.closed_at desc), '[]'::jsonb))
  from app.shift_closes s
  where s.shift_date >= date_trunc('month', app.today())::date and s.shift_date < (date_trunc('month', app.today()) + interval '1 month')::date
$$;

create or replace function public.list_shift_closes(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return app.shift_closes_json();
end $$;

-- Owner: removes a shift close made by mistake.
create or replace function public.delete_shift_close(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare gone text := coalesce(nullif(req ->> 'shiftId', ''), '');
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  if not exists (select 1 from app.shift_closes where id = gone) then
    perform app.fail('nothing_to_delete', 'That shift close isn''t saved any more.');
  end if;
  delete from app.shift_closes where id = gone;
  return app.shift_closes_json();
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.stamp', 'app.shift_starts', 'app.ended_in_shift', 'app.shift_closes_json', 'public.shift_status',
      'public.submit_shift_close', 'public.list_shift_closes', 'public.delete_shift_close')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on all functions in schema app to smart_scan_api;
grant execute on function public.shift_status(uuid, jsonb), public.submit_shift_close(uuid, jsonb), public.list_shift_closes(uuid, jsonb),
  public.delete_shift_close(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
