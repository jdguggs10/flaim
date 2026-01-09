# TODO

## Features
- ~~Make the auto-pull league feature also automatically trigger the season pull feature as well.~~ *(Done in v1.1)*

## Bugs

### Active

- **Build out MCP functionality for football and baseball**: Worker tools are skeletal (auth + retrieval tests only); expand to full functionality.
  - Current football tools (workers/football-espn-mcp): `get_user_session`, `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings`.
  - Current baseball tools (workers/baseball-espn-mcp): `get_user_session`, `get_espn_baseball_league_info`, `get_espn_baseball_team_roster`, `get_espn_baseball_matchups`, `get_espn_baseball_standings`.

### Resolved

- ~~**Auto league discovery refactor** (done in v1.2.0): See `docs/AUTO_LEAGUE_DISCOVERY_REFACTOR.md`.~~

- ~~**League delete succeeds in UI but fails to delete from Supabase**: Fixed in `removeLeague()` - now uses `.select()` to verify rows were deleted and returns `false` if 0 rows matched. Added logging for debugging.~~

- ~~**Silent skip on missing teamId**: Original hypothesis was that leagues were being skipped due to missing teamId. Investigation showed the actual issue is that ESPN returns NO leagues at all, not that leagues are being skipped.~~
