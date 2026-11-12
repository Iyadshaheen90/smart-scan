-- Shipment Received by pack number (owner 2026-11-11). The page scans one ticket from every pack; save_back_stock's
-- shipment lines may carry packNumbers (7 digits each, at most `packs` of them). Those packs go in the back by number
-- (app.packs in_back, with received_on and the shipment), any others are counted without one as before. The lottery
-- never sends the same pack number of a game twice, so a pack number the database already has, in the back, live in a
-- slot, or ended (sold out, returned, full pack sale, taken out), is refused with why, and nothing in the shipment is
-- saved (pack_used); the same pack twice in one shipment is refused too (pack_twice). Activation already takes a pack
-- from the back by its number. Sheets ignores packNumbers (it keeps counts only).
grant create on schema app, public to smart_scan_api;

create or replace function public.save_back_stock(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
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
        if used.id is not null then
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
        select app.current_store_id(), game, x, 'in_back', app.today(), shipment, m.username from jsonb_array_elements_text(nums) x;
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
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and pg_get_userbyid(p.proowner) = 'postgres' and p.proname = 'save_back_stock'
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.save_back_stock(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
