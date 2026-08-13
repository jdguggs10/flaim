-- Behavioral proof for the FLA-264 provider-flags snapshot and the
-- per-variant dashboard refresh.
--
-- Run only against a reset local database. Every row it writes is synthetic,
-- and the transaction rolls back:
--   docker cp supabase/tests/provider_flags.sql supabase_db_flaim:/tmp/provider_flags.sql
--   docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/provider_flags.sql

begin;

do $proof$
declare
  frozen constant timestamptz := timestamptz '2020-01-01 00:00:00+00';
  external_payload jsonb;
  internal_payload jsonb;
  actual_count bigint;
begin
  -- The dedicated payload must be exactly the dashboard payload's sync_recent
  -- key, for both variants. This is the contract that lets a consumer switch
  -- sources without changing what it reads.
  if analytics.provider_flags_payload(false)
     is distinct from (analytics.dashboard_payload(false) -> 'sync_recent') then
    raise exception 'external provider payload diverges from dashboard sync_recent';
  end if;

  if analytics.provider_flags_payload(true)
     is distinct from (analytics.dashboard_payload(true) -> 'sync_recent') then
    raise exception 'internal provider payload diverges from dashboard sync_recent';
  end if;

  -- Each refresh function owns its own relation's timestamp. A dashboard
  -- refresh that stamped the provider row (or the reverse) would let a
  -- consumer read one relation's freshness off the other's cadence.
  update analytics.provider_flags_snapshot set computed_at = frozen;
  perform analytics.refresh_dashboard_snapshot();

  if exists (
    select 1 from analytics.provider_flags_snapshot where computed_at <> frozen
  ) then
    raise exception 'the dashboard refresh moved the provider flags timestamp';
  end if;

  update analytics.dashboard_snapshot set computed_at = frozen;
  perform analytics.refresh_provider_flags_snapshot();

  if exists (
    select 1 from analytics.dashboard_snapshot where computed_at <> frozen
  ) then
    raise exception 'the provider flags refresh moved the dashboard timestamp';
  end if;

  if exists (
    select 1 from analytics.provider_flags_snapshot where computed_at is null
  ) then
    raise exception 'the provider flags refresh left computed_at unpopulated';
  end if;

  -- Per-variant dashboard refresh. internal_user_count is an unfiltered count
  -- over analytics.internal_users, so adding a row changes both variants'
  -- payloads — which makes it a clean probe for which row was rebuilt.
  update analytics.dashboard_snapshot set computed_at = frozen;
  perform analytics.refresh_dashboard_snapshot();

  insert into analytics.internal_users (user_id, note)
  values ('synthetic-test-internal-user', 'rolled back by this proof');

  perform analytics.refresh_dashboard_snapshot(false);

  select count(*) into actual_count
  from analytics.dashboard_snapshot
  where (id = 1 and (payload ->> 'internal_user_count')::int = 2)
     or (id = 2 and (payload ->> 'internal_user_count')::int = 1);
  if actual_count <> 2 then
    raise exception 'refresh_dashboard_snapshot(false) did not refresh id=1 alone';
  end if;

  -- id=2 is the load-bearing half here: it read 1 immediately above and must
  -- now read 2. Asserting it alone keeps the proof honest, since id=1 would
  -- already read 2 from the previous call whether or not this one did
  -- anything.
  perform analytics.refresh_dashboard_snapshot(true);

  if (
    select (payload ->> 'internal_user_count')::int
    from analytics.dashboard_snapshot
    where id = 2
  ) <> 2 then
    raise exception 'refresh_dashboard_snapshot(true) did not refresh id=2';
  end if;

  -- Provider absence: with no sync state at all, both variants are an empty
  -- array, not a set of invented zero rows.
  delete from public.provider_sync_state;
  perform analytics.refresh_provider_flags_snapshot();

  select providers into external_payload
  from analytics.provider_flags_snapshot where id = 1;
  select providers into internal_payload
  from analytics.provider_flags_snapshot where id = 2;

  if external_payload <> '[]'::jsonb or internal_payload <> '[]'::jsonb then
    raise exception 'empty provider sync state did not produce empty arrays: % / %',
      external_payload,
      internal_payload;
  end if;

  -- A single failing provider produces exactly one row, and only for that
  -- provider.
  insert into public.provider_sync_state (
    clerk_user_id,
    provider,
    last_attempt_at,
    last_failure_at,
    last_error_code,
    last_sync_source,
    updated_at
  ) values (
    'synthetic-test-sync-user',
    'sleeper',
    now() - interval '1 minute',
    now() - interval '1 minute',
    'SYNTHETIC_TEST_SYNC_ERROR',
    'proof',
    now() - interval '1 minute'
  );

  perform analytics.refresh_provider_flags_snapshot();

  select providers into external_payload
  from analytics.provider_flags_snapshot where id = 1;

  if jsonb_array_length(external_payload) <> 1
     or not exists (
       select 1
       from jsonb_array_elements(external_payload) as item
       where item ->> 'provider' = 'sleeper'
         and (item ->> 'users_failed_6h')::int = 1
         and (item ->> 'users_succeeded_6h')::int = 0
         and item -> 'recent_error_codes'
             = '["SYNTHETIC_TEST_SYNC_ERROR"]'::jsonb
     ) then
    raise exception 'single-provider failure payload is wrong: %', external_payload;
  end if;

  -- Aging the failure past the six-hour window zeroes the counts and empties
  -- the error codes, but the provider keeps its row: the grouping sees every
  -- sync-state row, and only the counters are windowed. A provider with no
  -- sync-state row at all is what produces no row (asserted above).
  update public.provider_sync_state
  set last_attempt_at = now() - interval '7 hours',
      last_failure_at = now() - interval '7 hours',
      updated_at = now() - interval '7 hours'
  where clerk_user_id = 'synthetic-test-sync-user';

  perform analytics.refresh_provider_flags_snapshot();

  select providers into external_payload
  from analytics.provider_flags_snapshot where id = 1;

  if jsonb_array_length(external_payload) <> 1
     or not exists (
       select 1
       from jsonb_array_elements(external_payload) as item
       where item ->> 'provider' = 'sleeper'
         and (item ->> 'users_failed_6h')::int = 0
         and jsonb_array_length(item -> 'recent_error_codes') = 0
     ) then
    raise exception 'stale failures were not aged out of the window: %',
      external_payload;
  end if;
end;
$proof$;

rollback;

select 'provider flags snapshot behavior verified' as result;
