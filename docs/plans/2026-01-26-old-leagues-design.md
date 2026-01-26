# Old Leagues / Ancient History Design

## Problem

Users accumulate leagues over time. Currently, `get_user_session` sends ALL leagues and ALL seasons to the AI, consuming significant tokens even though 95% of queries are about current/recent data.

## Solution

Split leagues into "active" and "old" based on a 2-year threshold:
- **Active**: Has a season within the last 2 calendar years
- **Old**: Most recent season is 2+ years ago

### Data Flow

**`get_user_session` (trimmed):**
- Only active leagues
- Only last 2 seasons per league
- Adds instruction hint about `get_ancient_history`

**`get_ancient_history` (new tool):**
- Returns old leagues (all details)
- Returns old seasons from active leagues
- Called on-demand for historical queries

### Token Impact

Example user with 8 leagues, 40 total seasons:
- Before: ~4000 tokens
- After: 4 active leagues × 2 seasons = ~800 tokens
- **~80% reduction**

## UI Design

### Old Leagues Section

Appears at bottom of Active Leagues card, after all sport sections:
- Header: `🗄️ Old Leagues (3)` - gray, collapsed by default
- Click to expand
- Old league cards have muted styling, show "Last active: YYYY"
- No star/default functionality on old leagues
- Delete button still available

### Important Distinction

| Concept | UI Treatment | MCP Treatment |
|---------|--------------|---------------|
| Old League | Gray section at bottom | Hidden from get_user_session |
| Old Season (active league) | Visible in horizontal scroll | Hidden from get_user_session |
| Active Season | Visible in horizontal scroll | Included (last 2 only) |

Users see everything. AI sees trimmed data by default.

## MCP Tool Specification

### Modified: `get_user_session`

Returns only active leagues with 2 most recent seasons each.

Instructions include: *"For historical leagues/seasons (2+ years old), use get_ancient_history"*

### New: `get_ancient_history`

```typescript
{
  name: "get_ancient_history",
  description: "Retrieve archived leagues and old seasons beyond the 2-year window. Use when user asks about inactive leagues, past seasons, or historical performance.",
  parameters: {
    platform: { type: "string", enum: ["espn", "yahoo"], optional: true }
  }
}
```

Returns:
```typescript
{
  oldLeagues: League[],      // Leagues with no seasons in 2 years
  oldSeasons: {              // Old seasons grouped by active league
    [leagueKey: string]: Season[]
  }
}
```

## Implementation Scope

### Changes Required

**Frontend (`web/app/(site)/leagues/page.tsx`):**
- Split leagues into active vs old
- Add collapsible "Old Leagues" section
- Muted styling for old league cards

**MCP (`workers/fantasy-mcp/src/mcp/tools.ts`):**
- Filter `get_user_session` to active leagues + 2 seasons
- Add `get_ancient_history` tool
- Update instructions hint

### No Changes Needed

- ESPN/Yahoo storage layers
- Database schema
- Existing MCP tools (roster, standings, etc.)
