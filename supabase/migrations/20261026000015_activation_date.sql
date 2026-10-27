-- The day the lottery activated a slot's pack (owner 2026-10-26; setActivationDate in Slots.js). Usually the day it went
-- in, but a slow pack left in the back long enough is activated by the lottery on its own, so its settling clock started
-- earlier. Only the days counter reads activated_on (list_slots daysActive → Slots, the day-50 mark, Settling); sales
-- count from the tickets scanned. Owner only; any day from a year ago to today.
grant create on schema app, public to smart_scan_api;

create or replace function public.set_activation_date(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s text := case when jsonb_typeof(req -> 'date') = 'string' then req ->> 'date' else '' end;
  d date; days integer; cfg app.slots; cur app.packs;
begin
  perform app.enter_store(p_store, '{owner}');
  if s !~ '^\d{4}-\d{2}-\d{2}$' then perform app.fail('bad_date', 'Pick the day the lottery activated the pack.'); end if;
  begin
    d := s::date;
  exception when others then
    perform app.fail('bad_date', 'Pick the day the lottery activated the pack.');
  end;
  days := app.today() - d;
  if days < 0 then perform app.fail('bad_date', 'The activation date can''t be after today.'); end if;
  if days > 365 then perform app.fail('bad_date', 'That date is more than a year ago. Check the year.'); end if;
  perform app.lock_store();
  cfg := app.slot_of(req);
  if cfg.box is null then
    perform app.fail('no_slot', format('There''s no slot %s in box %s.', app.js_text(req -> 'slot'), app.js_text(req -> 'box')));
  end if;
  cur := app.live_in(cfg.box, cfg.slot_number);
  if cur.id is null then perform app.fail('slot_empty', 'This slot has no pack.'); end if;
  update app.packs set activated_on = d where id = cur.id;
  return jsonb_build_object('box', app.js_num(req -> 'box'), 'slot', app.js_num(req -> 'slot'), 'packKey', app.pack_key(cur),
    'activationDate', s, 'daysActive', days);
end $$;

alter function public.set_activation_date(uuid, jsonb) owner to smart_scan_api;
revoke execute on function public.set_activation_date(uuid, jsonb) from public, anon;
grant execute on function public.set_activation_date(uuid, jsonb) to authenticated;

revoke create on schema app, public from smart_scan_api;
