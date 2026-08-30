#!/usr/bin/env bash
# Genuine two-session concurrency proof for the FLA-311 advisory-lock guard.
# The rollback-only account_deletions.sql proof exercises the purge and the
# 13 guard triggers sequentially in one transaction; it cannot exercise the
# actual mutual-exclusion property, which only exists when two real sessions
# contend for the same per-user advisory lock. This script races two live
# `docker exec psql` sessions against a local reset, the same pattern used by
# token_rpc_concurrency.sh.

set -euo pipefail

readonly DB_CONTAINER="supabase_db_flaim"
readonly WRITER_WINS_USER="conc_writer_wins_user"
readonly PURGE_WINS_USER="conc_purge_wins_user"

tmp_dir="$(mktemp -d)"

psql_exec() {
  docker exec -i "${DB_CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

cleanup_rows() {
  psql_exec -q -c "
    delete from public.espn_credentials where clerk_user_id in ('${WRITER_WINS_USER}', '${PURGE_WINS_USER}');
    delete from public.account_deletions where clerk_user_id in ('${WRITER_WINS_USER}', '${PURGE_WINS_USER}');
  " >/dev/null
}

cleanup() {
  cleanup_rows || true
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

cleanup_rows

# ---------------------------------------------------------------------------
# Scenario 1: writer-wins. A writer's transaction commits first; the guard
# trigger it fires acquires the per-user advisory lock and holds it for the
# transaction's duration. A concurrent purge attempt must block on that same
# lock until the writer commits, then must still find and delete the row the
# writer just committed (the purge's delete list is unconditional).
# ---------------------------------------------------------------------------
psql_exec -q -c "
  set role service_role;
  begin;
  insert into public.espn_credentials (clerk_user_id, swid, s2, email)
    values ('${WRITER_WINS_USER}', '{TEST-SWID}', 'test-s2-value', 'test@example.com');
  select pg_sleep(2);
  commit;
" > "${tmp_dir}/writer-wins-writer.log" 2>&1 &
writer_pid=$!

sleep 0.5
start_ns=$(date +%s%N)
psql_exec -Atq -c "
  set role service_role;
  select public.purge_account_data('${WRITER_WINS_USER}');
" > "${tmp_dir}/writer-wins-purge.log" 2>&1
end_ns=$(date +%s%N)

wait "${writer_pid}"

elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
if [[ "${elapsed_ms}" -lt 1200 ]]; then
  printf 'writer-wins: purge did not block on the writer'"'"'s lock (elapsed %sms, expected >= ~1200ms)\n' \
    "${elapsed_ms}" >&2
  cat "${tmp_dir}/writer-wins-purge.log" >&2
  exit 1
fi

remaining="$(psql_exec -Atq -c "
  select count(*) from public.espn_credentials where clerk_user_id = '${WRITER_WINS_USER}';
")"
if [[ "${remaining}" != "0" ]]; then
  printf 'writer-wins: purge did not clean up the writer'"'"'s committed row (found %s)\n' \
    "${remaining}" >&2
  exit 1
fi

printf 'writer-wins: PASS (purge blocked %sms on the writer'"'"'s lock, then purged the committed row)\n' \
  "${elapsed_ms}"

# ---------------------------------------------------------------------------
# Scenario 2: purge-wins. The purge acquires the per-user advisory lock first
# and holds it (manually, then reentrantly inside purge_account_data itself)
# across a deliberate delay. A concurrent writer for the same user must block
# on the same lock until the purge commits, then its guard trigger must see
# the now-committed tombstone and reject the write.
# ---------------------------------------------------------------------------
psql_exec -q -c "
  set role service_role;
  begin;
  select pg_advisory_xact_lock(public.account_deletion_lock_key('${PURGE_WINS_USER}'));
  select pg_sleep(2);
  select public.purge_account_data('${PURGE_WINS_USER}');
  commit;
" > "${tmp_dir}/purge-wins-purge.log" 2>&1 &
purge_pid=$!

sleep 0.5
start_ns=$(date +%s%N)
writer_exit=0
psql_exec -q -c "
  set role service_role;
  insert into public.espn_credentials (clerk_user_id, swid, s2, email)
    values ('${PURGE_WINS_USER}', '{TEST-SWID}', 'test-s2-value', 'test@example.com');
" > "${tmp_dir}/purge-wins-writer.log" 2>&1 || writer_exit=$?
end_ns=$(date +%s%N)

wait "${purge_pid}"

elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
if [[ "${elapsed_ms}" -lt 1200 ]]; then
  printf 'purge-wins: writer did not block on the purge'"'"'s lock (elapsed %sms, expected >= ~1200ms)\n' \
    "${elapsed_ms}" >&2
  cat "${tmp_dir}/purge-wins-writer.log" >&2
  exit 1
fi

if [[ "${writer_exit}" == "0" ]]; then
  printf 'purge-wins: writer insert unexpectedly succeeded after the tombstone committed\n' >&2
  cat "${tmp_dir}/purge-wins-writer.log" >&2
  exit 1
fi
if ! grep -qi "was deleted; write to" "${tmp_dir}/purge-wins-writer.log"; then
  printf 'purge-wins: writer failed, but not with the expected guard-trigger rejection:\n' >&2
  cat "${tmp_dir}/purge-wins-writer.log" >&2
  exit 1
fi

printf 'purge-wins: PASS (writer blocked %sms on the purge'"'"'s lock, then was correctly rejected)\n' \
  "${elapsed_ms}"
