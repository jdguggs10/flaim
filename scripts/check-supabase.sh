#!/usr/bin/env bash

set -euo pipefail

readonly REPO_ROOT="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd
)"
cd "${REPO_ROOT}"

export SUPABASE_TELEMETRY_DISABLED=1

# Every guard below is a ripgrep search, and a missing binary exits 127 — which
# an `if rg ...` treats as "no match", i.e. as passing. Require it explicitly so
# an absent tool can never quietly stand in for a clean result.
if ! command -v rg >/dev/null 2>&1; then
  printf 'ripgrep (rg) is required by this check and was not found on PATH.\n' >&2
  exit 1
fi

# Supabase derives this container name from project_id = "flaim" in config.toml.
readonly DB_CONTAINER="supabase_db_flaim"
readonly PROOF_SQL="supabase/tests/reproducibility.sql"
readonly TOKEN_RPC_PROOF_SQL="supabase/tests/token_rpc.sql"
readonly PROVIDER_FLAGS_PROOF_SQL="supabase/tests/provider_flags.sql"
readonly DASHBOARD_SINGLE_REFRESH_PROOF_SQL="supabase/tests/dashboard_single_refresh.sql"
readonly ESPN_HISTORY_JOBS_PROOF_SQL="supabase/tests/espn_history_jobs.sql"
readonly ACCOUNT_DELETIONS_PROOF_SQL="supabase/tests/account_deletions.sql"
readonly RAW_DASHBOARD_MIGRATION_SQL="supabase/migrations/20260802131749_add_sync_recent_dashboard_payload.sql"
readonly CONTAINER_RAW_DASHBOARD_MIGRATION_SQL="/tmp/analytics_dashboard_raw_reference.sql"
readonly CRON_PRODUCTION_SQL="supabase/cron/production.sql"

readonly PROVIDER_FLAGS_COMMAND='select analytics.refresh_provider_flags_snapshot();'
readonly PROVIDER_FLAGS_JOB_BODY='$job$'"${PROVIDER_FLAGS_COMMAND}"'$job$'
readonly DASHBOARD_COMMAND='select analytics.refresh_dashboard_snapshot();'
readonly DASHBOARD_JOB_BODY='$job$'"${DASHBOARD_COMMAND}"'$job$'

# Both analytics jobs stay at five-minute cadence. The dashboard function now
# computes one inclusive payload per call; provider flags remain independent.
if ! rg --multiline --quiet \
  "cron\.schedule\(\s*'provider-flags-snapshot',\s*'\*/5 \* \* \* \*'" \
  "${CRON_PRODUCTION_SQL}"; then
  printf '%s must schedule provider-flags-snapshot at */5.\n' \
    "${CRON_PRODUCTION_SQL}" >&2
  exit 1
fi

if ! rg --multiline --quiet \
  "cron\.schedule\(\s*'dashboard-snapshot',\s*'\*/5 \* \* \* \*'" \
  "${CRON_PRODUCTION_SQL}"; then
  printf '%s must schedule dashboard-snapshot at */5.\n' \
    "${CRON_PRODUCTION_SQL}" >&2
  exit 1
fi

if rg --quiet "dashboard-snapshot-internal|refresh_dashboard_snapshot\(true\)" \
  "${CRON_PRODUCTION_SQL}"; then
  printf '%s must keep one no-argument dashboard refresh at five-minute cadence.\n' \
    "${CRON_PRODUCTION_SQL}" >&2
  exit 1
fi

if ! rg --fixed-strings --quiet "${PROVIDER_FLAGS_JOB_BODY}" \
  "${CRON_PRODUCTION_SQL}"; then
  printf '%s must schedule provider-flags-snapshot with the canonical command.\n' \
    "${CRON_PRODUCTION_SQL}" >&2
  exit 1
fi

if ! rg --fixed-strings --quiet "${DASHBOARD_JOB_BODY}" \
  "${CRON_PRODUCTION_SQL}"; then
  printf '%s must schedule dashboard-snapshot with the canonical no-argument command.\n' \
    "${CRON_PRODUCTION_SQL}" >&2
  exit 1
fi

if rg --line-number \
  "\\.eq\\('(state|code|access_token|refresh_token)'" \
  workers/auth-worker/src \
  --glob '!**/__tests__/**' \
  --glob '!token-rpc-compat.ts'; then
  printf 'Credential-shaped PostgREST equality filter found in Auth Worker source.\n' >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"

cleanup() {
  local exit_code=$?

  corepack pnpm exec supabase stop \
    --project-id flaim \
    --no-backup >/dev/null 2>&1 || true
  rm -rf "${tmp_dir}"

  trap - EXIT
  exit "${exit_code}"
}

trap cleanup EXIT

expected_cli_version="$(
  node -e '
    const version = require("./package.json").devDependencies.supabase;
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error("Supabase CLI must use an exact version");
    }
    process.stdout.write(version);
  '
)"
actual_cli_version="$(corepack pnpm exec supabase --version)"
if [[ "${actual_cli_version}" != "${expected_cli_version}" ]]; then
  printf 'Expected Supabase CLI %s, found %s\n' \
    "${expected_cli_version}" \
    "${actual_cli_version}" >&2
  exit 1
fi

corepack pnpm exec supabase db start

for reset_number in 1 2; do
  corepack pnpm exec supabase db reset --local

  docker exec -i "${DB_CONTAINER}" \
    psql \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d postgres \
    -f - \
    < "${PROOF_SQL}" \
    > "${tmp_dir}/snapshot-${reset_number}.txt"

  docker exec -i "${DB_CONTAINER}" \
    psql \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d postgres \
    -f - \
    < "${TOKEN_RPC_PROOF_SQL}" \
    >> "${tmp_dir}/snapshot-${reset_number}.txt"

  docker exec -i "${DB_CONTAINER}" \
    psql \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d postgres \
    -f - \
    < "${PROVIDER_FLAGS_PROOF_SQL}" \
    >> "${tmp_dir}/snapshot-${reset_number}.txt"

  docker exec -i "${DB_CONTAINER}" \
    psql \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d postgres \
    -f - \
    < "${DASHBOARD_SINGLE_REFRESH_PROOF_SQL}" \
    >> "${tmp_dir}/snapshot-${reset_number}.txt"

  docker exec -i "${DB_CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f - < "${ESPN_HISTORY_JOBS_PROOF_SQL}" >> "${tmp_dir}/snapshot-${reset_number}.txt"
  docker exec -i "${DB_CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f - < "${ACCOUNT_DELETIONS_PROOF_SQL}" >> "${tmp_dir}/snapshot-${reset_number}.txt"
  docker cp \
    "${RAW_DASHBOARD_MIGRATION_SQL}" \
    "${DB_CONTAINER}:${CONTAINER_RAW_DASHBOARD_MIGRATION_SQL}" \
    >/dev/null
  docker exec -i "${DB_CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f - < supabase/tests/analytics_history.sql >> "${tmp_dir}/snapshot-${reset_number}.txt"
done

if ! diff -u \
  "${tmp_dir}/snapshot-1.txt" \
  "${tmp_dir}/snapshot-2.txt"; then
  printf 'Supabase reset snapshots were not deterministic.\n' >&2
  exit 1
fi

bash supabase/tests/token_rpc_concurrency.sh
bash supabase/tests/account_deletions_concurrency.sh
bash supabase/tests/analytics_history_concurrency.sh
bash supabase/tests/analytics_history_guard.sh
bash supabase/tests/analytics_history_dimensions_guard.sh

corepack pnpm exec supabase db lint \
  --local \
  --schema public,analytics \
  --level warning \
  --fail-on error

corepack pnpm exec supabase db advisors \
  --local \
  --type security \
  --level warn \
  --fail-on error

corepack pnpm exec supabase db diff \
  --local \
  --schema public,analytics \
  --output "${tmp_dir}/schema-diff.sql"

if [[ -s "${tmp_dir}/schema-diff.sql" ]]; then
  printf 'Supabase schema drift detected:\n' >&2
  cat "${tmp_dir}/schema-diff.sql" >&2
  exit 1
fi

printf 'Supabase database contract is reproducible and drift-free.\n'
