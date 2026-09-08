#!/usr/bin/env bash
# Behavioral proof for the FLA-265 production-only activation and read-path
# cutover artifacts. Both artifacts are intentionally tested as an operator
# might run them: through psql *without* ON_ERROR_STOP. Their transactions must
# make a failed guard a real no-op rather than merely an error message.

set -euo pipefail

readonly DB_CONTAINER="supabase_db_flaim"
readonly ACTIVATE_SQL="supabase/cron/analytics-history.sql"
readonly CUTOVER_SQL="supabase/cron/analytics-history-cutover.sql"
readonly RAW_DASHBOARD_SQL="supabase/migrations/20260802131749_add_sync_recent_dashboard_payload.sql"
readonly CLOSE_JOB="mcp-et-history-close"
readonly CLOSE_COMMAND="select public.close_mcp_user_daily_et();"
readonly GUARD_USER="history-guard-close"

tmp_dir="$(mktemp -d)"
original_payload_sql="${tmp_dir}/dashboard_payload_before.sql"

psql_quiet() {
  docker exec -i "${DB_CONTAINER}" \
    psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c "$1" >/dev/null
}

psql_value() {
  docker exec -i "${DB_CONTAINER}" \
    psql -At -U postgres -d postgres -c "$1"
}

run_artifact() {
  local pgoptions=$1 artifact=$2
  # Deliberately no ON_ERROR_STOP: a guard that only raises is not sufficient.
  docker exec -i -e PGOPTIONS="${pgoptions}" "${DB_CONTAINER}" \
    psql -U postgres -d postgres -f - < "${artifact}" >/dev/null 2>&1 || true
}

clear_history_job() {
  psql_quiet "
    select cron.unschedule(jobid)
    from cron.job
    where jobname = '${CLOSE_JOB}';
    delete from cron.job_run_details
    where command = \$cmd\$${CLOSE_COMMAND}\$cmd\$;
  "
}

reset_history_state() {
  psql_quiet "
    truncate public.mcp_user_daily_et;
    update analytics.history_rollup_state
    set initial_history_start_et_day = null,
        last_closed_et_day = null,
        updated_at = now()
    where id;
  "
}

restore_seed_history_state() {
  reset_history_state
  psql_quiet "
    select public.close_mcp_user_daily_et(
      (now() at time zone 'America/New_York')::date - 1,
      (now() at time zone 'America/New_York')::date - 1
    );
    select analytics.refresh_dashboard_snapshot();
  "
}

clear_guard_fixture() {
  psql_quiet "
    delete from public.mcp_tool_events
    where user_id = '${GUARD_USER}';
  "
}

restore_payload() {
  if [[ -s "${original_payload_sql}" ]]; then
    docker exec -i "${DB_CONTAINER}" \
      psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f - \
      < "${original_payload_sql}" >/dev/null
  fi
}

install_raw_payload() {
  docker exec -i "${DB_CONTAINER}" \
    psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f - \
    < "${RAW_DASHBOARD_SQL}" >/dev/null
}

cleanup() {
  restore_payload || true
  clear_history_job || true
  clear_guard_fixture || true
  restore_seed_history_state || true
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

assert_close_job() {
  local expected=$1 actual
  actual="$(psql_value "
    select coalesce(
      string_agg(jobname || '@' || schedule || '@' || command, ',' order by jobid),
      ''
    )
    from cron.job
    where jobname = '${CLOSE_JOB}';
  ")"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'analytics-history guard: expected close job [%s], found [%s].\n' \
      "${expected}" "${actual}" >&2
    exit 1
  fi
}

await_command_success() {
  local command=$1 attempt count
  for attempt in $(seq 1 20); do
    count="$(psql_value "
      select count(*)
      from cron.job_run_details
      where status = 'succeeded'
        and command = \$cmd\$${command}\$cmd\$;
    ")"
    if (( count >= 1 )); then
      return 0
    fi
    sleep 1
  done
  printf 'analytics-history guard: local scheduler never logged success for [%s].\n' "${command}" >&2
  exit 1
}

clear_history_job
clear_guard_fixture
restore_seed_history_state

# Save the canonical wrapper so this production-artifact proof can restore the
# reset contract on every exit path. Then install the last raw-only reader as
# the production cutover's true before-state; its refresh is safe because the
# seeded marker is initialized.
psql_value "
  select pg_get_functiondef('analytics.dashboard_payload(boolean)'::regprocedure);
" > "${original_payload_sql}"
install_raw_payload
payload_before="$(psql_value "
  select md5(pg_get_functiondef('analytics.dashboard_payload(boolean)'::regprocedure));
")"
identity_before="$(psql_value "
  select pg_get_userbyid(proowner) || '|' || coalesce(proacl::text, '')
  from pg_proc
  where oid = 'analytics.dashboard_payload(boolean)'::regprocedure;
")"
reset_history_state

# 1. No acknowledgement and then acknowledged-but-uninitialized both leave no
# job behind. Each invocation lacks ON_ERROR_STOP by design.
run_artifact "" "${ACTIVATE_SQL}"
run_artifact "-c flaim.analytics_history_close_approved=yes" "${ACTIVATE_SQL}"
assert_close_job ""

# 2. The cutover cannot change the existing payload without its explicit
# approval, even if the state and daily job happen to look ready later.
psql_quiet "
  update analytics.history_rollup_state
  set initial_history_start_et_day = (now() at time zone 'America/New_York')::date - 7,
      last_closed_et_day = (now() at time zone 'America/New_York')::date - 1,
      updated_at = now()
  where id;
"
run_artifact "-c flaim.analytics_history_close_approved=yes" "${ACTIVATE_SQL}"
assert_close_job "${CLOSE_JOB}@0 6 * * *@${CLOSE_COMMAND}"

run_artifact "" "${CUTOVER_SQL}"
if [[ "$(psql_value "select md5(pg_get_functiondef('analytics.dashboard_payload(boolean)'::regprocedure));")" != "${payload_before}" ]]; then
  printf 'analytics-history guard: unacknowledged cutover changed dashboard_payload.\n' >&2
  exit 1
fi

# 3. A stale marker blocks the acknowledged cutover without changing the
# payload, even if the close job itself remains correctly configured.
psql_quiet "
  update analytics.history_rollup_state
  set last_closed_et_day = (now() at time zone 'America/New_York')::date - 2,
      updated_at = now()
  where id;
"
run_artifact "-c flaim.analytics_history_cutover_approved=yes" "${CUTOVER_SQL}"
if [[ "$(psql_value "select md5(pg_get_functiondef('analytics.dashboard_payload(boolean)'::regprocedure));")" != "${payload_before}" ]]; then
  printf 'analytics-history guard: stale-marker cutover changed dashboard_payload.\n' >&2
  exit 1
fi
psql_quiet "
  update analytics.history_rollup_state
  set last_closed_et_day = (now() at time zone 'America/New_York')::date - 1,
      updated_at = now()
  where id;
"

# 4. A current marker and exact active job still do not suffice until that
# exact command has actually succeeded. First retain a success for a previous
# command under the same job id, then put the exact close command back.
psql_quiet "
  select cron.schedule('${CLOSE_JOB}', '1 seconds', \$job\$select 1;\$job\$);
"
await_command_success "select 1;"
psql_quiet "
  select cron.schedule('${CLOSE_JOB}', '0 6 * * *', \$job\$${CLOSE_COMMAND}\$job\$);
"
run_artifact "-c flaim.analytics_history_cutover_approved=yes" "${CUTOVER_SQL}"
if [[ "$(psql_value "select md5(pg_get_functiondef('analytics.dashboard_payload(boolean)'::regprocedure));")" != "${payload_before}" ]]; then
  printf 'analytics-history guard: previous-command success incorrectly allowed cutover.\n' >&2
  exit 1
fi

# pg_cron accepts sub-minute schedules locally. Make yesterday genuinely
# unclosed and add a unique raw event before running the real close command.
# A bare successful no-op would not prove the activation path can advance the
# marker or persist a daily summary.
psql_quiet "
  update analytics.history_rollup_state
  set last_closed_et_day = (now() at time zone 'America/New_York')::date - 2,
      updated_at = now()
  where id;
  insert into public.mcp_tool_events (
    ts, env, user_id, auth_type, client_name, tool_name, platform, sport,
    status, error_code, latency_ms, league_hash
  ) values (
    (((now() at time zone 'America/New_York')::date - 1)::timestamp + interval '12 hours')
      at time zone 'America/New_York',
    'prod', '${GUARD_USER}', 'oauth', 'guard', 'get_roster', 'espn',
    'football', 'ok', null, 1, 'history-guard-close'
  );
"

# Run the real close command once at one-second cadence, then put the same job
# back on the exact production cadence. The job id and its matching command
# history remain intact.
psql_quiet "
  select cron.schedule('${CLOSE_JOB}', '1 seconds', \$job\$${CLOSE_COMMAND}\$job\$);
"
await_command_success "${CLOSE_COMMAND}"
if [[ "$(psql_value "
  select last_closed_et_day = (now() at time zone 'America/New_York')::date - 1
  from analytics.history_rollup_state
  where id;
")" != "t" ]]; then
  printf 'analytics-history guard: successful close did not advance the ET marker through yesterday.\n' >&2
  exit 1
fi
if [[ "$(psql_value "
  select count(*)::text || '|' || coalesce(sum(call_count), 0)::text
  from public.mcp_user_daily_et
  where et_day = (now() at time zone 'America/New_York')::date - 1
    and env = 'prod'
    and user_id = '${GUARD_USER}'
    and auth_type = 'oauth'
    and client_name = 'guard';
")" != "1|1" ]]; then
  printf 'analytics-history guard: successful close did not persist exactly one synthetic yesterday summary.\n' >&2
  exit 1
fi
psql_quiet "
  select cron.schedule('${CLOSE_JOB}', '0 6 * * *', \$job\$${CLOSE_COMMAND}\$job\$);
"
assert_close_job "${CLOSE_JOB}@0 6 * * *@${CLOSE_COMMAND}"

# 5. With all explicit gates met, cutover produces the thin wrapper and keeps
# the exact pre-existing owner/ACL. There are no job mutations in this file.
run_artifact "-c flaim.analytics_history_cutover_approved=yes" "${CUTOVER_SQL}"
wrapper_body_is_history="$(psql_value "
  select (
    lower(regexp_replace(prosrc, '[[:space:]]+', '', 'g')) =
      'selectanalytics.dashboard_payload_history(include_internal);'
  )::text
  from pg_proc
  where oid = 'analytics.dashboard_payload(boolean)'::regprocedure;
")"
if [[ "${wrapper_body_is_history}" != "true" ]]; then
  printf 'analytics-history guard: successful cutover did not install the history wrapper.\n' >&2
  exit 1
fi
wrapper_security="$(psql_value "
  select (
    not prosecdef
    and coalesce(proconfig, '{}'::text[]) @> array['search_path=\"\"']
  )::text
  from pg_proc
  where oid = 'analytics.dashboard_payload(boolean)'::regprocedure;
")"
if [[ "${wrapper_security}" != "true" ]]; then
  printf 'analytics-history guard: successful wrapper is not invoker with an empty search_path.\n' >&2
  exit 1
fi
wrapper_matches_sibling="$(psql_value "
  select (
    analytics.dashboard_payload(false) = analytics.dashboard_payload_history(false)
    and analytics.dashboard_payload(true) = analytics.dashboard_payload_history(true)
    and (analytics.dashboard_payload(false) ->> 'health_window_days') = '30'
    and (analytics.dashboard_payload(true) ->> 'health_window_days') = '30'
  )::text;
")"
if [[ "${wrapper_matches_sibling}" != "true" ]]; then
  printf 'analytics-history guard: wrapper does not execute as the sibling for both variants.\n' >&2
  exit 1
fi
if [[ "$(psql_value "
  select pg_get_userbyid(proowner) || '|' || coalesce(proacl::text, '')
  from pg_proc
  where oid = 'analytics.dashboard_payload(boolean)'::regprocedure;
")" != "${identity_before}" ]]; then
  printf 'analytics-history guard: cutover changed dashboard_payload owner or ACL.\n' >&2
  exit 1
fi
assert_close_job "${CLOSE_JOB}@0 6 * * *@${CLOSE_COMMAND}"

printf 'analytics-history activation and cutover guards block and permit correctly.\n'
