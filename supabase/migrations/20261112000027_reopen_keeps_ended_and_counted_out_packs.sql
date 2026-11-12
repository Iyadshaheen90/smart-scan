-- Two fixes from the 2026-11-12 database review (docs/db-review-2026-11.md).
--
-- 1. Reopening a close lost the sales of a pack that ended after it. reopen_close deleted every close line of the day,
--    but a pack that was sold out, returned or replaced after the close isn't live any more: its top ticket wasn't put
--    back and its ending line (dated the next day) starts from the closed ticket, so the day's sales were in no close.
--    Now only packs still in a slot go back; an ended pack keeps its close line, which counts again when the day is
--    closed again (the summary adds every line since the last close). Lines are undone newest first, so a pack with two
--    close lines that day ends on its earliest ticket. Sheets (Close.js reopenClose) got the same fix.
--
-- 2. A count or Manage Packs − only knows how many packs, so the database picks which numbered packs to take out
--    (removed, reason count / adjust). Such a pack could never be used again, even when it is really on the shelf (a
--    miscount, or a different pack was the one missing): no way back. Now scanning it proves it's there: it can be
--    activated, sold as a full pack, or received again, like a pack the database doesn't know. Packs taken out as
--    returned, damaged, stolen, game expired or other stay refused.
grant create on schema app, public to smart_scan_api;

-- Counted out, not known gone: the pack may still be on the shelf.
create or replace function app.counted_out(p app.packs) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p.status = 'removed' and p.removed_reason in ('count', 'adjust'), false)
$$;
alter function app.counted_out(app.packs) owner to smart_scan_api;
revoke execute on function app.counted_out(app.packs) from public, anon, authenticated;
grant execute on function app.counted_out(app.packs) to smart_scan_api;

CREATE OR REPLACE FUNCTION public.reopen_close(p_store uuid, req jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  for r in with gone as (
      delete from app.close_entries c where c.close_type = 'close' and c.close_date = today
        and exists (select 1 from app.packs p where p.id = c.pack_id and p.status = 'live')
      returning c.*)
    select * from gone order by id desc
  loop
    n := n + 1;
    update app.packs set top_ticket = r.previous_ticket,
      last_close_on = coalesce(r.previous_close_date,
        (select max(c.close_date) from app.close_entries c where c.pack_id = r.pack_id and c.close_type = 'close'))
    where id = r.pack_id and status = 'live';
  end loop;
  delete from app.daily_closes where close_date = today;
  return jsonb_build_object('reopened', app.date_label(today), 'slotsRestored', n);
end $function$;

CREATE OR REPLACE FUNCTION public.activate_pack(p_store uuid, req jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m app.store_members; cfg app.slots; cur app.packs; other app.packs; g app.games;
  game text := coalesce(req ->> 'gameNumber', ''); pack text := coalesce(req ->> 'packNumber', '');
  t numeric := app.js_num(req -> 'ticketNumber'); key text; old jsonb := null; reason text;
  price_changed boolean; before integer; took boolean; back_id bigint;
begin
  m := app.enter_store(p_store, '{load_packs}');
  if game !~ '^\d{4}$' or pack !~ '^\d{7}$' or not app.is_int(t) or t < 0 or t > 999 then
    perform app.fail('bad_ticket', 'That doesn''t look like a ticket number.');
  end if;
  perform app.lock_store();
  cfg := app.slot_of(req);
  if cfg.box is null then
    perform app.fail('no_slot', format('There''s no slot %s in box %s.', app.js_text(req -> 'slot'), app.js_text(req -> 'box')));
  end if;
  cur := app.live_in(cfg.box, cfg.slot_number);
  key := game || '-' || pack;
  select * into other from app.packs where game_number = game and pack_number = pack;
  if other.status = 'live' then
    perform app.fail('pack_in_use', format('Pack %s is already live in box %s, slot %s.', key, other.box, other.slot_number));
  end if;
  if other.status in ('sold_out', 'returned', 'full_pack_sale') then
    perform app.fail('pack_ended', format('Pack %s was already sold out or returned.', key));
  end if;
  if other.status = 'removed' and not app.counted_out(other) then
    perform app.fail('pack_ended', format('Pack %s was taken out of back stock (%s).', key, other.removed_reason));
  end if;

  select * into g from app.games where game_number = game;
  if g.game_number is null then g := app.add_game(m, game, req -> 'gamePrice', req -> 'ticketsPerPack'); end if;
  if t >= g.tickets_per_pack then
    perform app.fail('bad_ticket', format('Ticket %s can''t be in a %s-ticket pack (they''re numbered %s).', t, g.tickets_per_pack,
      case when cfg.ticket_order = 'ascending' then format('000 to %s', g.tickets_per_pack - 1)
        else format('%s down to 000', g.tickets_per_pack - 1) end));
  end if;

  price_changed := g.price <> cfg.price;
  if price_changed then
    if not app.can(m, 'load_packs') then
      perform app.fail('price_mismatch', format('Game %s is $%s, but this is a $%s slot. Ask the owner.', game,
        app.money_text(g.price), app.money_text(cfg.price)));
    end if;
    if req -> 'overridePrice' is distinct from 'true'::jsonb then
      perform app.fail('price_mismatch', format('Game %s is $%s, but this is a $%s slot. Confirm to change the slot to $%s.', game,
        app.money_text(g.price), app.money_text(cfg.price), app.money_text(g.price)));
    end if;
    update app.slots set price = g.price where box = cfg.box and slot_number = cfg.slot_number;
  end if;

  if cur.id is not null then
    reason := req ->> 'oldPackEnd';
    if reason is null or reason not in ('sold_out', 'returned') then
      perform app.fail('slot_occupied', format('This slot still has pack %s. Was it sold out or returned?', app.pack_key(cur)));
    end if;
    perform app.require_end_permission(m, reason);
    old := app.end_pack_in_slot(m, cur, reason, req -> 'oldPackTicket');
  end if;

  before := app.packs_in_back(game);
  select id into back_id from app.packs where game_number = game and pack_number = pack and status = 'in_back';
  took := back_id is not null or g.unnumbered_in_back > 0;
  if back_id is null and g.unnumbered_in_back > 0 then
    update app.games set unnumbered_in_back = unnumbered_in_back - 1 where game_number = game;
  end if;
  -- A pack of an ended game going into a slot means the game is back.
  update app.games set ended_on = null where game_number = game and ended_on is not null;
  if back_id is null and other.id is not null then
    -- Counted out earlier, and here it is: the same row goes live, like a pack the database didn't know.
    update app.packs set status = 'live', box = cfg.box, slot_number = cfg.slot_number, ticket_order = cfg.ticket_order,
      price = g.price, activation_ticket = t, top_ticket = t, activated_on = app.today(), last_close_on = null,
      price_before_activation = case when price_changed then cfg.price end, took_from_back = took, performed_by = m.username,
      removed_reason = null, ended_on = null, ended_at = null
    where id = other.id;
  elsif back_id is not null then
    update app.packs set status = 'live', box = cfg.box, slot_number = cfg.slot_number, ticket_order = cfg.ticket_order,
      price = g.price, activation_ticket = t, top_ticket = t, activated_on = app.today(), last_close_on = null,
      price_before_activation = case when price_changed then cfg.price end, took_from_back = true, performed_by = m.username
    where id = back_id;
  else
    insert into app.packs (store_id, game_number, pack_number, status, box, slot_number, ticket_order, price, activation_ticket,
      top_ticket, activated_on, price_before_activation, took_from_back, performed_by)
    values (app.current_store_id(), game, pack, 'live', cfg.box, cfg.slot_number, cfg.ticket_order, g.price, t, t, app.today(),
      case when price_changed then cfg.price end, took, m.username);
  end if;
  return jsonb_build_object('box', app.js_num(req -> 'box'), 'slot', app.js_num(req -> 'slot'), 'packKey', key,
    'packsInBack', app.packs_in_back(game), 'backWasEmpty', before <= 0, 'oldPack', old);
end $function$;

CREATE OR REPLACE FUNCTION public.sell_full_pack(p_store uuid, req jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if other.status in ('sold_out', 'returned', 'full_pack_sale') or (other.status = 'removed' and not app.counted_out(other)) then
    perform app.fail('pack_ended', format('Pack %s was already sold out, returned or sold as a full pack.', key));
  end if;
  if (other.id is null or app.counted_out(other)) and g.unnumbered_in_back < 1 then
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
    -- Counted out earlier, and here it is: it comes off the packs counted without a number, like an unknown pack.
    if app.counted_out(other) then
      update app.games set unnumbered_in_back = unnumbered_in_back - 1 where game_number = game;
    end if;
    update app.packs set status = 'full_pack_sale', price = g.price, activated_on = sale_date, ended_on = sale_date,
      ended_at = clock_timestamp(), end_reason = 'full_pack_sale', remaining_at_end = 0, performed_by = m.username,
      removed_reason = null
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
end $function$;

CREATE OR REPLACE FUNCTION public.save_back_stock(p_store uuid, req jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m app.store_members; mode text := req ->> 'mode'; lines jsonb := req -> 'lines'; notes text := coalesce(req ->> 'notes', '');
  line jsonb; game text; packs numeric; price numeric; size numeric; seen text[] := '{}'; g app.games;
  before integer; after integer; numbered integer; results jsonb := '[]'::jsonb;
  nums jsonb; num text; seen_packs text[]; used app.packs; shipment bigint; numbered_now integer;
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
    -- Shipment: the pack numbers scanned (one ticket from each pack). Each pack number of a game exists once, ever:
    -- one the database already has (in the back, live, or ended) is refused, so nothing is saved.
    nums := line -> 'packNumbers';
    if mode = 'shipment' and nums is not null and jsonb_typeof(nums) <> 'null' then
      if jsonb_typeof(nums) <> 'array' or jsonb_array_length(nums) > packs then
        perform app.fail('bad_request', format('Game %s: the pack numbers don''t match the packs.', game));
      end if;
      seen_packs := '{}';
      for num in select x from jsonb_array_elements_text(nums) x loop
        if num !~ '^\d{7}$' then perform app.fail('bad_request', format('"%s" isn''t a pack number.', num)); end if;
        if num = any(seen_packs) then perform app.fail('pack_twice', format('Pack %s-%s is on the list twice.', game, num)); end if;
        seen_packs := seen_packs || num;
        select * into used from app.packs where game_number = game and pack_number = num;
        if used.id is not null and not app.counted_out(used) then
          perform app.fail('pack_used', format('Pack %s-%s %s', game, num, case used.status
            when 'in_back' then 'is already in the back' || coalesce(' (received ' || app.date_label(used.received_on) || ').', '.')
            when 'live' then format('is live in box %s, slot %s.', used.box, used.slot_number)
            when 'sold_out' then 'already sold out' || coalesce(' on ' || app.date_label(used.ended_on), '') || '.'
            when 'returned' then 'was returned' || coalesce(' on ' || app.date_label(used.ended_on), '') || '.'
            when 'full_pack_sale' then 'was sold as a full pack' || coalesce(' on ' || app.date_label(used.ended_on), '') || '.'
            else 'was taken out of back stock' || coalesce(' on ' || app.date_label(used.ended_on), '')
              || coalesce(' (' || used.removed_reason || ')', '') || '.' end));
        end if;
      end loop;
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
      insert into app.shipments (store_id, received_on, game_number, price, tickets_per_pack, packs, source, notes, performed_by)
      values (app.current_store_id(), app.today(), game, g.price, g.tickets_per_pack, packs::integer, 'delivery', notes, m.username)
      returning id into shipment;
      -- Scanned packs go in by number; any more (a typed game number) are counted without one.
      nums := line -> 'packNumbers';
      numbered_now := 0;
      if nums is not null and jsonb_typeof(nums) = 'array' then
        insert into app.packs (store_id, game_number, pack_number, status, received_on, shipment_id, performed_by)
        select app.current_store_id(), game, x, 'in_back', app.today(), shipment, m.username from jsonb_array_elements_text(nums) x
        -- Only a pack counted out earlier can be here already (every other one was refused above): it's back.
        on conflict (store_id, game_number, pack_number) do update set status = 'in_back', removed_reason = null,
          ended_on = null, ended_at = null, received_on = excluded.received_on, shipment_id = excluded.shipment_id,
          performed_by = excluded.performed_by;
        numbered_now := jsonb_array_length(nums);
      end if;
      update app.games set unnumbered_in_back = unnumbered_in_back + packs::integer - numbered_now where game_number = game;
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
end $function$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and pg_get_userbyid(p.proowner) = 'postgres'
      and p.proname in ('reopen_close', 'activate_pack', 'sell_full_pack', 'save_back_stock')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

revoke create on schema app, public from smart_scan_api;
