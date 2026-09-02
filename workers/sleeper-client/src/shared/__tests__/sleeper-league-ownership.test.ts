import { describe, expect, it } from 'vitest';
import type { SleeperLeagueUser, SleeperRoster } from '../../types';
import {
  buildSleeperLeagueOwnershipMap,
  resolveSleeperPlayerAvailability,
  toSleeperLeagueAvailabilityFields,
} from '../sleeper-league-ownership';

describe('Sleeper targeted league availability', () => {
  it('resolves one exact player id as rostered with roster, team, and owner', () => {
    const rosters = [{
      roster_id: 3,
      owner_id: 'owner-example',
      players: ['4046', 'other-player'],
    }] as SleeperRoster[];
    const users = [{
      user_id: 'owner-example',
      display_name: 'Example Owner',
      avatar: null,
      metadata: { team_name: 'Example Team' },
    }] as SleeperLeagueUser[];

    const ownership = buildSleeperLeagueOwnershipMap(rosters, users);
    const availability = resolveSleeperPlayerAvailability('4046', ownership);

    expect(availability).toEqual({
      status: 'ROSTERED',
      rosterId: '3',
      teamName: 'Example Team',
      ownerName: 'Example Owner',
    });
    expect(toSleeperLeagueAvailabilityFields(availability)).toEqual({
      availability_status: 'ROSTERED',
      league_status: 'ROSTERED',
      league_team_id: '3',
      league_team_name: 'Example Team',
      league_owner_name: 'Example Owner',
    });
  });

  it('returns AVAILABLE only when the player id is absent from every roster', () => {
    const rosters = [
      { roster_id: 1, owner_id: 'one', players: ['p1', 'p2'] },
      { roster_id: 2, owner_id: 'two', players: ['p3'] },
    ] as SleeperRoster[];

    const ownership = buildSleeperLeagueOwnershipMap(rosters, []);
    const availability = resolveSleeperPlayerAvailability('4046', ownership);

    expect(availability).toEqual({
      status: 'AVAILABLE',
      rosterId: null,
      teamName: null,
      ownerName: null,
    });
    expect(toSleeperLeagueAvailabilityFields(availability)).toEqual({
      availability_status: 'AVAILABLE',
      league_status: 'FREE_AGENT',
      league_team_id: null,
      league_team_name: null,
      league_owner_name: null,
    });
  });
});
