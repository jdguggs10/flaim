# Tool Versioning Policy

Rules for changing MCP tool contracts after directory submission. Both Anthropic and OpenAI lock tool names/signatures after publication, so changes require resubmission.

## Breaking Changes (require resubmission)

These changes alter the tool contract and require re-review:

- Removing a tool
- Renaming a tool
- Changing or removing required parameters
- Changing parameter types
- Changing tool behavior in ways that break existing prompts

## Non-Breaking Changes (no resubmission)

These changes are backward-compatible and can be deployed freely:

- Adding optional parameters to existing tools
- Improving tool descriptions (clarifying, not changing semantics)
- Adding new tools
- Bug fixes that don't change the tool interface
- Performance improvements
- Adding support for new sports/platforms within existing tool parameters

## Deprecation Process

1. Mark the tool description with `[Deprecated]` prefix — deploy immediately
2. Wait 30 days minimum
3. Remove the tool
4. Resubmit to affected directories

## Version Tracking

Use `docs/CHANGELOG.md` for all tool contract changes. Tag entries with:
- `[tool-contract]` for any change to tool names, parameters, or behavior
- `[breaking]` for changes that require resubmission
- `[non-breaking]` for backward-compatible changes

## Pre-Change Checklist

Before modifying any tool:

1. Is this a breaking change? If yes, plan a resubmission
2. Update `docs/CHANGELOG.md` with the change
3. Update `docs/STATUS.md` if the parity matrix changes
4. Run `npm run eval` in flaim-eval to verify no regressions
5. Run the pre-submission check before resubmitting
