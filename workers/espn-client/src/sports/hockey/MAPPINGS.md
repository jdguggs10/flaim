# ESPN Hockey Mappings

## Sources
- **Primary:** `cwendt94/espn-api` Python library — `espn_api/hockey/constant.py`
- **Verification status:** UNVERIFIED — no live hockey league credentials available

## Notes
- Hockey uses a **single ID space** for positions (like basketball, unlike baseball)
- `PRO_TEAM_MAP` includes expansion teams with large IDs: Seattle Kraken (124292), Utah Hockey Club (129764)
- Stats are split: IDs 0-12 are goalie stats, IDs 13+ are skater stats
- Some stat IDs in the source are marked with `?` or unknown — these are included as-is
- Arizona Coyotes (ID 24) may be deprecated in favor of Utah Hockey Club (ID 129764)

## Verification Checklist
When live credentials become available:
- [ ] Confirm POSITION_MAP IDs against actual roster entries
- [ ] Confirm goalie vs skater stat ID boundary
- [ ] Confirm PRO_TEAM_MAP — especially expansion team IDs
- [ ] Check if Arizona (24) still appears or is fully replaced by Utah (129764)
- [ ] Log any unknown IDs that appear in practice
