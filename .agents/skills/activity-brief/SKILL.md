---
name: activity-brief
description: Give a time-bucketed league activity briefing on recent fantasy moves, including who moved who, when, and why. Use when the user explicitly wants a transaction roundup or invokes /activity-brief.
argument-hint: "[days-back, default 2]"
license: Proprietary
---

# Activity Brief

Produce a clean recent-activity briefing for the user's current or specified fantasy league.

## Scope and data rules

- Fantasy league data must come from Flaim MCP tools.
- Use web search to enrich player news, injuries, role changes, and schedule context.

## Arguments

- `$ARGUMENTS` is the requested number of days back.
- If no argument is provided, default to `2`.
- Treat non-numeric arguments as no argument unless the user clearly explains a different time window in natural language.

## Workflow

### 1. Resolve the target league

- Call `get_user_session` if it has not already been called in this chat.
- If the user explicitly names a league, platform, or sport, honor that.
- Otherwise treat this as a vague singular request: use `defaultLeague` when present, otherwise the relevant sport entry in `defaultLeagues`.
- If there is no applicable default and multiple leagues still match, ask which league.
- Call `get_league_info` for the selected league before interpreting transactions so team names and owner/team mapping are resolved.

### 2. Pull recent transactions

- Call `get_transactions` for the selected league.
- Retrieve the recent transaction window the platform provides, then trim the presentation to the requested day range.
- Remember platform caveats:
  - Yahoo ignores explicit `week` and uses a recent timestamp window.
  - ESPN and Sleeper are more week-oriented than date-oriented.

### 3. Organize the results

Bucket the transactions by time period relative to now:

- **Overnight**: since the most recent midnight in the user's inferred timezone, or UTC if their timezone is unclear
- **Yesterday**: the prior calendar day
- **Prior day(s)**: older moves still within the requested window

Within each time bucket, group by team so the user can see what each team did together.

### 4. Enrich with public context

For the important players involved, use web search to check:

- injuries or status changes
- recent performance trends
- role or depth-chart changes
- upcoming schedule context
- breaking news that explains the move

### 5. Analyze each move

- **Simple adds/drops**: usually one line
- **Waiver claims**: one line explaining the appeal of the add and what was sacrificed
- **Trades**: a few lines on what each side gains, schedule implications, and whether it looks balanced

Focus on why the move likely happened, not just what the transaction log says.

### 6. Present the briefing

Format the output as:

- one-sentence topline summary
- time-bucketed sections
- team-grouped moves inside each section
- short take on any move that materially affects the user's team or competition

## Output style

- Conversational, not robotic
- Player names in bold on first mention
- Keep simple moves to one line when possible
- Expand only when a trade or high-impact move justifies it
