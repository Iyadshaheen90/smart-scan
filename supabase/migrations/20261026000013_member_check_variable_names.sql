-- member_admin_check (0012) had a variable named like a column (email): "column reference is ambiguous" on every invite.
-- Same function with the variables renamed.
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
    if exists (select 1 from app.store_members x where lower(x.username) = who) then
      perform app.fail('user_exists', format('The username "%s" is already taken.', who));
    end if;
    select * into m from app.store_members x where lower(x.email) = new_email;
    if found then perform app.fail('email_exists', format('That email is already on the list (%s).', m.username)); end if;
    return jsonb_build_object('username', who, 'email', new_email, 'isTest', test_store);
  elsif req ->> 'action' = 'setPassword' then
    select * into m from app.store_members x where lower(x.username) = who;
    if not found then perform app.fail('no_user', 'No such user.'); end if;
    return jsonb_build_object('userId', m.user_id, 'username', m.username, 'isTest', test_store);
  end if;
  perform app.fail('bad_request', 'Unknown request.');
end $$;
