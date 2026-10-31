-- Store info and Report a Problem (owner 2026-10-31; database only, from the Dec 1 cutover).
-- Store info: every store gets a Store ID (a number from 10001, given once, never changed) that support uses to
-- know the store. Never the retailer number (sensitive; it stays in Vault). The owner adds the address and the store's
-- phone in More → Store Info (and in the setup wizard, later); the phone can also help support confirm an owner who
-- lost their sign-in email.
-- Report a Problem: anyone signed in sends a report (where it happened, what happened, up to 3 screenshots, and what
-- the app knows by itself). The support Edge Function saves it through report_problem, keeps the screenshots in the
-- private bucket problem-screenshots and emails support. My Reports: the owner sees the store's reports, an employee
-- their own; support sets the status (Received / Working on It / Fixed) with scripts/report-status.js.
grant create on schema app, public to smart_scan_api;

-- ---------- Store ID, address, phone ----------

create sequence app.store_number_seq start 10001;
alter table app.stores
  add column store_number integer unique default nextval('app.store_number_seq'),
  add column street text,
  add column city text,
  add column state text,
  add column zip text,
  add column phone text;
alter table app.stores alter column store_number set not null;
grant usage on sequence app.store_number_seq to smart_scan_api;

-- (555) 123-4567 from the 10 digits saved.
create or replace function app.phone_label(digits text) returns text language sql immutable set search_path = '' as $$
  select case when digits ~ '^\d{10}$'
    then format('(%s) %s-%s', substr(digits, 1, 3), substr(digits, 4, 3), substr(digits, 7)) else digits end
$$;

create or replace function app.store_info_json(s app.stores) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('storeId', s.store_number, 'name', s.name, 'street', s.street, 'city', s.city,
    'state', coalesce(s.state, s.lottery_state), 'zip', s.zip, 'phone', s.phone, 'phoneLabel', app.phone_label(s.phone),
    'complete', s.street is not null and s.city is not null and s.zip is not null and s.phone is not null)
$$;

-- Owner only: the store's ID, name, address and phone.
create or replace function public.store_info(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s app.stores;
begin
  perform app.enter_store(p_store, '{owner}');
  select * into s from app.stores where id = p_store;
  return app.store_info_json(s);
end $$;

-- Owner only: saves the name, address and phone (all of them; each is checked before anything is saved).
create or replace function public.set_store_info(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(req ->> 'name', ''));
  v_street text := btrim(coalesce(req ->> 'street', ''));
  v_city text := btrim(coalesce(req ->> 'city', ''));
  v_state text := upper(btrim(coalesce(req ->> 'state', '')));
  v_zip text := btrim(coalesce(req ->> 'zip', ''));
  v_phone text := regexp_replace(coalesce(req ->> 'phone', ''), '\D', '', 'g');
  s app.stores;
begin
  perform app.enter_store(p_store, '{owner}');
  if v_name = '' or length(v_name) > 60 then perform app.fail('bad_store_name', 'Enter the store name (up to 60 letters).'); end if;
  if v_street = '' or length(v_street) > 100 then perform app.fail('bad_street', 'Enter the street address.'); end if;
  if v_city = '' or length(v_city) > 60 then perform app.fail('bad_city', 'Enter the city.'); end if;
  if v_state !~ '^[A-Z]{2}$' then perform app.fail('bad_state', 'Enter the state as 2 letters, like CA.'); end if;
  if v_zip !~ '^\d{5}$' then perform app.fail('bad_zip', 'Enter the 5-digit ZIP code.'); end if;
  if length(v_phone) = 11 and left(v_phone, 1) = '1' then v_phone := substr(v_phone, 2); end if;
  if v_phone !~ '^\d{10}$' then perform app.fail('bad_phone', 'Enter the store phone with its area code (10 digits).'); end if;
  update app.stores set name = v_name, street = v_street, city = v_city, state = v_state, zip = v_zip, phone = v_phone
    where id = p_store returning * into s;
  return app.store_info_json(s);
end $$;

-- ---------- Problem reports ----------

create table app.problem_reports (
  id bigint generated always as identity (start with 1001) primary key,  -- the report number people see (#1001)
  store_id uuid not null references app.stores on delete cascade,
  created_at timestamptz not null default now(),
  username text not null,
  role text not null,
  area text not null check (area in ('close', 'shift', 'slots', 'backstock', 'reports', 'months', 'signin', 'other')),
  description text not null,
  page text,
  app_version text,
  device text,
  recent_errors jsonb not null default '[]',
  screenshots smallint not null default 0 check (screenshots between 0 and 3),
  status text not null default 'received' check (status in ('received', 'working', 'fixed')),
  status_note text,
  status_at timestamptz,
  emailed_at timestamptz,
  email_error text
);
create index problem_reports_store on app.problem_reports (store_id, created_at desc);
alter table app.problem_reports enable row level security;
alter table app.problem_reports force row level security;
create policy store_rows on app.problem_reports for all to smart_scan_api
  using (store_id = app.current_store_id()) with check (store_id = app.current_store_id());
grant select, insert, update on app.problem_reports to smart_scan_api;

-- Words for the email and the list.
create or replace function app.problem_area_label(area text) returns text language sql immutable set search_path = '' as $$
  select case area when 'close' then 'Close Day' when 'shift' then 'Close Shift' when 'slots' then 'Slots'
    when 'backstock' then 'Back Stock' when 'reports' then 'Reports' when 'months' then 'Months'
    when 'signin' then 'Sign In' else 'Something Else' end
$$;

-- A text field from the request, trimmed and cut to `max` letters ('' when missing or not text).
create or replace function app.req_text(req jsonb, key text, max integer) returns text language sql immutable set search_path = '' as $$
  select left(btrim(case when jsonb_typeof(req -> key) = 'string' then req ->> key else '' end), max)
$$;

-- Anyone signed in: saves a report. req: { area, description, screenshots (0-3), page, appVersion, device,
-- recentErrors: [text] }. Called by the support Edge Function (as the person), which then stores the screenshots and
-- sends the email. At most 10 reports an hour per person.
create or replace function public.report_problem(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m app.store_members;
  v_area text := app.req_text(req, 'area', 20);
  v_text text := btrim(case when jsonb_typeof(req -> 'description') = 'string' then req ->> 'description' else '' end);
  v_shots integer := coalesce(case when jsonb_typeof(req -> 'screenshots') = 'number' then (req ->> 'screenshots')::numeric end, 0);
  v_errors jsonb := '[]';
  r app.problem_reports;
begin
  m := app.enter_store(p_store);
  if v_area not in ('close', 'shift', 'slots', 'backstock', 'reports', 'months', 'signin', 'other') then
    perform app.fail('bad_area', 'Pick where the problem happened.');
  end if;
  if length(v_text) < 10 then perform app.fail('too_short', 'Tell us a bit more: what did you tap, and what happened?'); end if;
  if length(v_text) > 2000 then perform app.fail('too_long', 'Keep it under 2,000 letters.'); end if;
  if v_shots not between 0 and 3 or v_shots <> trunc(v_shots) then perform app.fail('too_many_screenshots', 'Add up to 3 screenshots.'); end if;
  if jsonb_typeof(req -> 'recentErrors') = 'array' then
    select coalesce(jsonb_agg(left(e, 300)), '[]') into v_errors
      from (select value as e from jsonb_array_elements_text(req -> 'recentErrors') with ordinality t(value, n)
            where n <= 5) x;
  end if;
  perform app.lock_store();
  if (select count(*) from app.problem_reports where username = m.username and created_at > now() - interval '1 hour') >= 10 then
    perform app.fail('too_many_reports', 'That''s a lot of reports in one hour. Wait a bit, then send this one.');
  end if;
  insert into app.problem_reports (store_id, username, role, area, description, page, app_version, device, recent_errors, screenshots)
    values (p_store, m.username, m.role, v_area, v_text, app.req_text(req, 'page', 100), app.req_text(req, 'appVersion', 40),
      app.req_text(req, 'device', 300), v_errors, v_shots::smallint)
    returning * into r;
  return jsonb_build_object('number', r.id, 'status', r.status);
end $$;

create or replace function app.problem_json(r app.problem_reports, tz text) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('number', r.id, 'area', r.area, 'areaLabel', app.problem_area_label(r.area),
    'description', r.description, 'username', r.username, 'status', r.status, 'statusNote', r.status_note,
    'sentAt', to_char(r.created_at at time zone tz, 'Mon FMDD, FMHH12:MI AM'),
    'statusAt', to_char(r.status_at at time zone tz, 'Mon FMDD, FMHH12:MI AM'),
    'screenshots', r.screenshots)
$$;

-- My Reports: the owner sees every report from the store, an employee only their own. Newest first, the last 50.
create or replace function public.my_reports(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m app.store_members; tz text;
begin
  m := app.enter_store(p_store);
  select time_zone into tz from app.stores where id = p_store;
  return coalesce((select jsonb_agg(app.problem_json(r, tz) order by r.id desc)
    from (select * from app.problem_reports r
          where m.role = 'owner' or r.username = m.username
          order by r.id desc limit 50) r), '[]'::jsonb);
end $$;

-- Service key only (the support Edge Function): everything the support email needs.
create or replace function public.service_problem_for_email(p_store uuid, p_report bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r app.problem_reports; s app.stores; email text;
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  select * into r from app.problem_reports where id = p_report;
  if r.id is null then perform app.fail('no_report', 'No such report.'); end if;
  select * into s from app.stores where id = p_store;
  select m.email into email from app.store_members m where m.username = r.username;
  return jsonb_build_object('number', r.id, 'storeUuid', s.id, 'isTest', s.is_test, 'store', app.store_info_json(s),
    'sentAt', to_char(r.created_at at time zone s.time_zone, 'Mon FMDD, YYYY FMHH12:MI AM'),
    'username', r.username, 'role', r.role, 'email', email, 'area', r.area, 'areaLabel', app.problem_area_label(r.area),
    'description', r.description, 'page', r.page, 'appVersion', r.app_version, 'device', r.device,
    'recentErrors', r.recent_errors, 'screenshots', r.screenshots);
end $$;

-- Service key only: the email went out (p_error null) or why it didn't. The report is kept either way.
create or replace function public.service_problem_emailed(p_store uuid, p_report bigint, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  update app.problem_reports set emailed_at = case when p_error is null then now() end, email_error = left(p_error, 500)
    where id = p_report and store_id = p_store;
end $$;

-- Service key only (scripts/report-status.js): support moves a report to Received / Working on It / Fixed, with an
-- optional note the person sees in My Reports.
create or replace function public.service_set_problem_status(p_store uuid, p_report bigint, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app.problem_reports; tz text;
begin
  perform app.require_service_role();
  perform set_config('app.store_id', p_store::text, true);
  if p_status not in ('received', 'working', 'fixed') then perform app.fail('bad_status', 'Status is received, working or fixed.'); end if;
  update app.problem_reports set status = p_status, status_note = nullif(btrim(coalesce(p_note, '')), ''), status_at = now()
    where id = p_report and store_id = p_store returning * into r;
  if r.id is null then perform app.fail('no_report', 'No such report in that store.'); end if;
  select time_zone into tz from app.stores where id = p_store;
  return app.problem_json(r, tz);
end $$;

-- Screenshots: a private bucket; only the service key (the support function) reads or writes it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('problem-screenshots', 'problem-screenshots', false, 3145728, array['image/jpeg', 'image/png'])
  on conflict (id) do nothing;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, n.nspname as ns from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in ('app.phone_label', 'app.store_info_json', 'app.problem_area_label', 'app.req_text',
      'app.problem_json', 'public.store_info', 'public.set_store_info', 'public.report_problem', 'public.my_reports',
      'public.service_problem_for_email', 'public.service_problem_emailed', 'public.service_set_problem_status')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    if f.ns = 'app' then execute format('grant execute on function %s to smart_scan_api', f.sig); end if;
  end loop;
end $$;
grant execute on function public.store_info(uuid, jsonb), public.set_store_info(uuid, jsonb), public.report_problem(uuid, jsonb),
  public.my_reports(uuid, jsonb) to authenticated;
-- The service functions check the service role themselves; PostgREST calls them as service_role.
grant execute on function public.service_problem_for_email(uuid, bigint), public.service_problem_emailed(uuid, bigint, text),
  public.service_set_problem_status(uuid, bigint, text, text) to service_role;

revoke create on schema app, public from smart_scan_api;
