-- Many stores, build steps 4 and 5 (design: smart-scan-multi-store-design.md, owner's decisions 2026-11-12):
-- - Inviting an email that already has a Smart Scan account adds it to the store (the members Edge Function then
--   sends a plain "you were added" email instead of an invite).
-- - Reset Password: an owner types a password only for an account whose only store is theirs; for anyone in more
--   stores the function emails that person a reset link instead.
-- - leave_store: an employee takes themselves off a store.
-- - delete_store: the owner deletes the store and everything in it, after typing its name.
-- - account_delete_check: what stands in the way of deleting an account (it still owns a store).
-- Route 66 Liquor is untouched: nothing here changes a store's rows unless its own people ask.
grant create on schema app, public to smart_scan_api;

-- ---------- An account, as the members Edge Function needs to know it ----------

-- req: { email } or { userId } -> { userId, email, stores } (stores: how many stores the account is on, active or
-- not; userId null when there is no such account). Service key only. Owned by postgres: auth.users is postgres's,
-- and the count is across stores (row security would hide the other stores' rows).
create or replace function public.service_account_info(req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare found_id uuid; found_email text; store_count integer;
begin
  perform app.require_service_role();
  if req ? 'userId' then
    select u.id, u.email into found_id, found_email from auth.users u where u.id = (req ->> 'userId')::uuid;
  else
    select u.id, u.email into found_id, found_email from auth.users u
      where lower(u.email) = lower(btrim(coalesce(req ->> 'email', '')));
  end if;
  if found_id is null then return jsonb_build_object('userId', null, 'stores', 0); end if;
  select count(*) into store_count from app.store_members m where m.user_id = found_id;
  return jsonb_build_object('userId', found_id, 'email', lower(found_email), 'stores', store_count);
end $$;
revoke execute on function public.service_account_info(jsonb) from public, anon, authenticated;
grant execute on function public.service_account_info(jsonb) to service_role;

-- ---------- The owner's checks (members Edge Function) ----------

-- As before, plus: invite answers the store's name (for the "you were added" email), setPassword answers the
-- person's email (for the reset email when the owner may not type their password).
create or replace function public.member_admin_check(p_store uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who text := app.norm_username(req -> 'username'); new_email text; m app.store_members;
  test_store boolean; shop text;
begin
  perform app.enter_store(p_store, '{owner}');
  select s.is_test, s.name into test_store, shop from app.stores s where s.id = p_store;
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
    return jsonb_build_object('username', who, 'email', new_email, 'isTest', test_store, 'storeName', shop);
  elsif req ->> 'action' = 'setPassword' then
    select * into m from app.store_members x where x.store_id = p_store and lower(x.username) = who;
    if not found then perform app.fail('no_user', 'No such user.'); end if;
    return jsonb_build_object('userId', m.user_id, 'username', m.username, 'email', m.email, 'isTest', test_store);
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

-- The members function adds an account as an employee (no permissions on): one it just made, or one that already
-- existed. An account already on this store is refused by name.
create or replace function public.service_add_member(p_store uuid, p_user uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members;
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  perform app.lock_store();
  select * into m from app.store_members x where x.store_id = p_store and x.user_id = p_user;
  if found then perform app.fail('email_exists', format('That email is already on the list (%s).', m.username)); end if;
  begin
    insert into app.store_members (store_id, user_id, username, role, email)
      values (p_store, p_user, app.norm_username(req -> 'username'), 'employee', lower(btrim(req ->> 'email')));
  exception when unique_violation then
    perform app.fail('user_exists', format('The username "%s" is already taken.', app.norm_username(req -> 'username')));
  end;
  return app.users_json();
end $$;

-- ---------- Leaving a store (an employee) ----------

-- The caller comes off this store. Their account and any other store stay; what they did here keeps their username.
-- The way back: the owner adds them again. The owner can't leave (the store would have nobody to run it).
create or replace function public.leave_store(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me app.store_members; shop text;
begin
  me := app.enter_store(p_store);
  if me.role = 'owner' then
    perform app.fail('owner_cant_leave', 'The owner can''t leave the store. To close it for good, use Delete Store.');
  end if;
  perform app.lock_store();
  select s.name into shop from app.stores s where s.id = p_store;
  delete from app.store_members where store_id = p_store and user_id = me.user_id;
  return jsonb_build_object('left', true, 'storeName', shop);
end $$;

-- ---------- Deleting a store (the owner) ----------

-- req: { name }: the store's name, typed, so it can't happen by a slip. Everything the store has goes: slots, packs,
-- closes, shift closes, shipments, back stock, problem reports, its people's places on it and the retailer number.
-- The accounts themselves stay (a person may be on other stores). Answers the numbers of the problem reports that
-- had screenshots, so the Edge Function can remove those files too. There is no way back.
create or replace function public.delete_store(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s app.stores; reports jsonb;
begin
  perform app.enter_store(p_store, '{owner}');
  select * into s from app.stores where id = p_store;
  if lower(btrim(coalesce(req ->> 'name', ''))) <> lower(btrim(s.name)) then
    perform app.fail('wrong_name', format('Type the store''s name to delete it: %s', s.name));
  end if;
  perform app.lock_store();
  select coalesce(jsonb_agg(r.id order by r.id), '[]'::jsonb) into reports
    from app.problem_reports r where r.store_id = p_store and r.screenshots > 0;
  perform app.forget_retailer_number();
  delete from app.shift_entries where store_id = p_store;
  delete from app.shift_closes where store_id = p_store;
  delete from app.close_entries where store_id = p_store;
  delete from app.daily_closes where store_id = p_store;
  delete from app.packs where store_id = p_store;
  delete from app.shipments where store_id = p_store;
  delete from app.stock_adjustments where store_id = p_store;
  delete from app.slots where store_id = p_store;
  delete from app.games where store_id = p_store;
  delete from app.store_members where store_id = p_store;
  -- The store row takes its problem reports with it.
  delete from app.stores where id = p_store;
  return jsonb_build_object('deleted', true, 'storeName', s.name, 'storeNumber', s.store_number, 'screenshotReports', reports);
end $$;

-- ---------- Deleting an account ----------

-- What stands in the way of deleting the caller's account: a store it still owns (it must be deleted first, or it
-- would be left with nobody to run it). Answers { stores: how many stores the account is on }. The members Edge
-- Function calls this as the person, then removes the account; their places on stores go with it.
create or replace function public.account_delete_check() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owned text; on_stores integer;
begin
  if app.uid() is null then perform app.fail('unauthorized', 'Your session has ended. Please sign in again.'); end if;
  perform set_config('app.store_id', '', true);
  select string_agg(coalesce(st.name, 'a store'), ', ' order by st.name) into owned
    from app.store_members m left join app.stores st on st.id = m.store_id
    where m.user_id = app.uid() and m.role = 'owner';
  if owned is not null then
    perform app.fail('owns_store', format('You own %s. Delete the store first, then delete your account.', owned));
  end if;
  select count(*) into on_stores from app.store_members m where m.user_id = app.uid();
  return jsonb_build_object('stores', on_stores);
end $$;

-- ---------- Owners and grants ----------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'public.leave_store', 'public.delete_store', 'public.account_delete_check')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.leave_store(uuid, jsonb), public.delete_store(uuid, jsonb), public.account_delete_check() to authenticated;

revoke create on schema app, public from smart_scan_api;
