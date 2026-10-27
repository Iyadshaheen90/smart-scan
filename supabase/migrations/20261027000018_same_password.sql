-- A new password can't be the one it replaces (owner 2026-10-27). Signing in (Change My Password) and Forgot Password
-- go through Supabase Auth, which already refuses it (same_password); the owner setting an employee's password goes
-- through the admin API, which doesn't. So the members Edge Function asks this, with the service key: is this the
-- person's current password? It compares against the stored bcrypt hash and only ever answers yes or no.
-- Owned by postgres (auth.users is postgres's), callable only with the service key.
create or replace function public.service_is_current_password(p_user uuid, p_password text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare stored text;
begin
  perform app.require_service_role();
  select encrypted_password into stored from auth.users where id = p_user;
  if stored is null or stored = '' then return false; end if;
  return extensions.crypt(p_password, stored) = stored;
end $$;

revoke execute on function public.service_is_current_password(uuid, text) from public, anon, authenticated;
grant execute on function public.service_is_current_password(uuid, text) to service_role;
