-- Back stock (Backstock.js) and full pack sales (FullPacks.js): listBackStock, saveBackStock, removeBackStock,
-- adjustBackStock, endGame, bringBackGame, sellFullPack, undoFullPackSale, listFullPackSales.
-- Same checks, messages and answers as the Sheets code (test/parity/back-stock.js). Back stock is still counted per game
-- here, as the pages send it: packs added go to the game's unnumbered packs; packs taken off come from the unnumbered
-- ones first, then numbered ones (newest received first, marked removed with the reason). The per-pack shipment
-- scan-in comes later and will add numbered packs instead.
-- On purpose: a full pack sale of a pack that isn't in the back (by number, or an unnumbered one) is refused, and
-- "this month" for the full pack list is the calendar month of the store's today.
grant create on schema app, public to smart_scan_api;

-- Every game, ended ones included, most expensive first (listBackStock). No $ for employees (withoutDollars).
create or replace function app.back_stock_json(is_owner boolean) returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.price desc, x.game_number), '[]'::jsonb) from (
    select g.price, g.game_number, jsonb_build_object(
      'gameNumber', g.game_number, 'price', g.price, 'ticketsPerPack', g.tickets_per_pack,
      'standardPackSize', app.standard_pack_size(g.price),
      'packsInBack', app.packs_in_back(g.game_number),
      'ticketsInBack', app.packs_in_back(g.game_number) * g.tickets_per_pack,
      'endedDate', app.date_label(g.ended_on),
      'liveSlots', (select count(*) from app.packs p where p.status = 'live' and p.game_number = g.game_number),
      'liveIn', coalesce((select jsonb_agg(jsonb_build_object('box', p.box, 'slot', p.slot_number) order by p.box, p.slot_number)
        from app.packs p where p.status = 'live' and p.game_number = g.game_number), '[]'::jsonb))
      || case when is_owner then jsonb_build_object('valueInBack', app.packs_in_back(g.game_number) * g.tickets_per_pack * g.price)
         else '{}'::jsonb end as j
    from app.games g) x
$$;

-- Takes n packs of a game out of the back: unnumbered first, then numbered ones (newest received first).
create or replace function app.take_from_back(game text, n integer, reason text) returns void
language plpgsql set search_path = '' as $$
declare loose integer := (select unnumbered_in_back from app.games where game_number = game); from_loose integer;
begin
  from_loose := least(n, loose);
  update app.games set unnumbered_in_back = unnumbered_in_back - from_loose where game_number = game;
  if n > from_loose then
    update app.packs set status = 'removed', removed_reason = reason, ended_on = app.today(), ended_at = clock_timestamp()
    where id in (select id from app.packs where game_number = game and status = 'in_back'
      order by received_on desc nulls last, id desc limit n - from_loose);
  end if;
end $$;

-- "is only 1 pack" / "are only 3 packs"
create or replace function app.only_packs(n integer) returns text language sql immutable set search_path = '' as $$
  select case when n = 1 then 'is only 1 pack' else format('are only %s packs', n) end
$$;

create or replace function public.list_back_stock(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members;
begin
  m := app.enter_store(p_store, '{receive_shipments,count_stock,full_pack_sale}');
  return app.back_stock_json(m.role = 'owner');
end $$;

-- req: { mode: 'shipment' | 'count', lines: [{ gameNumber, packs, gamePrice?, ticketsPerPack? }], notes? }
create or replace function public.save_back_stock(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m app.store_members; mode text := req ->> 'mode'; lines jsonb := req -> 'lines'; notes text := coalesce(req ->> 'notes', '');
  line jsonb; game text; packs numeric; price numeric; size numeric; seen text[] := '{}'; g app.games;
  before integer; after integer; numbered integer; results jsonb := '[]'::jsonb;
begin
  m := app.enter_store(p_store, '{receive_shipments,count_stock}');
  if mode is null or mode not in ('shipment', 'count') then perform app.fail('bad_request', 'Unknown back stock action.'); end if;
  if mode = 'shipment' then
    perform app.require_permission(m, 'receive_shipments', 'The owner hasn''t turned on receiving shipments for you.');
  else
    perform app.require_permission(m, 'count_stock', 'The owner hasn''t turned on Manage Stock for you.');
  end if;
  if lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then
    perform app.fail('bad_request', 'Scan at least one game.');
  end if;
  perform app.lock_store();
  -- Check every line before writing anything.
  for line in select x from jsonb_array_elements(lines) x loop
    game := coalesce(nullif(line ->> 'gameNumber', ''), '');
    if game !~ '^\d{4}$' then perform app.fail('bad_request', format('"%s" isn''t a game number.', game)); end if;
    if game = any(seen) then perform app.fail('bad_request', format('Game %s is listed twice.', game)); end if;
    seen := seen || game;
    packs := app.js_num(line -> 'packs');
    if not app.is_int(packs) or (mode = 'shipment' and packs <= 0) or packs < 0 or packs > 999 then
      perform app.fail('bad_count', format('Game %s: enter a number of packs%s.', game, case when mode = 'shipment' then ' above 0' else '' end));
    end if;
    if not exists (select 1 from app.games where game_number = game) then
      price := app.js_num(line -> 'gamePrice');
      if not coalesce(price > 0, false) then perform app.fail('unknown_game', format('Game %s is new. Enter its ticket price.', game)); end if;
      size := case when line -> 'ticketsPerPack' is null or jsonb_typeof(line -> 'ticketsPerPack') = 'null' or line -> 'ticketsPerPack' = '""'::jsonb
        then app.standard_pack_size(price) else app.js_num(line -> 'ticketsPerPack') end;
      if not app.is_int(size) or size <= 0 then
        perform app.fail('unknown_game', format('Game %s: enter how many tickets are in a pack.', game));
      end if;
    end if;
  end loop;

  for line in select x from jsonb_array_elements(lines) x loop
    game := line ->> 'gameNumber';
    packs := app.js_num(line -> 'packs');
    select * into g from app.games where game_number = game;
    if g.game_number is null then g := app.add_game(m, game, line -> 'gamePrice', line -> 'ticketsPerPack'); end if;
    -- Receiving or counting an ended game means it's back.
    update app.games set ended_on = null where game_number = game and ended_on is not null;
    before := app.packs_in_back(game);
    after := case when mode = 'shipment' then before + packs::integer else packs::integer end;
    if mode = 'shipment' then
      update app.games set unnumbered_in_back = unnumbered_in_back + packs::integer where game_number = game;
      insert into app.shipments (store_id, received_on, game_number, price, tickets_per_pack, packs, source, notes, performed_by)
      values (app.current_store_id(), app.today(), game, g.price, g.tickets_per_pack, packs::integer, 'delivery', notes, m.username);
    else
      numbered := (select count(*) from app.packs where game_number = game and status = 'in_back');
      if after >= numbered then
        update app.games set unnumbered_in_back = after - numbered where game_number = game;
      else
        update app.games set unnumbered_in_back = 0 where game_number = game;
        perform app.take_from_back(game, numbered - after, 'count');
      end if;
      if after <> before then
        insert into app.stock_adjustments (store_id, adjusted_on, game_number, packs_removed, tickets_removed, reason, notes, performed_by)
        values (app.current_store_id(), app.today(), game, before - after, (before - after) * g.tickets_per_pack, 'count', notes, m.username);
      end if;
    end if;
    results := results || jsonb_build_array(jsonb_build_object('gameNumber', game, 'before', before, 'after', after));
  end loop;
  return jsonb_build_object('results', results, 'backStock', app.back_stock_json(m.role = 'owner'));
end $$;

-- Owner: takes packs out of the back with a reason (returned, game expired, damaged, stolen, other).
create or replace function public.remove_back_stock(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m app.store_members; game text := coalesce(nullif(req ->> 'gameNumber', ''), ''); packs numeric := app.js_num(req -> 'packs');
  reason text := case when req ->> 'reason' = 'expired' then 'game expired' else req ->> 'reason' end; g app.games; before integer;
begin
  m := app.enter_store(p_store, '{owner}');
  if reason is null or reason not in ('returned', 'game expired', 'damaged', 'stolen', 'other') then
    perform app.fail('bad_request', 'Pick a reason: returned, game expired, damaged, stolen, other.');
  end if;
  if not app.is_int(packs) or packs <= 0 then perform app.fail('bad_count', 'Enter how many packs to remove.'); end if;
  perform app.lock_store();
  select * into g from app.games where game_number = game;
  if g.game_number is null then perform app.fail('unknown_game', format('Game %s isn''t in back stock.', game)); end if;
  before := app.packs_in_back(game);
  if packs > before then
    perform app.fail('bad_count', format('There %s of game %s in the back.', app.only_packs(before), game));
  end if;
  perform app.take_from_back(game, packs::integer, reason);
  insert into app.stock_adjustments (store_id, adjusted_on, game_number, packs_removed, tickets_removed, reason, notes, performed_by)
  values (app.current_store_id(), app.today(), game, packs::integer, packs::integer * g.tickets_per_pack, reason,
    coalesce(req ->> 'notes', ''), m.username);
  return app.back_stock_json(true);
end $$;

-- Owner: the Manage packs dialog, change = packs added (negative = taken off). More is a shipment ('add pack').
create or replace function public.adjust_back_stock(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m app.store_members; game text := coalesce(nullif(req ->> 'gameNumber', ''), ''); change numeric := app.js_num(req -> 'change');
  g app.games; before integer; after integer;
begin
  m := app.enter_store(p_store, '{owner}');
  if not app.is_int(change) or change = 0 or abs(change) > 999 then
    perform app.fail('bad_count', 'Nothing to save: the packs are unchanged.');
  end if;
  perform app.lock_store();
  select * into g from app.games where game_number = game;
  if g.game_number is null then perform app.fail('unknown_game', format('Game %s isn''t in back stock.', game)); end if;
  if g.ended_on is not null then perform app.fail('game_ended', format('Game %s is marked ended. Bring it back first.', game)); end if;
  before := app.packs_in_back(game);
  after := before + change::integer;
  if after < 0 then perform app.fail('bad_count', format('There %s of game %s in the back.', app.only_packs(before), game)); end if;
  if change > 0 then
    update app.games set unnumbered_in_back = unnumbered_in_back + change::integer where game_number = game;
    insert into app.shipments (store_id, received_on, game_number, price, tickets_per_pack, packs, source, notes, performed_by)
    values (app.current_store_id(), app.today(), game, g.price, g.tickets_per_pack, change::integer, 'add pack', '', m.username);
  else
    perform app.take_from_back(game, -change::integer, 'adjust');
    insert into app.stock_adjustments (store_id, adjusted_on, game_number, packs_removed, tickets_removed, reason, notes, performed_by)
    values (app.current_store_id(), app.today(), game, -change::integer, -change::integer * g.tickets_per_pack, 'adjust', '', m.username);
  end if;
  return jsonb_build_object('before', before, 'after', after, 'backStock', app.back_stock_json(true));
end $$;

-- Owner: hides a game CA Lottery stopped, once none is left in the back or a slot.
create or replace function public.end_game(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare game text := coalesce(nullif(req ->> 'gameNumber', ''), ''); g app.games; packs integer; places text;
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  select * into g from app.games where game_number = game;
  if g.game_number is null then perform app.fail('unknown_game', format('Game %s isn''t in back stock.', game)); end if;
  if g.ended_on is not null then perform app.fail('already_ended', format('Game %s is already marked ended.', game)); end if;
  packs := app.packs_in_back(game);
  if packs > 0 then
    perform app.fail('game_in_stock', format('There %s still %s pack%s of game %s in the back. Remove them first (e.g. returned).',
      case when packs = 1 then 'is' else 'are' end, packs, case when packs = 1 then '' else 's' end, game));
  end if;
  select string_agg(format('box %s, slot %s', box, slot_number), '; ' order by box, slot_number) into places
  from app.packs where status = 'live' and game_number = game;
  if places is not null then perform app.fail('game_in_slot', format('Game %s is still in %s. End that pack first.', game, places)); end if;
  update app.games set ended_on = app.today() where game_number = game;
  return app.back_stock_json(true);
end $$;

create or replace function public.bring_back_game(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare game text := coalesce(nullif(req ->> 'gameNumber', ''), '');
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  if not exists (select 1 from app.games where game_number = game and ended_on is not null) then
    perform app.fail('not_ended', format('Game %s isn''t marked ended.', game));
  end if;
  update app.games set ended_on = null where game_number = game;
  return app.back_stock_json(true);
end $$;

-- ---------- Full pack sales ----------

-- This month's full pack sales, newest first, with the count and $ total (owner).
create or replace function app.full_pack_sales_json() returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('count', count(*), 'dollars', coalesce(sum(c.dollars), 0),
    'sales', coalesce(jsonb_agg(jsonb_build_object('date', app.date_label(c.close_date), 'packKey', app.pack_key(p),
      'gameNumber', p.game_number, 'packNumber', p.pack_number, 'price', c.price, 'ticketsPerPack', c.tickets_sold,
      'dollars', c.dollars, 'soldBy', coalesce(c.performed_by, ''),
      'canUndo', not exists (select 1 from app.daily_closes d where d.close_date = c.close_date))
      order by c.close_date desc, c.id desc), '[]'::jsonb))
  from app.close_entries c join app.packs p on p.id = c.pack_id
  where c.close_type = 'full_pack' and c.close_date >= date_trunc('month', app.today())::date
    and c.close_date < (date_trunc('month', app.today()) + interval '1 month')::date
$$;

create or replace function public.list_full_pack_sales(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return app.full_pack_sales_json();
end $$;

-- A customer buys a whole sealed pack from the back: one pack off back stock, its sale in that day's totals.
create or replace function public.sell_full_pack(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m app.store_members; game text := coalesce(nullif(req ->> 'gameNumber', ''), ''); pack text := coalesce(nullif(req ->> 'packNumber', ''), '');
  key text; g app.games; before integer; other app.packs; sale_date date; pack_id bigint; result jsonb;
begin
  m := app.enter_store(p_store, '{full_pack_sale}');
  if game !~ '^\d{4}$' or pack !~ '^\d+$' then
    perform app.fail('bad_request', 'Scan a ticket from the pack (the game and pack number are needed).');
  end if;
  key := game || '-' || pack;
  perform app.lock_store();
  select * into g from app.games where game_number = game;
  if g.game_number is null then perform app.fail('unknown_game', format('Game %s isn''t in back stock. Receive the shipment first.', game)); end if;
  before := app.packs_in_back(game);
  if before < 1 then perform app.fail('none_in_back', format('There are no packs of game %s in the back. Receive the shipment first.', game)); end if;
  select * into other from app.packs where game_number = game and pack_number = pack;
  if other.status = 'live' then perform app.fail('pack_in_use', format('Pack %s is live in box %s, slot %s.', key, other.box, other.slot_number)); end if;
  if other.status in ('sold_out', 'returned', 'full_pack_sale', 'removed') then
    perform app.fail('pack_ended', format('Pack %s was already sold out, returned or sold as a full pack.', key));
  end if;
  if other.id is null and g.unnumbered_in_back < 1 then
    perform app.fail('not_in_back', format('Pack %s isn''t in the back. Scan it in with its shipment first.', key));
  end if;
  sale_date := app.sales_date();
  if other.id is null then
    update app.games set unnumbered_in_back = unnumbered_in_back - 1 where game_number = game;
    insert into app.packs (store_id, game_number, pack_number, status, price, activated_on, ended_on, ended_at, end_reason,
      remaining_at_end, performed_by)
    values (app.current_store_id(), game, pack, 'full_pack_sale', g.price, sale_date, sale_date, clock_timestamp(), 'full_pack_sale', 0, m.username)
    returning id into pack_id;
  else
    update app.packs set status = 'full_pack_sale', price = g.price, activated_on = sale_date, ended_on = sale_date,
      ended_at = clock_timestamp(), end_reason = 'full_pack_sale', remaining_at_end = 0, performed_by = m.username
    where id = other.id returning id into pack_id;
  end if;
  insert into app.close_entries (store_id, close_date, pack_id, previous_ticket, tickets_sold, price, dollars, remaining_after,
    close_type, late_activation, performed_by, logged_at)
  values (app.current_store_id(), sale_date, pack_id, g.tickets_per_pack - 1, g.tickets_per_pack, g.price,
    g.tickets_per_pack * g.price, 0, 'full_pack', false, m.username, app.now_tz());
  result := jsonb_build_object('packKey', key, 'gameNumber', game, 'packNumber', pack, 'date', app.date_label(sale_date),
    'price', g.price, 'ticketsPerPack', g.tickets_per_pack, 'before', before, 'after', before - 1,
    'backStock', app.back_stock_json(m.role = 'owner'));
  if m.role = 'owner' then result := result || jsonb_build_object('dollars', g.tickets_per_pack * g.price); end if;
  return result;
end $$;

-- Owner: puts a full pack sale back (the pack returns to the back) while its sales day isn't closed.
create or replace function public.undo_full_pack_sale(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare key text := coalesce(nullif(req ->> 'packKey', ''), ''); sale app.close_entries; p app.packs;
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  select c.* into sale from app.close_entries c join app.packs x on x.id = c.pack_id
  where c.close_type = 'full_pack' and app.pack_key(x) = key order by c.id limit 1;
  if sale.id is null then perform app.fail('nothing_to_undo', format('Pack %s wasn''t sold as a full pack this month.', key)); end if;
  if exists (select 1 from app.daily_closes where close_date = sale.close_date) then
    perform app.fail('already_closed', 'That day''s close already counted this sale, so it can''t be undone.');
  end if;
  delete from app.close_entries where id = sale.id;
  -- Back in the back, now known by its number.
  update app.packs set status = 'in_back', activated_on = null, ended_on = null, ended_at = null, end_reason = null,
    remaining_at_end = null where id = sale.pack_id returning * into p;
  return jsonb_build_object('packKey', key, 'after', app.packs_in_back(p.game_number), 'sales', app.full_pack_sales_json());
end $$;

-- ---------- Ownership and who may call what ----------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.back_stock_json', 'app.take_from_back', 'app.only_packs', 'app.full_pack_sales_json', 'public.list_back_stock',
      'public.save_back_stock', 'public.remove_back_stock', 'public.adjust_back_stock', 'public.end_game',
      'public.bring_back_game', 'public.list_full_pack_sales', 'public.sell_full_pack', 'public.undo_full_pack_sale')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on all functions in schema app to smart_scan_api;
grant execute on function public.list_back_stock(uuid, jsonb), public.save_back_stock(uuid, jsonb), public.remove_back_stock(uuid, jsonb),
  public.adjust_back_stock(uuid, jsonb), public.end_game(uuid, jsonb), public.bring_back_game(uuid, jsonb),
  public.list_full_pack_sales(uuid, jsonb), public.sell_full_pack(uuid, jsonb), public.undo_full_pack_sale(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
