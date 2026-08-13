#!/usr/bin/env bash

set -euo pipefail

readonly REPO_ROOT="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd
)"
cd "${REPO_ROOT}"

export SUPABASE_TELEMETRY_DISABLED=1

# Supabase derives this container name from project_id = "flaim" in config.toml.
readonly DB_CONTAINER="supabase_db_flaim"
readonly PROOF_SQL="supabase/tests/reproducibility.sql"
readonly TOKEN_RPC_PROOF_SQL="supabase/tests/token_rpc.sql"
readonly PROVIDER_FLAGS_PROOF_SQL="supabase/tests/provider_flags.sql"
readonly CRON_PRODUCTION_SQL="supabase/cron/production.sql"
readonly CRON_CUTOVER_SQL="supabase/cron/production-cadence-cutover.sql"
readonly CUTOVER_GUARD_PROOF_SH="supabase/tests/cutover_guard.sh"

# The phase 2 guard matches this command exactly, because cron.job_run_details
# keeps the command each historical run executed and a renamed-in-place job
# would otherwise be vouched for by unrelated history. Exact matching only
# works while the scheduled command and the guard's expectation agree, so
# assert they cannot drift apart silently.
readonly PROVIDER_FLAGS_COMMAND='select analytics.refresh_provider_flags_snapshot();'
readonly PROVIDER_FLAGS_JOB_BODY='$job$'"${PROVIDER_FLAGS_COMMAND}"'$job$'
readonly PROVIDER_FLAGS_GUARD_MATCH="command = '${PROVIDER_FLAGS_COMMAND}'"

# FLA-264 cron cutover ordering, asserted statically because the failure is
# silent: the provider-failure consumer fails open on a stale snapshot, so
# dropping the dashboard cadence before that consumer reads the dedicated
# provider snapshot stops outage alerting without an error anywhere.
#
# The canonical production schedule must stay in phase 1 — the dedicated job
# added at */5 while the dashboard job is still */5. Phase 2 lives in its own
# guarded file. Once phase 2 has been applied and verified in production, fold
# the new cadence into production.sql and update these assertions in the same
# change.
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
  printf '%s changed the dashboard-snapshot cadence. Phase 2 belongs in %s.\n' \
    "${CRON_PRODUCTION_SQL}" \
    "${CRON_CUTOVER_SQL}" >&2
  exit 1
fi

if rg --quiet "dashboard-snapshot-internal|refresh_dashboard_snapshot\(true\)" \
  "${CRON_PRODUCTION_SQL}"; then
  printf '%s contains phase 2 cadence changes; they belong in %s.\n' \
    "${CRON_PRODUCTION_SQL}" \
    "${CRON_CUTOVER_SQL}" >&2
  exit 1
fi

if ! rg --quiet "flaim\.flags_consumer_verified" "${CRON_CUTOVER_SQL}"; then
  printf '%s must keep its consumer-verification guard.\n' \
    "${CRON_CUTOVER_SQL}" >&2
  exit 1
fi

if ! rg --quiet "provider-flags-snapshot" "${CRON_CUTOVER_SQL}"; then
  printf '%s must require the phase 1 job before changing cadence.\n' \
    "${CRON_CUTOVER_SQL}" >&2
  exit 1
fi

# A raising guard is not a blocking guard: psql runs the statements after a
# failed one unless ON_ERROR_STOP is set, so the guard has to abort a
# transaction that wraps the schedule changes. Assert the file is that
# transaction; the behavioral proof below runs it and checks it stayed inert.
if ! rg --multiline --quiet '(?s)^begin;.*^commit;' "${CRON_CUTOVER_SQL}"; then
  printf '%s must wrap its guard and schedule changes in one transaction.\n' \
    "${CRON_CUTOVER_SQL}" >&2
  exit 1
fi

if ! rg --fixed-strings --quiet "${PROVIDER_FLAGS_JOB_BODY}" \
  "${CRON_PRODUCTION_SQL}"; then
  printf '%s must schedule provider-flags-snapshot with the exact command the phase 2 guard requires.\n' \
    "${CRON_PRODUCTION_SQL}" >&2
  exit 1
fi

if ! rg --fixed-strings --quiet "${PROVIDER_FLAGS_GUARD_MATCH}" \
  "${CRON_CUTOVER_SQL}"; then
  printf '%s must match the scheduled command exactly, not by pattern.\n' \
    "${CRON_CUTOVER_SQL}" >&2
  exit 1
fi

if ! rg --fixed-strings --quiet 'd.command = j.command' "${CRON_CUTOVER_SQL}"; then
  printf '%s must tie run history to the current command, not just the job id.\n' \
    "${CRON_CUTOVER_SQL}" >&2
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
done

if ! diff -u \
  "${tmp_dir}/snapshot-1.txt" \
  "${tmp_dir}/snapshot-2.txt"; then
  printf 'Supabase reset snapshots were not deterministic.\n' >&2
  exit 1
fi

bash "${CUTOVER_GUARD_PROOF_SH}"

bash supabase/tests/token_rpc_concurrency.sh

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
