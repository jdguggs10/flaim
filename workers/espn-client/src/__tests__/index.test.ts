import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INTERNAL_SERVICE_TOKEN_HEADER } from '@flaim/worker-shared';
import type { RoutedToolParams } from '../types';

const footballGetStandings = vi.fn(async () => ({
  success: true,
  data: { handler: 'football' },
}));

const basketballGetStandings = vi.fn(async () => ({
  success: true,
  data: { handler: 'basketball' },
}));

const basketballGetMatchups = vi.fn(async () => ({
  success: true,
  data: { handler: 'basketball-matchups' },
}));

const hockeyGetFreeAgents = vi.fn(async () => ({
  success: true,
  data: { handler: 'hockey-free-agents' },
}));

vi.mock('../sports/football/handlers', () => ({
  footballHandlers: {
    get_standings: footballGetStandings,
  },
}));

vi.mock('../sports/baseball/handlers', () => ({
  baseballHandlers: {},
}));

vi.mock('../sports/basketball/handlers', () => ({
  basketballHandlers: {
    get_standings: basketballGetStandings,
    get_matchups: basketballGetMatchups,
  },
}));

vi.mock('../sports/hockey/handlers', () => ({
  hockeyHandlers: {
    get_free_agents: hockeyGetFreeAgents,
  },
}));

const { default: app } = await import('../index');

function makeRequest(body: unknown): Request {
  return new Request('https://espn-client.test/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer user-token',
      [INTERNAL_SERVICE_TOKEN_HEADER]: 'internal-token',
    },
    body: JSON.stringify(body),
  });
}

describe('/execute season boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves canonical season_year and adds basketball seasonContext', async () => {
    const response = await app.fetch(makeRequest({
      tool: 'get_standings',
      params: {
        sport: 'basketball',
        league_id: '123',
        season_year: 2024,
      },
    }), {
      INTERNAL_SERVICE_TOKEN: 'internal-token',
    } as never);

    expect(response.status).toBe(200);
    expect(basketballGetStandings).toHaveBeenCalledOnce();

    const basketballCalls = basketballGetStandings.mock.calls as unknown[][];
    const routedParams = basketballCalls[0]?.[1] as RoutedToolParams;
    expect(routedParams).toMatchObject({
      sport: 'basketball',
      league_id: '123',
      season_year: 2024,
      seasonContext: {
        canonicalYear: 2024,
        espnYear: 2025,
      },
    });
    expect(basketballCalls[0]?.[2]).toBe('Bearer user-token');

    const body = await response.json();
    expect(body).toEqual({
      success: true,
      data: { handler: 'basketball' },
    });
  });

  it('routes basketball get_matchups with explicit seasonContext', async () => {
    const response = await app.fetch(makeRequest({
      tool: 'get_matchups',
      params: {
        sport: 'basketball',
        league_id: '321',
        season_year: 2024,
        week: 7,
      },
    }), {
      INTERNAL_SERVICE_TOKEN: 'internal-token',
    } as never);

    expect(response.status).toBe(200);
    expect(basketballGetMatchups).toHaveBeenCalledOnce();

    const basketballCalls = basketballGetMatchups.mock.calls as unknown[][];
    const routedParams = basketballCalls[0]?.[1] as RoutedToolParams;
    expect(routedParams).toMatchObject({
      sport: 'basketball',
      league_id: '321',
      season_year: 2024,
      week: 7,
      seasonContext: {
        canonicalYear: 2024,
        espnYear: 2025,
      },
    });
    expect(basketballCalls[0]?.[2]).toBe('Bearer user-token');

    const body = await response.json();
    expect(body).toEqual({
      success: true,
      data: { handler: 'basketball-matchups' },
    });
  });

  it('keeps football canonical and ESPN year aligned', async () => {
    const response = await app.fetch(makeRequest({
      tool: 'get_standings',
      params: {
        sport: 'football',
        league_id: '999',
        season_year: 2025,
      },
    }), {
      INTERNAL_SERVICE_TOKEN: 'internal-token',
    } as never);

    expect(response.status).toBe(200);
    expect(footballGetStandings).toHaveBeenCalledOnce();

    const footballCalls = footballGetStandings.mock.calls as unknown[][];
    const routedParams = footballCalls[0]?.[1] as RoutedToolParams;
    expect(routedParams).toMatchObject({
      sport: 'football',
      league_id: '999',
      season_year: 2025,
      seasonContext: {
        canonicalYear: 2025,
        espnYear: 2025,
      },
    });
  });

  it('routes hockey get_free_agents with explicit seasonContext', async () => {
    const response = await app.fetch(makeRequest({
      tool: 'get_free_agents',
      params: {
        sport: 'hockey',
        league_id: '456',
        season_year: 2024,
        position: 'C',
        count: 15,
      },
    }), {
      INTERNAL_SERVICE_TOKEN: 'internal-token',
    } as never);

    expect(response.status).toBe(200);
    expect(hockeyGetFreeAgents).toHaveBeenCalledOnce();

    const hockeyCalls = hockeyGetFreeAgents.mock.calls as unknown[][];
    const routedParams = hockeyCalls[0]?.[1] as RoutedToolParams;
    expect(routedParams).toMatchObject({
      sport: 'hockey',
      league_id: '456',
      season_year: 2024,
      position: 'C',
      count: 15,
      seasonContext: {
        canonicalYear: 2024,
        espnYear: 2025,
      },
    });
    expect(hockeyCalls[0]?.[2]).toBe('Bearer user-token');

    const body = await response.json();
    expect(body).toEqual({
      success: true,
      data: { handler: 'hockey-free-agents' },
    });
  });
});
