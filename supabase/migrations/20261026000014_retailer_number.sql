-- The store's CA Lottery retailer number (owner 2026-10-26): the lottery's account number for the store, printed on the
-- Theft Report (Store.js on the Sheets backend). It's sensitive, so it's kept encrypted in Supabase Vault (one secret per
-- store, named retailer_number:<store id>), never in a table. Only the owner can see or change it (get/set_retailer_number);
-- the Theft Report shows it in full to whoever makes it, employees with theft_report too (owner's choice).
--
-- Vault is readable only by postgres, so two small helpers are owned by postgres (the one exception to "functions are
-- owned by smart_scan_api"): they touch only the Vault secret of the store the request entered (app.current_store_id(),
-- set by enter_store after its checks), and only smart_scan_api, the API functions' role, may call them.
grant create on schema app, public to smart_scan_api;

create or replace function app.retailer_secret_name(p_store uuid) returns text language sql immutable set search_path = '' as $$
  select 'retailer_number:' || p_store::text
$$;

-- The entered store's number (null when not entered yet or no store entered).
create or replace function app.store_retailer_number() returns text
language plpgsql security definer set search_path = '' as $$
begin
  if app.current_store_id() is null then return null; end if;
  return (select s.decrypted_secret from vault.decrypted_secrets s where s.name = app.retailer_secret_name(app.current_store_id()));
end $$;

create or replace function app.save_retailer_number(v text) returns void
language plpgsql security definer set search_path = '' as $$
declare secret_id uuid;
begin
  if app.current_store_id() is null then perform app.fail('forbidden', 'No store.'); end if;
  select s.id into secret_id from vault.secrets s where s.name = app.retailer_secret_name(app.current_store_id());
  if secret_id is null then
    perform vault.create_secret(v, app.retailer_secret_name(app.current_store_id()), 'Smart Scan: the store''s CA Lottery retailer number');
  else
    perform vault.update_secret(secret_id, v);
  end if;
end $$;

-- A test store's number goes with it (test_drop_store).
create or replace function app.forget_retailer_number() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if app.current_store_id() is null then return; end if;
  delete from vault.secrets where name = app.retailer_secret_name(app.current_store_id());
end $$;

revoke execute on function app.store_retailer_number(), app.save_retailer_number(text), app.forget_retailer_number()
  from public, anon, authenticated, service_role;
grant execute on function app.store_retailer_number(), app.save_retailer_number(text), app.forget_retailer_number() to smart_scan_api;

-- getRetailerNumber (owner).
create or replace function public.get_retailer_number(p_store uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_store(p_store, '{owner}');
  return jsonb_build_object('retailerNumber', app.store_retailer_number());
end $$;

-- setRetailerNumber (owner): digits only; spaces and dashes typed with it are dropped.
create or replace function public.set_retailer_number(p_store uuid, req jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  perform app.enter_store(p_store, '{owner}');
  v := case when req -> 'retailerNumber' is null or jsonb_typeof(req -> 'retailerNumber') = 'null' then ''
    else regexp_replace(app.js_text(req -> 'retailerNumber'), '[\s-]', '', 'g') end;
  if v !~ '^[0-9]{4,12}$' then
    perform app.fail('bad_retailer_number', 'Enter the retailer number: digits only, as on your lottery terminal.');
  end if;
  perform app.lock_store();
  perform app.save_retailer_number(v);
  return jsonb_build_object('retailerNumber', v);
end $$;

-- theftReport adds retailerNumber: the report from 0010 moves to app.theft_report_body, and public.theft_report wraps it.
alter function public.theft_report(uuid, jsonb) set schema app;
alter function app.theft_report(uuid, jsonb) rename to theft_report_body;
revoke execute on function app.theft_report_body(uuid, jsonb) from public, anon, authenticated;

create or replace function public.theft_report(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare report jsonb;
begin
  report := app.theft_report_body(p_store, req);
  return report || jsonb_build_object('retailerNumber', app.store_retailer_number());
end $$;

-- Test stores: forget the number too.
create or replace function public.test_drop_store(p_store uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_test_store(p_store);
  perform app.forget_retailer_number();
  perform app.clear_test_store(p_store);
  delete from app.store_members where store_id = p_store;
  delete from app.stores where id = p_store;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and pg_get_userbyid(p.proowner) = 'postgres' and n.nspname || '.' || p.proname in (
      'app.retailer_secret_name', 'public.get_retailer_number', 'public.set_retailer_number', 'public.theft_report')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function app.retailer_secret_name(uuid), app.theft_report_body(uuid, jsonb) to smart_scan_api;
grant execute on function public.get_retailer_number(uuid, jsonb), public.set_retailer_number(uuid, jsonb),
  public.theft_report(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
