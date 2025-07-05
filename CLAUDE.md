# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules
Be brutally honest, don't be a yes man. If I am wrong, point it out bluntly. I need honest feedback on my code. Do not do more than what you were specifically asked to do. Do not take shortcuts. Stop working if you need user feedback or if the plan needs to change. If the API or protocol are unfamiliar, use web search to learn.

## Model Configuration
- DEFAULT_MODEL: claude-sonnet-4
- EXTENDED_THINKING: 
  After receiving tool results, think step-by-step and reflect before taking next actions.
- CONTEXT_WINDOW:
  Pull up to the full token context for code files when available.
- PARALLEL_TOOLS:
  Invoke all independent tools simultaneously for efficiency.

## Behavior & Guardrails
- IMPORTANT: Follow these guidelines exactly.
- Be explicit: describe what to do, not what to avoid.
- Provide examples for every non-obvious instruction.
- Focus edits strictly on the specified diff; avoid sprawling rewrites.
- Use subagents for complex problems, reflecting after each step.
- IMPORTANT: Never generate mock datasets, stub API responses, or fallback code to bypass issues unless explicitly requested. Always root-cause failures and implement real fixes.
- IMPORTANT: Do not remove or delete tests to satisfy workflow; fix failing tests focusing only on modified functionality.
- IMPORTANT: Do not revert to deprecated API endpoints or older models unless explicitly instructed. Always use the specified endpoints and models.
- Use Sequential Thinking mode (e.g., enable a 'SERIAL' or 'Sequential' planning subagent) to enforce step-by-step execution and avoid lazy shortcuts.

## Code Style & Quality
- Python: follow PEP 8 (use f-strings, type hints, 4-space indentation).
- JavaScript: use ES modules, no `var`, prefer arrow functions.
- General solutions only—do not hard-code to pass specific tests.
- Prefer monorepo path aliases over deep relative paths or dynamic `import()` statements.  
  Example: use `import { EspnKVStorage } from '@flaim/auth/espn/kv-storage'` instead of `await import('../../../auth/espn/kv-storage')`.

## Tool & Workflow
- # Bash commands
  - ./build.sh: Build production artifacts (consolidated build script)
  - npm run test: Run unit tests
  - ./start.sh: Interactive development and deployment launcher
- ALLOWLIST:
  - Always allow: Edit
  - Always allow: Bash(git commit:*)
- Slash Commands Directory: `.claude/commands`

## Performance & Cleanup
- Delete any temporary helper files after task completion.
- Load only relevant file segments to minimize token usage.

## Maintenance
- Review and refine these instructions periodically.