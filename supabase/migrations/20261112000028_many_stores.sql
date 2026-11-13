-- Many stores (design: smart-scan-multi-store-design.md, owner's decisions 2026-11-12). Database side of build steps
-- 1 and 2:
-- - Review finding 3: a person in two stores no longer sees their own row from the other store inside a store.
-- - Activate Several's cap is the store's slot count, not 48.
-- - my_stores adds each store's Store ID.
-- - create_store: any signed-in account sets up its own store (the setup wizard), all or nothing.
-- - store_settings / set_store_settings: time zone, day-end hour, ticket order for new slots.
-- - Layout: add_slots, remove_slot, remove_box. Boxes and slots are never renumbered.
-- Route 66 Liquor is untouched: it is already a store row with 2 boxes of 24 slots.
grant create on schema app, public to smart_scan_api;

-- ---------- Review finding 3: one person in two stores ----------

-- The two "before a store is entered" policies now apply only then. Inside a store, only the entered store's rows
-- show, so a query that forgets the store filter can't see the caller's membership (or store) elsewhere.
drop policy own_rows on app.store_members;
create policy own_rows on app.store_members for select to smart_scan_api
  using (user_id = app.uid() and app.current_store_id() is null);
drop policy my_stores on app.stores;
create policy my_stores on app.stores for select to smart_scan_api
  using (app.current_store_id() is null
    and exists (select 1 from app.store_members m where m.store_id = stores.id and m.user_id = app.uid() and m.active));

-- enter_store therefore leaves any store entered earlier in the same transaction before it looks the caller up
-- (each request is its own transaction; the database tests make several calls in one).
create or replace function app.enter_store(p_store uuid, allowed text[] default null)
returns app.store_members language plpgsql security definer set search_path = '' as $$
declare m app.store_members;
begin
  if app.uid() is null then perform app.fail('unauthorized', 'Your session has ended. Please sign in again.'); end if;
  perform set_config('app.store_id', '', true);
  select * into m from app.store_members where store_id = p_store and user_id = app.uid();
  if not found then perform app.fail('forbidden', 'You don''t have access to this store.'); end if;
  if not m.active then perform app.fail('unauthorized', 'This account is no longer active.'); end if;
  if allowed is not null and m.role <> 'owner' then
    if allowed = array['owner'] then perform app.fail('forbidden', 'Only the owner can do that.'); end if;
    if not (m.permissions && allowed) then perform app.fail('forbidden', 'The owner hasn''t turned this on for you.'); end if;
  end if;
  perform set_config('app.store_id', p_store::text, true);
  return m;
end $$;

-- And the member queries name the store themselves (belt and braces).
create or replace function app.users_json() returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('username', m.username, 'role', m.role, 'active', m.active,
      'permissions', to_jsonb(case when m.role = 'owner' then app.all_permissions()
        else array(select p from unnest(app.all_permissions()) p where p = any (m.permissions)) end),
      'createdDate', to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'email', m.email, 'signedIn', m.signed_in_at is not null) order by m.seq), '[]'::jsonb)
  from app.store_members m where m.store_id = app.current_store_id()
$$;

create or replace function public.set_user_permissions(p_store uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who text := app.norm_username(req -> 'username'); m app.store_members;
begin
  perform app.enter_store(p_store, '{owner}');
  if jsonb_typeof(req -> 'permissions') is distinct from 'array' or exists (select 1 from jsonb_array_elements(req -> 'permissions') p
      where jsonb_typeof(p) <> 'string' or not (p #>> '{}') = any (app.all_permissions())) then
    perform app.fail('bad_request', 'Unknown permission.');
  end if;
  perform app.lock_store();
  select * into m from app.store_members x where x.store_id = app.current_store_id() and lower(x.username) = who;
  if not found then perform app.fail('no_user', 'No such user.'); end if;
  if m.role = 'owner' then perform app.fail('bad_request', 'The owner can already do everything.'); end if;
  update app.store_members set permissions = array(select p from unnest(app.all_permissions()) p
      where to_jsonb(p) <@ (req -> 'permissions'))
    where store_id = app.current_store_id() and user_id = m.user_id;
  return app.users_json();
end $$;

create or replace function public.member_admin_check(p_store uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who text := app.norm_username(req -> 'username'); new_email text; m app.store_members;
  test_store boolean;
begin
  perform app.enter_store(p_store, '{owner}');
  select s.is_test into test_store from app.stores s where s.id = p_store;
  if req ->> 'action' = 'invite' then
    if who !~ '^[a-z0-9._-]{3,30}$' then
      perform app.fail('bad_username', 'Username must be 3-30 characters: letters, numbers, dot, dash or underscore.');
    end if;
    new_email := lower(btrim(coalesce(req ->> 'email', '')));
    if new_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform app.fail('bad_email', 'Enter the employee''s email address.'); end if;
    if exists (select 1 from app.store_members x where x.store_id = p_store and lower(x.username) = who) then
      perform app.fail('user_exists', format('The username "%s" is already taken.', who));
    end if;
    select * into m from app.store_members x where x.store_id = p_store and lower(x.email) = new_email;
    if found then perform app.fail('email_exists', format('That email is already on the list (%s).', m.username)); end if;
    return jsonb_build_object('username', who, 'email', new_email, 'isTest', test_store);
  elsif req ->> 'action' = 'setPassword' then
    select * into m from app.store_members x where x.store_id = p_store and lower(x.username) = who;
    if not found then perform app.fail('no_user', 'No such user.'); end if;
    return jsonb_build_object('userId', m.user_id, 'username', m.username, 'isTest', test_store);
  elsif req ->> 'action' = 'resendInvite' then
    select * into m from app.store_members x where x.store_id = p_store and lower(x.username) = who;
    if not found then perform app.fail('no_user', 'No such user.'); end if;
    if not m.active then perform app.fail('inactive', format('%s is deactivated. Reactivate them first.', m.username)); end if;
    if m.signed_in_at is not null then
      perform app.fail('already_signed_in', format('%s has already signed in. Use Reset Password if they forgot it.', m.username));
    end if;
    if m.email is null then perform app.fail('no_email', format('%s has no email on file.', m.username)); end if;
    return jsonb_build_object('userId', m.user_id, 'username', m.username, 'email', m.email, 'isTest', test_store);
  end if;
  perform app.fail('bad_request', 'Unknown request.');
end $$;

-- The stores the signed-in person can use (with each store's Store ID and hours, so the phone knows the store's
-- business day); also marks them signed in on each.
-- The list of stores to mark is read before any store is entered (the own-rows policy only applies then).
create or replace function public.my_stores() returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uuid; to_mark uuid[]; answer jsonb;
begin
  if app.uid() is null then perform app.fail('unauthorized', 'Your session has ended. Please sign in again.'); end if;
  perform set_config('app.store_id', '', true);
  select coalesce(jsonb_agg(jsonb_build_object('storeId', st.id, 'storeName', st.name, 'storeNumber', st.store_number,
      'username', m.username, 'role', m.role, 'permissions', to_jsonb(m.permissions),
      'timeZone', st.time_zone, 'dayEndHour', st.day_end_hour) order by st.name, st.store_number), '[]'::jsonb)
    into answer
    from app.store_members m join app.stores st on st.id = m.store_id
    where m.user_id = app.uid() and m.active;
  select array_agg(m.store_id) into to_mark from app.store_members m
    where m.user_id = app.uid() and m.active and m.signed_in_at is null;
  foreach s in array coalesce(to_mark, '{}') loop
    perform set_config('app.store_id', s::text, true);
    update app.store_members set signed_in_at = now() where store_id = s and user_id = app.uid();
  end loop;
  perform set_config('app.store_id', '', true);
  return answer;
end $$;

-- ---------- Activate Several: at most as many packs as the store has slots ----------

create or replace function public.activate_several(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  list jsonb := req -> 'packs'; check_only boolean := coalesce((req -> 'check') = 'true'::jsonb, false);
  answers jsonb := '[]'; r jsonb; failed boolean := false; msg text; code text;
  this_pack text; this_slot text; packs_seen text[] := '{}'; slots_seen text[] := '{}'; slot_count integer;
begin
  perform app.enter_store(p_store, '{load_packs}');
  if jsonb_typeof(list) is distinct from 'array' or jsonb_array_length(list) = 0 then
    perform app.fail('bad_request', 'Scan at least one pack.');
  end if;
  select count(*) into slot_count from app.slots;
  if jsonb_array_length(list) > slot_count then
    perform app.fail('bad_request', format('That''s more packs than there are slots. Activate at most %s at once.', slot_count));
  end if;
  perform app.lock_store();
  begin
    for r in select x from jsonb_array_elements(list) as t(x) loop
      -- Each row in its own sub-transaction: a refused row leaves nothing behind (e.g. the old pack it ended).
      begin
        if jsonb_typeof(r) is distinct from 'object' then perform app.fail('bad_request', 'That isn''t a pack.'); end if;
        this_pack := coalesce(r ->> 'gameNumber', '') || '-' || coalesce(r ->> 'packNumber', '');
        if this_pack = any(packs_seen) then
          perform app.fail('pack_twice', format('Pack %s is on the list twice. Remove one.', this_pack));
        end if;
        packs_seen := packs_seen || this_pack;
        if coalesce(r ->> 'box', '') = '' or coalesce(r ->> 'slot', '') = '' then
          perform app.fail('pick_slot', 'Pick a slot for this pack.');
        end if;
        this_slot := app.js_text(r -> 'box') || '-' || app.js_text(r -> 'slot');
        if this_slot = any(slots_seen) then
          perform app.fail('slot_twice', format('Box %s, slot %s is picked for another pack on the list too. Pick a different slot.',
            app.js_text(r -> 'box'), app.js_text(r -> 'slot')));
        end if;
        slots_seen := slots_seen || this_slot;
        answers := answers || jsonb_build_array(jsonb_build_object('ok', true) || public.activate_pack(p_store, r));
      exception when sqlstate 'P0001' then
        get stacked diagnostics msg = message_text, code = pg_exception_hint;
        -- Only the app's own refusals (they carry a code) belong on a row; anything else is a real error.
        if coalesce(code, '') = '' then raise; end if;
        failed := true;
        answers := answers || jsonb_build_array(jsonb_build_object('ok', false, 'code', code, 'message', msg));
      end;
    end loop;
    -- A check, or a list with a refused row: throw away everything the good rows did.
    if check_only or failed then raise exception using errcode = 'SS001', message = 'not saved'; end if;
  exception when sqlstate 'SS001' then
    null;
  end;
  return jsonb_build_object('saved', not (check_only or failed), 'rows', answers);
end $$;

-- ---------- Shared checks ----------

-- The store's name, address and phone as set_store_info checks them; answers the cleaned values.
create or replace function app.store_info_checked(req jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_name text := btrim(coalesce(req ->> 'name', ''));
  v_street text := btrim(coalesce(req ->> 'street', ''));
  v_city text := btrim(coalesce(req ->> 'city', ''));
  v_state text := upper(btrim(coalesce(req ->> 'state', '')));
  v_zip text := btrim(coalesce(req ->> 'zip', ''));
  v_phone text := regexp_replace(coalesce(req ->> 'phone', ''), '\D', '', 'g');
begin
  if v_name = '' or length(v_name) > 60 then perform app.fail('bad_store_name', 'Enter the store name (up to 60 letters).'); end if;
  if v_street = '' or length(v_street) > 100 then perform app.fail('bad_street', 'Enter the street address.'); end if;
  if v_city = '' or length(v_city) > 60 then perform app.fail('bad_city', 'Enter the city.'); end if;
  if v_state !~ '^[A-Z]{2}$' then perform app.fail('bad_state', 'Enter the state as 2 letters, like CA.'); end if;
  if v_zip !~ '^\d{5}$' then perform app.fail('bad_zip', 'Enter the 5-digit ZIP code.'); end if;
  if length(v_phone) = 11 and left(v_phone, 1) = '1' then v_phone := substr(v_phone, 2); end if;
  if v_phone !~ '^\d{10}$' then perform app.fail('bad_phone', 'Enter the store phone with its area code (10 digits).'); end if;
  return jsonb_build_object('name', v_name, 'street', v_street, 'city', v_city, 'state', v_state, 'zip', v_zip, 'phone', v_phone);
end $$;

create or replace function public.set_store_info(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; s app.stores;
begin
  perform app.enter_store(p_store, '{owner}');
  v := app.store_info_checked(req);
  update app.stores set name = v ->> 'name', street = v ->> 'street', city = v ->> 'city', state = v ->> 'state',
      zip = v ->> 'zip', phone = v ->> 'phone'
    where id = p_store returning * into s;
  return app.store_info_json(s);
end $$;

-- The states whose tickets the app can read (the wizard's list). California only for now.
create or replace function app.supported_states() returns text[] language sql immutable set search_path = '' as $$
  select array['CA']
$$;

-- The prices a slot can be set up with (the standard pack sizes are known for these).
create or replace function app.slot_prices() returns numeric[] language sql immutable set search_path = '' as $$
  select array[1, 2, 3, 5, 10, 20, 30, 40]::numeric[]
$$;

-- Time zone, day-end hour and ticket order, as the wizard and Store Settings send them; answers the cleaned values.
create or replace function app.store_hours_checked(req jsonb) returns jsonb language plpgsql stable set search_path = '' as $$
declare tz text := btrim(coalesce(req ->> 'timeZone', '')); hour numeric; ord text := coalesce(req ->> 'ticketOrder', '');
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = tz) then
    perform app.fail('bad_time_zone', 'Pick the store''s time zone.');
  end if;
  if jsonb_typeof(req -> 'dayEndHour') is distinct from 'number' then
    perform app.fail('bad_day_end', 'Pick when the business day ends: midnight, or an hour up to 12 noon.');
  end if;
  hour := (req ->> 'dayEndHour')::numeric;
  if hour <> trunc(hour) or hour < 0 or hour > 12 then
    perform app.fail('bad_day_end', 'Pick when the business day ends: midnight, or an hour up to 12 noon.');
  end if;
  if ord not in ('descending', 'ascending') then
    perform app.fail('bad_order', 'Pick the ticket order: descending or ascending.');
  end if;
  return jsonb_build_object('timeZone', tz, 'dayEndHour', hour, 'ticketOrder', ord);
end $$;

-- The entered store's boxes: [{ box, slots, live }] in box order.
create or replace function app.layout_json() returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('box', b.box, 'slots', b.slots, 'live', b.live) order by b.box), '[]'::jsonb)
  from (select s.box, count(*) as slots,
      count(*) filter (where exists (select 1 from app.packs p where p.status = 'live' and p.box = s.box
        and p.slot_number = s.slot_number)) as live
    from app.slots s where s.store_id = app.current_store_id() group by s.box) b
$$;

create or replace function app.store_settings_json() returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('timeZone', s.time_zone, 'dayEndHour', s.day_end_hour, 'ticketOrder', s.default_ticket_order,
    'lotteryState', s.lottery_state, 'today', app.date_label(app.today()), 'boxes', app.layout_json(),
    'maxBoxes', 20, 'maxSlots', 100, 'prices', to_jsonb(app.slot_prices()))
  from app.stores s where s.id = app.current_store_id()
$$;

-- ---------- create_store: the setup wizard's one call ----------

-- req: { name, street, city, state, zip, phone, username, lotteryState, timeZone, dayEndHour, ticketOrder,
--        boxes: [[price, price, …], …] (one list of slot prices per box, in slot order), retailerNumber? }
-- Any signed-in account. Everything is checked first; then the store, the caller as its owner, every slot and
-- (if given) the retailer number are saved together, or nothing is. Answers the store as my_stores lists it.
-- Limits: 3 stores set up per account per day, 10 stores owned per account.
create or replace function public.create_store(req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := app.uid(); my_email text; info jsonb; hours jsonb; who text := app.norm_username(req -> 'username');
  lottery text := upper(btrim(coalesce(req ->> 'lotteryState', ''))); boxes jsonb := req -> 'boxes';
  retailer text; new_id uuid := gen_random_uuid(); s app.stores; b jsonb; box_no integer := 0; made_today integer; owned integer;
begin
  if me is null then perform app.fail('unauthorized', 'Your session has ended. Please sign in again.'); end if;
  perform set_config('app.store_id', '', true);
  my_email := lower(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email');

  info := app.store_info_checked(req);
  if who !~ '^[a-z0-9._-]{3,30}$' then
    perform app.fail('bad_username', 'Username must be 3-30 characters: letters, numbers, dot, dash or underscore.');
  end if;
  if not lottery = any (app.supported_states()) then
    perform app.fail('bad_lottery_state', 'Smart Scan doesn''t read that state''s tickets yet.');
  end if;
  hours := app.store_hours_checked(req);
  if jsonb_typeof(boxes) is distinct from 'array' or jsonb_array_length(boxes) < 1 or jsonb_array_length(boxes) > 20 then
    perform app.fail('bad_layout', 'A store has 1 to 20 boxes.');
  end if;
  for b in select x from jsonb_array_elements(boxes) as t(x) loop
    box_no := box_no + 1;
    if jsonb_typeof(b) is distinct from 'array' or jsonb_array_length(b) < 1 or jsonb_array_length(b) > 100 then
      perform app.fail('bad_layout', format('Box %s needs 1 to 100 slots.', box_no));
    end if;
    if exists (select 1 from jsonb_array_elements(b) as p(v)
        where jsonb_typeof(v) is distinct from 'number' or not (v #>> '{}')::numeric = any (app.slot_prices())) then
      perform app.fail('bad_price', format('Every slot in box %s needs a price.', box_no));
    end if;
  end loop;
  if req ? 'retailerNumber' and coalesce(req ->> 'retailerNumber', '') <> '' then
    retailer := regexp_replace(req ->> 'retailerNumber', '[\s-]', '', 'g');
    if retailer !~ '^[0-9]{4,12}$' then
      perform app.fail('bad_retailer_number', 'Enter the retailer number: digits only, as on your lottery terminal.');
    end if;
  end if;

  -- One at a time per account, so two taps can't both pass the limits.
  perform pg_advisory_xact_lock(hashtextextended('create_store:' || me::text, 0));
  select count(*), count(*) filter (where st.created_at > now() - interval '1 day') into owned, made_today
    from app.store_members m join app.stores st on st.id = m.store_id
    where m.user_id = me and m.role = 'owner' and m.active;
  if made_today >= 3 then
    perform app.fail('too_many_stores', 'You''ve set up 3 stores today. Try again tomorrow.');
  end if;
  if owned >= 10 then
    perform app.fail('too_many_stores', 'An account can own up to 10 stores. Report a Problem if you need more.');
  end if;

  perform set_config('app.store_id', new_id::text, true);
  insert into app.stores (id, name, street, city, state, zip, phone, lottery_state, time_zone, day_end_hour, default_ticket_order)
    values (new_id, info ->> 'name', info ->> 'street', info ->> 'city', info ->> 'state', info ->> 'zip', info ->> 'phone',
      lottery, hours ->> 'timeZone', (hours ->> 'dayEndHour')::smallint, hours ->> 'ticketOrder')
    returning * into s;
  insert into app.store_members (store_id, user_id, username, role, email, signed_in_at)
    values (new_id, me, who, 'owner', my_email, now());
  insert into app.slots (store_id, box, slot_number, price, ticket_order)
    select new_id, bx.n, sl.n, (sl.v #>> '{}')::numeric, hours ->> 'ticketOrder'
    from jsonb_array_elements(boxes) with ordinality as bx(v, n), jsonb_array_elements(bx.v) with ordinality as sl(v, n);
  if retailer is not null then perform app.save_retailer_number(retailer); end if;
  return jsonb_build_object('storeId', s.id, 'storeName', s.name, 'storeNumber', s.store_number, 'username', who,
    'role', 'owner', 'permissions', '[]'::jsonb, 'timeZone', s.time_zone, 'dayEndHour', s.day_end_hour);
end $$;

-- ---------- Store Settings (owner) ----------

create or replace function public.store_settings(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return app.store_settings_json();
end $$;

-- req: { timeZone, dayEndHour, ticketOrder }. The ticket order is for slots added later (each slot's own order is
-- changed on the slot, or for all at once, as before). Moving the day's end or the time zone moves sales between
-- days, so it's refused once today has a close or a shift close, and when it would land on a day already closed.
create or replace function public.set_store_settings(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare hours jsonb; s app.stores; moved boolean;
begin
  perform app.enter_store(p_store, '{owner}');
  hours := app.store_hours_checked(req);
  perform app.lock_store();
  select * into s from app.stores where id = p_store;
  moved := s.time_zone <> hours ->> 'timeZone' or s.day_end_hour <> (hours ->> 'dayEndHour')::smallint;
  if moved and (exists (select 1 from app.daily_closes d where d.close_date >= app.today())
      or exists (select 1 from app.shift_closes c where c.shift_date >= app.today())) then
    perform app.fail('day_started', 'Today already has a close. Change the hours tomorrow, before the first close.');
  end if;
  update app.stores set time_zone = hours ->> 'timeZone', day_end_hour = (hours ->> 'dayEndHour')::smallint,
      default_ticket_order = hours ->> 'ticketOrder'
    where id = p_store;
  -- With the new hours "today" may be another day: not one that's already closed.
  if moved and (exists (select 1 from app.daily_closes d where d.close_date >= app.today())
      or exists (select 1 from app.shift_closes c where c.shift_date >= app.today())) then
    perform app.fail('day_started', 'With those hours, today would be a day that''s already closed. Change the hours tomorrow, before the first close.');
  end if;
  return app.store_settings_json();
end $$;

-- ---------- Layout (owner) ----------

-- req: { box, count, price }: more slots at the end of a box, or a new box (the next box number).
create or replace function public.add_slots(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  box_no numeric := app.js_num(req -> 'box'); how_many numeric := app.js_num(req -> 'count'); new_price numeric := app.js_num(req -> 'price');
  boxes integer; in_box integer; ord text;
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  select coalesce(max(s.box), 0) into boxes from app.slots s;
  if not app.is_int(box_no) or box_no < 1 or box_no > boxes + 1 then
    perform app.fail('no_box', format('Pick a box from 1 to %s, or add box %s.', boxes, boxes + 1));
  end if;
  if box_no > 20 then perform app.fail('too_many_boxes', 'A store has at most 20 boxes.'); end if;
  if not app.is_int(how_many) or how_many < 1 then perform app.fail('bad_count', 'Enter how many slots to add.'); end if;
  select coalesce(max(s.slot_number), 0) into in_box from app.slots s where s.box = box_no;
  if in_box + how_many > 100 then
    perform app.fail('too_many_slots', format('A box has at most 100 slots. Box %s has %s.', box_no, in_box));
  end if;
  if new_price is null or not new_price = any (app.slot_prices()) then
    perform app.fail('bad_price', 'Pick the price of the new slots.');
  end if;
  select st.default_ticket_order into ord from app.stores st where st.id = p_store;
  insert into app.slots (store_id, box, slot_number, price, ticket_order)
    select p_store, box_no, in_box + n, new_price, ord from generate_series(1, how_many::integer) n;
  return jsonb_build_object('box', box_no, 'added', how_many, 'boxes', app.layout_json());
end $$;

-- Takes the last slot off a box (or off every box from the end: remove_box). Only an empty slot, never the store's
-- last one. Past sales keep their box and slot numbers.
create or replace function app.remove_last_slots(box_no numeric, how_many integer) returns void
language plpgsql set search_path = '' as $$
declare in_box integer; live app.packs;
begin
  select max(s.slot_number) into in_box from app.slots s where s.box = box_no;
  select p.* into live from app.packs p where p.status = 'live' and p.box = box_no and p.slot_number > in_box - how_many
    order by p.slot_number limit 1;
  if found then
    perform app.fail('slot_occupied', format('Box %s, slot %s still has pack %s. Mark it sold out or returned first.',
      box_no, live.slot_number, app.pack_key(live)));
  end if;
  if (select count(*) from app.slots s) <= how_many then
    perform app.fail('last_slot', 'A store needs at least one slot.');
  end if;
  delete from app.slots s where s.store_id = app.current_store_id() and s.box = box_no and s.slot_number > in_box - how_many;
end $$;

-- req: { box, slot }: only the last slot of its box.
create or replace function public.remove_slot(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cfg app.slots; in_box integer;
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  cfg := app.slot_of(req);
  if cfg.box is null then
    perform app.fail('no_slot', format('There''s no slot %s in box %s.', app.js_text(req -> 'slot'), app.js_text(req -> 'box')));
  end if;
  select max(s.slot_number) into in_box from app.slots s where s.box = cfg.box;
  if cfg.slot_number <> in_box then
    perform app.fail('not_last_slot', format('Only the last slot of a box can be removed (box %s, slot %s). Slots are never renumbered.',
      cfg.box, in_box));
  end if;
  perform app.remove_last_slots(cfg.box, 1);
  return jsonb_build_object('box', cfg.box, 'slot', cfg.slot_number, 'boxes', app.layout_json());
end $$;

-- req: { box }: only the last box, with every slot empty.
create or replace function public.remove_box(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare box_no numeric := app.js_num(req -> 'box'); boxes integer; in_box integer;
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  select max(s.box) into boxes from app.slots s;
  select count(*) into in_box from app.slots s where s.box = box_no;
  if in_box = 0 then perform app.fail('no_box', format('There''s no box %s.', app.js_text(req -> 'box'))); end if;
  if box_no <> boxes then
    perform app.fail('not_last_box', format('Only the last box can be removed (box %s). Boxes are never renumbered.', boxes));
  end if;
  perform app.remove_last_slots(box_no, in_box);
  return jsonb_build_object('box', box_no, 'boxes', app.layout_json());
end $$;

-- ---------- Tests: a store made by create_store becomes a test store ----------

-- The page tests set up a store through the wizard, then hand it over here so test_drop_store can remove it.
-- Service key only; refuses a store older than an hour or with anyone whose email isn't a test address
-- (@test.invalid can't be a real mailbox), so a real store can never be marked.
create or replace function public.test_claim_store(p_store uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  if not exists (select 1 from app.stores s where s.id = p_store and s.created_at > now() - interval '1 hour')
      or not exists (select 1 from app.store_members m where m.store_id = p_store)
      or exists (select 1 from app.store_members m where m.store_id = p_store and coalesce(m.email, '') not like '%@test.invalid') then
    perform app.fail('forbidden', 'Not a store made by a test.');
  end if;
  update app.stores set is_test = true where id = p_store;
end $$;

-- ---------- Owners and grants ----------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.store_info_checked', 'app.supported_states', 'app.slot_prices', 'app.store_hours_checked', 'app.layout_json',
      'app.store_settings_json', 'app.remove_last_slots', 'public.create_store', 'public.store_settings',
      'public.set_store_settings', 'public.add_slots', 'public.remove_slot', 'public.remove_box', 'public.test_claim_store')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function app.store_info_checked(jsonb), app.supported_states(), app.slot_prices(), app.store_hours_checked(jsonb),
  app.layout_json(), app.store_settings_json(), app.remove_last_slots(numeric, integer) to smart_scan_api;
grant execute on function public.create_store(jsonb), public.store_settings(uuid, jsonb), public.set_store_settings(uuid, jsonb),
  public.add_slots(uuid, jsonb), public.remove_slot(uuid, jsonb), public.remove_box(uuid, jsonb) to authenticated;
revoke execute on function public.test_claim_store(uuid) from service_role;
grant execute on function public.test_claim_store(uuid) to service_role;

revoke create on schema app, public from smart_scan_api;
