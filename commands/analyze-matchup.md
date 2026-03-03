---
description: Analyze your current matchup -- scores, who's left to play, and forecast
argument-hint: "[week number]"
---

# /analyze-matchup - Matchup Analyzer

Assess the current state of your head-to-head matchup with a fact-based forecast of what's still to come.

## Usage

```
/analyze-matchup   # Current week, default sport/league
/analyze-matchup 12 # Specific week
```

## Workflow

### 1. Get League Context

Call `get_user_session` to identify the user's default sport and default league. If no defaults are set, ask which league.

### 2. Determine Scoring Format

Call `get_league_info` to identify the scoring type:

- **H2H Points** — total points, one winner
- **H2H Categories** — multiple statistical categories, each a win/loss/tie
- **Roto** — not head-to-head; explain this command isn't applicable and offer to show standings instead

### 3. Pull Matchup and Rosters

- Call `get_matchups` for the target week to get current scores and the opponent
- Call `get_roster` for the user's team and the opponent's team

### 4. Determine What's Left to Play

Use web search to determine the remaining real-world games within the matchup period:

**Football:**
- Check which players have already played, are currently playing, or have upcoming games (Thursday → Sunday → Monday)
- Group remaining players by game slot (Sun early, Sun afternoon, Sun night, Monday)

**Baseball / Basketball / Hockey:**
- The matchup spans a full week with daily games
- Web search the real-world team schedules for both rosters to count remaining player-games
- For baseball pitchers: check probable pitcher schedules to identify remaining starts
- Baseball note: probable starter assignments can change late, so identifying when specific pitchers are slated to start may require additional research from current beat reports/team updates
- Summarize as total remaining games per roster, broken down by position group if relevant

### 5. Assess the Situation

**For H2H Points:**
- State the current score and margin
- List remaining players for each team with their game times
- Give a fact-based outlook: is the lead comfortable, tight, or dire based on who's left?
- Note any high-variance situations (e.g., opponent has a QB/WR stack in one game)

**For H2H Categories:**
- State the current category breakdown (wins, losses, ties)
- Identify which categories are close enough to flip based on remaining volume
- Identify which categories are locked up in either direction
- Note where remaining game volume (more batter-games, more SP starts) could shift things

### 6. Present the Briefing

Format cleanly:

- **Score line** at the top with margin or category record
- **Remaining players** for each team, organized by game time (football) or total remaining games (other sports)
- **Outlook** paragraph: 2-4 sentences on the trajectory, key swing factors, and what to watch
- Do NOT recommend roster moves — keep it to assessment and forecast only
