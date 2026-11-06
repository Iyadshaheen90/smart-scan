-- Delete several shift closes at once (owner 2026-11-06): delete_shift_close also takes req.shiftIds, a list, and removes
-- them together. One already gone is fine (another phone may have deleted it); nothing_to_delete only when none are left.
-- req.shiftId, for one, still works. Same as deleteShiftClose in Shifts.js.
create or replace function public.delete_shift_close(p_store uuid, req jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare gone text[];
begin
  perform app.enter_store(p_store, '{owner}');
  perform app.lock_store();
  if jsonb_typeof(req -> 'shiftIds') = 'array' then
    select coalesce(array_agg(t.id), '{}') into gone from jsonb_array_elements_text(req -> 'shiftIds') as t(id);
  else
    gone := array[coalesce(nullif(req ->> 'shiftId', ''), '')];
  end if;
  if not exists (select 1 from app.shift_closes where id = any(gone)) then
    perform app.fail('nothing_to_delete', 'That shift close isn''t saved any more.');
  end if;
  delete from app.shift_closes where id = any(gone);
  return app.shift_closes_json();
end $$;
