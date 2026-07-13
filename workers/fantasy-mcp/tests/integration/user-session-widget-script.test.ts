import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  classifyRefreshResult,
  type RefreshResultClassification,
  USER_SESSION_WIDGET_HTML,
} from '../../src/widgets/user-session-widget';

function loadEmbeddedClassifier(): (payload: unknown) => RefreshResultClassification {
  const script = USER_SESSION_WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Widget script not found');

  const exposedScript = script.replace(
    /\}\)\(\);\s*$/,
    'globalThis.__classifyRefreshResult = classifyRefreshResult;\n})();',
  );
  const context: Record<string, unknown> = {
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      body: { scrollHeight: 0 },
    },
    URL,
    setTimeout,
  };
  context.window = {
    addEventListener() {},
    parent: null,
  };
  (context.window as Record<string, unknown>).parent = context.window;

  runInNewContext(exposedScript, context);
  return context.__classifyRefreshResult as (payload: unknown) => RefreshResultClassification;
}

describe('user session widget script', () => {
  it('ships the classifier without module helper dependencies', () => {
    expect(USER_SESSION_WIDGET_HTML).not.toContain('__name');
    expect(USER_SESSION_WIDGET_HTML).not.toContain('classifyRefreshResult.toString');
  });

  const cases: Array<{
    name: string;
    payload: unknown;
    expected: RefreshResultClassification;
  }> = [
    {
      name: 'rejects a null payload',
      payload: null,
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
    {
      name: 'rejects a primitive payload',
      payload: 'not-a-batch',
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
    {
      name: 'rejects a payload with missing results',
      payload: { success: false },
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
    {
      name: 'rejects null results',
      payload: { success: false, results: null },
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
    {
      name: 'rejects array results',
      payload: { success: false, results: [] },
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
    {
      name: 'rejects empty results',
      payload: { success: false, results: {} },
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
    {
      name: 'rejects results containing only malformed entries',
      payload: { success: false, results: { espn: null, yahoo: 'invalid', sleeper: [] } },
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
    {
      name: 'honors a top-level rate limit before validating results',
      payload: { success: false, status: 429, results: null },
      expected: { kind: 'retry', message: 'Refresh limited. Try again later.', reloadSession: false },
    },
    {
      name: 'requires explicit batch success for a provider success',
      payload: {
        results: { espn: { platform: 'espn', status: 'success', details: { added: 2 } } },
      },
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
    {
      name: 'rejects explicit batch failure despite a provider success',
      payload: {
        success: false,
        results: { espn: { platform: 'espn', status: 'success', details: { added: 2 } } },
      },
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
    {
      name: 'reports changed ESPN counts',
      payload: {
        success: true,
        results: {
          espn: { platform: 'espn', status: 'success', details: { seasons: { added: 2 } } },
        },
      },
      expected: { kind: 'success', message: 'Leagues refreshed.', reloadSession: true },
    },
    {
      name: 'reports unchanged ESPN counts',
      payload: {
        success: true,
        results: {
          espn: {
            platform: 'espn',
            status: 'success',
            details: { added: 0, refreshed: 0, nested: { updated: 0 } },
          },
        },
      },
      expected: { kind: 'unchanged', message: 'Leagues already up to date.', reloadSession: true },
    },
    {
      name: 'treats Yahoo success as neutral despite mutation-like fields',
      payload: {
        success: true,
        results: {
          yahoo: { platform: 'yahoo', status: 'success', details: { added: 9, updated: 4 } },
        },
      },
      expected: { kind: 'success', message: 'Refresh complete.', reloadSession: true },
    },
    {
      name: 'treats Sleeper success as neutral despite mutation-like fields',
      payload: {
        success: true,
        results: {
          sleeper: { platform: 'sleeper', status: 'success', details: { created: 3, saved: 8 } },
        },
      },
      expected: { kind: 'success', message: 'Refresh complete.', reloadSession: true },
    },
    {
      name: 'reports a generic partial result after a changed ESPN success',
      payload: {
        success: true,
        results: {
          espn: { platform: 'espn', status: 'success', details: { refreshed: 1 } },
          sleeper: { platform: 'sleeper', status: 'error', error: 'discovery_failed' },
        },
      },
      expected: { kind: 'partial', message: 'Some leagues refreshed.', reloadSession: true },
    },
    {
      name: 'reports a retryable partial result',
      payload: {
        success: true,
        results: {
          espn: { platform: 'espn', status: 'success', details: { refreshed: 0 } },
          yahoo: { platform: 'yahoo', status: 'error', retryAfter: '30' },
        },
      },
      expected: {
        kind: 'partial',
        message: 'Refresh partially complete. Try again later.',
        reloadSession: true,
      },
    },
    {
      name: 'reports a reconnect partial result ahead of retry',
      payload: {
        success: true,
        results: {
          sleeper: { platform: 'sleeper', status: 'success' },
          yahoo: {
            platform: 'yahoo',
            status: 'error',
            httpStatus: 401,
            error: 'rate_limited',
          },
        },
      },
      expected: {
        kind: 'partial',
        message: 'Refresh partially complete. Reconnect a provider.',
        reloadSession: true,
        showLeaguesLink: true,
      },
    },
    ...(['reconnectRequired', 'requiresReconnect', 'reconnect_required'] as const).map((flag) => ({
      name: `honors the explicit ${flag} flag`,
      payload: {
        success: true,
        results: {
          espn: { platform: 'espn', status: 'success', details: { added: 0 } },
          yahoo: { platform: 'yahoo', status: 'skipped', [flag]: true },
        },
      },
      expected: {
        kind: 'partial' as const,
        message: 'Refresh partially complete. Reconnect a provider.',
        reloadSession: true,
        showLeaguesLink: true,
      },
    })),
    {
      name: 'reports reconnect-only auth failures',
      payload: {
        success: false,
        results: {
          yahoo: { platform: 'yahoo', status: 'error', httpStatus: 403, error: 'access_denied' },
        },
      },
      expected: { kind: 'reconnect', message: 'Reconnect a league provider.', reloadSession: false },
    },
    {
      name: 'reports reconnect-only failures from auth text',
      payload: {
        success: false,
        results: {
          yahoo: { platform: 'yahoo', status: 'error', error_description: 'Credential revoked' },
        },
      },
      expected: { kind: 'reconnect', message: 'Reconnect a league provider.', reloadSession: false },
    },
    {
      name: 'reports retry-only rate limits',
      payload: {
        success: false,
        results: {
          yahoo: { platform: 'yahoo', status: 'error', httpStatus: 429 },
        },
      },
      expected: { kind: 'retry', message: 'Refresh limited. Try again later.', reloadSession: false },
    },
    {
      name: 'reports retry-only failures from error text',
      payload: {
        success: false,
        results: {
          sleeper: { platform: 'sleeper', status: 'error', error: 'too many requests; try again' },
        },
      },
      expected: { kind: 'retry', message: 'Refresh limited. Try again later.', reloadSession: false },
    },
    {
      name: 'reports skipped-only providers as unchanged',
      payload: {
        success: false,
        results: {
          espn: { platform: 'espn', status: 'skipped' },
          yahoo: { platform: 'yahoo', status: 'skipped' },
        },
      },
      expected: { kind: 'unchanged', message: 'No connected leagues to refresh.', reloadSession: false },
    },
    {
      name: 'reports a generic provider failure',
      payload: {
        success: false,
        results: {
          espn: { platform: 'espn', status: 'error', httpStatus: 500, error: 'discovery_failed' },
        },
      },
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
    {
      name: 'ignores skipped providers alongside a successful refresh',
      payload: {
        success: true,
        results: {
          espn: { platform: 'espn', status: 'success', details: { added: 1 } },
          yahoo: { platform: 'yahoo', status: 'skipped', error: 'not_connected' },
          sleeper: { platform: 'sleeper', status: 'skipped', error: 'not_connected' },
        },
      },
      expected: { kind: 'success', message: 'Leagues refreshed.', reloadSession: true },
    },
  ];

  it.each(cases)('$name', ({ payload, expected }) => {
    const embeddedClassifier = loadEmbeddedClassifier();
    expect(classifyRefreshResult(payload)).toEqual(expected);
    expect(embeddedClassifier(payload)).toEqual(expected);
  });
});
