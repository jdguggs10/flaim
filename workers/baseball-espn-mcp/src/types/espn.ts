// ESPN API Response Types for Fantasy Baseball

export interface EspnLeagueResponse {
  id: number;
  seasonId: number;
  segmentId: number;
  scoringPeriodId: number;
  currentMatchupPeriod: number;
  status: LeagueStatus;
  settings: LeagueSettings;
}

export interface LeagueSettings {
  name: string;
  size: number;
  playoffTeamCount: number;
  regularSeasonMatchupPeriods: number;
  scoringSettings: ScoringSettings;
  rosterSettings: RosterSettings;
  scheduleSettings: ScheduleSettings;
}

export interface ScoringSettings {
  scoringType: string;
  matchupPeriods: number;
}

export interface RosterSettings {
  lineupSlotCounts: Record<string, number>;
  positionLimits: Record<string, number>;
}

export interface ScheduleSettings {
  playoffSeedingRule: string;
  playoffMatchupPeriodLength: number;
}

export interface LeagueStatus {
  currentMatchupPeriod: number;
  isActive: boolean;
  latestScoringPeriod: number;
  previousSeasonId: number;
  standingsUpdateDate: number;
  teamsJoined: number;
  transactionDeadlineDate: number;
  waiverLastExecutionDate: number;
}

export interface ToolResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  leagueId?: string;
  year?: number;
}

export interface LeagueMetaData {
  id: number;
  name: string;
  size: number;
  status: LeagueStatus;
  scoringPeriodId: number;
  currentMatchupPeriod: number;
  seasonId: number;
  segmentId: number;
  scoringSettings: {
    type: string;
    matchupPeriods: number;
    playoffTeamCount: number;
    regularSeasonMatchupPeriods: number;
  };
  roster: {
    lineupSlotCounts: Record<string, number>;
    positionLimits: Record<string, number>;
  };
  schedule: {
    playoffSeedingRule: string;
    playoffMatchupPeriodLength: number;
  };
}

export interface EspnTeam {
  id: number;
  abbrev: string;
  location: string;
  nickname: string;
  roster?: {
    entries: any[];
  };
}

export interface EspnRosterResponse {
  teams: EspnTeam[];
}