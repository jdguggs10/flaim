#!/usr/bin/env bash

# Behavioral proof for the FLA-264 phase 2 cutover artifact.
#
# The artifact is the one file in this repo that changes production scheduling,
# and its failure mode is silent: a cutover applied too early leaves the
# provider-failure consumer reading an hourly snapshot it cannot distinguish
# from a fresh one. So the guard is tested by running the real file, under the
# invocations an operator would actually use, and asserting what the local
# scheduler ends up holding.
#
# Scenarios:
#   1. Preconditions unmet, no ON_ERROR_STOP — the invocation that steps over a
#      guard that only raises. Nothing may be activated.
#   2. Stale history under a previous command. cron.schedule() updates a job
#      with an existing name in place and keeps its jobid, so successes logged
#      before the command changed must not vouch for the current one.
#   3. Every precondition genuinely met — the cutover must apply, and apply
#      exactly the two expected schedules.
#
# Run only against a reset local database. It leaves the scheduler empty.

set -euo pipefail

readonly DB_CONTAINER="supabase_db_flaim"
readonly CUTOVER_SQL="supabase/cron/production-cadence-cutover.sql"
readonly JOB_NAME="provider-flags-snapshot"
readonly REFRESH_COMMAND="select analytics.refresh_provider_flags_snapshot();"
readonly ACK="-c flaim.flags_consumer_verified=yes"

psql_quiet() {
  docker exec -i "${DB_CONTAINER}" \
    psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c "$1" >/dev/null
}

psql_value() {
  docker exec -i "${DB_CONTAINER}" \
    psql -At -U postgres -d postgres -c "$1"
}

# Deliberately without ON_ERROR_STOP: psql continues past a failed statement by
# default, which is exactly how a guard that only raises gets stepped over.
run_cutover() {
  docker exec -i -e PGOPTIONS="${1}" "${DB_CONTAINER}" \
    psql -U postgres -d postgres -f - < "${CUTOVER_SQL}" >/dev/null 2>&1 || true
}

clear_scheduler() {
  psql_quiet "
    select cron.unschedule(jobname) from cron.job;
    delete from cron.job_run_details;
  "
}

trap clear_scheduler EXIT

assert_jobs() {
  local expected=$1 context=$2 actual
  actual="$(psql_value "
    select coalesce(
      string_agg(jobname || '@' || schedule, ',' order by jobname collate \"C\"),
      ''
    )
    from cron.job;
  ")"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'Cutover guard (%s): expected jobs [%s], found [%s].\n' \
      "${context}" "${expected}" "${actual}" >&2
    exit 1
  fi
}

# Waits for the scheduler to log successful runs of a specific command. pg_cron
# supports sub-minute schedules, so this is seconds, not minutes.
await_successes() {
  local command=$1 wanted=$2 attempt count
  for attempt in $(seq 1 30); do
    count="$(psql_value "
      select count(*) from cron.job_run_details
      where status = 'succeeded' and command = \$cmd\$${command}\$cmd\$;
    ")"
    if (( count >= wanted )); then
      return 0
    fi
    sleep 1
  done
  printf 'Cutover guard: the local scheduler never logged %s successful run(s) of [%s].\n' \
    "${wanted}" "${command}" >&2
  exit 1
}

clear_scheduler

# --- 1. Preconditions unmet ------------------------------------------------

run_cutover ""
run_cutover "${ACK}"
assert_jobs "" "preconditions unmet"

# --- 2. Successful history belonging to a previous command -----------------

psql_quiet "select cron.schedule('${JOB_NAME}', '1 seconds', \$job\$select 1;\$job\$);"
await_successes "select 1;" 2

# Same job name, so the jobid is preserved and the earlier runs stay attached
# to it — while the command they ran is not the one being vouched for.
psql_quiet "
  select cron.schedule('${JOB_NAME}', '*/5 * * * *', \$job\$${REFRESH_COMMAND}\$job\$);
"

if [[ "$(psql_value "
  select count(*) from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where j.jobname = '${JOB_NAME}' and d.status = 'succeeded';
")" -lt 2 ]]; then
  printf 'Cutover guard: the stale-history scenario did not retain its runs.\n' >&2
  exit 1
fi

run_cutover "${ACK}"
assert_jobs "${JOB_NAME}@*/5 * * * *" "stale history under a previous command"

# --- 3. Every precondition met ---------------------------------------------

psql_quiet "select cron.schedule('${JOB_NAME}', '1 seconds', \$job\$${REFRESH_COMMAND}\$job\$);"
await_successes "${REFRESH_COMMAND}" 2
psql_quiet "
  select cron.schedule('${JOB_NAME}', '*/5 * * * *', \$job\$${REFRESH_COMMAND}\$job\$);
"

run_cutover "${ACK}"
assert_jobs "dashboard-snapshot@7 * * * *,dashboard-snapshot-internal@10 6 * * *,${JOB_NAME}@*/5 * * * *" \
  "preconditions met"

clear_scheduler
assert_jobs "" "after cleanup"

printf 'Phase 2 cutover guard blocks and permits correctly.\n'
