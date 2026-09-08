#!/usr/bin/env bash

# Behavioral proof that the platform/sport history migration refuses to
# reinterpret an already-used ET aggregate. The reset database already has the
# migration applied, so each scenario temporarily restores the old columns and
# constraint inside one database transaction, runs the real migration file,
# and then rolls the entire scenario back. A lost client connection also rolls
# it back, leaving no committed fixture or schema change.

set -euo pipefail

readonly DB_CONTAINER="supabase_db_flaim"
readonly MIGRATION_SQL="supabase/migrations/20260906120524_add_platform_sport_to_et_history.sql"
readonly CONTAINER_MIGRATION_SQL="/tmp/analytics_history_dimensions_migration.sql"

psql_exec() {
  docker exec -i "${DB_CONTAINER}" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

capture_reset_history_state() {
  psql_exec -Atq -c "
    select jsonb_build_object(
      'aggregate', coalesce(
        (
          select jsonb_agg(
            to_jsonb(d)
            order by
              d.et_day,
              d.env,
              d.user_id,
              d.auth_type,
              d.client_name nulls first,
              d.platform nulls first,
              d.sport nulls first,
              d.call_count
          )
          from public.mcp_user_daily_et as d
        ),
        '[]'::jsonb
      ),
      'marker', coalesce(
        (
          select jsonb_agg(to_jsonb(s) order by s.id)
          from analytics.history_rollup_state as s
        ),
        '[]'::jsonb
      )
    )::text;
  "
}

readonly EXPECTED_RESET_HISTORY_STATE="$(capture_reset_history_state)"

assert_reset_posture() {
  local actual_reset_history_state

  psql_exec -q -c "
    do \$assert\$
    declare
      actual_columns text[];
      actual_constraint text;
    begin
      select array_agg(a.attname order by a.attnum)
      into actual_columns
      from pg_catalog.pg_attribute as a
      where a.attrelid = 'public.mcp_user_daily_et'::regclass
        and a.attnum > 0
        and not a.attisdropped;

      if actual_columns <> array[
        'et_day', 'env', 'user_id', 'auth_type', 'client_name',
        'call_count', 'platform', 'sport'
      ]::text[] then
        raise exception 'dimension guard left unexpected columns: %', actual_columns;
      end if;

      select pg_catalog.pg_get_constraintdef(c.oid)
      into actual_constraint
      from pg_catalog.pg_constraint as c
      where c.conrelid = 'public.mcp_user_daily_et'::regclass
        and c.conname = 'mcp_user_daily_et_grain';

      if actual_constraint <> 'UNIQUE NULLS NOT DISTINCT (et_day, env, user_id, auth_type, client_name, platform, sport)' then
        raise exception 'dimension guard left unexpected unique grain: %', actual_constraint;
      end if;

      if not exists (
        select 1
        from analytics.history_rollup_state as s
        where s.id
          and s.initial_history_start_et_day is not null
          and s.last_closed_et_day is not null
          and s.initial_history_start_et_day <= s.last_closed_et_day
      ) then
        raise exception 'dimension guard did not retain initialized analytics history';
      end if;

      if exists (
        select 1 from cron.job where jobname = 'mcp-et-history-close'
      ) then
        raise exception 'dimension migration activated the history-close job';
      end if;
    end;
    \$assert\$;
  " >/dev/null

  actual_reset_history_state="$(capture_reset_history_state)"
  if [[ "${actual_reset_history_state}" != "${EXPECTED_RESET_HISTORY_STATE}" ]]; then
    printf 'Dimension migration guard changed the seeded history rows or marker.\n' >&2
    exit 1
  fi
}

readonly RESTORE_OLD_GRAIN_SQL="
  truncate public.mcp_user_daily_et;
  update analytics.history_rollup_state
    set initial_history_start_et_day = null,
        last_closed_et_day = null,
        updated_at = now()
    where id;
  alter table public.mcp_user_daily_et
    drop constraint mcp_user_daily_et_grain;
  alter table public.mcp_user_daily_et
    drop column platform,
    drop column sport;
  alter table public.mcp_user_daily_et
    add constraint mcp_user_daily_et_grain unique nulls not distinct (
      et_day,
      env,
      user_id,
      auth_type,
      client_name
    );
"

run_refusal_case() {
  local label=$1 fixture_sql=$2 expected_message=$3 output status

  set +e
  output="$(
    docker exec -i "${DB_CONTAINER}" \
      psql -X -v ON_ERROR_STOP=0 -U postgres -d postgres \
      -c "begin; ${RESTORE_OLD_GRAIN_SQL} ${fixture_sql}" \
      -f "${CONTAINER_MIGRATION_SQL}" \
      -c "rollback;" 2>&1
  )"
  status=$?
  set -e

  if [[ "${output}" != *"${expected_message}"* ]]; then
    printf 'Dimension migration guard (%s): expected error [%s].\n' \
      "${label}" "${expected_message}" >&2
    printf '%s\n' "${output}" >&2
    exit 1
  fi

  # ON_ERROR_STOP is deliberately disabled so psql reaches ROLLBACK after the
  # expected error. Accept either status, but independently prove the enclosing
  # transaction restored the reset schema and fixtures.
  if (( status != 0 && status != 1 )); then
    printf 'Dimension migration guard (%s): unexpected psql status %s.\n' \
      "${label}" "${status}" >&2
    printf '%s\n' "${output}" >&2
    exit 1
  fi
  assert_reset_posture
}

assert_reset_posture
docker cp "${MIGRATION_SQL}" "${DB_CONTAINER}:${CONTAINER_MIGRATION_SQL}" >/dev/null

run_refusal_case \
  "initialized marker" \
  "update analytics.history_rollup_state
     set initial_history_start_et_day = current_date - 2,
         last_closed_et_day = current_date - 1,
         updated_at = now()
     where id;" \
  "platform/sport history migration requires an uninitialized analytics history"

run_refusal_case \
  "aggregate row with uninitialized marker" \
  "insert into public.mcp_user_daily_et (
     et_day, env, user_id, auth_type, client_name, call_count
   ) values (
     current_date - 1, 'prod', 'history-dimension-guard', 'oauth', null, 1
   );" \
  "platform/sport history migration requires an empty ET aggregate"

# The only permitted posture is both empty and uninitialized. Capture the
# parity sibling before the migration and prove the successful migration does
# not replace it, populate either history relation, or activate scheduling.
psql_exec -q \
  -c "
    begin;
    create temp table expected_history_payload_definition as
      select pg_catalog.pg_get_functiondef(
        'analytics.dashboard_payload_history(boolean)'::regprocedure
      ) as definition;
    ${RESTORE_OLD_GRAIN_SQL}
  " \
  -f "${CONTAINER_MIGRATION_SQL}" \
  -c "
    do \$assert\$
    begin
      if (
        select definition
        from pg_temp.expected_history_payload_definition
      ) is distinct from pg_catalog.pg_get_functiondef(
        'analytics.dashboard_payload_history(boolean)'::regprocedure
      ) then
        raise exception 'dimension migration changed the parity dashboard sibling';
      end if;

      if exists (select 1 from public.mcp_user_daily_et)
        or exists (
          select 1
          from analytics.history_rollup_state as s
          where s.id
            and (
              s.initial_history_start_et_day is not null
              or s.last_closed_et_day is not null
            )
        )
      then
        raise exception 'dimension migration backfilled or initialized history';
      end if;

      if exists (
        select 1 from cron.job where jobname = 'mcp-et-history-close'
      ) then
        raise exception 'dimension migration activated the history-close job';
      end if;
    end;
    \$assert\$;
    rollback;
  " >/dev/null

assert_reset_posture
printf 'Analytics history dimension migration guard: PASS.\n'
