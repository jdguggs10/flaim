// Synthetic fixtures for Yahoo weekly player points in get_roster (football
// only). There is no captured `player_points` payload anywhere in this repo —
// Yahoo API access has been unavailable since 2026-07-27 (FLA-237) — so this
// shape is inferred from Yahoo's own (sparse) documentation, not a live
// capture. Treat these as fixture-tested only, matching the FLA-284 caveat
// already used for is_keeper/settings fixtures in this same directory.

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

  const subResources: unknown[] = [];
  if (order === 'normal') {
    subResources.push(selectedPositionResource);
    if (spec.points) {
      // A real capture would also carry a `player_stats` sub-resource
      // alongside `player_points` when stats are requested — included here so
      // findPlayerSubResource must scan past it rather than assuming
      // player_points sits at a fixed offset from selected_position.
      subResources.push({ player_stats: { '0': { stat: { stat_id: '00', value: '0' } }, coverage_type: spec.points.coverageType } });
      subResources.push({
        player_points: {
          coverage_type: spec.points.coverageType,
          ...(spec.points.week ? { week: spec.points.week } : {}),
          total: spec.points.total,
        },
      });
    }
  } else {
    // Reversed order (fixture b): player_points appears BEFORE
    // selected_position, proving the scan is index-agnostic rather than
    // relying on selected_position always being the first sub-resource.
    if (spec.points) {
      subResources.push({
        player_points: {
          coverage_type: spec.points.coverageType,
          ...(spec.points.week ? { week: spec.points.week } : {}),
          total: spec.points.total,
        },
      });
    }
    subResources.push(selectedPositionResource);
  }

  return { player: [metaArray, ...subResources] };
}

function buildRosterFromSpecs(specs: PlayerSpec[], order: 'normal' | 'reversed'): unknown {
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
  points: { total: '22.16', coverageType: 'week', week: '5' },
};

const BYE_WEEK_RB: PlayerSpec = {
  playerKey: '449.p.102',
  playerId: 'p102',
  fullName: 'Synthetic Running Back',
  team: 'MIA',
  displayPosition: 'RB',
  selectedPosition: 'RB',
  points: { total: '0.00', coverageType: 'week', week: '5' },
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
 * Week-5 football roster: a QB with a finite weekly total, a bye-week RB
 * starter whose total is genuinely '0.00' (must be preserved as 0, not
 * omitted), and a bench WR with no stats sub-resource at all.
 */
export function buildRosterPointsFixture(): unknown {
  return buildRosterFromSpecs([QB_WITH_POINTS, BYE_WEEK_RB, BENCH_WR_NO_STATS], 'normal');
}

/**
 * Same three players, but each player's `player_points` sub-resource is
 * placed BEFORE `selected_position` in the array — proves the sub-resource
 * scan is index-agnostic rather than assuming a fixed position.
 */
export function buildRosterPointsReversedOrderFixture(): unknown {
  return buildRosterFromSpecs([QB_WITH_POINTS, BYE_WEEK_RB, BENCH_WR_NO_STATS], 'reversed');
}

/**
 * A single player whose `player_points` carries `coverage_type: 'season'`
 * and no `week` — simulates Yahoo echoing back a season-to-date total instead
 * of the requested week. No player in this fixture should ever surface
 * `points`, and the response must not carry `pointsCoverage`.
 */
export function buildRosterPointsSeasonCoverageFixture(): unknown {
  const seasonPlayer: PlayerSpec = {
    playerKey: '449.p.104',
    playerId: 'p104',
    fullName: 'Synthetic Season Total Player',
    team: 'KC',
    displayPosition: 'TE',
    selectedPosition: 'TE',
    points: { total: '84.30', coverageType: 'season' },
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
 * DIFFERENT week (6) than the one requested (5) — simulates Yahoo drifting
 * to an adjacent week. On a week-5 request, this player's points must never
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
    points: { total: '15.40', coverageType: 'week', week: '6' },
  };
  return buildRosterFromSpecs([wrongWeekPlayer], 'normal');
}

/**
 * Two players on a week-5 request: one whose `player_points` echoes week 5
 * (matches), one whose echoes week 6 (drifted). Only the week-5 player
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
    points: { total: '9.80', coverageType: 'week', week: '5' },
  };
  const mismatchedWeekPlayer: PlayerSpec = {
    playerKey: '449.p.107',
    playerId: 'p107',
    fullName: 'Synthetic Mismatched Week Player',
    team: 'DAL',
    displayPosition: 'WR',
    selectedPosition: 'WR',
    points: { total: '11.20', coverageType: 'week', week: '6' },
  };
  return buildRosterFromSpecs([matchingWeekPlayer, mismatchedWeekPlayer], 'normal');
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
  return buildRosterFromSpecs([firstWeekPlayer, secondWeekPlayer], 'normal');
}
