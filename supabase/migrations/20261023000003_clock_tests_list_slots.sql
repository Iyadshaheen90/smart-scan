-- Phase 2 starts: the store's clock, test support, and the first ported action (listSlots → public.list_slots).
-- Every API function has the same shape as the Apps Script router: public.<action>(p_store uuid, req jsonb) returns the
-- same JSON as today (api.js turns listSlots into list_slots). The Sheets code (src/apps-script) is the answer key:
-- test/parity runs the same steps on both and compares every answer.

grant create on schema app, public to smart_scan_api;

-- ---------- The store's clock ----------

alter table app.stores add column is_test boolean not null default false;
-- Test stores only: a fixed store-local time instead of now(), so tests can use the same dates as the Sheets tests.
alter table app.stores add column test_now timestamp;
alter table app.stores add constraint test_now_only_for_tests check (test_now is null or is_test);
-- When a pack ended (newest last), for the slot's "ended today" line.
alter table app.packs add column ended_at timestamptz;

-- The store's local wall-clock time (its time zone; a test store's test_now).
create or replace function app.local_now() returns timestamp language sql stable set search_path = '' as $$
  select coalesce(s.test_now, now() at time zone s.time_zone) from app.stores s where s.id = app.current_store_id()
$$;

-- The store's business day (todayLabel): the local date, with a day that ends after midnight counted to the day before.
create or replace function app.today() returns date language sql stable set search_path = '' as $$
  select (app.local_now() - make_interval(hours => s.day_end_hour))::date from app.stores s where s.id = app.current_store_id()
$$;

-- A moment for timestamptz columns (closed_at, logged_at): the test clock in tests, else now().
create or replace function app.now_tz() returns timestamptz language sql stable set search_path = '' as $$
  select case when s.test_now is null then now() else s.test_now at time zone s.time_zone end
  from app.stores s where s.id = app.current_store_id()
$$;

create or replace function app.date_label(d date) returns text language sql immutable set search_path = '' as $$
  select to_char(d, 'YYYY-MM-DD')
$$;

-- ---------- Ticket math (Tickets.js; the pages keep their copy in api.js) ----------

-- Descending: top + 1 left. Ascending: size − top left (needs the pack size).
create or replace function app.tickets_left(ticket_order text, top integer, size integer) returns integer
language sql immutable set search_path = '' as $$
  select case when ticket_order = 'ascending' then size - top else top + 1 end
$$;

-- STANDARD_PACK_SIZES (Schema.js / barcode.js).
create or replace function app.standard_pack_size(price numeric) returns integer language sql immutable set search_path = '' as $$
  select case price when 40 then 30 when 30 then 30 when 20 then 30 when 10 then 50 when 5 then 80 when 3 then 100
    when 2 then 100 when 1 then 240 end
$$;

-- A game's pack size (packSizeFinder): its games row, else the standard size for the price.
create or replace function app.pack_size(game text, price numeric) returns integer language sql stable set search_path = '' as $$
  select coalesce((select g.tickets_per_pack from app.games g where g.game_number = game), app.standard_pack_size(price))
$$;

-- Sealed packs of a game in the back: numbered ones plus those from the sheets without numbers.
create or replace function app.packs_in_back(game text) returns integer language sql stable set search_path = '' as $$
  select (select count(*)::integer from app.packs p where p.game_number = game and p.status = 'in_back')
    + coalesce((select g.unnumbered_in_back from app.games g where g.game_number = game), 0)
$$;

-- ---------- listSlots ----------

-- One slot as listSlots gives it (Slots.js): its live pack, a pack ended today if it's empty, and the last game's back stock.
create or replace function app.slot_json(s app.slots, today date) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'box', s.box, 'slot', s.slot_number, 'slotPrice', s.price, 'slotOrder', s.ticket_order,
    'pack', case when p.id is null then null else jsonb_build_object(
      'gameNumber', p.game_number, 'packNumber', p.pack_number, 'price', p.price, 'exposedTicket', p.top_ticket,
      'remaining', app.tickets_left(p.ticket_order, p.top_ticket,
        case when p.ticket_order = 'ascending' then app.pack_size(p.game_number, p.price) end),
      'order', p.ticket_order,
      'activationDate', app.date_label(p.activated_on),
      'lastCloseDate', app.date_label(p.last_close_on),
      'daysActive', today - p.activated_on,
      'packsInBack', app.packs_in_back(p.game_number),
      'ticketsPerPack', g.tickets_per_pack,
      'standardPackSize', app.standard_pack_size(p.price)) end,
    'endedToday', case when p.id is null and e.id is not null
      then jsonb_build_object('packKey', e.game_number || '-' || e.pack_number, 'reason', e.end_reason) end,
    -- An empty slot most likely gets another pack of its last game; none for a game CA Lottery has ended.
    'lastGame', case when p.id is null and s.last_game_number is not null and lg.ended_on is null
      then jsonb_build_object('gameNumber', s.last_game_number, 'packsInBack', app.packs_in_back(s.last_game_number)) end)
  from (select 1) one
  left join app.packs p on p.status = 'live' and p.box = s.box and p.slot_number = s.slot_number
  left join app.games g on g.game_number = p.game_number
  left join lateral (select x.* from app.packs x where x.status in ('sold_out', 'returned') and x.ended_on = today
    and x.box = s.box and x.slot_number = s.slot_number order by x.ended_at desc nulls first, x.id desc limit 1) e on true
  left join app.games lg on lg.game_number = s.last_game_number
$$;

-- Everyone signed in (employees see Slots view-only).
create or replace function public.list_slots(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date;
begin
  perform app.enter_store(p_store);
  today := app.today();
  return coalesce((select jsonb_agg(app.slot_json(s, today) order by s.box, s.slot_number) from app.slots s), '[]'::jsonb);
end $$;

-- ---------- Test support (service role only, test stores only) ----------
-- The tests make a store, people and rows through these, over the API with the secret key, which never ships in the
-- app. Each refuses any store that isn't is_test, so they can't touch a real one.

create or replace function app.require_service_role() returns void language plpgsql set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    perform app.fail('forbidden', 'Test functions need the service role.');
  end if;
end $$;

-- Enters a test store (refuses a real one).
create or replace function app.enter_test_store(p_store uuid) returns void language plpgsql set search_path = '' as $$
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  if not exists (select 1 from app.stores where id = p_store and is_test) then perform app.fail('forbidden', 'Not a test store.'); end if;
end $$;

create or replace function public.test_create_store(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid := gen_random_uuid();
begin
  perform app.require_service_role();
  perform set_config('app.store_id', id::text, true);
  insert into app.stores (id, name, is_test) values (id, p_name, true);
  return id;
end $$;

-- users: [{ userId, username, role, permissions }]
create or replace function public.test_add_members(p_store uuid, users jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_test_store(p_store);
  insert into app.store_members (store_id, user_id, username, role, permissions)
  select p_store, (u ->> 'userId')::uuid, u ->> 'username', u ->> 'role',
    coalesce(array(select jsonb_array_elements_text(u -> 'permissions')), '{}')
  from jsonb_array_elements(users) u;
end $$;

-- The test clock: 'YYYY-MM-DD HH:MI:SS' store-local, or null for the real time.
create or replace function public.test_set_clock(p_store uuid, p_now text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_test_store(p_store);
  update app.stores set test_now = p_now::timestamp where id = p_store;
end $$;

-- Empties a test store and puts in the given rows (the same starting state the Sheets side gets):
-- { slots: [{ box, slot, price, order?, lastGame? }], games: [{ game, price, size, inBack?, endedOn? }],
--   packs: [{ game, pack, status, box?, slot?, price?, order?, top?, activationTicket?, activatedOn?, lastCloseOn?,
--             endedOn?, endReason?, remainingAtEnd?, tookFromBack?, priceBefore?, performedBy? }],
--   closes: [{ date, tickets, dollars, liveSlots, inventory, closeId?, closedBy?, closedAt? }] }
create or replace function public.test_seed(p_store uuid, data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_test_store(p_store);
  delete from app.shift_entries; delete from app.shift_closes; delete from app.close_entries; delete from app.daily_closes;
  delete from app.packs; delete from app.shipments; delete from app.stock_adjustments; delete from app.slots; delete from app.games;
  insert into app.slots (store_id, box, slot_number, price, ticket_order, last_game_number)
  select p_store, (x ->> 'box')::smallint, (x ->> 'slot')::smallint, (x ->> 'price')::numeric,
    coalesce(x ->> 'order', 'descending'), x ->> 'lastGame'
  from jsonb_array_elements(coalesce(data -> 'slots', '[]')) x;
  insert into app.games (store_id, game_number, price, tickets_per_pack, unnumbered_in_back, ended_on)
  select p_store, x ->> 'game', (x ->> 'price')::numeric, (x ->> 'size')::integer, coalesce((x ->> 'inBack')::integer, 0),
    (x ->> 'endedOn')::date
  from jsonb_array_elements(coalesce(data -> 'games', '[]')) x;
  insert into app.packs (store_id, game_number, pack_number, status, box, slot_number, price, ticket_order, top_ticket,
    activation_ticket, activated_on, last_close_on, ended_on, ended_at, end_reason, remaining_at_end, took_from_back,
    price_before_activation, performed_by)
  select p_store, x ->> 'game', x ->> 'pack', x ->> 'status', (x ->> 'box')::smallint, (x ->> 'slot')::smallint,
    (x ->> 'price')::numeric, coalesce(x ->> 'order', 'descending'), (x ->> 'top')::integer,
    (x ->> 'activationTicket')::integer, (x ->> 'activatedOn')::date, (x ->> 'lastCloseOn')::date, (x ->> 'endedOn')::date,
    case when x ? 'endedOn' then ((x ->> 'endedOn')::date + time '12:00') at time zone 'UTC' end,
    x ->> 'endReason', (x ->> 'remainingAtEnd')::integer, (x ->> 'tookFromBack')::boolean, (x ->> 'priceBefore')::numeric,
    x ->> 'performedBy'
  from jsonb_array_elements(coalesce(data -> 'packs', '[]')) with ordinality as t(x, n) order by n;
  insert into app.daily_closes (store_id, close_date, total_tickets, total_dollars, live_slot_count, inventory_value,
    close_id, closed_by, closed_at)
  select p_store, (x ->> 'date')::date, (x ->> 'tickets')::integer, (x ->> 'dollars')::numeric,
    (x ->> 'liveSlots')::integer, (x ->> 'inventory')::numeric, x ->> 'closeId', x ->> 'closedBy',
    (x ->> 'closedAt')::timestamp at time zone (select time_zone from app.stores where id = p_store)
  from jsonb_array_elements(coalesce(data -> 'closes', '[]')) x;
end $$;

create or replace function public.test_drop_store(p_store uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_test_store(p_store);
  delete from app.shift_entries; delete from app.shift_closes; delete from app.close_entries; delete from app.daily_closes;
  delete from app.packs; delete from app.shipments; delete from app.stock_adjustments; delete from app.slots; delete from app.games;
  delete from app.store_members; delete from app.stores where id = p_store;
end $$;

-- ---------- Ownership and who may call what ----------

do $$
declare f text;
begin
  foreach f in array array['app.local_now()', 'app.today()', 'app.now_tz()', 'app.date_label(date)',
    'app.tickets_left(text, integer, integer)', 'app.standard_pack_size(numeric)', 'app.pack_size(text, numeric)',
    'app.packs_in_back(text)', 'app.slot_json(app.slots, date)', 'app.require_service_role()', 'app.enter_test_store(uuid)',
    'public.list_slots(uuid, jsonb)', 'public.test_create_store(text)', 'public.test_add_members(uuid, jsonb)',
    'public.test_set_clock(uuid, text)', 'public.test_seed(uuid, jsonb)', 'public.test_drop_store(uuid)'] loop
    execute format('alter function %s owner to smart_scan_api', f);
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on all functions in schema app to smart_scan_api;
grant execute on function public.list_slots(uuid, jsonb) to authenticated;
grant execute on function public.test_create_store(text), public.test_add_members(uuid, jsonb),
  public.test_set_clock(uuid, text), public.test_seed(uuid, jsonb), public.test_drop_store(uuid) to service_role;

revoke create on schema app, public from smart_scan_api;
