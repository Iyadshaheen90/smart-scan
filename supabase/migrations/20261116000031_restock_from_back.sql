-- Restock from the back (Pro; owner 2026-11-16; database only). An empty slot whose last game has packs in the back
-- can take the oldest one: restock_list says which slots and which pack, and activating a newer pack of the game asks
-- first (error not_oldest; notOldestOk goes ahead). Oldest = packs from the sheets (no pack number, counted before the
-- move) first, then by received day, then pack number; packs received the same day are equally old.
-- Pro features: subscriptions aren't built yet and sign-up is closed, so app.has_pro is true for every store for now.
-- The subscriptions build (smart-scan-subscriptions-design.md) makes it store_access() = 'pro'.
grant create on schema app, public to smart_scan_api;

create or replace function app.has_pro(feature text) returns boolean language sql stable set search_path = '' as $$
  select true
$$;

create or replace function app.require_pro(feature text) returns void language plpgsql stable set search_path = '' as $$
begin
  if not app.has_pro(feature) then perform app.fail('needs_pro', format('%s comes with Pro.', feature)); end if;
end $$;

-- The pack of a game to put out next, or null when none is in the back.
-- { unnumbered: true } (a pack from the sheets) or { packNumber, receivedOn: 'YYYY-MM-DD' | null, receivedText: 'Nov 3' }.
create or replace function app.oldest_in_back(game text, skip text[] default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select case
    when coalesce((select g.unnumbered_in_back from app.games g where g.game_number = game), 0) > 0
      then jsonb_build_object('unnumbered', true)
    else (select jsonb_build_object('packNumber', p.pack_number, 'receivedOn', app.date_label(p.received_on),
        'receivedText', to_char(p.received_on, 'FMMon FMDD'))
      from app.packs p where p.game_number = game and p.status = 'in_back' and not p.pack_number = any(skip)
      order by p.received_on asc nulls first, p.pack_number asc limit 1) end
$$;

-- The oldest pack of p's game when one in the back is older than p (p itself in the back), else null.
create or replace function app.older_in_back(p app.packs, skip text[] default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select case when coalesce((select g.unnumbered_in_back from app.games g where g.game_number = p.game_number), 0) > 0
      or exists (select 1 from app.packs o where o.game_number = p.game_number and o.status = 'in_back' and o.id <> p.id
        and not o.pack_number = any(skip)
        and coalesce(o.received_on, '-infinity'::date) < coalesce(p.received_on, '-infinity'::date))
    then app.oldest_in_back(p.game_number, skip) end
$$;

-- Ready to Restock: each empty slot whose last game (not ended) has packs in the back, with the pack to use.
-- req { box, slot } (the slot page): only that slot, also while it still has a pack (its game then), so the pack to
-- use can show the moment the old one sells out. [{ box, slot, gameNumber, packsInBack, oldest }]
create or replace function public.restock_list(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare one boolean := coalesce(req ->> 'box', '') <> '' and coalesce(req ->> 'slot', '') <> '';
begin
  perform app.enter_store(p_store, '{load_packs}');
  perform app.require_pro('Ready to Restock');
  return coalesce((select jsonb_agg(jsonb_build_object('box', x.box, 'slot', x.slot_number, 'gameNumber', x.game,
      'packsInBack', app.packs_in_back(x.game), 'oldest', app.oldest_in_back(x.game)) order by x.box, x.slot_number)
    from (select s.box, s.slot_number, coalesce(p.game_number, s.last_game_number) as game
      from app.slots s
      left join app.packs p on p.status = 'live' and p.box = s.box and p.slot_number = s.slot_number
      where case when one then s.box::text = app.js_text(req -> 'box') and s.slot_number::text = app.js_text(req -> 'slot')
        else p.id is null end) x
    join app.games g on g.game_number = x.game and g.ended_on is null
    where app.packs_in_back(x.game) > 0), '[]'::jsonb);
end $$;

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
  price_changed boolean; before integer; took boolean; back_id bigint; scanned app.packs; oldest jsonb;
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

  -- Restock from the back (Pro, owner 2026-11-16): the oldest pack of a game goes out first. A newer pack from the
  -- back asks once; notOldestOk says the person chose it anyway. Packs also going out on the same Activate Several
  -- list (goingOut: their pack numbers) don't count as left behind.
  select * into scanned from app.packs where game_number = game and pack_number = pack and status = 'in_back';
  if scanned.id is not null and app.has_pro('restock') and req -> 'notOldestOk' is distinct from 'true'::jsonb then
    oldest := app.older_in_back(scanned, coalesce(array(select jsonb_array_elements_text(
      case when jsonb_typeof(req -> 'goingOut') = 'array' then req -> 'goingOut' else '[]'::jsonb end)), '{}'));
    if oldest is not null then
      perform app.fail('not_oldest', case when oldest ? 'unnumbered'
        then format('Game %s has older packs in the back (from before pack numbers were kept). Use pack %s anyway?', game, key)
        else format('Pack %s isn''t the oldest: pack %s-%s %s. Use this one anyway?', key, game, oldest ->> 'packNumber',
          coalesce('came ' || (oldest ->> 'receivedText'), 'is older')) end);
    end if;
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

-- Test stores only (service key): packs may carry receivedOn, for the oldest-pack page test.
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
    price_before_activation, performed_by, received_on)
  select p_store, x ->> 'game', x ->> 'pack', x ->> 'status', (x ->> 'box')::smallint, (x ->> 'slot')::smallint,
    (x ->> 'price')::numeric, coalesce(x ->> 'order', 'descending'), (x ->> 'top')::integer,
    (x ->> 'activationTicket')::integer, (x ->> 'activatedOn')::date, (x ->> 'lastCloseOn')::date, (x ->> 'endedOn')::date,
    case when x ? 'endedOn' then ((x ->> 'endedOn')::date + time '12:00') at time zone 'UTC' end,
    x ->> 'endReason', (x ->> 'remainingAtEnd')::integer, (x ->> 'tookFromBack')::boolean, (x ->> 'priceBefore')::numeric,
    x ->> 'performedBy', (x ->> 'receivedOn')::date
  from jsonb_array_elements(coalesce(data -> 'packs', '[]')) with ordinality as t(x, n) order by n;
  insert into app.daily_closes (store_id, close_date, total_tickets, total_dollars, live_slot_count, inventory_value,
    close_id, closed_by, closed_at)
  select p_store, (x ->> 'date')::date, (x ->> 'tickets')::integer, (x ->> 'dollars')::numeric,
    (x ->> 'liveSlots')::integer, (x ->> 'inventory')::numeric, x ->> 'closeId', x ->> 'closedBy',
    (x ->> 'closedAt')::timestamp at time zone (select time_zone from app.stores where id = p_store)
  from jsonb_array_elements(coalesce(data -> 'closes', '[]')) x;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.has_pro', 'app.require_pro', 'app.oldest_in_back', 'app.older_in_back', 'public.restock_list',
      'public.activate_pack')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function app.has_pro(text), app.require_pro(text), app.oldest_in_back(text, text[]),
  app.older_in_back(app.packs, text[]) to smart_scan_api;
grant execute on function public.restock_list(uuid, jsonb), public.activate_pack(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
