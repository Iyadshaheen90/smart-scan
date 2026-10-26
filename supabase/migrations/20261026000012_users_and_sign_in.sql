-- Employees and sign-in (Users.js, Auth.js): listUsers, setUserActive, setUserPermissions, the checks behind inviting an
-- employee and the owner setting someone's password, and an inactive account being signed out.
-- On the database everyone signs in with their own email (Supabase Auth). The owner adds an employee by username + email:
-- the `members` Edge Function (supabase/functions/members) checks the request here, makes the account (an invite email,
-- or for a test store a link it hands back) and adds the member with service_add_member. Setting a password goes through
-- the same function, since only the service key can change someone else's password. Answers match the Sheets code
-- (test/parity/users.js) plus two fields the sheets don't have: email and signedIn (has used the invite yet).
grant create on schema app, public to smart_scan_api;

alter table app.store_members add column email text;
-- First signed in to this store (set by my_stores at sign-in): until then Manage Employees shows them as Invited.
alter table app.store_members add column signed_in_at timestamptz;
-- The order people were added, which is the order Manage Employees lists them (the Users tab's row order).
alter table app.store_members add column seq bigint generated always as identity;
create unique index store_members_email on app.store_members (store_id, lower(email)) where email is not null;

-- An account the owner turned off is signed out on its next request, as requireSession does (forbidden for no access).
create or replace function app.enter_store(p_store uuid, allowed text[] default null)
returns app.store_members language plpgsql security definer set search_path = '' as $$
declare m app.store_members;
begin
  if app.uid() is null then perform app.fail('unauthorized', 'Your session has ended. Please sign in again.'); end if;
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

-- PERMISSIONS in Permissions.js, in its order.
create or replace function app.all_permissions() returns text[] language sql immutable set search_path = '' as $$
  select array['load_packs', 'return_packs', 'receive_shipments', 'count_stock', 'full_pack_sale', 'ticket_order', 'theft_report']
$$;

-- normalizeUsername: String(username || '').trim().toLowerCase().
create or replace function app.norm_username(v jsonb) returns text language sql immutable set search_path = '' as $$
  select case when v is null or v in ('null', 'false', '0', '""') then ''
    else lower(regexp_replace(app.js_text(v), '^\s+|\s+$', '', 'g')) end
$$;

-- listUsers, plus email and signedIn.
create or replace function app.users_json() returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('username', m.username, 'role', m.role, 'active', m.active,
      'permissions', to_jsonb(case when m.role = 'owner' then app.all_permissions()
        else array(select p from unnest(app.all_permissions()) p where p = any (m.permissions)) end),
      'createdDate', to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'email', m.email, 'signedIn', m.signed_in_at is not null) order by m.seq), '[]'::jsonb)
  from app.store_members m
$$;

create or replace function public.list_users(p_store uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return app.users_json();
end $$;

-- setUserActive: not yourself; a turned-off account is refused from its next request (enter_store).
create or replace function public.set_user_active(p_store uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me app.store_members; who text := app.norm_username(req -> 'username');
begin
  me := app.enter_store(p_store, '{owner}');
  if who = me.username then perform app.fail('self', 'You can''t deactivate your own account.'); end if;
  perform app.lock_store();
  update app.store_members set active = coalesce(req -> 'active' = 'true'::jsonb, false)
    where store_id = app.current_store_id() and lower(username) = who;
  if not found then perform app.fail('no_user', 'No such user.'); end if;
  return app.users_json();
end $$;

-- setUserPermissions: the owner's switches on one employee, kept in PERMISSIONS order.
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
  select * into m from app.store_members where lower(username) = who;
  if not found then perform app.fail('no_user', 'No such user.'); end if;
  if m.role = 'owner' then perform app.fail('bad_request', 'The owner can already do everything.'); end if;
  update app.store_members set permissions = array(select p from unnest(app.all_permissions()) p
      where to_jsonb(p) <@ (req -> 'permissions'))
    where store_id = app.current_store_id() and user_id = m.user_id;
  return app.users_json();
end $$;

-- The owner's checks for the members Edge Function, called with the owner's own sign-in, before it touches any account.
-- invite { username, email }: the username rules of createUser, a real-looking email, neither already on this store.
-- setPassword { username }: the person (its userId, for the function). The new password's length is checked there.
-- isTest: a test store, where the function hands back the invite link instead of emailing it.
create or replace function public.member_admin_check(p_store uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who text := app.norm_username(req -> 'username'); email text; m app.store_members;
  is_test boolean;
begin
  perform app.enter_store(p_store, '{owner}');
  select s.is_test into is_test from app.stores s where s.id = p_store;
  if req ->> 'action' = 'invite' then
    if who !~ '^[a-z0-9._-]{3,30}$' then
      perform app.fail('bad_username', 'Username must be 3-30 characters: letters, numbers, dot, dash or underscore.');
    end if;
    email := lower(btrim(coalesce(req ->> 'email', '')));
    if email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform app.fail('bad_email', 'Enter the employee''s email address.'); end if;
    if exists (select 1 from app.store_members x where lower(x.username) = who) then
      perform app.fail('user_exists', format('The username "%s" is already taken.', who));
    end if;
    select * into m from app.store_members x where lower(x.email) = email;
    if found then perform app.fail('email_exists', format('That email is already on the list (%s).', m.username)); end if;
    return jsonb_build_object('username', who, 'email', email, 'isTest', is_test);
  elsif req ->> 'action' = 'setPassword' then
    select * into m from app.store_members x where lower(x.username) = who;
    if not found then perform app.fail('no_user', 'No such user.'); end if;
    return jsonb_build_object('userId', m.user_id, 'username', m.username, 'isTest', is_test);
  end if;
  perform app.fail('bad_request', 'Unknown request.');
end $$;

-- The members function, with the service key, adds the account it just made as an employee (no permissions on).
create or replace function public.service_add_member(p_store uuid, p_user uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  perform app.lock_store();
  begin
    insert into app.store_members (store_id, user_id, username, role, email)
      values (p_store, p_user, app.norm_username(req -> 'username'), 'employee', lower(btrim(req ->> 'email')));
  exception when unique_violation then
    perform app.fail('user_exists', format('The username "%s" is already taken.', app.norm_username(req -> 'username')));
  end;
  return app.users_json();
end $$;

-- The stores the signed-in person can use; also marks them signed in on each (Manage Employees stops showing Invited).
create or replace function public.my_stores() returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  if app.uid() is null then perform app.fail('unauthorized', 'Your session has ended. Please sign in again.'); end if;
  for s in select m.store_id from app.store_members m where m.user_id = app.uid() and m.active and m.signed_in_at is null loop
    perform set_config('app.store_id', s::text, true);
    update app.store_members set signed_in_at = now() where store_id = s and user_id = app.uid();
  end loop;
  perform set_config('app.store_id', '', true);
  return coalesce((select jsonb_agg(jsonb_build_object('storeId', st.id, 'storeName', st.name, 'username', m.username,
      'role', m.role, 'permissions', to_jsonb(m.permissions)) order by st.name)
    from app.store_members m join app.stores st on st.id = m.store_id
    where m.user_id = app.uid() and m.active), '[]'::jsonb);
end $$;

-- Test stores: people with an email (the sign-in browser test signs in by email).
create or replace function public.test_add_members(p_store uuid, users jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_test_store(p_store);
  insert into app.store_members (store_id, user_id, username, role, permissions, email)
  select p_store, (u ->> 'userId')::uuid, u ->> 'username', u ->> 'role',
    coalesce(array(select jsonb_array_elements_text(u -> 'permissions')), '{}'), u ->> 'email'
  from jsonb_array_elements(users) u;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.all_permissions', 'app.norm_username', 'app.users_json', 'public.list_users', 'public.set_user_active',
      'public.set_user_permissions', 'public.member_admin_check', 'public.service_add_member')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on all functions in schema app to smart_scan_api;
grant execute on function public.list_users(uuid, jsonb), public.set_user_active(uuid, jsonb), public.set_user_permissions(uuid, jsonb),
  public.member_admin_check(uuid, jsonb) to authenticated;
grant execute on function public.service_add_member(uuid, uuid, jsonb) to service_role;

revoke create on schema app, public from smart_scan_api;
