-- Variables named like a column (price, close_id) can't be told apart inside UPDATE/WHERE: renamed.
create or replace function public.set_slot_price(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare new_price numeric := app.js_num(req -> 'price'); n integer;
begin
  perform app.enter_store(p_store, '{owner}');
  if not coalesce(new_price > 0, false) then perform app.fail('bad_price', 'Enter a price above $0.'); end if;
  perform app.lock_store();
  update app.slots s set price = new_price
    where s.box = app.js_num(req -> 'box') and s.slot_number = app.js_num(req -> 'slot');
  get diagnostics n = row_count;
  if n = 0 then
    perform app.fail('no_slot', format('There''s no slot %s in box %s.', app.js_text(req -> 'slot'), app.js_text(req -> 'box')));
  end if;
  return jsonb_build_object('box', app.js_num(req -> 'box'), 'slot', app.js_num(req -> 'slot'), 'slotPrice', new_price);
end $$;

create or replace function public.submit_close(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m app.store_members; entries jsonb := req -> 'entries'; new_close_id text := nullif(req ->> 'closeId', ''); sent app.daily_closes;
  today date; p app.packs; e jsonb; place text; t numeric; size integer; sold integer; extra jsonb; summary app.daily_closes;
  live_slots jsonb;
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
  summary.close_id := new_close_id;
  summary.closed_by := m.username;
  summary.closed_at := app.now_tz();
  insert into app.daily_closes select summary.*;
  return app.summary_json(summary, m.role = 'owner');
end $$;
