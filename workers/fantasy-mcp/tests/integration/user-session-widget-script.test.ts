import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  classifyRefreshResult,
  type RefreshResultClassification,
  LEGACY_USER_SESSION_WIDGET_HTML,
  USER_SESSION_WIDGET_HTML,
} from '../../src/widgets/user-session-widget';

interface FakeElement {
  innerHTML: string;
  className: string;
  textContent: string;
  href?: string;
  disabled?: boolean;
  listeners: Record<string, Array<(event: unknown) => unknown>>;
  addEventListener(type: string, handler: (event: unknown) => unknown): void;
}

function fakeElement(props: Partial<FakeElement> = {}): FakeElement {
  const listeners: Record<string, Array<(event: unknown) => unknown>> = Object.create(null);
  return {
    innerHTML: '',
    className: '',
    textContent: '',
    listeners,
    addEventListener(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    ...props,
  };
}

interface WidgetHarness {
  exports: Record<string, unknown>;
  elements: Record<string, FakeElement>;
  classes: Set<string>;
  windowListeners: Record<string, Array<(event: unknown) => unknown>>;
  /** The script's own `window`, needed as `event.source` for trusted messages. */
  contextWindow: Record<string, unknown>;
}

interface WidgetHarnessOptions {
  /** Host global to expose as `window.openai`, or omitted for a bare host. */
  openai?: Record<string, unknown>;
  exposed?: string[];
}

const DEFAULT_EXPORTS = ['classifyRefreshResult', 'render', 'applyTheme', 'refreshLeagues'];

/**
 * Execute the widget's shipped browser script against a minimal DOM stub and
 * expose the internals under test. The script is the product artifact, so the
 * tests run the real bytes rather than a TypeScript twin.
 */
function loadWidgetScript(
  html: string = USER_SESSION_WIDGET_HTML,
  options: WidgetHarnessOptions = {},
): WidgetHarness {
  const exposed = options.exposed ?? DEFAULT_EXPORTS;
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Widget script not found');

  const exposedScript = script.replace(
    /\}\)\(\);\s*$/,
    `${exposed.map((name) => `globalThis.__${name} = ${name};`).join('\n')}\n})();`,
  );

  const elements: Record<string, FakeElement> = {
    content: fakeElement(),
    'refresh-status': fakeElement(),
    'refresh-button': fakeElement(),
    'refresh-word': fakeElement(),
    'edit-link': fakeElement(),
    'yahoo-link': fakeElement({ href: 'https://sports.yahoo.com/fantasy/' }),
  };
  const classes = new Set<string>();
  const windowListeners: Record<string, Array<(event: unknown) => unknown>> = Object.create(null);

  const context: Record<string, unknown> = {
    document: {
      addEventListener() {},
      body: { scrollHeight: 0 },
      documentElement: {
        classList: {
          add: (name: string) => classes.add(name),
          remove: (name: string) => classes.delete(name),
          contains: (name: string) => classes.has(name),
        },
      },
      createElement() {
        let text = '';
        return {
          set textContent(value: unknown) { text = String(value); },
          get innerHTML() {
            return text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
          },
        };
      },
      getElementById(id: string) {
        return Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : null;
      },
      querySelector() { return null; },
    },
    URL,
    setTimeout,
  };
  const windowStub: Record<string, unknown> = {
    addEventListener(type: string, handler: (event: unknown) => unknown) {
      (windowListeners[type] = windowListeners[type] || []).push(handler);
    },
    parent: null,
  };
  if (options.openai) windowStub.openai = options.openai;
  windowStub.parent = windowStub;
  context.window = windowStub;

  runInNewContext(exposedScript, context);

  const exports: Record<string, unknown> = {};
  for (const name of exposed) exports[name] = context[`__${name}`];
  return { exports, elements, classes, windowListeners, contextWindow: windowStub };
}

/**
 * Loads the embedded widget script into a sandboxed VM context and exposes
 * render() so the hidden-widget path (FLA-277) can be exercised directly,
 * along with everything a real MCP Apps host would observe: DOM writes,
 * .widget display changes, and postMessage notifications sent to the parent
 * frame.
 */
function loadEmbeddedRender() {
  const script = USER_SESSION_WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Widget script not found');

  const exposedScript = script.replace(
    /\}\)\(\);\s*$/,
    'globalThis.__render = render;\nglobalThis.__sendSizeChanged = sendSizeChanged;\nglobalThis.__queueSizeChanged = queueSizeChanged;\n})();',
  );

  const postedMessages: Array<Record<string, unknown>> = [];
  // getBoundingClientRect reflects style.display like a real element would:
  // a display:none element measures 0x0 (not null) rather than throwing or
  // omitting the rect — this is what actually triggers the FLA-277 refresh
  // bug (a falsy 0 width previously fell through to the WIDGET_WIDTH
  // fallback instead of staying zero).
  const widgetEl = {
    style: {} as Record<string, string>,
    getBoundingClientRect() {
      if (this.style.display === 'none') return { width: 0, height: 0 };
      return { width: 353, height: 240 };
    },
  };
  const contentEl = { innerHTML: '' };

  const context: Record<string, unknown> = {
    document: {
      addEventListener() {},
      getElementById(id: string) {
        if (id === 'content') return contentEl;
        return null;
      },
      querySelector(selector: string) {
        if (selector === '.widget') return widgetEl;
        return null;
      },
      createElement() {
        return { set textContent(v: string) { (this as unknown as { _t: string })._t = v; }, get innerHTML() { return (this as unknown as { _t: string })._t ?? ''; } };
      },
      body: { scrollHeight: 0 },
    },
    URL,
    setTimeout,
  };

  // window.parent must be a distinct object from window itself: postToParent
  // in the real script only posts when `window.parent !== window`, matching
  // how a sandboxed MCP Apps iframe actually sees its host frame.
  const parentWindow = {
    postMessage(message: Record<string, unknown>) {
      postedMessages.push(message);
    },
  };
  context.window = {
    addEventListener() {},
    parent: parentWindow,
  };

  runInNewContext(exposedScript, context);
  return {
    render: context.__render as (data: unknown) => void,
    sendSizeChanged: context.__sendSizeChanged as () => void,
    queueSizeChanged: context.__queueSizeChanged as () => void,
    postedMessages,
    widgetEl,
    contentEl,
  };
}

/** A click event that records whether the handler suppressed the default action. */
function clickEvent() {
  const state = { prevented: false };
  return {
    state,
    event: { preventDefault() { state.prevented = true; } },
  };
}

function loadEmbeddedClassifier(): (payload: unknown) => RefreshResultClassification {
  return loadWidgetScript().exports.classifyRefreshResult as (
    payload: unknown,
  ) => RefreshResultClassification;
}

const SAMPLE_SESSION = {
  allLeagues: [
    {
      platform: 'espn',
      sport: 'football',
      leagueId: 'known',
      leagueName: 'Sunday Night Football League',
      teamName: 'Rochester Rough Riders',
      seasonYear: 2026,
    },
    {
      platform: 'yahoo',
      sport: 'baseball',
      leagueId: 'baseball-1',
      leagueName: 'Rochester Friends and Family Baseball Association',
      teamName: 'The Long Ball Appreciation Society',
      seasonYear: 2026,
    },
    {
      platform: 'sleeper',
      sport: 'basketball',
      leagueId: 'basketball-1',
      leagueName: 'Wednesday Night Basketball',
      teamName: 'Full Court Press',
      seasonYear: 2026,
    },
    {
      platform: 'espn',
      sport: 'hockey',
      leagueId: 'hockey-1',
      leagueName: 'Upstate New York Hockey League',
      teamName: 'Lake Effect',
      seasonYear: 2026,
    },
  ],
  defaultLeagues: {
    football: { platform: 'espn', leagueId: 'known', seasonYear: 2026 },
  },
  defaultSport: 'football',
};

describe('user session widget script', () => {
  it('ships the classifier without module helper dependencies', () => {
    expect(USER_SESSION_WIDGET_HTML).not.toContain('__name');
    expect(USER_SESSION_WIDGET_HTML).not.toContain('classifyRefreshResult.toString');
  });

  it('renders the same script in both bodies', () => {
    const legacyScript = LEGACY_USER_SESSION_WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const currentScript = USER_SESSION_WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(legacyScript).toBeTruthy();
    expect(legacyScript).toBe(currentScript);
  });

  it('renders a sport band per sport with the matching Tabler icon', () => {
    const { exports, elements } = loadWidgetScript();
    (exports.render as (data: unknown) => void)(SAMPLE_SESSION);
    const html = elements.content.innerHTML;

    // Default sport sorts first, then the SPORT_ORDER fallback.
    expect(html.match(/class="sport-header"/g)).toHaveLength(4);
    expect(html.indexOf('Football')).toBeLessThan(html.indexOf('Baseball'));
    expect(html.indexOf('Baseball')).toBeLessThan(html.indexOf('Basketball'));
    expect(html.indexOf('Basketball')).toBeLessThan(html.indexOf('Hockey'));
    // Football, baseball, basketball, hockey ice-skate.
    expect(html).toContain('M16 3c-7.18 0 -13 5.82 -13 13a5 5 0 0 0 5 5c7.18 0 13 -5.82 13 -13a5 5 0 0 0 -5 -5');
    expect(html).toContain('M5.636 18.364a9 9 0 1 0 12.728 -12.728a9 9 0 0 0 -12.728 12.728');
    expect(html).toContain('M5.65 5.65l12.7 12.7');
    expect(html).toContain('M5.905 5h3.418a1 1 0 0 1 .928 .629l1.143 2.856a3 3 0 0 0 2.207 1.83l4.717 .926a2.084 2.084 0 0 1 1.682 2.045v.714a1 1 0 0 1 -1 1h-13.895a1 1 0 0 1 -1 -1.1l.8 -8a1 1 0 0 1 1 -.9');
    expect(html.match(/class="sport-icon"/g)).toHaveLength(4);
  });

  it('marks the default sport and default league with an accessible equivalent', () => {
    const { exports, elements } = loadWidgetScript();
    (exports.render as (data: unknown) => void)(SAMPLE_SESSION);
    const html = elements.content.innerHTML;

    expect(html).toContain('<span class="badge badge-default" aria-hidden="true">DEFAULT</span>');
    expect(html).toContain('<span class="visually-hidden">Default sport</span>');
    expect(html.match(/badge-default/g)).toHaveLength(1);
    // The gold right edge is decorative; the row label carries the meaning.
    expect(html).toContain('class="league-row is-default"');
    expect(html).toContain(
      'aria-label="Sunday Night Football League, ESPN, 2026, Rochester Rough Riders, default football league"'
    );
    expect(html.match(/is-default/g)).toHaveLength(1);
  });

  it('keeps full league and team names reachable behind the truncated row', () => {
    const { exports, elements } = loadWidgetScript();
    (exports.render as (data: unknown) => void)(SAMPLE_SESSION);
    const html = elements.content.innerHTML;

    expect(html).toContain('<span class="badge badge-espn">espn</span>');
    expect(html).toContain('<span class="badge badge-yahoo">yahoo</span>');
    expect(html).toContain('<span class="badge badge-sleeper">sleeper</span>');
    expect(html).toContain(
      '<div class="league-name" title="Wednesday Night Basketball">Wednesday Night Basketball</div>'
    );
    expect(html).toContain('<span class="league-year">2026</span>');
    expect(html).toContain('<span class="league-team" title="Full Court Press">Full Court Press</span>');
  });

  it('renders unknown sports with the fallback icon while escaping sport text', () => {
    const { exports, elements } = loadWidgetScript();
    (exports.render as (data: unknown) => void)({
      allLeagues: [
        {
          platform: 'espn',
          sport: 'football',
          leagueId: 'known',
          leagueName: 'Known league',
          teamName: 'Known team',
          seasonYear: 2026,
        },
        {
          platform: 'espn',
          sport: 'other<img src=x onerror=alert(1)>',
          leagueId: 'unknown',
          leagueName: 'Unknown league',
          teamName: 'Unknown team',
          seasonYear: 2026,
        },
        {
          platform: 'espn',
          sport: '__proto__',
          leagueId: 'prototype-key',
          leagueName: 'Prototype key league',
          teamName: 'Prototype key team',
          seasonYear: 2026,
        },
      ],
      defaultLeagues: {},
      defaultSport: null,
    });
    const html = elements.content.innerHTML;

    expect(html).toContain('M15 9l-6 6');
    // Trophy fallback for both the unknown sport and the prototype key.
    expect(html.match(/M8 21l8 0/g)).toHaveLength(2);
    expect(html).toContain('Football');
    expect(html).toContain('Other&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('__proto__');
    expect(html.match(/class="sport-icon"/g)).toHaveLength(3);
  });

  it('escapes user data used inside attributes', () => {
    const { exports, elements } = loadWidgetScript();
    (exports.render as (data: unknown) => void)({
      allLeagues: [
        {
          platform: 'espn',
          sport: 'football',
          leagueId: 'quoted',
          leagueName: 'League" onmouseover="alert(1)',
          teamName: "Team' onfocus='alert(2)",
          seasonYear: 2026,
        },
      ],
      defaultLeagues: {},
      defaultSport: null,
    });
    const html = elements.content.innerHTML;

    // Quotes are neutralized, so the injected handler text can never close
    // the attribute it sits in. It stays inert text everywhere it appears.
    expect(html).toContain(
      'aria-label="League&quot; onmouseover=&quot;alert(1), ESPN, 2026, Team&#39; onfocus=&#39;alert(2)"'
    );
    expect(html).toContain('title="League&quot; onmouseover=&quot;alert(1)"');
    expect(html).toContain('title="Team&#39; onfocus=&#39;alert(2)"');
  });

  it('applies the dark theme class from the host theme global', () => {
    const { exports, classes, windowListeners } = loadWidgetScript();

    (exports.applyTheme as (value: unknown) => void)('dark');
    expect(classes.has('theme-dark')).toBe(true);
    expect(classes.has('theme-light')).toBe(false);

    (exports.applyTheme as (value: unknown) => void)('light');
    expect(classes.has('theme-light')).toBe(true);
    expect(classes.has('theme-dark')).toBe(false);

    // An unknown theme falls back to the prefers-color-scheme media query.
    (exports.applyTheme as (value: unknown) => void)(undefined);
    expect(classes.size).toBe(0);

  });

  it('keeps applying theme changes after the first render', () => {
    const { exports, elements, classes, windowListeners } = loadWidgetScript();

    // Tool output is ignored once rendered, but theme changes must not be.
    (exports.render as (data: unknown) => void)(SAMPLE_SESSION);
    expect(elements.content.innerHTML).toContain('class="league-row');

    const handlers = windowListeners['openai:set_globals'];
    expect(handlers).toHaveLength(1);
    handlers[0]({ detail: { globals: { theme: 'dark' } } });
    expect(classes.has('theme-dark')).toBe(true);
    expect(classes.has('theme-light')).toBe(false);
    handlers[0]({ detail: { globals: { theme: 'light' } } });
    expect(classes.has('theme-dark')).toBe(false);
    expect(classes.has('theme-light')).toBe(true);
  });

  it('renders a tool result delivered over the MCP Apps message bridge', () => {
    const { elements, windowListeners, contextWindow } = loadWidgetScript();
    const handlers = windowListeners.message;
    expect(handlers).toHaveLength(1);

    handlers[0]({
      // isTrustedMessageEvent requires the parent frame as the source; a
      // sandboxed host may report a "null" origin.
      source: contextWindow,
      origin: 'null',
      data: {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { structuredContent: SAMPLE_SESSION },
      },
    });

    const html = elements.content.innerHTML;
    expect(html.match(/class="league-row/g)).toHaveLength(4);
    expect(html).toContain('Sunday Night Football League');
    expect(html).toContain('Upstate New York Hockey League');
  });

  it('ignores a message that did not come from the parent frame', () => {
    const { elements, windowListeners } = loadWidgetScript();
    windowListeners.message[0]({
      source: { not: 'the parent' },
      origin: 'https://chatgpt.com',
      data: {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { structuredContent: SAMPLE_SESSION },
      },
    });
    expect(elements.content.innerHTML).toBe('');
  });

  describe('refresh flow', () => {
    function stubHost(refreshResult: unknown, options: { reject?: boolean } = {}) {
      const calls: string[] = [];
      const openai = {
        async callTool(name: string) {
          calls.push(name);
          if (name === 'refresh_leagues') {
            if (options.reject) throw new Error('transport failure');
            return refreshResult;
          }
          return SAMPLE_SESSION;
        },
      };
      return { calls, openai };
    }

    async function runRefresh(refreshResult: unknown, options: { reject?: boolean } = {}) {
      const { calls, openai } = stubHost(refreshResult, options);
      const harness = loadWidgetScript(USER_SESSION_WIDGET_HTML, { openai });
      await (harness.exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();
      return { ...harness, calls };
    }

    it('reports success and reloads the session', async () => {
      const { elements, calls } = await runRefresh({
        success: true,
        results: { espn: { platform: 'espn', status: 'success', details: { added: 2 } } },
      });

      expect(calls).toEqual(['refresh_leagues', 'get_user_session']);
      expect(elements['refresh-status'].innerHTML).toBe('Leagues refreshed.');
      expect(elements['refresh-status'].className).toBe('status is-success');
      expect(elements.content.innerHTML).toContain('Sunday Night Football League');
      // The control is released and relabelled whatever the outcome.
      expect(elements['refresh-button'].disabled).toBe(false);
      expect(elements['refresh-word'].textContent).toBe('Refresh');
    });

    it('reports a reconnect partial with a leagues link and still reloads', async () => {
      const { elements, calls } = await runRefresh({
        success: true,
        results: {
          sleeper: { platform: 'sleeper', status: 'success' },
          yahoo: { platform: 'yahoo', status: 'error', httpStatus: 401, error: 'expired' },
        },
      });

      expect(calls).toEqual(['refresh_leagues', 'get_user_session']);
      expect(elements['refresh-status'].className).toBe('status is-error');
      expect(elements['refresh-status'].innerHTML).toBe(
        'Refresh partially complete. Reconnect a provider. <a href="https://flaim.app/leagues?from=widget" target="_blank" rel="noopener">Open leagues</a>.'
      );
      expect(elements.content.innerHTML).toContain('Sunday Night Football League');
    });

    it('reports a rate limit without reloading the session', async () => {
      const { elements, calls } = await runRefresh({
        success: false,
        results: { yahoo: { platform: 'yahoo', status: 'error', httpStatus: 429 } },
      });

      expect(calls).toEqual(['refresh_leagues']);
      expect(elements['refresh-status'].innerHTML).toBe('Refresh limited. Try again later.');
      expect(elements['refresh-status'].className).toBe('status');
      expect(elements.content.innerHTML).toBe('');
    });

    it('surfaces a rejected call as a recoverable failure', async () => {
      const { elements, calls } = await runRefresh(null, { reject: true });

      expect(calls).toEqual(['refresh_leagues']);
      expect(elements['refresh-status'].className).toBe('status is-error');
      expect(elements['refresh-status'].innerHTML).toBe(
        'Refresh failed. <a href="https://flaim.app/leagues?from=widget" target="_blank" rel="noopener">Open leagues</a>.'
      );
      expect(elements.content.innerHTML).toBe('');
      expect(elements['refresh-button'].disabled).toBe(false);
      expect(elements['refresh-word'].textContent).toBe('Refresh');
    });
  });

  describe('Yahoo attribution link', () => {
    it('leaves the native anchor alone when the host cannot open external URLs', () => {
      const { elements } = loadWidgetScript();
      const { state, event } = clickEvent();

      elements['yahoo-link'].listeners.click[0](event);

      // Without window.openai the anchor's own target="_blank" navigation is
      // the only working path, so the default action must survive.
      expect(state.prevented).toBe(false);
    });

    it('leaves the anchor alone when window.openai exists without openExternal', () => {
      const { elements } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        openai: { callTool: async () => null },
      });
      const { state, event } = clickEvent();

      elements['yahoo-link'].listeners.click[0](event);

      expect(state.prevented).toBe(false);
    });

    it('routes through openExternal when the host provides it', () => {
      const opened: unknown[] = [];
      const { elements } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        openai: {
          openExternal(args: unknown) {
            opened.push(args);
            return true;
          },
        },
      });
      const { state, event } = clickEvent();

      elements['yahoo-link'].listeners.click[0](event);

      expect(state.prevented).toBe(true);
      expect(opened).toEqual([{ href: 'https://sports.yahoo.com/fantasy/' }]);
    });
  });

  it('renders the empty state with a flaim.app link', () => {
    const { exports, elements } = loadWidgetScript();
    (exports.render as (data: unknown) => void)({ allLeagues: [] });
    expect(elements.content.innerHTML).toContain('no fantasy leagues are set up yet');
    expect(elements.content.innerHTML).toContain('https://flaim.app/leagues?from=widget');
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

  // FLA-277 Mechanism B: when widget.hidden is true, the widget must render
  // no league rows and report a zero size instead of the 353px fallback.
  describe('hidden widget render (FLA-277)', () => {
    it('renders no league rows and posts a zero-size notification when widget.hidden is true', () => {
      const { render, postedMessages, widgetEl, contentEl } = loadEmbeddedRender();

      render({
        allLeagues: [
          { platform: 'espn', sport: 'football', leagueId: '1', leagueName: 'Gridiron', seasonYear: 2025 },
        ],
        defaultLeagues: {},
        defaultSport: null,
        widget: { hidden: true },
      });

      // No DOM content was ever built for the league list.
      expect(contentEl.innerHTML).toBe('');
      // The root widget element is hidden.
      expect(widgetEl.style.display).toBe('none');
      // A zero-size notification was sent instead of the real dimensions.
      const sizeMessages = postedMessages.filter(
        (message) => message.method === 'ui/notifications/size-changed',
      );
      expect(sizeMessages).toHaveLength(1);
      expect(sizeMessages[0].params).toEqual({ width: 0, height: 0 });
    });

    it('renders leagues normally and reports real dimensions when widget.hidden is absent', async () => {
      const { render, postedMessages, widgetEl, contentEl } = loadEmbeddedRender();

      render({
        allLeagues: [
          { platform: 'espn', sport: 'football', leagueId: '1', leagueName: 'Gridiron', seasonYear: 2025 },
        ],
        defaultLeagues: {},
        defaultSport: null,
      });

      expect(contentEl.innerHTML).not.toBe('');
      expect(widgetEl.style.display).not.toBe('none');
      // The normal (non-hidden) path reports size via queueSizeChanged(),
      // which defers through setTimeout when requestAnimationFrame is
      // unavailable — unlike the hidden path's synchronous sendZeroSize().
      await new Promise((resolve) => setTimeout(resolve, 0));
      const sizeMessages = postedMessages.filter(
        (message) => message.method === 'ui/notifications/size-changed',
      );
      expect(sizeMessages).toHaveLength(1);
      expect(sizeMessages[0].params).not.toEqual({ width: 0, height: 0 });
    });

    it('renders no league rows when widget.hidden is true even when allLeagues is empty', () => {
      const { render, postedMessages, contentEl } = loadEmbeddedRender();

      render({ allLeagues: [], widget: { hidden: true } });

      // The empty-state branch (which does build DOM) must not run either.
      expect(contentEl.innerHTML).toBe('');
      const sizeMessages = postedMessages.filter(
        (message) => message.method === 'ui/notifications/size-changed',
      );
      expect(sizeMessages).toHaveLength(1);
      expect(sizeMessages[0].params).toEqual({ width: 0, height: 0 });
    });

    // Regression: refreshLeagues() calls render(data) and then
    // setRefreshStatus() -> queueSizeChanged() -> sendSizeChanged() runs
    // regardless of outcome. Before the widgetHidden guard, .widget's own
    // (display:none) getBoundingClientRect() reported a falsy 0 width, which
    // the original fallback treated as "no rect" and re-posted the 353px
    // default — silently un-collapsing a hidden widget on every refresh.
    it('does not re-expand a hidden widget when the refresh flow reports size afterward', async () => {
      const { render, queueSizeChanged, postedMessages, widgetEl } = loadEmbeddedRender();

      render({
        allLeagues: [
          { platform: 'espn', sport: 'football', leagueId: '1', leagueName: 'Gridiron', seasonYear: 2025 },
        ],
        widget: { hidden: true },
      });
      expect(widgetEl.style.display).toBe('none');

      // Simulate the refresh flow's later, independent size-report call
      // (setRefreshStatus -> queueSizeChanged -> sendSizeChanged).
      queueSizeChanged();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const sizeMessages = postedMessages.filter(
        (message) => message.method === 'ui/notifications/size-changed',
      );
      // One from render()'s own sendZeroSize(), one from the simulated
      // refresh follow-up — both must report zero, never the 353px fallback.
      expect(sizeMessages).toHaveLength(2);
      for (const message of sizeMessages) {
        expect(message.params).toEqual({ width: 0, height: 0 });
      }
    });

    it('clears the hidden guard and reports real size again once a refresh un-hides the widget', async () => {
      const { render, postedMessages, widgetEl, contentEl } = loadEmbeddedRender();

      render({ allLeagues: [], widget: { hidden: true } });
      expect(widgetEl.style.display).toBe('none');
      postedMessages.length = 0;

      // A later refresh returns session data with the preference off (or
      // simply without the widget key). render() itself queues the
      // follow-up size report in this branch — no separate call needed.
      render({
        allLeagues: [
          { platform: 'espn', sport: 'football', leagueId: '1', leagueName: 'Gridiron', seasonYear: 2025 },
        ],
      });
      expect(widgetEl.style.display).not.toBe('none');
      expect(contentEl.innerHTML).not.toBe('');

      await new Promise((resolve) => setTimeout(resolve, 0));

      const sizeMessages = postedMessages.filter(
        (message) => message.method === 'ui/notifications/size-changed',
      );
      expect(sizeMessages).toHaveLength(1);
      expect(sizeMessages[0].params).not.toEqual({ width: 0, height: 0 });
    });
  });
});
