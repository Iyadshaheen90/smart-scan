-- A missed day (owner 2026-10-26: a broken or forgotten phone; Close.js on the Sheets backend).
-- 1. A close counts every sales line logged after the previous close up to its day (build_summary), so a day nobody
--    closed has its sold outs, returns and full pack sales counted by the next close. A full pack sale can be undone
--    only while no close has counted it (covered_by_close).
-- 2. Close Yesterday: the next morning, before 12:00 PM and before anything changed today, anyone can close yesterday
--    late (submit_close with late: true), recorded under yesterday's date; a pack marked sold out in it ended yesterday.
--    The owner can reopen that late close on the same terms (reopen_close with date = yesterday). close_status (and so
--    owner_home) tells the pages with closeYesterday; a late close's summary has closedLate.
-- Known difference: Sheets doesn't offer it on the 1st once the new month's spreadsheet is started; the database has no
-- spreadsheets, so it does.
grant create on schema app, public to smart_scan_api;

-- Close Yesterday is open until noon (owner's choice).
create or replace function app.close_yesterday_until() returns time language sql immutable set search_path = '' as $$ select '12:00'::time $$;
create or replace function app.close_yesterday_until_label() returns text language sql immutable set search_path = '' as $$ select '12:00 PM' $$;

-- A day's sales lines are counted once a close on that day or a later one is saved.
create or replace function app.covered_by_close(d date) returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from app.daily_closes c where c.close_date >= d)
$$;

-- Why a late close of yesterday would mix in today's sales: something already changed today. null when nothing has.
create or replace function app.changed_today(today date) returns text language sql stable set search_path = '' as $$
  select case
    when exists (select 1 from app.packs p where p.status = 'live' and p.activated_on = today and p.last_close_on is null)
      then 'A pack was already put in a slot today'
    when exists (select 1 from app.close_entries c where c.close_date = today)
      then 'A pack was already sold out, returned or sold whole today'
    when exists (select 1 from app.shift_closes s where s.shift_date = today)
      then 'A shift was already closed today'
  end
$$;

-- What stops a late close of yesterday (or reopening one) at all: its message (code too_late), null when allowed.
create or replace function app.close_yesterday_refusal(today date) returns text language sql stable set search_path = '' as $$
  select case
    when exists (select 1 from app.daily_closes d where d.close_date = today)
      then 'Today is already closed, so yesterday''s sales are counted in today''s close.'
    when app.local_now()::time >= app.close_yesterday_until()
      then format('Yesterday can only be closed before %s. Its sales will count in tonight''s close.', app.close_yesterday_until_label())
  end
$$;

-- A close saved on a later business day than the one it closes (Close Yesterday).
create or replace function app.is_late_close(d app.daily_closes) returns boolean language sql stable set search_path = '' as $$
  select coalesce(((d.closed_at at time zone s.time_zone) - make_interval(hours => s.day_end_hour))::date > d.close_date, false)
  from app.stores s where s.id = app.current_store_id()
$$;

create or replace function app.summary_json(d app.daily_closes, is_owner boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('date', app.date_label(d.close_date), 'ticketsSold', d.total_tickets,
      'liveSlots', d.live_slot_count, 'closedBy', d.closed_by, 'closedAt', app.time_label(d.closed_at),
      'closedLate', case when app.is_late_close(d) then true end))
    || case when is_owner then jsonb_build_object('dollarsSold', d.total_dollars, 'inventoryValue', d.inventory_value)
       else '{}'::jsonb end
$$;

-- For Home and Close Day: { date, until, closed } (this morning's late close, which can be reopened) or { date, until,
-- blocked } (blocked: why it can't be closed now, else null) while Close Yesterday applies; null otherwise.
create or replace function app.close_yesterday_json(m app.store_members, today date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare y date := today - 1; d app.daily_closes; changed text;
begin
  if app.close_yesterday_refusal(today) is not null then return null; end if;
  select * into d from app.daily_closes c where c.close_date = y;
  if d.close_date is not null then
    if not app.is_late_close(d) then return null; end if;
    return jsonb_build_object('date', app.date_label(y), 'until', app.close_yesterday_until_label(),
      'closed', app.summary_json(d, m.role = 'owner'));
  end if;
  changed := app.changed_today(today);
  return jsonb_build_object('date', app.date_label(y), 'until', app.close_yesterday_until_label(),
    'blocked', case when changed is null then null
      else changed || ', so yesterday can''t be closed now. Its sales will count in tonight''s close.' end);
end $$;

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
    'closeYesterday', app.close_yesterday_json(m, today),
    'permissions', to_jsonb(m.permissions),
    'slots', app.slots_json(today));
end $$;

-- A close's totals: every sales line after the previous close up to its day; inventory = live packs + back stock now.
create or replace function app.build_summary(today date) returns app.daily_closes language sql stable set search_path = '' as $$
  with since as (select max(d.close_date) as day from app.daily_closes d where d.close_date < today),
  counted as (select c.* from app.close_entries c, since where c.close_date <= today and (since.day is null or c.close_date > since.day))
  select app.current_store_id(), today,
    coalesce((select sum(c.tickets_sold) from counted c), 0)::integer,
    coalesce((select sum(c.dollars) from counted c), 0),
    (select count(*) from app.packs p where p.status = 'live')::integer,
    coalesce((select sum(app.tickets_left(p.ticket_order, p.top_ticket,
      case when p.ticket_order = 'ascending' then app.pack_size(p.game_number, p.price) end) * p.price)
      from app.packs p where p.status = 'live'), 0)
    + coalesce((select sum(app.packs_in_back(g.game_number) * g.tickets_per_pack * g.price) from app.games g), 0),
    null::text, null::text, null::timestamptz
$$;

-- on_date: Close Yesterday marking a pack sold out — its sales and end date are yesterday's.
drop function app.end_pack_in_slot(app.store_members, app.packs, text, jsonb);
create function app.end_pack_in_slot(m app.store_members, p app.packs, reason text, top jsonb, on_date date default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  tpp integer := (select g.tickets_per_pack from app.games g where g.game_number = p.game_number);
  size integer := coalesce(tpp, app.standard_pack_size(p.price));
  remaining integer := 0;
  t numeric;
  sold integer;
begin
  if reason = 'returned' then
    t := case when top is null or jsonb_typeof(top) = 'null' or top = '""'::jsonb then null else app.js_num(top) end;
    if not app.is_int(t) or t < 0 or app.already_sold(p.ticket_order, p.top_ticket, t)
      or (p.ticket_order = 'ascending' and size is not null and t >= size) then
      perform app.fail('bad_ticket', format('Scan the top ticket of pack %s (it should be %s %s).', app.pack_key(p), p.top_ticket,
        case when p.ticket_order = 'ascending' then 'or higher' else 'or lower' end));
    end if;
    remaining := app.tickets_left(p.ticket_order, t::integer, size);
  end if;
  sold := app.tickets_left(p.ticket_order, p.top_ticket, size) - remaining;
  insert into app.close_entries (store_id, close_date, box, slot_number, pack_id, previous_ticket, current_ticket, tickets_sold,
    price, dollars, remaining_after, close_type, late_activation, performed_by, previous_close_date, logged_at)
  values (p.store_id, coalesce(on_date, app.sales_date()), p.box, p.slot_number, p.id, p.top_ticket,
    case when reason = 'returned' then t::integer end, sold, p.price, sold * p.price, 0, reason, false, m.username,
    p.last_close_on, app.now_tz());
  update app.packs set status = reason, ended_on = coalesce(on_date, app.today()), ended_at = clock_timestamp(), end_reason = reason,
    remaining_at_end = remaining, performed_by = m.username
  where id = p.id;
  update app.slots set last_game_number = p.game_number where box = p.box and slot_number = p.slot_number;
  return jsonb_build_object('packKey', app.pack_key(p), 'reason', reason, 'ticketsSoldToday', sold, 'remainingReturned', remaining);
end $$;

-- req: { entries: [{ box, slot, packKey, type: 'scan' | 'sold_out', ticketNumber? }], closeId?, date?, late? }
create or replace function public.submit_close(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m app.store_members; entries jsonb := req -> 'entries'; new_close_id text := nullif(req ->> 'closeId', ''); sent app.daily_closes;
  late boolean := coalesce(req -> 'late' = 'true'::jsonb, false);
  today date; day date; p app.packs; e jsonb; place text; t numeric; size integer; sold integer; extra jsonb; summary app.daily_closes;
  live_slots jsonb; refusal text;
begin
  m := app.enter_store(p_store);
  if entries is null or jsonb_typeof(entries) <> 'array' then perform app.fail('bad_request', 'Nothing to submit.'); end if;
  perform app.lock_store();
  -- Sent again after a lost answer: the close it already saved.
  if new_close_id is not null then
    select * into sent from app.daily_closes d where d.close_id = new_close_id;
    if sent.close_date is not null then return app.summary_json(sent, m.role = 'owner') || '{"alreadySent": true}'::jsonb; end if;
  end if;
  today := app.today();
  -- The day this close is for: today, or yesterday for Close Yesterday.
  day := case when late then today - 1 else today end;
  if coalesce(req ->> 'date', '') <> '' and req ->> 'date' <> app.date_label(day) then
    perform app.fail('wrong_day', format('This close was scanned on %s and couldn''t be sent that day, so it wasn''t saved. ', req ->> 'date')
      || 'Those sales will count in today''s close. Open Close Day and scan again.');
  end if;
  if late then
    if exists (select 1 from app.daily_closes where close_date = day) then perform app.fail('already_closed', 'Yesterday has already been closed.'); end if;
    refusal := app.close_yesterday_refusal(today);
    if refusal is not null then perform app.fail('too_late', refusal); end if;
    refusal := app.changed_today(today);
    if refusal is not null then
      perform app.fail('too_late', refusal || ', so yesterday can''t be closed now. Its sales will count in tonight''s close.');
    end if;
  elsif exists (select 1 from app.daily_closes where close_date = today) then
    perform app.fail('already_closed', 'Today has already been closed.');
  end if;

  -- The slots with a pack when the close starts, for spotting an entry for a slot that has none.
  select coalesce(jsonb_agg(jsonb_build_array(box, slot_number)), '[]'::jsonb) into live_slots from app.packs where status = 'live';
  for p in select * from app.packs where status = 'live' order by box, slot_number loop
    place := format('Box %s, slot %s', p.box, p.slot_number);
    select x into e from jsonb_array_elements(entries) x
      where app.js_num(x -> 'box') = p.box and app.js_num(x -> 'slot') = p.slot_number limit 1;
    if e is null then perform app.fail('incomplete', format('%s hasn''t been scanned.', place)); end if;
    if (e ->> 'packKey') is distinct from app.pack_key(p) then
      perform app.fail('slots_changed', format('%s now holds pack %s, not %s. Reload Close Day.', place, app.pack_key(p), app.js_text(e -> 'packKey')));
    end if;
    if coalesce(e ->> 'type', '') not in ('scan', 'sold_out') then perform app.fail('bad_request', format('%s: unknown entry.', place)); end if;
    if e ->> 'type' = 'sold_out' then
      perform app.end_pack_in_slot(m, p, 'sold_out', null, case when late then day end);
      continue;
    end if;
    size := case when p.ticket_order = 'ascending' then app.pack_size(p.game_number, p.price) end;
    t := app.js_num(e -> 'ticketNumber');
    if not app.is_int(t) or t < 0 or app.already_sold(p.ticket_order, p.top_ticket, t) or (size is not null and t >= size) then
      perform app.fail('bad_ticket', format('%s: ticket %s is %s the last top ticket (%s). Rescan it.', place, app.js_text(e -> 'ticketNumber'),
        app.sold_side(p.ticket_order), p.top_ticket));
    end if;
    sold := app.tickets_sold(p.ticket_order, p.top_ticket, t::integer);
    insert into app.close_entries (store_id, close_date, box, slot_number, pack_id, previous_ticket, current_ticket, tickets_sold, price,
      dollars, remaining_after, close_type, late_activation, performed_by, previous_close_date, logged_at)
    values (p.store_id, day, p.box, p.slot_number, p.id, p.top_ticket, t::integer, sold, p.price, sold * p.price,
      app.tickets_left(p.ticket_order, t::integer, size), 'close', coalesce(p.activated_on = day, false), m.username,
      p.last_close_on, app.now_tz());
    update app.packs set top_ticket = t::integer, last_close_on = day where id = p.id;
  end loop;
  select x into extra from jsonb_array_elements(entries) x
    where not exists (select 1 from jsonb_array_elements(live_slots) l
      where (l ->> 0)::numeric = app.js_num(x -> 'box') and (l ->> 1)::numeric = app.js_num(x -> 'slot'))
    limit 1;
  if extra is not null then
    perform app.fail('slots_changed', format('Box %s, slot %s has no pack now. Reload Close Day.', app.js_text(extra -> 'box'),
      app.js_text(extra -> 'slot')));
  end if;

  summary := app.build_summary(day);
  summary.close_id := new_close_id;
  summary.closed_by := m.username;
  summary.closed_at := app.now_tz();
  insert into app.daily_closes select summary.*;
  return app.summary_json(summary, m.role = 'owner');
end $$;

-- Owner: undoes today's close so it can be done again (every top ticket goes back; ended packs stay ended) — or, with
-- date = yesterday, this morning's Close Yesterday, on the same terms as making it.
create or replace function public.reopen_close(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare now_day date; today date; asked text := coalesce(req ->> 'date', ''); r app.close_entries; n integer := 0;
  d app.daily_closes; refusal text;
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  now_day := app.today();
  if asked <> '' and asked <> app.date_label(now_day) then
    today := now_day - 1;
    if asked <> app.date_label(today) then
      perform app.fail('bad_request', 'Only today''s close, or yesterday''s closed this morning, can be reopened.');
    end if;
    select * into d from app.daily_closes c where c.close_date = today;
    if d.close_date is null then perform app.fail('not_closed', 'Yesterday hasn''t been closed.'); end if;
    if not app.is_late_close(d) then perform app.fail('too_late', 'Yesterday was closed on time, so it can''t be reopened now.'); end if;
    refusal := app.close_yesterday_refusal(now_day);
    if refusal is not null then perform app.fail('too_late', refusal); end if;
  else
    today := now_day;
    if not exists (select 1 from app.daily_closes where close_date = today) then perform app.fail('not_closed', 'Today hasn''t been closed.'); end if;
  end if;
  for r in delete from app.close_entries where close_type = 'close' and close_date = today returning * loop
    n := n + 1;
    update app.packs set top_ticket = r.previous_ticket,
      last_close_on = coalesce(r.previous_close_date,
        (select max(c.close_date) from app.close_entries c where c.pack_id = r.pack_id and c.close_type = 'close'))
    where id = r.pack_id and status = 'live';
  end loop;
  delete from app.daily_closes where close_date = today;
  return jsonb_build_object('reopened', app.date_label(today), 'slotsRestored', n);
end $$;

-- Full pack sales: Undo while no close has counted the sale (its day's, or the next one after a missed day).
create or replace function app.full_pack_sales_json() returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('count', count(*), 'dollars', coalesce(sum(c.dollars), 0),
    'sales', coalesce(jsonb_agg(jsonb_build_object('date', app.date_label(c.close_date), 'packKey', app.pack_key(p),
      'gameNumber', p.game_number, 'packNumber', p.pack_number, 'price', c.price, 'ticketsPerPack', c.tickets_sold,
      'dollars', c.dollars, 'soldBy', coalesce(c.performed_by, ''),
      'canUndo', not app.covered_by_close(c.close_date))
      order by c.close_date desc, c.id desc), '[]'::jsonb))
  from app.close_entries c join app.packs p on p.id = c.pack_id
  where c.close_type = 'full_pack' and c.close_date >= date_trunc('month', app.today())::date
    and c.close_date < (date_trunc('month', app.today()) + interval '1 month')::date
$$;

create or replace function public.undo_full_pack_sale(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare key text := coalesce(nullif(req ->> 'packKey', ''), ''); sale app.close_entries; p app.packs;
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  select c.* into sale from app.close_entries c join app.packs x on x.id = c.pack_id
  where c.close_type = 'full_pack' and app.pack_key(x) = key order by c.id limit 1;
  if sale.id is null then perform app.fail('nothing_to_undo', format('Pack %s wasn''t sold as a full pack this month.', key)); end if;
  if app.covered_by_close(sale.close_date) then
    perform app.fail('already_closed', 'That day''s close already counted this sale, so it can''t be undone.');
  end if;
  delete from app.close_entries where id = sale.id;
  -- Back in the back, now known by its number.
  update app.packs set status = 'in_back', activated_on = null, ended_on = null, ended_at = null, end_reason = null,
    remaining_at_end = null where id = sale.pack_id returning * into p;
  return jsonb_build_object('packKey', key, 'after', app.packs_in_back(p.game_number), 'sales', app.full_pack_sales_json());
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.close_yesterday_until', 'app.close_yesterday_until_label', 'app.covered_by_close', 'app.changed_today',
      'app.close_yesterday_refusal', 'app.is_late_close', 'app.summary_json', 'app.close_yesterday_json', 'app.build_summary',
      'app.end_pack_in_slot', 'app.full_pack_sales_json', 'public.close_status', 'public.submit_close', 'public.reopen_close',
      'public.undo_full_pack_sale')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on all functions in schema app to smart_scan_api;
grant execute on function public.close_status(uuid, jsonb), public.submit_close(uuid, jsonb), public.reopen_close(uuid, jsonb),
  public.undo_full_pack_sale(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
