-- FLA-265: make the already-proven history payload the canonical dashboard
-- reader for fresh environments. CREATE OR REPLACE deliberately preserves the
-- existing function owner and ACL; the owner-run snapshot refresh remains the
-- only consumer of the owner-only history sibling.
--
-- On an existing hosted database, initialize and verify ET history before
-- applying this migration. A fresh reset applies all migrations first and then
-- performs that initialization in seed.sql before its first snapshot refresh.

create or replace function analytics.dashboard_payload(include_internal boolean)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $function$
  select analytics.dashboard_payload_history(include_internal);
$function$;
