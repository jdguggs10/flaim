# Testing Guide

Keep testing light and focused. Flaim is a solo hobby project; prioritize critical paths and avoid heavy test infrastructure.

## What We Test Today

Automated tests currently focus on the Workers layer:
- **auth-worker**: OAuth handler behavior, league discovery helpers, ESPN type utilities
- **fantasy-mcp**: tool routing and minimal tool behavior
- **espn-client**: type utilities
- **yahoo-client**: response normalizers

The **web app** and **extension** do not have automated tests right now. Manual testing is acceptable until usage grows.

## Run Tests

Workers use Vitest.

```bash
cd workers/auth-worker && npm test
cd workers/fantasy-mcp && npm test
cd workers/espn-client && npm test
cd workers/yahoo-client && npm test
```

Type checks (where configured):

```bash
cd workers/auth-worker && npm run type-check
cd workers/fantasy-mcp && npm run type-check
cd workers/espn-client && npm run type-check
```

## When to Add Tests

Add tests when you touch:
- OAuth flow logic (auth-worker)
- MCP tool routing or tool arguments (fantasy-mcp)
- ESPN parsing or response normalization (espn-client)

Skip tests for small UI copy tweaks or non-critical refactors.

## Guiding Principles

- Prefer **unit tests** with mocked dependencies over brittle integration tests.
- Keep tests **small and obvious**.
- Focus on **auth and tool boundaries** first.

## Eval Harness

The `flaim-eval` repo supports headless API key auth via `FLAIM_EVAL_API_KEY`. When set, `npm run eval` skips the OAuth browser flow entirely. See `workers/auth-worker/README.md` for the eval API key security model.

## Deferred (for now)

- Full OAuth integration/E2E tests
- Web app component tests
- Extension E2E tests

Revisit these only when you have real users or frequent regressions.
