-- Activate Several (owner 2026-11-10; database only, live with the Dec 1 cutover): scan many packs, then one Activate All
-- puts each in its slot. Every row goes through activate_pack itself, so the checks, their order and the messages are the
-- same as putting one pack in on the slot page. Nothing on Sheets (the button is hidden there).
grant create on schema app, public to smart_scan_api;

-- req: { packs: [{ box, slot, gameNumber, packNumber, ticketNumber, oldPackEnd?, oldPackTicket?, overridePrice?,
--        gamePrice?, ticketsPerPack? }, …], check?: true }
-- The rows run one after another, so a later row sees what the earlier ones did. A refused row is answered on its own
-- row ({ ok: false, code, message }) and the others still run; a good row is { ok: true, …activate_pack's answer }.
-- check: true tries every row and keeps nothing (the page shows each row's problem before anything is saved).
-- Otherwise it saves only when every row is good: one bad row and nothing at all is saved (saved: false).
create or replace function public.activate_several(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  list jsonb := req -> 'packs'; check_only boolean := coalesce((req -> 'check') = 'true'::jsonb, false);
  answers jsonb := '[]'; r jsonb; failed boolean := false; msg text; code text;
  this_pack text; this_slot text; packs_seen text[] := '{}'; slots_seen text[] := '{}';
begin
  perform app.enter_store(p_store, '{load_packs}');
  if jsonb_typeof(list) is distinct from 'array' or jsonb_array_length(list) = 0 then
    perform app.fail('bad_request', 'Scan at least one pack.');
  end if;
  if jsonb_array_length(list) > 48 then
    perform app.fail('bad_request', 'That''s more packs than there are slots. Activate at most 48 at once.');
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

-- req: { slots: [{ box, slot, oldPack }, …] }: the packs Activate Several just put in. Undone last first: each
-- activation (undo_activation: the pack goes back to back stock if it came from there, the old slot price comes back),
-- then the pack it replaced (undo_end_pack) when there was one. All or nothing; a refusal names its slot.
create or replace function public.undo_activate_several(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare list jsonb := req -> 'slots'; r jsonb; msg text; code text; undone integer := 0;
begin
  perform app.enter_store(p_store, '{load_packs}');
  if jsonb_typeof(list) is distinct from 'array' or jsonb_array_length(list) = 0 then
    perform app.fail('nothing_to_undo', 'Nothing to undo.');
  end if;
  perform app.lock_store();
  for r in select x from jsonb_array_elements(list) with ordinality as t(x, n) order by n desc loop
    begin
      perform public.undo_activation(p_store, r);
      if (r -> 'oldPack') = 'true'::jsonb then perform public.undo_end_pack(p_store, r); end if;
      undone := undone + 1;
    exception when sqlstate 'P0001' then
      get stacked diagnostics msg = message_text, code = pg_exception_hint;
      if coalesce(code, '') = '' then raise; end if;
      perform app.fail(code, format('Box %s, slot %s: %s Nothing was undone.', app.js_text(r -> 'box'), app.js_text(r -> 'slot'), msg));
    end;
  end loop;
  return jsonb_build_object('undone', undone);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and pg_get_userbyid(p.proowner) = 'postgres'
      and p.proname in ('activate_several', 'undo_activate_several')
  loop
    execute format('alter function %s owner to smart_scan_api', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.activate_several(uuid, jsonb), public.undo_activate_several(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
