---
title: Build & Deployment Script Improvement Plan
status: draft
last_updated: 2025-07-15
---

> Purpose: Capture actionable tasks and open research questions arising from review of build / deploy logs (`start.sh`, `build.sh`).  Focus is on reducing warnings, improving reproducibility and CI/CD signal-to-noise.

## 1. Node Version Consistency

| Item | Details |
|------|---------|
| Current symptom | npm prints **EBADENGINE** warnings because `engines.node = "20"` but local & CI run Node `24.x`. |
| Goal | Guarantee that local, CI and Cloudflare Workers all build under the same LTS (target **Node 20**). |
| Actions | 1. Add `.nvmrc` & update `volta` / engines to `20`.  2. In **GitHub Actions** add `setup-node@v4` step pinned to `20`.  3. Update `Dockerfile` if present. |
| Research | • Confirm Cloudflare Pages runner still ships Node 20 LTS.<br>• Decide if we want `>=20 <25` instead of exact `20` to ease future upgrades. |

---

## 2. Edge Runtime Pages vs. Static Generation

| Item | Details |
|------|---------|
| Current symptom | Next.js logs: “Using edge runtime disables static generation for that page”.  All Edge pages render dynamically. |
| Goal | Decide for each route whether Edge runtime is needed. Preserve static generation when possible. |
| Actions | 1. Audit routes listed in build log (15 API routes + `/`).<br>2. For purely static pages, remove `export const runtime = 'edge'` or similar.<br>3. If edge is required (e.g. KV reads), accept dynamic behaviour and document impact on TTFB. |
| Research | • Measure performance difference (Pages → Edge → Cache) vs. static.<br>• Validate Cloudflare Pages cost for dynamic edge functions. |

---

## 3. Dirty-Git Warning on Wrangler Deploy

| Item | Details |
|------|---------|
| Current symptom | `wrangler pages deploy` warns: “git repo has uncommitted changes”. |
| Goal | Ensure CI/CD runs on clean commits or silence intentionally dirty deploys. |
| Actions | 1. In `start.sh` append `--commit-dirty=true` when `DRY_RUN=false && CI=true` (or add flag).<br>2. Encourage local developers to commit or stash before deploy. |
| Research | • Verify if `--commit-dirty` has any side-effects on rollbacks. |

---

## 4. Truly Quiet Mode in `build.sh`

| Item | Details |
|------|---------|
| Current symptom | `--quiet` still prints banners because they are emitted before the guard. |
| Goal | CI logs show only warnings/errors. |
| Actions | 1. Wrap `banner` calls inside `if [ "$QUIET_MODE" = false ]`.<br>2. Optionally pipe npm output to `--silent` when `QUIET_MODE=true`. |
| Research | • Confirm Vercel / Next-on-Pages builders respect `NEXT_TELEMETRY_DISABLED=1` for extra silence. |

---

## 5. NPM Flag Deprecation (`--unsafe-perm`)

| Item | Details |
|------|---------|
| Context | Next-on-Pages invokes `npm i --unsafe-perm`. npm 11 issues a deprecation notice; no functional impact. |
| Decision | Monitor npm 12 release; rely on upstream fix. No immediate action required. |
| Research | • Track https://github.com/cloudflare/next-on-pages issues for flag removal. |

---

## 6. Documentation & Automation

1. Create **docs/DEPLOYMENT.md → Known Warnings** appendix referencing this plan.
2. Add a **GitHub Issue** for each table row with `dev-exp` label.
3. Once changes are implemented, update this file and change `status` front-matter to `done`.
