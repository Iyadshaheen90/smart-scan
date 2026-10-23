-- Smart Scan on Supabase, Phase 1: the tables, store separation and the sign-in check.
-- (Database migration plan ~/.claude/plans/submitting-reports-and-updating-mossy-floyd.md; replaces the monthly Google
-- Sheets. One database for every store; months are just dates, so there's no Start New Month.)
--
-- Store separation, enforced by the database itself:
-- - The tables live in schema `app`, which the API doesn't expose and the signed-in roles can't use at all.
-- - The pages call functions in `public` (supabase.rpc). Each runs as role smart_scan_api and starts with
--   app.enter_store(store, allowed), which checks the caller is an active member with the right role or permission,
--   then sets app.store_id for that one transaction.
-- - Every table has forced Row Level Security: smart_scan_api sees and writes only rows of app.store_id. So even a
--   function that forgets a `where store_id = …` can't read or change another store. (Role postgres bypasses RLS,
--   which is why the functions don't run as postgres.)
-- - Errors the pages show: raise with hint = the app's error code (forbidden, unauthorized, …), as ApiError does today.

create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'smart_scan_api') then
    create role smart_scan_api nologin nobypassrls;
  end if;
end $$;
-- Lets migrations make smart_scan_api the owner of the API functions.
grant smart_scan_api to postgres;
grant usage on schema app to smart_scan_api;
grant usage on schema public to smart_scan_api;
-- Only while this migration runs: a function's new owner must be allowed to create in its schema (taken back at the end).
grant create on schema app, public to smart_scan_api;

-- ---------- Helpers ----------

-- The signed-in user (the JWT's sub), like auth.uid(), without needing the auth schema.
create or replace function app.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

-- The store this transaction entered (null before app.enter_store: then every table looks empty).
create or replace function app.current_store_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.store_id', true), '')::uuid
$$;

-- An error for the person at the counter: code in the hint (the page reads it), message shown as is.
create or replace function app.fail(code text, message text) returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = message, hint = code;
end $$;

-- ---------- Tables ----------

create table app.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  time_zone text not null default 'America/Los_Angeles',
  -- The hour a business day ends: 0 = midnight (Route 66 Liquor closes at 11 pm); 4 = a 2 am store's day runs to 4 am.
  day_end_hour smallint not null default 0 check (day_end_hour between 0 and 12),
  lottery_state text not null default 'CA',
  default_ticket_order text not null default 'descending' check (default_ticket_order in ('descending', 'ascending')),
  created_at timestamptz not null default now()
);

-- Who can use a store. Everyone signs in with their own email (Supabase Auth); username is the name shown in the app
-- and kept on the rows they make (performed_by), as the sheets do.
create table app.store_members (
  store_id uuid not null references app.stores on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  username text not null,
  role text not null check (role in ('owner', 'employee')),
  permissions text[] not null default '{}' check (permissions <@ array['load_packs', 'return_packs', 'receive_shipments',
    'count_stock', 'full_pack_sale', 'ticket_order', 'theft_report']),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create unique index store_members_username on app.store_members (store_id, lower(username));
create index store_members_user on app.store_members (user_id);

-- The store's slots (SlotConfig): any layout, each with its price tier and ticket order for its next pack.
create table app.slots (
  store_id uuid not null references app.stores on delete cascade,
  box smallint not null check (box > 0),
  slot_number smallint not null check (slot_number > 0),
  price numeric(6, 2) not null check (price > 0),
  ticket_order text not null default 'descending' check (ticket_order in ('descending', 'ascending')),
  -- The game of the last pack that ended here, for an empty slot's "N packs in back stock" hint.
  last_game_number text,
  primary key (store_id, box, slot_number)
);

-- Every game the store has had (ReserveInventory without the counts): its price and pack size are remembered here.
create table app.games (
  store_id uuid not null references app.stores on delete cascade,
  game_number text not null,
  price numeric(6, 2) not null check (price > 0),
  tickets_per_pack integer not null check (tickets_per_pack > 0),
  -- The owner marked it ended (CA Lottery stopped it); cleared if a pack of it comes back.
  ended_on date,
  -- Sealed packs in the back whose pack numbers were never scanned (the sheets kept counts only). Taken first when a
  -- pack is activated or sold whole without being in the back by number; the one-time "scan the back" at cutover
  -- replaces them with numbered packs.
  unnumbered_in_back integer not null default 0 check (unnumbered_in_back >= 0),
  primary key (store_id, game_number)
);

-- One row per pack, sealed in the back, live in a slot, or ended (SlotState + PackHistory + back stock by number).
create table app.packs (
  id bigint generated always as identity primary key,
  store_id uuid not null references app.stores on delete cascade,
  game_number text not null,
  pack_number text not null,
  status text not null check (status in ('in_back', 'live', 'sold_out', 'returned', 'full_pack_sale', 'removed')),
  -- Live: where it is. Ended: where it last was.
  box smallint,
  slot_number smallint,
  ticket_order text not null default 'descending' check (ticket_order in ('descending', 'ascending')),
  price numeric(6, 2),
  activation_ticket integer,
  -- The next unsold ticket as of the last Close Day (or the activation ticket until its first close).
  top_ticket integer,
  activated_on date,
  last_close_on date,
  -- For undoing a wrong-slot activation exactly.
  price_before_activation numeric(6, 2),
  took_from_back boolean,
  received_on date,
  shipment_id bigint,
  ended_on date,
  end_reason text,
  remaining_at_end integer,
  removed_reason text,
  adjustment_id bigint,
  performed_by text,
  created_at timestamptz not null default now(),
  foreign key (store_id, game_number) references app.games (store_id, game_number),
  unique (store_id, game_number, pack_number),
  check (status <> 'live' or (box is not null and slot_number is not null and top_ticket is not null))
);
-- A slot holds one live pack at most.
create unique index packs_one_live_per_slot on app.packs (store_id, box, slot_number) where status = 'live';
create index packs_status on app.packs (store_id, status);

-- Sales lines (DailyCloseLog): one per pack per Close Day, plus packs ended mid-day and full packs sold.
create table app.close_entries (
  id bigint generated always as identity primary key,
  store_id uuid not null references app.stores on delete cascade,
  close_date date not null,
  box smallint,
  slot_number smallint,
  pack_id bigint not null references app.packs,
  previous_ticket integer,
  current_ticket integer,
  tickets_sold integer not null,
  price numeric(6, 2) not null,
  dollars numeric(10, 2) not null,
  remaining_after integer,
  close_type text not null check (close_type in ('close', 'sold_out', 'returned', 'full_pack')),
  late_activation boolean not null default false,
  performed_by text,
  -- The pack's last close before this row, so undoing it restores that.
  previous_close_date date,
  logged_at timestamptz not null default now()
);
create index close_entries_date on app.close_entries (store_id, close_date);
create index close_entries_pack on app.close_entries (pack_id);

-- Each Close Day (DailySummary). close_id: the phone's id for it, so a close sent twice is saved once.
create table app.daily_closes (
  store_id uuid not null references app.stores on delete cascade,
  close_date date not null,
  total_tickets integer not null,
  total_dollars numeric(12, 2) not null,
  live_slot_count integer not null,
  inventory_value numeric(12, 2) not null,
  close_id text,
  closed_by text,
  closed_at timestamptz,
  primary key (store_id, close_date),
  unique (store_id, close_id)
);

-- Optional shift closes (ShiftCloses / ShiftCloseLog). They never change packs or the Close Day.
create table app.shift_closes (
  store_id uuid not null references app.stores on delete cascade,
  id text not null,
  shift_date date not null,
  closed_by text not null,
  started_at timestamptz,
  closed_at timestamptz not null,
  tickets_sold integer not null,
  dollars_sold numeric(10, 2) not null,
  slots_scanned integer not null,
  ended_tickets integer not null default 0,
  ended_dollars numeric(10, 2) not null default 0,
  primary key (store_id, id)
);
create index shift_closes_date on app.shift_closes (store_id, shift_date);

create table app.shift_entries (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  shift_id text not null,
  box smallint,
  slot_number smallint,
  pack_id bigint references app.packs,
  start_ticket integer,
  end_ticket integer,
  tickets_sold integer not null,
  price numeric(6, 2) not null,
  dollars numeric(10, 2) not null,
  entry_type text not null,
  foreign key (store_id, shift_id) references app.shift_closes (store_id, id) on delete cascade
);

-- Packs into the back: scanned deliveries and Manage packs + (source 'add pack').
create table app.shipments (
  id bigint generated always as identity primary key,
  store_id uuid not null references app.stores on delete cascade,
  received_on date not null,
  game_number text not null,
  price numeric(6, 2) not null,
  tickets_per_pack integer not null,
  packs integer not null check (packs > 0),
  source text not null check (source in ('delivery', 'add pack')),
  notes text,
  performed_by text,
  created_at timestamptz not null default now()
);
create index shipments_date on app.shipments (store_id, received_on);

-- Packs out of the back that weren't sold (ReserveAdjustments): counts and Manage packs −.
create table app.stock_adjustments (
  id bigint generated always as identity primary key,
  store_id uuid not null references app.stores on delete cascade,
  adjusted_on date not null,
  game_number text not null,
  packs_removed integer not null,
  tickets_removed integer not null,
  reason text not null check (reason in ('count', 'returned', 'game expired', 'damaged', 'stolen', 'other', 'adjust')),
  notes text,
  performed_by text,
  created_at timestamptz not null default now()
);
create index stock_adjustments_date on app.stock_adjustments (store_id, adjusted_on);

-- ---------- Row Level Security (forced, so it binds the table owner too) ----------

do $$
declare t text;
begin
  foreach t in array array['slots', 'games', 'packs', 'close_entries', 'daily_closes', 'shift_closes', 'shift_entries',
    'shipments', 'stock_adjustments'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('create policy store_rows on app.%I for all to smart_scan_api
      using (store_id = app.current_store_id()) with check (store_id = app.current_store_id())', t);
  end loop;
end $$;

alter table app.stores enable row level security;
alter table app.stores force row level security;
-- The entered store, plus (read only) the stores the signed-in person belongs to, for their list of stores.
create policy entered_store on app.stores for all to smart_scan_api
  using (id = app.current_store_id()) with check (id = app.current_store_id());
create policy my_stores on app.stores for select to smart_scan_api
  using (exists (select 1 from app.store_members m where m.store_id = stores.id and m.user_id = app.uid() and m.active));

alter table app.store_members enable row level security;
alter table app.store_members force row level security;
create policy entered_store on app.store_members for all to smart_scan_api
  using (store_id = app.current_store_id()) with check (store_id = app.current_store_id());
-- Someone's own memberships, so enter_store can check them before a store is entered.
create policy own_rows on app.store_members for select to smart_scan_api using (user_id = app.uid());

grant select, insert, update, delete on all tables in schema app to smart_scan_api;
grant usage on all sequences in schema app to smart_scan_api;

-- ---------- Entering a store ----------

-- Every API function starts here. allowed: null = any active member; '{owner}' = the owner only; a list of permissions
-- = the owner or an employee with one of them (the router's `allow: [...]` today). Returns the member.
create or replace function app.enter_store(p_store uuid, allowed text[] default null)
returns app.store_members language plpgsql security definer set search_path = '' as $$
declare m app.store_members;
begin
  if app.uid() is null then perform app.fail('unauthorized', 'Your session has ended. Please sign in again.'); end if;
  select * into m from app.store_members where store_id = p_store and user_id = app.uid() and active;
  if not found then perform app.fail('forbidden', 'You don''t have access to this store.'); end if;
  if allowed is not null and m.role <> 'owner' then
    if allowed = array['owner'] then perform app.fail('forbidden', 'Only the owner can do that.'); end if;
    if not (m.permissions && allowed) then perform app.fail('forbidden', 'The owner hasn''t turned this on for you.'); end if;
  end if;
  perform set_config('app.store_id', p_store::text, true);
  return m;
end $$;
alter function app.enter_store(uuid, text[]) owner to smart_scan_api;

-- ---------- First API functions (the rest come with Phase 2) ----------

-- The stores the signed-in person can use, for sign-in and (later) the store switcher.
create or replace function public.my_stores() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if app.uid() is null then perform app.fail('unauthorized', 'Your session has ended. Please sign in again.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('storeId', s.id, 'storeName', s.name, 'username', m.username,
      'role', m.role, 'permissions', to_jsonb(m.permissions)) order by s.name)
    from app.store_members m join app.stores s on s.id = m.store_id
    where m.user_id = app.uid() and m.active), '[]'::jsonb);
end $$;
alter function public.my_stores() owner to smart_scan_api;

-- Who's signed in to this store (today's `me`).
create or replace function public.me(p_store uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare m app.store_members;
begin
  m := app.enter_store(p_store);
  return jsonb_build_object('username', m.username, 'role', m.role, 'permissions', to_jsonb(m.permissions),
    'storeName', (select name from app.stores where id = p_store));
end $$;
alter function public.me(uuid) owner to smart_scan_api;

-- Only signed-in people may call the API; Supabase grants new functions to anon by default.
revoke execute on function public.my_stores(), public.me(uuid) from public, anon;
grant execute on function public.my_stores(), public.me(uuid) to authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on all functions in schema app to smart_scan_api;
revoke create on schema app, public from smart_scan_api;
