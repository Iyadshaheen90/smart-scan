-- Supabase refuses DELETE without WHERE (pg_safeupdate), even inside functions: the test store is emptied by name.
grant create on schema app, public to smart_scan_api;

create or replace function app.clear_test_store(p_store uuid) returns void language plpgsql set search_path = '' as $$
begin
  perform app.enter_test_store(p_store);
  delete from app.shift_entries where store_id = p_store;
  delete from app.shift_closes where store_id = p_store;
  delete from app.close_entries where store_id = p_store;
  delete from app.daily_closes where store_id = p_store;
  delete from app.packs where store_id = p_store;
  delete from app.shipments where store_id = p_store;
  delete from app.stock_adjustments where store_id = p_store;
  delete from app.slots where store_id = p_store;
  delete from app.games where store_id = p_store;
end $$;
alter function app.clear_test_store(uuid) owner to smart_scan_api;
revoke execute on function app.clear_test_store(uuid) from public, anon, authenticated;
grant execute on function app.clear_test_store(uuid) to smart_scan_api;

create or replace function public.test_seed(p_store uuid, data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_test_store(p_store);
  perform app.clear_test_store(p_store);
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
  perform app.clear_test_store(p_store);
  delete from app.store_members where store_id = p_store;
  delete from app.stores where id = p_store;
end $$;

revoke create on schema app, public from smart_scan_api;
