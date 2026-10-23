-- The slot and Close Day actions (Slots.js, Close.js): activatePack, endPack, undoActivation, undoEndPack, swapSlots,
-- setSlotPrice, setPackSize, setSlotOrder, setAllSlotsOrder, submitClose, reopenClose. Same checks in the same order,
-- same messages and answers as the Sheets code (test/parity checks them). Differences, all on purpose:
-- - Each call is one transaction: an error changes nothing (the Sheets code could leave a new game's row behind).
-- - Back stock by pack number: activating a pack takes that very pack out of the back when it's there by number,
--   else one of the game's unnumbered packs (from the sheets), else nothing (it was never scanned in).
-- - A pack ended in any month can't be activated again (the Sheets code only checked this month).
grant create on schema app, public to smart_scan_api;

-- A shift close remembers packs by key too, so a pack row removed by undoing a wrong activation doesn't take it along.
alter table app.shift_entries add column pack_key text;
alter table app.shift_entries drop constraint shift_entries_pack_id_fkey;
alter table app.shift_entries add constraint shift_entries_pack_id_fkey foreign key (pack_id) references app.packs on delete set null;

-- ---------- Helpers ----------

-- One write at a time per store (withLock): writes wait for each other instead of interleaving.
create or replace function app.lock_store() returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(app.current_store_id()::text, 0))
$$;

-- JavaScript's Number(x) for a request field: a number, a numeric string ('' and null are 0); null = NaN (missing or
-- not a number).
create or replace function app.js_num(v jsonb) returns numeric language sql immutable set search_path = '' as $$
  select case
    when v is null then null
    when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
    when jsonb_typeof(v) = 'null' then 0
    when jsonb_typeof(v) = 'boolean' then case when v = 'true'::jsonb then 1 else 0 end
    when jsonb_typeof(v) = 'string' then case
      when btrim(v #>> '{}') = '' then 0
      when btrim(v #>> '{}') ~ '^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$' then btrim(v #>> '{}')::numeric end
  end
$$;

create or replace function app.is_int(n numeric) returns boolean language sql immutable set search_path = '' as $$
  select n is not null and n = trunc(n)
$$;

-- How JavaScript prints a request field in a message (`${req.slot}`): the text as sent, 'undefined' when missing.
create or replace function app.js_text(v jsonb) returns text language sql immutable set search_path = '' as $$
  select case when v is null then 'undefined' when jsonb_typeof(v) = 'null' then 'null' else v #>> '{}' end
$$;

-- $20 not $20.00 (prices print as JavaScript numbers).
create or replace function app.money_text(n numeric) returns text language sql immutable set search_path = '' as $$
  select trim_scale(n)::text
$$;

create or replace function app.tickets_sold(ticket_order text, last integer, now integer) returns integer
language sql immutable set search_path = '' as $$
  select case when ticket_order = 'ascending' then now - last else last - now end
$$;

create or replace function app.already_sold(ticket_order text, last integer, ticket numeric) returns boolean
language sql immutable set search_path = '' as $$
  select case when ticket_order = 'ascending' then ticket < last else ticket > last end
$$;

create or replace function app.sold_side(ticket_order text) returns text language sql immutable set search_path = '' as $$
  select case when ticket_order = 'ascending' then 'below' else 'above' end
$$;

create or replace function app.can(m app.store_members, permission text) returns boolean language sql immutable set search_path = '' as $$
  select m.role = 'owner' or permission = any(m.permissions)
$$;

create or replace function app.require_permission(m app.store_members, permission text, message text) returns void
language plpgsql set search_path = '' as $$
begin
  if not app.can(m, permission) then perform app.fail('forbidden', message); end if;
end $$;

-- Sold out outside Close Day needs Load packs; Returned needs Return packs (owner: both).
create or replace function app.require_end_permission(m app.store_members, reason text) returns void
language plpgsql set search_path = '' as $$
begin
  if reason = 'returned' then
    perform app.require_permission(m, 'return_packs', 'The owner hasn''t turned on returning packs for you.');
  else
    perform app.require_permission(m, 'load_packs', 'Mark it sold out in Close Day. The owner hasn''t turned on loading packs for you.');
  end if;
end $$;

-- Sales logged outside Close Day belong to today, unless today is already closed: then to tomorrow's close.
create or replace function app.sales_date() returns date language sql stable set search_path = '' as $$
  select case when exists (select 1 from app.daily_closes d where d.close_date = app.today()) then app.today() + 1
    else app.today() end
$$;

create or replace function app.slot_of(req jsonb, box_field text default 'box', slot_field text default 'slot')
returns app.slots language sql stable set search_path = '' as $$
  select s.* from app.slots s where s.box = app.js_num(req -> box_field) and s.slot_number = app.js_num(req -> slot_field)
$$;

create or replace function app.live_in(b integer, s integer) returns app.packs language sql stable set search_path = '' as $$
  select p.* from app.packs p where p.status = 'live' and p.box = b and p.slot_number = s
$$;

create or replace function app.pack_key(p app.packs) returns text language sql immutable set search_path = '' as $$
  select p.game_number || '-' || p.pack_number
$$;

-- ---------- Ending a pack (endPackInSlot) ----------

-- Logs the pack's sales since the last close and ends it. Sold out: every remaining ticket sold. Returned: tickets
-- above the scanned top ticket sold, the rest go back to the lottery.
create or replace function app.end_pack_in_slot(m app.store_members, p app.packs, reason text, top jsonb)
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
  values (p.store_id, app.sales_date(), p.box, p.slot_number, p.id, p.top_ticket,
    case when reason = 'returned' then t::integer end, sold, p.price, sold * p.price, 0, reason, false, m.username,
    p.last_close_on, app.now_tz());
  update app.packs set status = reason, ended_on = app.today(), ended_at = clock_timestamp(), end_reason = reason,
    remaining_at_end = remaining, performed_by = m.username
  where id = p.id;
  update app.slots set last_game_number = p.game_number where box = p.box and slot_number = p.slot_number;
  return jsonb_build_object('packKey', app.pack_key(p), 'reason', reason, 'ticketsSoldToday', sold, 'remainingReturned', remaining);
end $$;

-- ---------- Activating (activatePack) ----------

-- A game seen for the first time: its price, and its pack size unless it's the standard one for that price.
create or replace function app.add_game(m app.store_members, game text, price_in jsonb, size_in jsonb) returns app.games
language plpgsql set search_path = '' as $$
declare price numeric := app.js_num(price_in); size numeric; g app.games;
begin
  size := case when size_in is null or jsonb_typeof(size_in) = 'null' or size_in = '""'::jsonb then app.standard_pack_size(price)
    else app.js_num(size_in) end;
  if not (app.can(m, 'load_packs') or app.can(m, 'receive_shipments') or app.can(m, 'count_stock')) then
    perform app.fail('unknown_game', format('Game %s isn''t in back stock yet. Ask the owner to activate this pack.', game));
  end if;
  if not coalesce(price > 0, false) or not app.is_int(size) or size <= 0 then
    perform app.fail('unknown_game', format('Game %s is new. Enter its ticket price and how many tickets are in a pack.', game));
  end if;
  insert into app.games (store_id, game_number, price, tickets_per_pack)
  values (app.current_store_id(), game, price, size::integer) returning * into g;
  return g;
end $$;

-- req: { box, slot, gameNumber, packNumber, ticketNumber, oldPackEnd?, oldPackTicket?, overridePrice?, gamePrice?, ticketsPerPack? }
create or replace function public.activate_pack(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
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
  if other.status = 'removed' then
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
  if back_id is not null then
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
end $$;

-- ---------- endPack / undoActivation / undoEndPack ----------

create or replace function public.end_pack(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; cfg app.slots; cur app.packs; reason text := req ->> 'reason';
begin
  m := app.enter_store(p_store, '{load_packs,return_packs}');
  perform app.lock_store();
  cfg := app.slot_of(req);
  cur := app.live_in(cfg.box, cfg.slot_number);
  if cur.id is null then perform app.fail('slot_empty', 'This slot has no pack.'); end if;
  if reason is null or reason not in ('sold_out', 'returned') then
    perform app.fail('bad_request', 'Say whether the pack sold out or was returned.');
  end if;
  perform app.require_end_permission(m, reason);
  return app.end_pack_in_slot(m, cur, reason, req -> 'ticketNumber');
end $$;

-- Takes back a pack activated into the wrong slot, until the slot's first close.
create or replace function public.undo_activation(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; cfg app.slots; cur app.packs; in_back integer; slot_price numeric;
begin
  m := app.enter_store(p_store, '{load_packs}');
  perform app.lock_store();
  cfg := app.slot_of(req);
  cur := app.live_in(cfg.box, cfg.slot_number);
  if cur.id is null then perform app.fail('slot_empty', 'This slot has no pack.'); end if;
  if cur.last_close_on is not null then
    perform app.fail('already_closed', format('Pack %s has been through a close, so it can''t be undone. Mark it sold out or returned instead.',
      app.pack_key(cur)));
  end if;
  in_back := app.packs_in_back(cur.game_number);
  if cur.took_from_back then
    -- Back in the back, now known by its number.
    in_back := in_back + 1;
    update app.packs set status = 'in_back', box = null, slot_number = null, activation_ticket = null, top_ticket = null,
      activated_on = null, price_before_activation = null, took_from_back = null
    where id = cur.id;
  else
    delete from app.packs where id = cur.id;
  end if;
  slot_price := coalesce(cur.price_before_activation, cfg.price);
  if cur.price_before_activation is not null then
    update app.slots set price = slot_price where box = cfg.box and slot_number = cfg.slot_number;
  end if;
  return jsonb_build_object('packKey', app.pack_key(cur), 'gameNumber', cur.game_number,
    'returnedToBack', coalesce(cur.took_from_back, false), 'packsInBack', in_back, 'slotPrice', slot_price);
end $$;

-- Puts back a pack marked sold out or returned by mistake today, while its sales day isn't closed.
create or replace function public.undo_end_pack(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; cfg app.slots; cur app.packs; ended app.packs; log app.close_entries; last_close date;
begin
  m := app.enter_store(p_store, '{load_packs,return_packs}');
  perform app.lock_store();
  cfg := app.slot_of(req);
  if cfg.box is null then
    perform app.fail('no_slot', format('There''s no slot %s in box %s.', app.js_text(req -> 'slot'), app.js_text(req -> 'box')));
  end if;
  cur := app.live_in(cfg.box, cfg.slot_number);
  if cur.id is not null then
    perform app.fail('slot_occupied', format('Pack %s is in this slot now. Undo that activation first.', app.pack_key(cur)));
  end if;
  select * into ended from app.packs where status in ('sold_out', 'returned') and box = cfg.box and slot_number = cfg.slot_number
    and ended_on = app.today() order by ended_at desc nulls first, id desc limit 1;
  if ended.id is null then perform app.fail('nothing_to_undo', 'No pack was marked sold out or returned in this slot today.'); end if;
  perform app.require_end_permission(m, ended.end_reason);
  select * into log from app.close_entries where pack_id = ended.id and close_type in ('sold_out', 'returned') order by id limit 1;
  if log.id is null then
    perform app.fail('nothing_to_undo', format('Can''t find the sales entry for pack %s.', app.pack_key(ended)));
  end if;
  if exists (select 1 from app.daily_closes where close_date = log.close_date) then
    perform app.fail('already_closed', 'That day''s close already counted this pack''s sales, so it can''t be undone.');
  end if;
  delete from app.close_entries where pack_id = ended.id and close_type in ('sold_out', 'returned');
  last_close := coalesce(log.previous_close_date,
    (select max(c.close_date) from app.close_entries c where c.pack_id = ended.id and c.close_type = 'close'));
  update app.packs set status = 'live', top_ticket = log.previous_ticket, last_close_on = last_close, ended_on = null,
    ended_at = null, end_reason = null, remaining_at_end = null
  where id = ended.id;
  return jsonb_build_object('packKey', app.pack_key(ended), 'reason', ended.end_reason, 'exposedTicket', log.previous_ticket);
end $$;

-- ---------- Rearranging and settings ----------

-- Owner: swaps everything in two slots (packs, price tiers, ticket order settings, last game). Either may be empty.
create or replace function public.swap_slots(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a app.slots; b app.slots; pa app.packs; pb app.packs;
begin
  perform app.enter_store(p_store, '{owner}');
  if app.js_num(req -> 'box') = app.js_num(req -> 'toBox') and app.js_num(req -> 'slot') = app.js_num(req -> 'toSlot') then
    perform app.fail('bad_request', 'Pick a different slot to swap with.');
  end if;
  perform app.lock_store();
  a := app.slot_of(req);
  b := app.slot_of(req, 'toBox', 'toSlot');
  if a.box is null or b.box is null then perform app.fail('no_slot', 'One of those slots doesn''t exist.'); end if;
  pa := app.live_in(a.box, a.slot_number);
  pb := app.live_in(b.box, b.slot_number);
  -- One live pack per slot is enforced at every row, so A's pack steps aside first.
  update app.packs set box = -1 where id = pa.id;
  update app.packs set box = a.box, slot_number = a.slot_number where id = pb.id;
  update app.packs set box = b.box, slot_number = b.slot_number where id = pa.id;
  update app.slots set price = b.price, ticket_order = b.ticket_order, last_game_number = b.last_game_number
    where box = a.box and slot_number = a.slot_number;
  update app.slots set price = a.price, ticket_order = a.ticket_order, last_game_number = a.last_game_number
    where box = b.box and slot_number = b.slot_number;
  return jsonb_build_object(
    'from', jsonb_build_object('box', a.box, 'slot', a.slot_number, 'packKey', case when pb.id is null then null else app.pack_key(pb) end),
    'to', jsonb_build_object('box', b.box, 'slot', b.slot_number, 'packKey', case when pa.id is null then null else app.pack_key(pa) end));
end $$;

create or replace function public.set_slot_price(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare price numeric := app.js_num(req -> 'price'); n integer;
begin
  perform app.enter_store(p_store, '{owner}');
  if not coalesce(price > 0, false) then perform app.fail('bad_price', 'Enter a price above $0.'); end if;
  perform app.lock_store();
  update app.slots s set price = set_slot_price.price
    where s.box = app.js_num(req -> 'box') and s.slot_number = app.js_num(req -> 'slot');
  get diagnostics n = row_count;
  if n = 0 then
    perform app.fail('no_slot', format('There''s no slot %s in box %s.', app.js_text(req -> 'slot'), app.js_text(req -> 'box')));
  end if;
  return jsonb_build_object('box', app.js_num(req -> 'box'), 'slot', app.js_num(req -> 'slot'), 'slotPrice', price);
end $$;

-- Owner: corrects a game's pack size; every live pack of the game must still fit.
create or replace function public.set_pack_size(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare game text := coalesce(req ->> 'gameNumber', ''); size numeric := app.js_num(req -> 'ticketsPerPack'); too_high app.packs;
begin
  perform app.enter_store(p_store, '{owner}');
  if not app.is_int(size) or size <= 0 or size > 1000 then perform app.fail('bad_size', 'Enter the number of tickets in a pack.'); end if;
  perform app.lock_store();
  if not exists (select 1 from app.games where game_number = game) then
    perform app.fail('unknown_game', format('Game %s isn''t set up yet.', game));
  end if;
  select * into too_high from app.packs where game_number = game and status = 'live' and top_ticket >= size order by box, slot_number limit 1;
  if too_high.id is not null then
    perform app.fail('bad_size', format('Pack %s is on ticket %s, so game %s packs have more than %s tickets.', app.pack_key(too_high),
      too_high.top_ticket, game, size));
  end if;
  update app.games set tickets_per_pack = size::integer where game_number = game;
  return jsonb_build_object('gameNumber', game, 'ticketsPerPack', size);
end $$;

-- Which way the next pack in this slot is sold; only while the slot is empty.
create or replace function public.set_slot_order(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; ord text := coalesce(req ->> 'order', ''); cfg app.slots; cur app.packs;
begin
  m := app.enter_store(p_store, '{ticket_order}');
  perform app.require_permission(m, 'ticket_order', 'The owner hasn''t turned on changing the ticket order for you.');
  if ord not in ('descending', 'ascending') then perform app.fail('bad_request', 'Choose descending or ascending.'); end if;
  perform app.lock_store();
  cfg := app.slot_of(req);
  cur := app.live_in(cfg.box, cfg.slot_number);
  if cur.id is not null then
    perform app.fail('slot_occupied', format('Pack %s is in this slot. Change the order when the slot is empty.', app.pack_key(cur)));
  end if;
  if cfg.box is null then
    perform app.fail('no_slot', format('There''s no slot %s in box %s.', app.js_text(req -> 'slot'), app.js_text(req -> 'box')));
  end if;
  update app.slots set ticket_order = ord where box = cfg.box and slot_number = cfg.slot_number;
  return jsonb_build_object('box', app.js_num(req -> 'box'), 'slot', app.js_num(req -> 'slot'), 'slotOrder', ord);
end $$;

-- Every slot at once: empty slots now, a slot with a pack from its next pack.
create or replace function public.set_all_slots_order(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; ord text := coalesce(req ->> 'order', ''); slots integer; waiting integer;
begin
  m := app.enter_store(p_store, '{ticket_order}');
  perform app.require_permission(m, 'ticket_order', 'The owner hasn''t turned on changing the ticket order for you.');
  if ord not in ('descending', 'ascending') then perform app.fail('bad_request', 'Choose descending or ascending.'); end if;
  perform app.lock_store();
  select count(*) into slots from app.slots;
  select count(*) into waiting from app.packs where status = 'live' and ticket_order <> ord;
  update app.slots set ticket_order = ord where store_id = app.current_store_id();
  return jsonb_build_object('order', ord, 'slots', slots, 'nowSlots', slots - waiting, 'waitingSlots', waiting);
end $$;

-- ---------- Close Day ----------

-- Today's totals (buildSummary): every sales line dated today; inventory = live packs' tickets left + back stock.
create or replace function app.build_summary(today date) returns app.daily_closes language sql stable set search_path = '' as $$
  select app.current_store_id(), today,
    coalesce((select sum(c.tickets_sold) from app.close_entries c where c.close_date = today), 0)::integer,
    coalesce((select sum(c.dollars) from app.close_entries c where c.close_date = today), 0),
    (select count(*) from app.packs p where p.status = 'live')::integer,
    coalesce((select sum(app.tickets_left(p.ticket_order, p.top_ticket,
      case when p.ticket_order = 'ascending' then app.pack_size(p.game_number, p.price) end) * p.price)
      from app.packs p where p.status = 'live'), 0)
    + coalesce((select sum(app.packs_in_back(g.game_number) * g.tickets_per_pack * g.price) from app.games g), 0),
    null::text, null::text, null::timestamptz
$$;

-- req: { entries: [{ box, slot, packKey, type: 'scan' | 'sold_out', ticketNumber? }], closeId?, date? }
create or replace function public.submit_close(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m app.store_members; entries jsonb := req -> 'entries'; close_id text := nullif(req ->> 'closeId', ''); sent app.daily_closes;
  today date; p app.packs; e jsonb; place text; t numeric; size integer; sold integer; extra jsonb; summary app.daily_closes;
  live_slots jsonb;
begin
  m := app.enter_store(p_store);
  if entries is null or jsonb_typeof(entries) <> 'array' then perform app.fail('bad_request', 'Nothing to submit.'); end if;
  perform app.lock_store();
  -- Sent again after a lost answer: the close it already saved.
  if close_id is not null then
    select * into sent from app.daily_closes d where d.close_id = submit_close.close_id;
    if sent.close_date is not null then return app.summary_json(sent, m.role = 'owner') || '{"alreadySent": true}'::jsonb; end if;
  end if;
  today := app.today();
  if coalesce(req ->> 'date', '') <> '' and req ->> 'date' <> app.date_label(today) then
    perform app.fail('wrong_day', format('This close was scanned on %s and couldn''t be sent that day, so it wasn''t saved. ', req ->> 'date')
      || 'Those sales will count in today''s close. Open Close Day and scan again.');
  end if;
  if exists (select 1 from app.daily_closes where close_date = today) then perform app.fail('already_closed', 'Today has already been closed.'); end if;

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
      perform app.end_pack_in_slot(m, p, 'sold_out', null);
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
    values (p.store_id, today, p.box, p.slot_number, p.id, p.top_ticket, t::integer, sold, p.price, sold * p.price,
      app.tickets_left(p.ticket_order, t::integer, size), 'close', coalesce(p.activated_on = today, false), m.username,
      p.last_close_on, app.now_tz());
    update app.packs set top_ticket = t::integer, last_close_on = today where id = p.id;
  end loop;
  select x into extra from jsonb_array_elements(entries) x
    where not exists (select 1 from jsonb_array_elements(live_slots) l
      where (l ->> 0)::numeric = app.js_num(x -> 'box') and (l ->> 1)::numeric = app.js_num(x -> 'slot'))
    limit 1;
  if extra is not null then
    perform app.fail('slots_changed', format('Box %s, slot %s has no pack now. Reload Close Day.', app.js_text(extra -> 'box'),
      app.js_text(extra -> 'slot')));
  end if;

  summary := app.build_summary(today);
  summary.close_id := close_id;
  summary.closed_by := m.username;
  summary.closed_at := app.now_tz();
  insert into app.daily_closes select summary.*;
  return app.summary_json(summary, m.role = 'owner');
end $$;

-- Owner: undoes today's close so it can be done again (every top ticket goes back; ended packs stay ended).
create or replace function public.reopen_close(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date; r app.close_entries; n integer := 0;
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  today := app.today();
  if not exists (select 1 from app.daily_closes where close_date = today) then perform app.fail('not_closed', 'Today hasn''t been closed.'); end if;
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

-- ---------- Ownership and who may call what ----------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.lock_store', 'app.js_num', 'app.is_int', 'app.js_text', 'app.money_text', 'app.tickets_sold', 'app.already_sold',
      'app.sold_side', 'app.can', 'app.require_permission', 'app.require_end_permission', 'app.sales_date', 'app.slot_of',
      'app.live_in', 'app.pack_key', 'app.end_pack_in_slot', 'app.add_game', 'app.build_summary', 'public.activate_pack',
      'public.end_pack', 'public.undo_activation', 'public.undo_end_pack', 'public.swap_slots', 'public.set_slot_price',
      'public.set_pack_size', 'public.set_slot_order', 'public.set_all_slots_order', 'public.submit_close', 'public.reopen_close')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on all functions in schema app to smart_scan_api;
grant execute on function public.activate_pack(uuid, jsonb), public.end_pack(uuid, jsonb), public.undo_activation(uuid, jsonb),
  public.undo_end_pack(uuid, jsonb), public.swap_slots(uuid, jsonb), public.set_slot_price(uuid, jsonb),
  public.set_pack_size(uuid, jsonb), public.set_slot_order(uuid, jsonb), public.set_all_slots_order(uuid, jsonb),
  public.submit_close(uuid, jsonb), public.reopen_close(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
