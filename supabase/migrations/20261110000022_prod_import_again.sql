-- The real import into production (owner 2026-11-10: invites wait until the owner says so). The store is imported once
-- now for the side-by-side checks and again after the Nov 30 close with the final November data, so:
-- - service_clear_store empties a store's sales, packs and back stock for that second import, and keeps the store row
--   (name, Store Info, Store ID), its people (accounts, permissions, who has signed in), the retailer number (vault) and
--   problem reports. Service key only, and only when given the store's exact name (a typo can't empty the wrong store).
-- - service_import_store takes a store that already has its people: each person is updated from the sheets (username,
--   role, permissions, on/off, email) and keeps when they first signed in; anyone new is added. It still refuses a store
--   that has any sales, packs or back stock rows, so nothing is ever imported twice on top of itself.

grant create on schema app, public to smart_scan_api;

create or replace function public.service_clear_store(p_store uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare store_name text; cleared jsonb;
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  select name into store_name from app.stores where id = p_store;
  if store_name is null then perform app.fail('no_store', 'No such store.'); end if;
  if p_confirm_name is distinct from store_name then
    perform app.fail('bad_request', 'The store name doesn''t match; nothing was cleared.');
  end if;
  cleared := jsonb_build_object('packs', (select count(*) from app.packs), 'closeEntries', (select count(*) from app.close_entries),
    'dailyCloses', (select count(*) from app.daily_closes), 'shiftCloses', (select count(*) from app.shift_closes));
  -- The same order as app.clear_test_store (lines before what they point at).
  delete from app.shift_entries where store_id = p_store;
  delete from app.shift_closes where store_id = p_store;
  delete from app.close_entries where store_id = p_store;
  delete from app.daily_closes where store_id = p_store;
  delete from app.packs where store_id = p_store;
  delete from app.shipments where store_id = p_store;
  delete from app.stock_adjustments where store_id = p_store;
  delete from app.slots where store_id = p_store;
  delete from app.games where store_id = p_store;
  return cleared;
end $$;

-- data: as in migration 0017. Only the people step and the "empty store" check change.
create or replace function public.service_import_store(p_store uuid, data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tz text;
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  select time_zone into tz from app.stores where id = p_store;
  if tz is null then perform app.fail('no_store', 'No such store.'); end if;
  if exists (select 1 from app.slots) or exists (select 1 from app.games) or exists (select 1 from app.daily_closes)
    or exists (select 1 from app.packs) or exists (select 1 from app.close_entries) or exists (select 1 from app.shift_closes)
    or exists (select 1 from app.shipments) or exists (select 1 from app.stock_adjustments) then
    perform app.fail('not_empty', 'This store already has data; the import only fills an empty store.');
  end if;

  -- People: new ones in the sheets' order; ones already here take the sheets' details and keep signed_in_at and created_at.
  insert into app.store_members (store_id, user_id, username, role, permissions, active, email, created_at)
  select p_store, (x ->> 'userId')::uuid, x ->> 'username', x ->> 'role',
    coalesce(array(select jsonb_array_elements_text(x -> 'permissions')), '{}'), (x ->> 'active')::boolean,
    x ->> 'email', coalesce(((x ->> 'createdOn')::date)::timestamp at time zone tz, now())
  from jsonb_array_elements(data -> 'members') with ordinality as t(x, n) order by n
  on conflict (store_id, user_id) do update set username = excluded.username, role = excluded.role,
    permissions = excluded.permissions, active = excluded.active, email = excluded.email;

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
      and p.proname in ('service_clear_store', 'service_import_store')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
  end loop;
end $$;
revoke execute on function public.service_clear_store(uuid, text), public.service_import_store(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.service_clear_store(uuid, text), public.service_import_store(uuid, jsonb) to service_role;

revoke create on schema app, public from smart_scan_api;
