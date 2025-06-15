/**
 * ESPN League Discovery Error Definitions
 */

export class AutomaticLeagueDiscoveryFailed extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'AutomaticLeagueDiscoveryFailed';
  }
}

export class EspnCredentialsRequired extends Error {
  constructor(message: string = 'ESPN credentials required for league discovery') {
    super(message);
    this.name = 'EspnCredentialsRequired';
  }
}

export class EspnAuthenticationFailed extends Error {
  constructor(message: string = 'ESPN authentication failed - invalid credentials') {
    super(message);
    this.name = 'EspnAuthenticationFailed';
  }
}