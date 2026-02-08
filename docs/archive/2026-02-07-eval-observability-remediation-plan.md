# Eval Observability Remediation Plan (Trace Isolation + Coverage + Signal)

> **For Claude/Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Goal

Fix and harden eval observability so that per-trace artifacts are trustworthy and actionable:

1. No cross-trace contamination in `runs/<run_id>/<trace_id>/logs/*.json`.
2. Better capture reliability for expected downstream worker logs.
3. Richer structured fields in artifacts for real debugging (not just timestamp/status/message).
4. Explicit acceptance output that flags coverage gaps, contamination, and low-signal traces.

---

## Current Findings (From Latest Run + Code Inspection)

### Finding 1: Cross-trace contamination in `fantasy-mcp` logs
- Symptom: Per-trace files include tool events from other traces in the same run.
- Root cause:
  - `/Users/ggugger/Code/flaim-eval/src/cloudflare-logs.ts` appends `eval=<run_id>` fallback for `fantasy-mcp` and merges results into trace artifacts.
  - This broad run-level fallback is not post-filtered by `trace_id`.

### Finding 2: Missing expected downstream worker in some traces
- Symptom: A trace can call ESPN tools but miss `espn-client.json` after enrichment.
- Root cause:
  - `/Users/ggugger/Code/flaim-eval/src/enrich.ts` performs one fetch pass per trace without coverage-aware retries.
  - Cloudflare indexing lag can cause false negatives.

### Finding 3: Low-signal downstream logs
- Symptom: `auth-worker`, `espn-client`, `yahoo-client` artifacts often appear as status/time-only with little context.
- Root cause:
  - `/Users/ggugger/Code/flaim-eval/src/cloudflare-logs.ts` normalizes events to a minimal shape and drops rich `source.*` fields.
  - Worker logs include structured JSON, but eval artifacts currently discard most of it.

### Finding 4: Runtime status interpretation is weak
- Symptom: many events show `status: 0`, which hides useful status semantics.
- Root cause:
  - status extraction currently relies on `$workers.event.response.status`.
  - service-binding/internal events often carry status in `source.status` (string), not `$workers`.

---

## Constraints and Non-Goals

### Constraints
- Keep eval artifacts backward-compatible where practical.
- Avoid increasing log volume in workers beyond eval-scoped traffic.
- Maintain existing worker header propagation behavior.

### Non-goals
- No redesign of MCP tools or scenario set.
- No changes to business logic of fantasy tool handlers.
- No migration away from Cloudflare Observability API.

---

## Implementation Patterns

### Pattern A: Authoritative-first query + explicit fallback gating
Use strict trace filters as the primary signal and only permit broader fallback paths behind an explicit env toggle.

Why:
- Prevents contamination by default.
- Preserves an escape hatch for legacy/debugging.

### Pattern B: Coverage-driven enrichment retries
Retry enrichment based on expected worker coverage per trace, not just "any logs found".

Why:
- "Any logs found" is insufficient when downstream workers index slower.

### Pattern C: Lossless-to-practical normalization
Preserve critical structured fields from Cloudflare `source` and metadata into artifact events while keeping a stable top-level shape.

Why:
- Enables debugging without opening raw query payloads.
- Keeps artifact review readable.

### Pattern D: Schema evolution with backward compatibility
Introduce additive fields and bump schema version in trace artifacts, but do not break consumers of existing keys.

Why:
- Existing scripts can continue reading `timestamp/status/wall_time_ms/message`.

### Pattern E: Formal acceptance artifact
Generate an explicit `acceptance-summary.json` that evaluates isolation, coverage, and signal quality.

Why:
- Makes release readiness deterministic and reviewable.

---

## Proposed Workstreams

## Workstream 1: Trace Isolation Hardening (`flaim-eval`)

### Files
- Modify: `../flaim-eval/src/cloudflare-logs.ts`
- Modify: `../flaim-eval/src/__tests__/cloudflare-logs.test.ts`
- Modify: `../flaim-eval/docs/OBSERVABILITY.md`
- Modify: `../flaim-eval/docs/TROUBLESHOOTING.md`

### Changes
1. Remove unconditional run-level fallback merge for `fantasy-mcp`.
2. Add env-gated fallback only:
   - `FLAIM_EVAL_ALLOW_RUN_FALLBACK=1` enables `eval=<run_id>` fallback.
   - default is strict mode (fallback disabled).
3. Add post-query strict filter:
   - keep events only if `trace_id` matches via `$metadata.traceId` or `source.trace_id`.
4. Keep trace needles only; avoid overly broad matching by default.

### Acceptance Criteria
1. No event in `runs/<run_id>/<trace_id>/logs/*.json` has a mismatched trace id.
2. Unit tests prove run-level fallback does not leak cross-trace events in strict mode.

---

## Workstream 2: Coverage-Aware Re-Enrichment (`flaim-eval`)

### Files
- Modify: `../flaim-eval/src/enrich.ts`
- Modify: `../flaim-eval/src/types.ts` (notes/metadata additions if needed)
- Modify: `../flaim-eval/src/__tests__/enrich.test.ts`
- Modify: `../flaim-eval/docs/OPERATIONS.md`

### Changes
1. Infer expected workers per trace from `trace.json` tool calls:
   - always `fantasy-mcp`
   - `auth-worker` when `get_user_session` appears
   - `espn-client` when tool args contain `platform=espn`
   - `yahoo-client` when tool args contain `platform=yahoo`
2. Retry enrichment until expected coverage is met or attempts exhausted.
3. Configurable retry behavior:
   - `FLAIM_EVAL_REENRICH_ATTEMPTS` (default: 6)
   - `FLAIM_EVAL_REENRICH_DELAY_MS` (default: 15000)
   - `FLAIM_EVAL_REENRICH_WINDOW_EXPAND_MS` (default: 30000)
4. Add trace notes for expected vs actual workers and missing list.

### Acceptance Criteria
1. Re-enrichment retries until expected workers appear or timeout.
2. Missing expected workers are explicitly recorded in notes.
3. Unit tests cover retry stop conditions and missing-worker reporting.

---

## Workstream 3: Rich Artifact Event Schema (`flaim-eval`)

### Files
- Modify: `../flaim-eval/src/types.ts`
- Modify: `../flaim-eval/src/cloudflare-logs.ts`
- Modify: `../flaim-eval/src/__tests__/cloudflare-logs.test.ts`
- Modify: `../flaim-eval/README.md`
- Modify: `../flaim-eval/docs/OBSERVABILITY.md`

### Changes
1. Expand `ServerLogs` event shape with optional structured fields:
   - `service`, `phase`, `run_id`, `trace_id`, `correlation_id`
   - `tool`, `sport`, `league_id`, `path`, `method`
   - `outcome`, `request_id`, `trigger`
   - `duration_ms`, `status_text`
2. Keep existing fields (`timestamp`, `status`, `wall_time_ms`, `message`) for compatibility.
3. Map status with precedence:
   - `$workers.event.response.status`
   - parse `source.status`
   - else `null` (not hardcoded `0`)
4. Bump trace artifact schema version to `1.1` (additive change only).

### Acceptance Criteria
1. New artifacts retain old keys and include structured fields when available.
2. Tests validate status fallback from `source.status`.
3. Consumers can still parse old shape.

---

## Workstream 4: Worker-Side Structured Message Hygiene (`flaim`)

### Files
- Modify: `workers/espn-client/src/index.ts`
- Modify: `workers/espn-client/src/logging.ts`
- Modify: `workers/yahoo-client/src/index.ts`
- Modify: `workers/yahoo-client/src/logging.ts`
- Modify: `workers/auth-worker/src/index-hono.ts`
- Modify: `workers/auth-worker/src/logging.ts`
- Optional: `workers/fantasy-mcp/src/mcp/tools.ts` (consistency pass)

### Changes
1. Ensure eval log events include concise contextual `message` for start/end/error phases where missing today.
2. Keep all eval fields (`run_id`, `trace_id`, `correlation_id`) unchanged.
3. Avoid adding verbose non-eval logs.

### Acceptance Criteria
1. Downstream worker artifact events are readable without raw payload inspection.
2. Existing worker tests/type checks continue to pass.

---

## Workstream 5: Acceptance Artifact + CLI (`flaim-eval`)

### Files
- Create: `../flaim-eval/src/accept.ts`
- Modify: `../flaim-eval/package.json`
- Modify: `../flaim-eval/docs/ACCEPTANCE.md`
- Modify: `../flaim-eval/docs/OPERATIONS.md`

### Changes
1. Add CLI command:
   - `npm run accept -- <run_id>`
2. Produce `runs/<run_id>/acceptance-summary.json` with:
   - scenario completion
   - expected vs actual worker coverage per trace
   - contamination checks
   - low-signal checks
   - retry counts and final coverage status
   - totals and pass/fail
3. Apply hybrid pass/fail policy:
   - hard fail on contamination
   - hard fail if `fantasy-mcp` is missing for a trace
   - hard fail if `auth-worker` is missing when `get_user_session` was called
   - warn-only for missing `espn-client`/`yahoo-client` after retries
4. Escalate downstream coverage warnings to hard fail if repeated:
   - missing downstream logs in `>=2` traces, OR
   - missing downstream logs in `>20%` of traces in the run.

### Acceptance Criteria
1. Acceptance summary is deterministic and review-ready.
2. Command fails on contamination or critical coverage failures per policy.
3. Summary clearly documents every warning/failure with trace IDs and reason codes.

---

## Public Interfaces and Config Changes

### `flaim-eval` env vars (new)
- `FLAIM_EVAL_ALLOW_RUN_FALLBACK` (`0` default, `1` optional legacy behavior)
- `FLAIM_EVAL_REENRICH_ATTEMPTS` (default `6`)
- `FLAIM_EVAL_REENRICH_DELAY_MS` (default `15000`)
- `FLAIM_EVAL_REENRICH_WINDOW_EXPAND_MS` (default `30000`)

### `TraceArtifact` schema version
- Current: `1.0`
- Planned: `1.1` with additive structured event fields.

---

## Verification Plan

### Unit tests
1. `cloudflare-logs.test.ts`
   - strict trace filtering
   - fallback gating behavior
   - structured mapping and status parsing
2. `enrich.test.ts`
   - expected worker inference
   - retry loop behavior
3. `accept.test.ts` (new)
   - contamination detection
   - pass/fail rules

### Integration checks
1. `npm run eval`
2. `npm run enrich -- <run_id>`
3. `npm run accept -- <run_id>`
4. Inspect:
   - `runs/<run_id>/summary.json`
   - `runs/<run_id>/acceptance-summary.json`
   - a few `trace.json` and `logs/*.json`
5. Confirm acceptance summary includes:
   - `policy_version`
   - `decisions_applied`
   - `fail_reasons[]`
   - `warn_reasons[]`
   - per-trace `expected_workers`, `actual_workers`, `missing_workers`, `retry_attempts`.

### Worker checks (`flaim`)
1. `workers/fantasy-mcp` test + type-check
2. `workers/espn-client` test + type-check
3. `workers/yahoo-client` test + type-check
4. `workers/auth-worker` test + type-check

---

## Rollout Strategy

1. Implement and test in local repos.
2. Deploy worker changes to preview.
3. Run `flaim-eval` against preview MCP URL.
4. Validate acceptance summary clean across at least two full runs.
5. Deploy to prod.
6. Run production eval smoke and archive artifacts.

---

## Risks and Mitigations

1. Risk: strict filtering reduces event counts unexpectedly.
   - Mitigation: keep env-gated legacy fallback for debugging.
2. Risk: larger artifacts from richer event schema.
   - Mitigation: keep only curated structured fields, not full raw event dumps.
3. Risk: Cloudflare indexing lag still causes intermittent coverage misses.
   - Mitigation: coverage-aware retries + widening windows + explicit missing reporting.
4. Risk: warning-only downstream misses become normalized and ignored.
   - Mitigation: escalation threshold (`>=2 traces` or `>20%`) converts repeated misses to hard fail.

---

## Planned Commits (Suggested)

1. `flaim-eval`: `fix: enforce strict per-trace log isolation in enrichment`
2. `flaim-eval`: `feat: add coverage-aware reenrichment retries`
3. `flaim-eval`: `feat: preserve structured observability fields in artifacts`
4. `flaim`: `chore: improve eval structured log message context in workers`
5. `flaim-eval`: `feat: add acceptance summary command for eval runs`
6. `docs`: `docs: update eval observability runbooks and contracts`

---

## Decisions Locked (2026-02-07)

1. **Default mode:** strict trace isolation by default.
   - `FLAIM_EVAL_ALLOW_RUN_FALLBACK=0` unless explicitly enabled.
2. **Artifact detail level:** curated structured fields by default.
   - No full raw Cloudflare payloads in default artifacts.
3. **Acceptance failure policy:** hybrid.
   - hard fail on contamination and critical worker gaps (`fantasy-mcp`, `auth-worker` with `get_user_session`)
   - warn on missing downstream (`espn-client`/`yahoo-client`) after retries
   - escalate repeated downstream warning patterns to hard fail (`>=2` traces or `>20%`).

### Documentation Requirements For Decision 3

`acceptance-summary.json` must explicitly document:
- policy applied and thresholds used
- each failed trace with reason code
- each warned trace with reason code
- aggregate warning counts and whether escalation triggered
- final pass/fail conclusion and why.

---

## Definition of Done

1. New plan implemented across both repos.
2. Two consecutive full eval runs produce:
   - no contamination
   - documented worker coverage outcomes
   - acceptance summary pass.
3. Docs updated and aligned with implemented behavior.
