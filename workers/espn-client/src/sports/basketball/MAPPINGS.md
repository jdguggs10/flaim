# ESPN Basketball Mappings

## Sources
- **Primary:** `cwendt94/espn-api` Python library — `espn_api/basketball/constant.py`
- **Verification status:** UNVERIFIED — no live basketball league credentials available

## Notes
- Basketball uses a **single ID space** for both `defaultPositionId` and `lineupSlotId/eligibleSlots`
  (unlike baseball which has two separate spaces)
- `PRO_TEAM_MAP` covers all 30 NBA teams (IDs 1-30, plus 0 for Free Agent)
- `STATS_MAP` covers 45 stat categories including per-game averages
- Some stat IDs may not appear in all league scoring formats

## Verification Checklist
When live credentials become available:
- [ ] Confirm POSITION_MAP IDs against actual roster entries
- [ ] Confirm STATS_MAP IDs against player stat objects
- [ ] Confirm PRO_TEAM_MAP against proTeamSchedules endpoint
- [ ] Log any unknown IDs that appear in practice
