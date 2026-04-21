# Flaim Repository Review (2026-04-20)

This document captures a focused code-quality review with potential bugs, optimization opportunities, and maintainability improvements.

## 1) Runtime/engine drift risk (Node 24 required, local env can run lower)

**Why it matters**
- The monorepo declares Node `24.x` as required, but local/CI environments can still run older versions unless explicitly enforced.
- Drift can hide subtle runtime differences (especially around web APIs and edge runtime behavior).

**Evidence**
- Root package engine pin: `"node": "24.x"`.

**Recommendation**
- Add a repo-level `.nvmrc`/`.node-version` and enforce Node major version in CI before running tests.

---

## 2) Season logic is duplicated across frontend + worker

**Why it matters**
- Season rollover logic appears in both web and auth-worker, which increases the chance of drift.
- Any future rule change (e.g., sport rollover month adjustments) must be updated in multiple places.

**Evidence**
- Web implementation: `web/lib/season-utils.ts`.
- Worker implementation: `workers/auth-worker/src/season-utils.ts`.

**Recommendation**
- Move season calculations into a shared package/module and import from both layers.

---

## 3) Extension ping tries IDs sequentially (avoidable user-visible latency)

**Why it matters**
- `pingExtension()` checks extension IDs in-order and waits `timeoutMs` for each ID.
- With multiple IDs configured, worst-case latency scales linearly (`N * timeoutMs`).

**Evidence**
- Sequential loop over extension IDs and per-ID timeout.

**Recommendation**
- Consider parallel pings with `Promise.any` (or capped concurrency), preserving first successful response.

---

## 4) Yahoo refresh lease wait loop can over-wait under contention

**Why it matters**
- Loser requests poll in a loop waiting for winner lease changes.
- Polling strategy (`fixed interval + jitter`) is simple, but can create extra DB reads and slower response under heavy concurrent traffic.

**Evidence**
- Polling loop in `waitForFreshCredentialsOrLeaseClear` repeatedly calls `getYahooCredentials()` after sleep.

**Recommendation**
- Use bounded exponential backoff and a strict overall wait ceiling; consider reducing read frequency after repeated misses.

---

## 5) `expiresIn` can go negative in token result construction

**Why it matters**
- `toTokenResult()` derives `expiresIn` from `expiresAt - Date.now()` without clamping.
- Clock skew or stale data can return negative seconds and leak inconsistent downstream state.

**Evidence**
- `Math.floor((credentials.expiresAt.getTime() - Date.now()) / 1000)`.

**Recommendation**
- Clamp to `>= 0` and optionally force refresh behavior when negative.

---

## 6) Upstream non-JSON error bodies lose diagnostic detail

**Why it matters**
- `fetchJsonWithTimeout()` swallows JSON parse errors and sets `data = null`.
- For non-JSON upstream errors, diagnostic details are lost and response quality degrades.

**Evidence**
- JSON parse failure fallback to `null` in extension sync route helper.

**Recommendation**
- Preserve a safe truncated copy of raw text for logs/error reporting when JSON parse fails.

---

## 7) High-volume test logs likely hide real signals in CI output

**Why it matters**
- Tests print many informational and expected-error lines.
- Excessive logs make real failures harder to spot and can slow CI output processing.

**Evidence**
- auth-worker tests emit extensive `console.log`/`console.error` output in success paths.

**Recommendation**
- Gate noisy logs behind a test debug flag or shared logger level, and keep assertions explicit.

---

## 8) Positive note: cache fallback path is robust

**Observation**
- Sleeper players cache handles malformed cache entries safely and refetches source data.

**Evidence**
- Defensive `try/catch` on cache parse and graceful refetch path.

**Recommendation**
- Keep this pattern; it is resilient and production-friendly.
