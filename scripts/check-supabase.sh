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
done

if ! diff -u \
  "${tmp_dir}/snapshot-1.txt" \
  "${tmp_dir}/snapshot-2.txt"; then
  printf 'Supabase reset snapshots were not deterministic.\n' >&2
  exit 1
fi

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
