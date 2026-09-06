#!/usr/bin/env bash
# Genuine two-session proof that the ET-history closer serializes on its
# singleton state row. The rollback-only SQL proof cannot show one close waiting
# for another; this script holds the row lock in one session, queues two normal
# close calls behind it, and proves that exactly one initializes/replaces the
# day while the other observes the finished marker as a no-op.

set -euo pipefail

readonly DB_CONTAINER="supabase_db_flaim"
readonly TEST_USER="history-concurrency-proof-user"

tmp_dir="$(mktemp -d)"

psql_exec() {
  docker exec -i "${DB_CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

cleanup_rows() {
  psql_exec -q -c "
    delete from public.mcp_tool_events where user_id = '${TEST_USER}';
    truncate public.mcp_user_daily_et;
    update analytics.history_rollup_state
      set initial_history_start_et_day = null,
          last_closed_et_day = null,
          updated_at = now()
      where id;
  " >/dev/null
}

cleanup() {
  cleanup_rows || true
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

cleanup_rows

# Seed a previous complete ET day. The closer records database arrival time in
# production; this direct fixture represents a row already persisted there.
psql_exec -q -c "
  insert into public.mcp_tool_events (
    ts, env, user_id, auth_type, client_name, tool_name, platform, sport,
    status, error_code, latency_ms, league_hash
  ) values (
    ((((now() at time zone 'America/New_York')::date - 1)::timestamp + interval '12 hours') at time zone 'America/New_York'),
    'prod', '${TEST_USER}', 'oauth', 'Claude', 'get_roster', 'espn', 'football',
    'ok', null, 100, 'history-concurrency-proof-league'
  );
" >/dev/null

# The first close protects against omitting any already-persisted raw history.
# The reset seed (and any earlier local synthetic fixture) therefore determines
# the explicit start, not this script's one new yesterday row.
initial_start_et_day="$(psql_exec -Atq -c "
  select min((ts at time zone 'America/New_York')::date)::text
  from public.mcp_tool_events;
")"
if [[ -z "${initial_start_et_day}" ]]; then
  printf 'history concurrency fixture has no raw event from which to establish the initial ET day\n' >&2
  exit 1
fi

# Take the exact state-row lock the closer must take, then start two real close
# calls while it is held. If either function skips SELECT ... FOR UPDATE it will
# complete before the two-second gate opens and this test fails.
psql_exec -q -c "
  begin;
  select id from analytics.history_rollup_state where id for update;
  select pg_sleep(2);
  commit;
" > "${tmp_dir}/holder.log" 2>&1 &
holder_pid=$!

sleep 0.5
# BSD date on macOS has no %N. Node is already the pinned workspace runtime and
# supplies the same monotonic-enough wall-clock millisecond check portably.
start_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
psql_exec -q -c "
  select public.close_mcp_user_daily_et(
    (now() at time zone 'America/New_York')::date - 1,
    date '${initial_start_et_day}'
  );
" > "${tmp_dir}/closer-a.log" 2>&1 &
closer_a_pid=$!
psql_exec -q -c "
  select public.close_mcp_user_daily_et(
    (now() at time zone 'America/New_York')::date - 1,
    date '${initial_start_et_day}'
  );
" > "${tmp_dir}/closer-b.log" 2>&1 &
closer_b_pid=$!

wait "${holder_pid}"
wait "${closer_a_pid}"
wait "${closer_b_pid}"
end_ms="$(node -e 'process.stdout.write(String(Date.now()))')"

elapsed_ms=$(( end_ms - start_ms ))
if [[ "${elapsed_ms}" -lt 1200 ]]; then
  printf 'history close did not block on the singleton state-row lock (elapsed %sms)\n' "${elapsed_ms}" >&2
  cat "${tmp_dir}/closer-a.log" >&2
  cat "${tmp_dir}/closer-b.log" >&2
  exit 1
fi

aggregate_rows="$(psql_exec -Atq -c "
  select count(*)
  from public.mcp_user_daily_et
  where user_id = '${TEST_USER}';
")"
if [[ "${aggregate_rows}" != "1" ]]; then
  printf 'concurrent history closes produced %s aggregate rows, expected exactly 1\n' "${aggregate_rows}" >&2
  exit 1
fi

marker="$(psql_exec -Atq -c "
  select last_closed_et_day
  from analytics.history_rollup_state
  where id;
")"
expected_marker="$(psql_exec -Atq -c "
  select ((now() at time zone 'America/New_York')::date - 1)::text;
")"
if [[ "${marker}" != "${expected_marker}" ]]; then
  printf 'concurrent history closes left marker %s, expected %s\n' "${marker}" "${expected_marker}" >&2
  exit 1
fi

printf 'history close concurrency: PASS (both closers blocked %sms and produced one stable aggregate row)\n' \
  "${elapsed_ms}"
