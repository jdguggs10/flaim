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

The database-contract verification flow is:

```sh
corepack pnpm exec supabase db start
corepack pnpm exec supabase db reset --local
docker cp supabase/tests/reproducibility.sql supabase_db_flaim:/tmp/reproducibility.sql
docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/reproducibility.sql
corepack pnpm exec supabase db lint --local --schema public,analytics --level warning --fail-on error
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
