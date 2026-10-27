-- The move from the monthly spreadsheets (scripts/import-sheets.js, with the service key, which never ships in the app).
-- service_create_store makes the real store at cutover; service_import_store fills an empty store with the rows
-- scripts/import-map.js builds from the sheets, in one transaction (any error and nothing is kept).
-- Rows go in in the sheets' order, so every list the app orders by id comes out in the same order as on Sheets.

grant create on schema app, public to smart_scan_api;

create or replace function public.service_create_store(p_name text, p_time_zone text default 'America/Los_Angeles') returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid := gen_random_uuid();
begin
  perform app.require_service_role();
  perform set_config('app.store_id', id::text, true);
  insert into app.stores (id, name, time_zone) values (id, p_name, p_time_zone);
  return id;
end $$;

-- data: { members: [{ userId, username, role, permissions, active, email, createdOn }], slots, games, packs, closeEntries,
--         dailyCloses, shiftCloses, shiftEntries, shipments, adjustments } — the shapes are in scripts/import-map.js.
-- Times ("2026-09-27 22:52:10") are the store's local time.
create or replace function public.service_import_store(p_store uuid, data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tz text;
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  select time_zone into tz from app.stores where id = p_store;
  if tz is null then perform app.fail('no_store', 'No such store.'); end if;
  if exists (select 1 from app.slots) or exists (select 1 from app.games) or exists (select 1 from app.daily_closes)
    or exists (select 1 from app.store_members) then
    perform app.fail('not_empty', 'This store already has data; the import only fills an empty store.');
  end if;

  insert into app.store_members (store_id, user_id, username, role, permissions, active, email, created_at)
  select p_store, (x ->> 'userId')::uuid, x ->> 'username', x ->> 'role',
    coalesce(array(select jsonb_array_elements_text(x -> 'permissions')), '{}'), (x ->> 'active')::boolean,
    x ->> 'email', coalesce(((x ->> 'createdOn')::date)::timestamp at time zone tz, now())
  from jsonb_array_elements(data -> 'members') with ordinality as t(x, n) order by n;

  insert into app.slots (store_id, box, slot_number, price, ticket_order, last_game_number)
  select p_store, (x ->> 'box')::smallint, (x ->> 'slot')::smallint, (x ->> 'price')::numeric, x ->> 'order', x ->> 'lastGame'
  from jsonb_array_elements(data -> 'slots') x;

  insert into app.games (store_id, game_number, price, tickets_per_pack, unnumbered_in_back, ended_on)
  select p_store, x ->> 'game', (x ->> 'price')::numeric, (x ->> 'size')::integer, (x ->> 'inBack')::integer, (x ->> 'endedOn')::date
  from jsonb_array_elements(data -> 'games') x;

  insert into app.packs (store_id, game_number, pack_number, status, box, slot_number, ticket_order, price, activation_ticket,
    top_ticket, activated_on, last_close_on, price_before_activation, took_from_back, ended_on, ended_at, end_reason,
    remaining_at_end, performed_by)
  select p_store, x ->> 'game', x ->> 'pack', x ->> 'status', (x ->> 'box')::smallint, (x ->> 'slot')::smallint, x ->> 'order',
    (x ->> 'price')::numeric, (x ->> 'activationTicket')::integer, (x ->> 'top')::integer, (x ->> 'activatedOn')::date,
    (x ->> 'lastCloseOn')::date, (x ->> 'priceBefore')::numeric, (x ->> 'tookFromBack')::boolean, (x ->> 'endedOn')::date,
    (x ->> 'endedAt')::timestamp at time zone tz, x ->> 'endReason', (x ->> 'remainingAtEnd')::integer, x ->> 'performedBy'
  from jsonb_array_elements(data -> 'packs') with ordinality as t(x, n) order by n;

  insert into app.close_entries (store_id, close_date, box, slot_number, pack_id, previous_ticket, current_ticket, tickets_sold,
    price, dollars, remaining_after, close_type, late_activation, performed_by, previous_close_date, logged_at)
  select p_store, (x ->> 'date')::date, (x ->> 'box')::smallint, (x ->> 'slot')::smallint, p.id, (x ->> 'previous')::integer,
    (x ->> 'current')::integer, (x ->> 'tickets')::integer, (x ->> 'price')::numeric, (x ->> 'dollars')::numeric,
    (x ->> 'remainingAfter')::integer, x ->> 'type', (x ->> 'late')::boolean, x ->> 'performedBy', (x ->> 'previousCloseOn')::date,
    (x ->> 'loggedAt')::timestamp at time zone tz
  from jsonb_array_elements(data -> 'closeEntries') with ordinality as t(x, n)
  join app.packs p on p.game_number = x ->> 'game' and p.pack_number = x ->> 'pack'
  order by n;
  if (select count(*) from app.close_entries) <> jsonb_array_length(data -> 'closeEntries') then
    perform app.fail('bad_request', 'A close line is for a pack that isn''t in the import.');
  end if;

  insert into app.daily_closes (store_id, close_date, total_tickets, total_dollars, live_slot_count, inventory_value, close_id,
    closed_by, closed_at)
  select p_store, (x ->> 'date')::date, (x ->> 'tickets')::integer, (x ->> 'dollars')::numeric, (x ->> 'liveSlots')::integer,
    (x ->> 'inventory')::numeric, x ->> 'closeId', x ->> 'closedBy', (x ->> 'closedAt')::timestamp at time zone tz
  from jsonb_array_elements(data -> 'dailyCloses') x;

  insert into app.shift_closes (store_id, id, shift_date, closed_by, started_at, closed_at, tickets_sold, dollars_sold,
    slots_scanned, ended_tickets, ended_dollars)
  select p_store, x ->> 'id', (x ->> 'date')::date, x ->> 'closedBy', (x ->> 'startedAt')::timestamp at time zone tz,
    (x ->> 'closedAt')::timestamp at time zone tz, (x ->> 'tickets')::integer, (x ->> 'dollars')::numeric,
    (x ->> 'slotsScanned')::integer, (x ->> 'endedTickets')::integer, (x ->> 'endedDollars')::numeric
  from jsonb_array_elements(data -> 'shiftCloses') with ordinality as t(x, n) order by n;

  insert into app.shift_entries (store_id, shift_id, box, slot_number, pack_id, pack_key, start_ticket, end_ticket, tickets_sold,
    price, dollars, entry_type)
  select p_store, x ->> 'shiftId', (x ->> 'box')::smallint, (x ->> 'slot')::smallint, p.id, x ->> 'packKey',
    (x ->> 'start')::integer, (x ->> 'end')::integer, (x ->> 'tickets')::integer, (x ->> 'price')::numeric,
    (x ->> 'dollars')::numeric, x ->> 'type'
  from jsonb_array_elements(data -> 'shiftEntries') with ordinality as t(x, n)
  left join app.packs p on p.game_number = x ->> 'game' and p.pack_number = x ->> 'pack'
  order by n;

  insert into app.shipments (store_id, received_on, game_number, price, tickets_per_pack, packs, source, notes, performed_by)
  select p_store, (x ->> 'date')::date, x ->> 'game', (x ->> 'price')::numeric, (x ->> 'size')::integer,
    (x ->> 'packs')::integer, x ->> 'source', x ->> 'notes', x ->> 'performedBy'
  from jsonb_array_elements(data -> 'shipments') with ordinality as t(x, n) order by n;

  insert into app.stock_adjustments (store_id, adjusted_on, game_number, packs_removed, tickets_removed, reason, notes, performed_by)
  select p_store, (x ->> 'date')::date, x ->> 'game', (x ->> 'packs')::integer, (x ->> 'tickets')::integer, x ->> 'reason',
    x ->> 'notes', x ->> 'performedBy'
  from jsonb_array_elements(data -> 'adjustments') with ordinality as t(x, n) order by n;

  return jsonb_build_object('members', (select count(*) from app.store_members), 'slots', (select count(*) from app.slots),
    'games', (select count(*) from app.games), 'packs', (select count(*) from app.packs),
    'closeEntries', (select count(*) from app.close_entries), 'dailyCloses', (select count(*) from app.daily_closes),
    'shiftCloses', (select count(*) from app.shift_closes), 'shiftEntries', (select count(*) from app.shift_entries),
    'shipments', (select count(*) from app.shipments), 'adjustments', (select count(*) from app.stock_adjustments));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and pg_get_userbyid(p.proowner) = 'postgres'
      and p.proname in ('service_create_store', 'service_import_store')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.service_create_store(text, text), public.service_import_store(uuid, jsonb) to service_role;

revoke create on schema app, public from smart_scan_api;
