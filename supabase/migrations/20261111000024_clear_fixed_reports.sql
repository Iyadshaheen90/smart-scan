-- Clearing fixed reports from My Reports (owner 2026-11-10): a Fixed report can be cleared by the person who sent it or
-- by the owner, one at a time or all fixed ones at once. It's one shared list: cleared for everyone in the store. It
-- only hides the report (support keeps it, with who cleared it and when); Undo and Show Cleared → Restore bring it back.
-- If support moves a cleared report back to Received or Working on It, it shows again.

grant create on schema app, public to smart_scan_api;

alter table app.problem_reports add column cleared_at timestamptz, add column cleared_by text;

-- req.cleared true: only the cleared ones (Show Cleared); otherwise the ones still showing.
create or replace function public.my_reports(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; tz text; cleared boolean := coalesce((req ->> 'cleared')::boolean, false);
begin
  m := app.enter_store(p_store);
  select time_zone into tz from app.stores where id = p_store;
  return coalesce((select jsonb_agg(app.problem_json(r, tz) order by r.id desc)
    from (select * from app.problem_reports r
          where (m.role = 'owner' or r.username = m.username)
            and (r.cleared_at is not null) = cleared
          order by r.id desc limit 50) r), '[]'::jsonb);
end $$;

-- The report numbers in req.numbers, checked: each one this person may see (theirs, or any for the owner).
create or replace function app.reports_to_clear(m app.store_members, req jsonb) returns bigint[]
language plpgsql security definer set search_path = '' as $$
declare nums bigint[];
begin
  if jsonb_typeof(req -> 'numbers') is distinct from 'array' then perform app.fail('bad_request', 'Pick a report first.'); end if;
  select coalesce(array_agg(distinct (x #>> '{}')::bigint), '{}') into nums from jsonb_array_elements(req -> 'numbers') x;
  if cardinality(nums) = 0 then perform app.fail('bad_request', 'Pick a report first.'); end if;
  if cardinality(nums) > 100 then perform app.fail('bad_request', 'That''s too many reports at once.'); end if;
  if (select count(*) from app.problem_reports r where r.id = any(nums) and r.store_id = m.store_id
      and (m.role = 'owner' or r.username = m.username)) <> cardinality(nums) then
    perform app.fail('no_report', 'That report isn''t in your reports.');
  end if;
  return nums;
end $$;

-- Clear: Fixed reports only (nothing is cleared if any isn't fixed). Answers with the reports still showing.
create or replace function public.clear_reports(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; nums bigint[];
begin
  m := app.enter_store(p_store);
  nums := app.reports_to_clear(m, req);
  if exists (select 1 from app.problem_reports where id = any(nums) and status <> 'fixed') then
    perform app.fail('not_fixed', 'Only fixed reports can be cleared.');
  end if;
  update app.problem_reports set cleared_at = now(), cleared_by = m.username where id = any(nums) and cleared_at is null;
  return public.my_reports(p_store, '{}');
end $$;

-- Restore (Undo, or Show Cleared → Restore): back in My Reports. Answers with the reports showing.
create or replace function public.restore_reports(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; nums bigint[];
begin
  m := app.enter_store(p_store);
  nums := app.reports_to_clear(m, req);
  update app.problem_reports set cleared_at = null, cleared_by = null where id = any(nums) and cleared_at is not null;
  return public.my_reports(p_store, '{}');
end $$;

-- As in migration 0020, and a report moved back from Fixed shows again in My Reports.
create or replace function public.service_set_problem_status(p_store uuid, p_report bigint, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app.problem_reports; tz text;
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  if p_status not in ('received', 'working', 'fixed') then perform app.fail('bad_status', 'Status is received, working or fixed.'); end if;
  update app.problem_reports set status = p_status, status_note = nullif(btrim(coalesce(p_note, '')), ''), status_at = now(),
      cleared_at = case when p_status = 'fixed' then cleared_at end,
      cleared_by = case when p_status = 'fixed' then cleared_by end
    where id = p_report and store_id = p_store returning * into r;
  if r.id is null then perform app.fail('no_report', 'No such report in that store.'); end if;
  select time_zone into tz from app.stores where id = p_store;
  return app.problem_json(r, tz);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, n.nspname as ns from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and pg_get_userbyid(p.proowner) = 'postgres'
      and p.proname in ('my_reports', 'reports_to_clear', 'clear_reports', 'restore_reports', 'service_set_problem_status')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    if f.ns = 'app' then execute format('grant execute on function %s to smart_scan_api', f.sig); end if;
  end loop;
end $$;
grant execute on function public.my_reports(uuid, jsonb), public.clear_reports(uuid, jsonb), public.restore_reports(uuid, jsonb)
  to authenticated;
grant execute on function public.service_set_problem_status(uuid, bigint, text, text) to service_role;

revoke create on schema app, public from smart_scan_api;
