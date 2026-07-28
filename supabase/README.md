# Flaim Supabase contract

This directory is the reviewed, secret-free database contract for Flaim. It is
intended to create a new environment from scratch; it does not copy or repair
the hosted production project's historical migration ledger.

The initial migration deliberately reproduces the observed database
**before-state**, including broad Data API grants and the known exact duplicate
index. Keeping those properties in the baseline lets later hardening and
maintenance changes remain small, forward-only, independently reviewable
migrations.

The [reconciliation manifest](./reconciliation.md) records the live objects
represented by this baseline and its one intentional omission.

## Safety boundary

- The repository contains no database passwords, tokens, connection strings, or
  production rows.
- `analytics_readonly` is created as `NOLOGIN`. Any credential provisioning is
  an out-of-band, environment-specific operation.
- `supabase_admin` remains platform-owned. Its default ACLs are verified during
  reset proof rather than changed by application migrations.
- `analytics` is not exposed through the Data API configuration.
- The five production cron jobs are defined in
  `cron/production.sql`, outside the migration path. Local resets and preview
  databases therefore do not activate background jobs.
- Never run `supabase db reset --linked` or use a production database URL for a
  reset. Linking, hosted preview creation, migration-history changes, and
  production DDL require separate approval.

## Tooling

Use Node.js 24 and the exact Supabase CLI version pinned in the root
`package.json` and lockfile:

```sh
corepack pnpm exec supabase --version
```

Run the complete two-reset proof locally with:

```sh
bash scripts/check-supabase.sh
```

The same local-only command runs in GitHub Actions for database-contract,
toolchain, or workflow changes. It never links to or contacts a hosted
Supabase project.

The database-contract verification flow is:

```sh
corepack pnpm exec supabase db start
corepack pnpm exec supabase db reset --local
docker cp supabase/tests/reproducibility.sql supabase_db_flaim:/tmp/reproducibility.sql
docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/reproducibility.sql
docker cp supabase/tests/token_rpc.sql supabase_db_flaim:/tmp/token_rpc.sql
docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/token_rpc.sql
corepack pnpm exec supabase db lint --local --schema public,analytics --level warning --fail-on error
corepack pnpm exec supabase db advisors --local --type security --level warn --fail-on error
corepack pnpm exec supabase db diff --local --schema public,analytics
```

`db reset --local` recreates the local Postgres container, applies timestamped
files in `supabase/migrations`, then applies `seed.sql`. The seed contains only
fixed synthetic identifiers and deliberately invalid credential-shaped values.

On 2026-07-27, two clean local resets produced identical reviewed catalog,
privilege, extension, role, policy, migration, cron-absence, and seed-summary
hashes. Both lint runs found no schema errors, and the final local schema diff
was empty. Local advisors reported no errors and one expected warning for the
exact duplicate before-state index. This passes the local reproducibility gate
for considering a separate hosted preview database; it does not authorize
hosted infrastructure or production changes.

## Token-matching RPCs

The forward migration after the baseline moves MCP OAuth and Yahoo
credential-shaped comparisons into service-role-only Postgres functions.
Supabase RPC calls use their default `POST` behavior so function arguments are
carried in the JSON body rather than PostgREST filter URLs. The functions are
security invokers with an empty search path; `EXECUTE` is revoked from
`PUBLIC`, `anon`, and `authenticated`, and granted only to `service_role`.

`supabase/tests/token_rpc.sql` proves the function ACLs, state/code/refresh
single-use behavior, idempotent revocation, Yahoo lease exclusion, and guarded
credential recovery with synthetic rows inside a rolled-back transaction.
`supabase/tests/token_rpc_concurrency.sh` independently races two database
sessions and requires exactly one MCP refresh winner and one Yahoo lease
winner, then removes its synthetic fixtures.

Rollback is Worker-first: restore the previous Auth Worker version before
removing any function, so no deployed caller loses its database dependency.
The additive functions may safely remain unused during observation. If removal
is later required, drop only the nine signatures introduced by
`20260728210429_move_token_matching_to_rpc.sql` after the Worker rollback is
confirmed. Hosted preview application and every production promotion remain
separate approval gates.

```sql
begin;
drop function if exists public.create_mcp_oauth_state(text, text, text, timestamptz);
drop function if exists public.consume_mcp_oauth_state(text, text, text);
drop function if exists public.claim_mcp_oauth_code(text);
drop function if exists public.find_mcp_oauth_access_token(text);
drop function if exists public.claim_mcp_oauth_refresh_token(text);
drop function if exists public.revoke_mcp_oauth_access_token(text);
drop function if exists public.consume_yahoo_oauth_state(text);
drop function if exists public.acquire_yahoo_refresh_lease(text, text, timestamptz, text);
drop function if exists public.recover_yahoo_credentials(text, text, text, timestamptz, text, text);
commit;
```
