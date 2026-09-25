#!/usr/bin/env bash
# Genuine two-session concurrency proof for the FLA-396 signup log.
#
# The rollback-only signup_log.sql proof exercises record_signup and
# purge_account_data sequentially in one transaction, so it can prove the
# tombstone-aware RESULT but not the mutual exclusion that produces it. That
# property only exists when two real sessions contend for the same per-user
# advisory lock, which is what this script races -- the same pattern as
# account_deletions_concurrency.sh and token_rpc_concurrency.sh.
#
# Both orders matter and neither may raise. record_signup deliberately does NOT
# carry the anti-resurrection guard trigger: a late user.created retry after a
# purge must record the signup with NULL attribution and return normally, or
# Svix burns all eight attempts on an event that is correct to record.

set -euo pipefail

readonly DB_CONTAINER="supabase_db_flaim"
readonly RECORD_FIRST_USER="signup_conc_record_first_user"
readonly PURGE_FIRST_USER="signup_conc_purge_first_user"
readonly CREATED_AT="2026-05-04 15:00:00+00"
readonly FIRST_TOUCH='{"schemaVersion":1,"landingPath":"/","utmSource":"reddit"}'

tmp_dir="$(mktemp -d)"

psql_exec() {
  docker exec -i "${DB_CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

cleanup_rows() {
  psql_exec -q -c "
    delete from public.signup_log where clerk_user_id in ('${RECORD_FIRST_USER}', '${PURGE_FIRST_USER}');
    delete from public.account_deletions where clerk_user_id in ('${RECORD_FIRST_USER}', '${PURGE_FIRST_USER}');
  " >/dev/null
}

cleanup() {
  cleanup_rows || true
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

cleanup_rows

assert_no_deadlock() {
  local label="$1"
  if grep -qi "deadlock detected" "${tmp_dir}"/*.log; then
    printf '%s: a deadlock was detected\n' "${label}" >&2
    grep -il "deadlock detected" "${tmp_dir}"/*.log | while read -r f; do cat "${f}" >&2; done
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Scenario 1: record-first. record_signup commits attribution first, holding
# the per-user advisory lock for its transaction. A concurrent purge must block
# on that same lock until the writer commits, then must find the committed row
# and null its attribution -- without deleting it.
# ---------------------------------------------------------------------------
psql_exec -q -c "
  set role service_role;
  begin;
  select public.record_signup('${RECORD_FIRST_USER}', timestamptz '${CREATED_AT}', '${FIRST_TOUCH}'::jsonb, 'webhook');
  select pg_sleep(2);
  commit;
" > "${tmp_dir}/record-first-writer.log" 2>&1 &
writer_pid=$!

sleep 0.5
start_ns=$(date +%s%N)
psql_exec -Atq -c "
  set role service_role;
  select public.purge_account_data('${RECORD_FIRST_USER}');
" > "${tmp_dir}/record-first-purge.log" 2>&1
end_ns=$(date +%s%N)

wait "${writer_pid}"
assert_no_deadlock 'record-first'

elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
if [[ "${elapsed_ms}" -lt 1200 ]]; then
  printf 'record-first: purge did not block on the writer'"'"'s lock (elapsed %sms, expected >= ~1200ms)\n' \
    "${elapsed_ms}" >&2
  cat "${tmp_dir}/record-first-purge.log" >&2
  exit 1
fi

state="$(psql_exec -Atq -c "
  select count(*) || ':' || count(first_touch)
  from public.signup_log where clerk_user_id = '${RECORD_FIRST_USER}';
")"
if [[ "${state}" != "1:0" ]]; then
  printf 'record-first: expected the signup row retained with null attribution, found rows:attributed = %s\n' \
    "${state}" >&2
  exit 1
fi

printf 'record-first: PASS (purge blocked %sms on the writer'"'"'s lock, then redacted the committed row without deleting it)\n' \
  "${elapsed_ms}"

# ---------------------------------------------------------------------------
# Scenario 2: purge-first. The purge takes the per-user advisory lock and holds
# it (manually, then reentrantly inside purge_account_data) across a delay. A
# concurrent record_signup for the same user must block on the same lock, then
# see the committed tombstone, record the signup anyway, and write NULL
# attribution -- returning normally, raising nothing.
# ---------------------------------------------------------------------------
psql_exec -q -c "
  set role service_role;
  begin;
  select pg_advisory_xact_lock(public.account_deletion_lock_key('${PURGE_FIRST_USER}'));
  select pg_sleep(2);
  select public.purge_account_data('${PURGE_FIRST_USER}');
  commit;
" > "${tmp_dir}/purge-first-purge.log" 2>&1 &
purge_pid=$!

sleep 0.5
start_ns=$(date +%s%N)
writer_exit=0
psql_exec -q -c "
  set role service_role;
  select public.record_signup('${PURGE_FIRST_USER}', timestamptz '${CREATED_AT}', '${FIRST_TOUCH}'::jsonb, 'webhook');
" > "${tmp_dir}/purge-first-writer.log" 2>&1 || writer_exit=$?
end_ns=$(date +%s%N)

wait "${purge_pid}"
assert_no_deadlock 'purge-first'

elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
if [[ "${elapsed_ms}" -lt 1200 ]]; then
  printf 'purge-first: writer did not block on the purge'"'"'s lock (elapsed %sms, expected >= ~1200ms)\n' \
    "${elapsed_ms}" >&2
  cat "${tmp_dir}/purge-first-writer.log" >&2
  exit 1
fi

if [[ "${writer_exit}" != "0" ]]; then
  printf 'purge-first: record_signup raised after the tombstone committed; it must record the signup silently\n' >&2
  cat "${tmp_dir}/purge-first-writer.log" >&2
  exit 1
fi

state="$(psql_exec -Atq -c "
  select count(*) || ':' || count(first_touch)
  from public.signup_log where clerk_user_id = '${PURGE_FIRST_USER}';
")"
if [[ "${state}" != "1:0" ]]; then
  printf 'purge-first: expected the signup recorded with null attribution, found rows:attributed = %s\n' \
    "${state}" >&2
  exit 1
fi

printf 'purge-first: PASS (writer blocked %sms on the purge'"'"'s lock, then recorded the signup with attribution suppressed)\n' \
  "${elapsed_ms}"
