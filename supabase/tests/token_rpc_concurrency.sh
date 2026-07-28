#!/usr/bin/env bash

set -euo pipefail

readonly DB_CONTAINER="supabase_db_flaim"
readonly REFRESH_TOKEN="synthetic-concurrency-refresh-token"
readonly YAHOO_USER="synthetic-concurrency-yahoo-user"
readonly YAHOO_REFRESH_TOKEN="synthetic-concurrency-yahoo-refresh-token"

tmp_dir="$(mktemp -d)"

cleanup_rows() {
  docker exec "${DB_CONTAINER}" \
    psql \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d postgres \
    -q \
    -c "
      delete from public.oauth_tokens
      where refresh_token = '${REFRESH_TOKEN}';
      delete from public.yahoo_credentials
      where clerk_user_id = '${YAHOO_USER}';
    " >/dev/null
}

cleanup() {
  cleanup_rows
  rm -rf "${tmp_dir}"
}

trap cleanup EXIT

cleanup_rows

docker exec "${DB_CONTAINER}" \
  psql \
  -v ON_ERROR_STOP=1 \
  -U postgres \
  -d postgres \
  -q \
  -c "
    insert into public.oauth_tokens (
      access_token,
      user_id,
      scope,
      expires_at,
      refresh_token,
      refresh_token_expires_at
    ) values (
      'synthetic-concurrency-access-token',
      'synthetic-concurrency-user',
      'mcp:read',
      now() + interval '1 hour',
      '${REFRESH_TOKEN}',
      now() + interval '1 hour'
    );

    insert into public.yahoo_credentials (
      clerk_user_id,
      access_token,
      refresh_token,
      expires_at
    ) values (
      '${YAHOO_USER}',
      'synthetic-concurrency-yahoo-access-token',
      '${YAHOO_REFRESH_TOKEN}',
      now() + interval '1 hour'
    );
  " >/dev/null

for attempt in 1 2; do
  docker exec "${DB_CONTAINER}" \
    psql \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d postgres \
    -Atq \
    -c "
      set role service_role;
      select count(*)
      from public.claim_mcp_oauth_refresh_token('${REFRESH_TOKEN}');
    " > "${tmp_dir}/refresh-${attempt}.txt" &
done
wait

refresh_winners="$(
  awk '{ total += $1 } END { print total + 0 }' \
    "${tmp_dir}/refresh-1.txt" \
    "${tmp_dir}/refresh-2.txt"
)"
if [[ "${refresh_winners}" != "1" ]]; then
  printf 'Expected one concurrent MCP refresh winner, found %s.\n' \
    "${refresh_winners}" >&2
  exit 1
fi

for attempt in 1 2; do
  docker exec "${DB_CONTAINER}" \
    psql \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d postgres \
    -Atq \
    -c "
      set role service_role;
      select case when public.acquire_yahoo_refresh_lease(
        '${YAHOO_USER}',
        'synthetic-owner-${attempt}',
        now() + interval '1 minute',
        '${YAHOO_REFRESH_TOKEN}'
      ) then 1 else 0 end;
    " > "${tmp_dir}/yahoo-${attempt}.txt" &
done
wait

yahoo_winners="$(
  awk '{ total += $1 } END { print total + 0 }' \
    "${tmp_dir}/yahoo-1.txt" \
    "${tmp_dir}/yahoo-2.txt"
)"
if [[ "${yahoo_winners}" != "1" ]]; then
  printf 'Expected one concurrent Yahoo lease winner, found %s.\n' \
    "${yahoo_winners}" >&2
  exit 1
fi

printf 'Concurrent MCP refresh and Yahoo lease claims verified.\n'
