# Tool Versioning Policy (Slim)

After directory publication, treat the MCP tool surface as a contract. If you change the contract, expect resubmission.

## Breaking (assume resubmission)

- Remove or rename a tool
- Change required parameters (add/remove/rename) or parameter types
- Change semantics in a way that breaks existing prompts

## Non-breaking (usually OK)

- Add optional parameters
- Add new tools
- Clarify descriptions (no semantic change)
- Bugfixes/perf work that preserve inputs/outputs

## Deprecations

1. Mark tool description with `[Deprecated]`
2. Wait at least 30 days
3. Remove tool
4. Resubmit to impacted directories (if required by their rules)

## Tracking

- Record tool changes in `docs/CHANGELOG.md`
  - `[tool-contract]` for any contract change
  - `[breaking]` when you expect resubmission

## Pre-change sanity

- Update `docs/STATUS.md` if support matrix changes
- Run `npm run eval` + `npm run presubmit -- <run_id>` in `flaim-eval`
