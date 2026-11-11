-- Update a report's status from the support email (owner 2026-11-10): the email's buttons open report-status.html with
-- a link signed by the support Edge Function, which checks it and then reads the report with this (service key only)
-- and saves the new status with service_set_problem_status. Read only.

grant create on schema app, public to smart_scan_api;

create or replace function public.service_problem_for_link(p_store uuid, p_report bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r app.problem_reports; s app.stores;
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  select * into r from app.problem_reports where id = p_report and store_id = p_store;
  if r.id is null then perform app.fail('no_report', 'No such report in that store.'); end if;
  select * into s from app.stores where id = p_store;
  return app.problem_json(r, s.time_zone) || jsonb_build_object('role', r.role, 'storeName', s.name, 'storeNumber', s.store_number);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and pg_get_userbyid(p.proowner) = 'postgres' and p.proname = 'service_problem_for_link'
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
  end loop;
end $$;
revoke execute on function public.service_problem_for_link(uuid, bigint) from public, anon, authenticated;
grant execute on function public.service_problem_for_link(uuid, bigint) to service_role;

revoke create on schema app, public from smart_scan_api;
