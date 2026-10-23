-- Supabase's security check (db advisors, lint 0011): the helpers get a fixed search_path like the API functions,
-- so nothing a caller puts on its search_path can stand in for what they use. They name everything by schema already.
alter function app.uid() set search_path = '';
alter function app.current_store_id() set search_path = '';
alter function app.fail(text, text) set search_path = '';
