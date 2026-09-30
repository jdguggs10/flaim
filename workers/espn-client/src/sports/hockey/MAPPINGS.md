# ESPN Hockey Mappings

## Sources
- **Primary:** `cwendt94/espn-api` Python library — `espn_api/hockey/constant.py`
- **Live verification:** 2026-09-29, against an anonymously readable 2026-27 ESPN hockey league. No credentials were used.

## Notes
- Hockey uses a **single ID space** for positions (like basketball, unlike baseball). Live roster data covered natural position IDs 1-5, eligible slot IDs 0-8, and roster slot IDs 3-8.
- `PRO_TEAM_MAP` is live-verified for IDs 1-23, 25-30, 37, 124292 (Seattle Kraken), and 129764 (Utah Hockey Club).
- Stats are split: IDs 0-12 are goalie stats and IDs 13+ are skater stats, except shared ID 30 (`GP`). The historical 2025-26 actual and 2026-27 projection payloads verified skater IDs 16 (`PTS`), 25 (`SHFT`), 26 (`TOI_SECONDS`), 27 (`ATOI_SECONDS`), 30 (`GP`), and goalie IDs 8 (`MIN_SECONDS`), 12 (`W%`), 30 (`GP`). Source-derived ID 34 no longer aliases `GP`; it keeps the honest `STAT_34` fallback because live goalie projections distinguish it from ID 30.
- Current 2026-27 actual-stat payloads are preseason-empty. Unknown stat IDs retain the `STAT_<id>` fallback rather than being guessed.
- Some source stat IDs remain unverified and are retained as sourced labels where present.
- Arizona Coyotes (ID 24) may be deprecated in favor of Utah Hockey Club (ID 129764)

## Remaining verification

- Check whether Arizona (24) still appears or is fully replaced by Utah (129764)
- Verify source-derived stat labels beyond the live-observed IDs
- Continue logging newly observed position, lineup-slot, and stat IDs
