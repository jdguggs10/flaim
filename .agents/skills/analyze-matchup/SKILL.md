---
name: analyze-matchup
description: Analyze the current fantasy matchup with scores, remaining players or games, and a fact-based forecast. Use when the user explicitly wants a matchup-state breakdown or invokes /analyze-matchup.
argument-hint: "[week-number]"
license: Proprietary
---

# Analyze Matchup

Assess the user's current head-to-head matchup with a fact-based forecast of what remains.

## Scope and data rules

- Fantasy league data must come from Flaim MCP tools.
- Use web search for live schedule context, injury updates, probable starters, and remaining real-world games.

## Arguments

- `$ARGUMENTS` is the requested matchup week.
- If no argument is provided, use the current week.

## Workflow

### 1. Resolve the target league

- Call `get_user_session` if it has not already been called in this chat.
- If the user explicitly names a league, platform, or sport, honor that.
- Otherwise treat this as a vague singular request: use `defaultLeague` when present, otherwise the relevant sport entry in `defaultLeagues`.
- If there is no applicable default and multiple leagues still match, ask which league.
- Call `get_league_info` for the selected league before matchup analysis so team names, scoring type, owner/team mapping, and roster context are resolved.

### 2. Determine whether matchup analysis applies

Use `get_league_info` to identify scoring format:

- **H2H Points**: proceed
- **H2H Categories**: proceed
- **Roto**: explain that this skill is not the right fit for roto and offer standings or roster analysis instead

### 3. Pull matchup and roster context

- Call `get_matchups` for the requested week or current week
- Call `get_roster` for the user's team
- Call `get_roster` for the opponent

### 4. Determine what remains to be played

Use web search to establish remaining real-world volume:

- **Football**: identify which players have already played, are in progress, or still have games left; group remaining players by game slot
- **Baseball/Basketball/Hockey**: estimate remaining player-games for both rosters
- For baseball, include probable remaining starts when current information supports it

### 5. Assess the matchup state

For **H2H Points**:

- state the current score and margin
- list meaningful remaining players and game windows
- explain whether the matchup looks comfortable, tight, or uphill
- flag high-variance swing factors

For **H2H Categories**:

- state the current category record
- separate likely-locked categories from realistic swing categories
- explain where remaining volume could still flip the matchup

### 6. Present the briefing

Format the output as:

- a clean score line at the top
- remaining-player or remaining-volume sections for both teams
- a short outlook paragraph covering trajectory, volatility, and what to watch

## Output style

- Keep it analytical, not melodramatic
- Do not recommend roster moves in this skill
- Focus on scoreboard state, remaining volume, and likely swing factors
