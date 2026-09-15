// Fixtures for Yahoo weekly player points in get_roster (football only),
// shaped from a real Yahoo NFL roster+stats response (format=json) captured
// by a third-party client — not a live call from this worker (Yahoo API
// access has been unavailable to this worker since 2026-07-27, FLA-237).
//
// Verified real-response shape:
// - `fantasy_content.team[1].roster` carries `coverage_type`/`week` at the
//   roster level (for a week-scoped request), plus `is_prescoring`/
//   `is_editable` siblings, alongside the `"0": { players: {...} }` wrapper.
// - Each player's `player` array is [metaArray, ...subResources]. Sub-
//   resources appear as separate sibling objects at later indices (e.g.
//   `selected_position`, an `is_editable` entry, and a combined object
//   carrying BOTH `player_stats` and `player_points`) — the index is not
//   guaranteed, so real code scans by key rather than assuming a position.
// - `player_points`: `{ "0": { coverage_type, week }, total: "12.50" }` —
//   coverage metadata is nested under numeric key "0"; `total` is a STRING
//   sibling, not nested under "0".
// - `player_stats`: `{ "0": { coverage_type, week }, stats: [...] }`.

interface PlayerSpec {
  playerKey: string;
  playerId: string;
  fullName: string;
  team: string;
  displayPosition: string;
  selectedPosition: string;
  /** Omit to simulate no player_stats/player_points sub-resources at all. */
  points?: {
    total: string;
    coverageType: string;
    week?: string;
  };
}

function buildPointsAndStatsResource(spec: NonNullable<PlayerSpec['points']>): Record<string, unknown> {
  const coverage = { coverage_type: spec.coverageType, ...(spec.week ? { week: spec.week } : {}) };

  return {
    player_stats: { '0': coverage, stats: [{ stat: { stat_id: '00', value: '0' } }] },
    player_points: { '0': coverage, total: spec.total },
  };
}

function buildPlayerArray(spec: PlayerSpec, order: 'normal' | 'reversed'): unknown {
  const metaArray = [
    { player_key: spec.playerKey },
    { player_id: spec.playerId },
    { name: { full: spec.fullName } },
    { editorial_team_abbr: spec.team },
    { display_position: spec.displayPosition },
    { status: 'healthy' },
  ];

  const selectedPositionResource = { selected_position: [{}, { position: spec.selectedPosition }] };
  const isEditableResource = { is_editable: 0 };

  const subResources: unknown[] = [];
  if (order === 'normal') {
    subResources.push(selectedPositionResource);
    subResources.push(isEditableResource);
    if (spec.points) {
      subResources.push(buildPointsAndStatsResource(spec.points));
    }
  } else {
    // Reversed order (fixture b): the combined stats/points resource
    // appears BEFORE selected_position, proving the scan is index-agnostic
    // rather than relying on selected_position always coming first.
    if (spec.points) {
      subResources.push(buildPointsAndStatsResource(spec.points));
    }
    subResources.push(isEditableResource);
    subResources.push(selectedPositionResource);
  }

  return { player: [metaArray, ...subResources] };
}

function buildRosterFromSpecs(
  specs: PlayerSpec[],
  order: 'normal' | 'reversed',
  rosterCoverage?: { coverageType: string; week?: string }
): unknown {
  const playersObj: Record<string, unknown> = {};
  specs.forEach((spec, index) => {
    playersObj[String(index)] = buildPlayerArray(spec, order);
  });
  playersObj.count = specs.length;

  return {
    fantasy_content: {
      team: [
        [
          { team_key: '449.l.123.t.1' },
          { name: 'Synthetic Team' },
          { managers: { '0': { manager: { manager_id: 'm1', nickname: 'Manager One' } }, count: 1 } },
        ],
        {
          roster: {
            '0': {
              players: playersObj,
            },
            ...(rosterCoverage
              ? { coverage_type: rosterCoverage.coverageType, ...(rosterCoverage.week ? { week: rosterCoverage.week } : {}) }
              : {}),
            is_prescoring: 0,
            is_editable: 0,
          },
        },
      ],
    },
  };
}

const QB_WITH_POINTS: PlayerSpec = {
  playerKey: '449.p.101',
  playerId: 'p101',
  fullName: 'Synthetic Quarterback',
  team: 'BUF',
  displayPosition: 'QB',
  selectedPosition: 'QB',
  points: { total: '12.50', coverageType: 'week', week: '1' },
};

const BYE_WEEK_RB: PlayerSpec = {
  playerKey: '449.p.102',
  playerId: 'p102',
  fullName: 'Synthetic Running Back',
  team: 'MIA',
  displayPosition: 'RB',
  selectedPosition: 'RB',
  points: { total: '0.00', coverageType: 'week', week: '1' },
};

const BENCH_WR_NO_STATS: PlayerSpec = {
  playerKey: '449.p.103',
  playerId: 'p103',
  fullName: 'Synthetic Wide Receiver',
  team: 'DET',
  displayPosition: 'WR',
  selectedPosition: 'BN',
  // No `points` — simulates a bench player Yahoo returned without any
  // player_stats/player_points sub-resource for the requested week.
};

/**
 * Week-1 football roster: a QB with a finite weekly total, a bye-week RB
 * starter whose total is genuinely '0.00' (must be preserved as 0, not
 * omitted), and a bench WR with no stats sub-resource at all.
 */
export function buildRosterPointsFixture(): unknown {
  return buildRosterFromSpecs([QB_WITH_POINTS, BYE_WEEK_RB, BENCH_WR_NO_STATS], 'normal', {
    coverageType: 'week',
    week: '1',
  });
}

/**
 * Same three players, but each player's combined player_stats/player_points
 * resource is placed BEFORE selected_position in the array — proves the
 * sub-resource scan is index-agnostic rather than assuming a fixed position.
 */
export function buildRosterPointsReversedOrderFixture(): unknown {
  return buildRosterFromSpecs([QB_WITH_POINTS, BYE_WEEK_RB, BENCH_WR_NO_STATS], 'reversed', {
    coverageType: 'week',
    week: '1',
  });
}

/**
 * A single player whose `player_points` carries `coverage_type: 'season'`
 * (under "0") and no `week` — simulates Yahoo echoing back a season-to-date
 * total instead of the requested week. No player in this fixture should
 * ever surface `points`, and the response must not carry `pointsCoverage`.
 */
export function buildRosterPointsSeasonCoverageFixture(): unknown {
  const seasonPlayer: PlayerSpec = {
    playerKey: '449.p.104',
    playerId: 'p104',
    fullName: 'Synthetic Season Total Player',
    team: 'KC',
    displayPosition: 'TE',
    selectedPosition: 'TE',
    points: { total: '84.30', coverageType: 'season', week: '2025' },
  };
  return buildRosterFromSpecs([seasonPlayer], 'normal');
}

/**
 * A roster with no `player_stats`/`player_points` sub-resource on any player
 * at all — simulates Yahoo not returning stats for this request (e.g. the
 * selector was ignored, or the league carries no player_points resource).
 */
export function buildRosterPointsNoStatsFixture(): unknown {
  return buildRosterFromSpecs([BENCH_WR_NO_STATS], 'normal');
}

/**
 * A single player whose `player_points` echoes `coverage_type: 'week'` but a
 * DIFFERENT week (2) than the one requested (1) — simulates Yahoo drifting
 * to an adjacent week. On a week-1 request, this player's points must never
 * surface: the gate requires exact week equality, not just `type: 'week'`.
 */
export function buildRosterPointsWeekMismatchFixture(): unknown {
  const wrongWeekPlayer: PlayerSpec = {
    playerKey: '449.p.105',
    playerId: 'p105',
    fullName: 'Synthetic Wrong Week Player',
    team: 'SF',
    displayPosition: 'WR',
    selectedPosition: 'WR',
    points: { total: '15.40', coverageType: 'week', week: '2' },
  };
  return buildRosterFromSpecs([wrongWeekPlayer], 'normal', { coverageType: 'week', week: '1' });
}

/**
 * Two players on a week-1 request: one whose `player_points` echoes week 1
 * (matches), one whose echoes week 2 (drifted). Only the week-1 player
 * should surface `points`; the mismatched player's points are omitted even
 * though the response as a whole still has usable points from the other
 * player.
 */
export function buildRosterPointsMixedWeekMatchFixture(): unknown {
  const matchingWeekPlayer: PlayerSpec = {
    playerKey: '449.p.106',
    playerId: 'p106',
    fullName: 'Synthetic Matching Week Player',
    team: 'GB',
    displayPosition: 'TE',
    selectedPosition: 'TE',
    points: { total: '9.80', coverageType: 'week', week: '1' },
  };
  const mismatchedWeekPlayer: PlayerSpec = {
    playerKey: '449.p.107',
    playerId: 'p107',
    fullName: 'Synthetic Mismatched Week Player',
    team: 'DAL',
    displayPosition: 'WR',
    selectedPosition: 'WR',
    points: { total: '11.20', coverageType: 'week', week: '2' },
  };
  return buildRosterFromSpecs([matchingWeekPlayer, mismatchedWeekPlayer], 'normal', {
    coverageType: 'week',
    week: '1',
  });
}

/**
 * Two players on a `current` request, echoing DIFFERENT weeks (3, then 4) —
 * simulates Yahoo's stats sub-resource not being pinned to one week when no
 * explicit week is requested. The single consistent week for the response is
 * resolved from the first usable player (week 3); the second player's week 4
 * points are treated as unusable even though they are otherwise well-formed.
 */
export function buildRosterPointsCurrentMixedWeeksFixture(): unknown {
  const firstWeekPlayer: PlayerSpec = {
    playerKey: '449.p.108',
    playerId: 'p108',
    fullName: 'Synthetic Week Three Player',
    team: 'PHI',
    displayPosition: 'RB',
    selectedPosition: 'RB',
    points: { total: '14.60', coverageType: 'week', week: '3' },
  };
  const secondWeekPlayer: PlayerSpec = {
    playerKey: '449.p.109',
    playerId: 'p109',
    fullName: 'Synthetic Week Four Player',
    team: 'NYJ',
    displayPosition: 'WR',
    selectedPosition: 'WR',
    points: { total: '6.90', coverageType: 'week', week: '4' },
  };
  return buildRosterFromSpecs([firstWeekPlayer, secondWeekPlayer], 'normal', { coverageType: 'week', week: '3' });
}
