-- Edit Layout (owner 2026-11-14): new slots and a new box get a price per slot, picked the way the setup wizard does,
-- instead of one price for all of them.
-- add_slots req: { box, prices: [price, …] } (one price per new slot, in slot order). The earlier form
-- { box, count, price } (one price for all) still works. Either way the slots go at the end of the box, or make the
-- next box; all or nothing.
grant create on schema app, public to smart_scan_api;

create or replace function public.add_slots(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  box_no numeric := app.js_num(req -> 'box'); how_many numeric; list jsonb := req -> 'prices';
  boxes integer; in_box integer; ord text;
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  select coalesce(max(s.box), 0) into boxes from app.slots s;
  if not app.is_int(box_no) or box_no < 1 or box_no > boxes + 1 then
    perform app.fail('no_box', format('Pick a box from 1 to %s, or add box %s.', boxes, boxes + 1));
  end if;
  if box_no > 20 then perform app.fail('too_many_boxes', 'A store has at most 20 boxes.'); end if;
  if req ? 'prices' then
    if jsonb_typeof(list) is distinct from 'array' or jsonb_array_length(list) < 1 then
      perform app.fail('bad_count', 'Enter how many slots to add.');
    end if;
    how_many := jsonb_array_length(list);
  else
    how_many := app.js_num(req -> 'count');
    if not app.is_int(how_many) or how_many < 1 then perform app.fail('bad_count', 'Enter how many slots to add.'); end if;
    if app.js_num(req -> 'price') is null or not app.js_num(req -> 'price') = any (app.slot_prices()) then
      perform app.fail('bad_price', 'Pick the price of the new slots.');
    end if;
  end if;
  select coalesce(max(s.slot_number), 0) into in_box from app.slots s where s.box = box_no;
  if in_box + how_many > 100 then
    perform app.fail('too_many_slots', format('A box has at most 100 slots. Box %s has %s.', box_no, in_box));
  end if;
  if req ? 'prices' and exists (select 1 from jsonb_array_elements(list) as p(v)
      where jsonb_typeof(v) is distinct from 'number' or not (v #>> '{}')::numeric = any (app.slot_prices())) then
    perform app.fail('bad_price', 'Every new slot needs a price.');
  end if;
  select st.default_ticket_order into ord from app.stores st where st.id = p_store;
  if req ? 'prices' then
    insert into app.slots (store_id, box, slot_number, price, ticket_order)
      select p_store, box_no, in_box + sl.n, (sl.v #>> '{}')::numeric, ord
      from jsonb_array_elements(list) with ordinality as sl(v, n);
  else
    insert into app.slots (store_id, box, slot_number, price, ticket_order)
      select p_store, box_no, in_box + n, app.js_num(req -> 'price'), ord from generate_series(1, how_many::integer) n;
  end if;
  return jsonb_build_object('box', box_no, 'added', how_many, 'boxes', app.layout_json());
end $$;

revoke create on schema app, public from smart_scan_api;
