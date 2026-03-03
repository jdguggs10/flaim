---
description: League activity briefing on recent moves -- who moved who, when, and why
argument-hint: "[days back, default 2]"
---

# /activity-brief - League Activity Briefing

Analyze recent league transactions and explain what happened, when, and why each team made their moves.

## Usage

```
/activity-brief    # Last 2 days (default)
/activity-brief 3  # Last 3 days
/activity-brief 1  # Just today/overnight
```

## Workflow

### 1. Get League Context

Call `get_user_session` to identify the user's default sport and default league. If no defaults are set, ask which league.

### 2. Pull Transactions

Call `get_transactions` for the identified league. Retrieve enough transactions to cover the requested time window (default: 2 days).

### 3. Organize by Time Period

Sort all transactions into buckets based on their `date` field relative to now:

- **Overnight** — moves made since midnight today
- **Yesterday** — moves made the prior calendar day
- **Prior day(s)** — anything older within the requested window

Within each time bucket, group by team so the user can see what each team did together.

### 4. Enrich with Context

For each transaction, run a web search on the key players involved (added, dropped, or traded). Look for:

- Injury news or status changes
- Recent performance (hot streak, cold streak, benchings)
- Upcoming schedule (bye weeks, tough/easy matchups)
- Breaking news (trades, suspensions, depth chart changes)

### 5. Analyze Each Move

For each transaction, write a brief explanation of *why* that team likely made the move:

- **Simple adds/drops:** One line. Example: "Doubs out 2-3 weeks with hamstring per Rapoport. RMJ expected to start."
- **Waiver claims:** One line noting the player's appeal and who was dropped.
- **Trades:** A few lines covering what each side gains, schedule implications, and whether it looks fair.

### 6. Present the Briefing

Format as a clean activity briefing (any time of day):

- Lead with a one-sentence summary ("5 moves across 3 teams in the last 2 days")
- Then time-bucketed sections with team moves and analysis
- End with any moves that might affect the user's team directly (e.g., a rival picked up a player at a position the user needs)

## Output Style

- Conversational, not robotic
- Player names in bold on first mention
- One-liner analysis for simple moves, 2-3 lines for trades
- Flag anything that directly impacts the user's roster or upcoming matchup
