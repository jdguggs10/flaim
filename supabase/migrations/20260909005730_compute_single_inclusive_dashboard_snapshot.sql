-- FLA-264: compute the human dashboard payload once per five-minute refresh.
--
-- Human analytics consumers now read only the internal-inclusive snapshot
-- (id=2). Keep the external snapshot row (id=1) unchanged for comparison and
-- manual recovery, but stop rebuilding it on the compatibility/no-argument
-- path. The boolean overload remains available to refresh either row
-- explicitly.
-- Provider flags use their own function, relation, and cron job; this migration
-- changes none of them and creates no schedule.

create or replace function analytics.refresh_dashboard_snapshot()
returns void
language plpgsql
set search_path to ''
as $function$
begin
  insert into analytics.dashboard_snapshot (id, payload, computed_at)
  values (2, analytics.dashboard_payload(true), now())
  on conflict (id) do update
  set payload = excluded.payload,
      computed_at = excluded.computed_at;
end;
$function$;
