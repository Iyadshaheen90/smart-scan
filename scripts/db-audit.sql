select jsonb_build_object(
 'functions', (select jsonb_agg(jsonb_build_object('f', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
     'owner', r.rolname, 'secdef', p.prosecdef, 'config', p.proconfig,
     'acl', (select jsonb_agg(coalesce(g.rolname,'PUBLIC') order by 1) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles g on g.oid = a.grantee where a.privilege_type='EXECUTE')) order by 1)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
   where n.nspname in ('app','public')),
 'tables', (select jsonb_agg(jsonb_build_object('t', n.nspname||'.'||c.relname, 'kind', c.relkind, 'owner', r.rolname, 'rls', c.relrowsecurity, 'force', c.relforcerowsecurity,
     'acl', c.relacl::text,
     'policies', (select jsonb_agg(jsonb_build_object('name', pol.polname, 'cmd', pol.polcmd, 'roles', (select jsonb_agg(rolname) from pg_roles where oid = any(pol.polroles)), 'using', pg_get_expr(pol.polqual, pol.polrelid), 'check', pg_get_expr(pol.polwithcheck, pol.polrelid))) from pg_policy pol where pol.polrelid=c.oid)) order by 1)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner
   where n.nspname in ('app','public') and c.relkind in ('r','v','m','S','p')),
 'schemas', (select jsonb_agg(jsonb_build_object('s', nspname, 'owner', nspowner::regrole::text, 'acl', nspacl::text)) from pg_namespace where nspname in ('app','public')),
 'defaults', (select jsonb_agg(jsonb_build_object('role', defaclrole::regrole::text, 'schema', defaclnamespace::regnamespace::text, 'type', defaclobjtype, 'acl', defaclacl::text)) from pg_default_acl),
 'role', (select jsonb_agg(jsonb_build_object('r', rolname, 'super', rolsuper, 'bypass', rolbypassrls, 'login', rolcanlogin, 'memberof', (select jsonb_agg(b.rolname) from pg_auth_members m join pg_roles b on b.oid=m.roleid where m.member=pg_roles.oid))) from pg_roles where rolname in ('smart_scan_api','authenticated','anon','service_role','authenticator','postgres')),
 'migrations', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations)
) as audit;
