// ESPN Fantasy Football API Types

export interface EspnFootballLeagueResponse {
  id: number;
  seasonId: number;
  segmentId: number;
  scoringPeriodId: number;
  currentMatchupPeriod: number;
  status: FootballLeagueStatus;
  settings: FootballLeagueSettings;
  teams?: FootballTeam[];
  schedule?: FootballMatchup[];
}

export interface FootballLeagueSettings {
  name: string;
  size: number;
  playoffTeamCount: number;
  regularSeasonMatchupPeriods: number;
  scoringSettings: FootballScoringSettings;
  rosterSettings: FootballRosterSettings;
  scheduleSettings: FootballScheduleSettings;
}

export interface FootballScoringSettings {
  scoringType: string;
  matchupPeriods: number;
  playoffMatchupPeriodLength: number;
  // Football-specific scoring
  scoringItems: Record<string, number>;
}

export interface FootballRosterSettings {
  lineupSlotCounts: Record<string, number>;
  positionLimits: Record<string, number>;
  // Football lineup slots: QB, RB, WR, TE, FLEX, K, D/ST, etc.
}

export interface FootballScheduleSettings {
  playoffSeedingRule: string;
  playoffMatchupPeriodLength: number;
  divisions?: FootballDivision[];
}

export interface FootballLeagueStatus {
  currentMatchupPeriod: number;
  isActive: boolean;
  latestScoringPeriod: number;
  previousSeasonId: number;
  standingsUpdateDate: number;
  teamsJoined: number;
  transactionDeadlineDate: number;
  waiverLastExecutionDate: number;
  waiverProcessStatus: Record<string, any>;
}

export interface FootballTeam {
  id: number;
  abbrev: string;
  name: string;
  owners: FootballOwner[];
  record: FootballRecord;
  roster?: FootballRoster;
  standings?: FootballStandings;
}

export interface FootballOwner {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
}

export interface FootballRecord {
  overall: {
    wins: number;
    losses: number;
    ties: number;
    pointsFor: number;
    pointsAgainst: number;
  };
  home?: {
    wins: number;
    losses: number;
    ties: number;
  };
  away?: {
    wins: number;
    losses: number;
    ties: number;
  };
}

export interface FootballRoster {
  entries: FootballRosterEntry[];
}

export interface FootballRosterEntry {
  playerId: number;
  lineupSlotId: number;
  playerPoolEntry: {
    player: FootballPlayer;
  };
  acquisitionType: number;
  injuryStatus?: string;
}

export interface FootballPlayer {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
  defaultPositionId: number;
  proTeamId: number;
  eligibleSlots: number[];
  stats?: FootballStats[];
  seasonOutlook?: string;
  injuryStatus?: string;
}

export interface FootballStats {
  seasonId: number;
  statSourceId: number;
  statSplitTypeId: number;
  stats: Record<string, number>;
  appliedStats: Record<string, number>;
}

export interface FootballMatchup {
  id: number;
  matchupPeriodId: number;
  playoffTierType: string;
  home: FootballMatchupTeam;
  away: FootballMatchupTeam;
  winner?: 'home' | 'away' | 'tie';
}

export interface FootballMatchupTeam {
  teamId: number;
  totalPoints: number;
  totalProjectedPoints?: number;
  rosterForCurrentScoringPeriod?: {
    entries: FootballRosterEntry[];
  };
}

export interface FootballStandings {
  rank: number;
  pointsFor: number;
  pointsAgainst: number;
  wins: number;
  losses: number;
  ties: number;
  divisionStanding?: number;
}

export interface FootballDivision {
  id: number;
  name: string;
  size: number;
}

export interface FootballToolResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  leagueId?: string;
  year?: number;
  sport: 'football';
}

export interface EspnFootballTeamResponse {
  teams: FootballTeam[];
}