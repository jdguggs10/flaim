import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyRefreshResult,
  type RefreshResultClassification,
  LEGACY_USER_SESSION_WIDGET_HTML,
  USER_SESSION_WIDGET_HTML,
  V3_USER_SESSION_WIDGET_HTML,
} from '../../src/widgets/user-session-widget';

interface FakeElement {
  innerHTML: string;
  className: string;
  textContent: string;
  href?: string;
  /** The anchor's `target` attribute (e.g. `_blank`), matching the real widget HTML. */
  target?: string;
  disabled?: boolean;
  listeners: Record<string, Array<(event: unknown) => unknown>>;
  addEventListener(type: string, handler: (event: unknown) => unknown): void;
}

/** A `.widget`-selector stand-in with a real `style` object, so tests can
 * observe the hide/show display toggle render() applies, and so
 * sendSizeChanged()'s getBoundingClientRect() branch has something to read
 * instead of always falling back to the WIDGET_WIDTH default. Mirrors
 * loadEmbeddedRender's widgetEl below. */
function fakeWidgetEl() {
  return {
    style: {} as Record<string, string>,
    getBoundingClientRect() {
      if (this.style.display === 'none') return { width: 0, height: 0 };
      return { width: 353, height: 240 };
    },
  };
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
  /** The `.widget` element render() shows/hides. See fakeWidgetEl() above. */
  widgetEl: ReturnType<typeof fakeWidgetEl>;
  /**
   * `window.parent` as the script sees it: a distinct scripted-host object
   * when `bridge` is set, otherwise the script's own window (self-referencing,
   * so postToParent no-ops, matching a top-level/non-iframe host). Use this as
   * `event.source` for any reply delivered by hand.
   */
  parent: Record<string, unknown>;
  /**
   * Every message the script posted to `window.parent`, in order. Only
   * populated when `bridge` is set — postToParent no-ops otherwise.
   */
  postedMessages: Array<Record<string, unknown>>;
  /** URLs passed to window.open (the last-resort link fallback), in order. */
  openedTabs: string[];
  /** `document.documentElement.style`, so a test can assert the fluid-sizing
   * width the widget sets (FLA-427). */
  documentElementStyle: Record<string, string>;
  /** `document.body.style`, so a test can assert the safe-area-inset padding
   * the widget sets (FLA-427). */
  bodyStyle: Record<string, string>;
  /**
   * Set only when `resizeObserver: true` was passed. Invoking it simulates
   * the stubbed ResizeObserver firing on `.widget`, exactly as the widget's
   * `new ResizeObserver(queueSizeChanged).observe(...)` wiring would.
   */
  triggerResize?: () => void;
  /** The element the stubbed ResizeObserver observed, or undefined if it
   * never called `.observe()` (e.g. it found no `.widget` element). */
  resizeObserverTarget?: unknown;
}

interface BridgeRequestMessage {
  id: string;
  method: string;
  params: unknown;
}

/** `hostContext.containerDimensions` / `.safeAreaInsets`, per the MCP Apps
 * sizing contract (FLA-427). Only the fields the widget reads are typed. */
interface FakeContainerDimensions {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
}
interface FakeSafeAreaInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface BridgeHostOptions {
  /**
   * Reply to the widget's ui/initialize handshake, delivered synchronously
   * (a real host still resolves the widget's pending promise on the next
   * microtask). Defaults to a host that supports both bridge capabilities.
   * Pass null to simulate a host that never answers (bridgeReady stays
   * false, matching the "no init reply" fallback case).
   */
  initResult?: {
    hostCapabilities?: Record<string, boolean>;
    hostContext?: {
      theme?: string;
      containerDimensions?: FakeContainerDimensions;
      safeAreaInsets?: FakeSafeAreaInsets;
    };
  } | null;
  /**
   * Called for every non-init request the widget posts (tools/call,
   * ui/open-link). Return the JSON-RPC reply to deliver, or omit/return
   * undefined to simulate a host that never answers that request (drive the
   * widget's own timeout with vi.useFakeTimers() + advanceTimersByTimeAsync).
   */
  respond?: (message: BridgeRequestMessage) => { result?: unknown; error?: unknown } | undefined;
}

interface WidgetHarnessOptions {
  /** Host global to expose as `window.openai`, or omitted for a bare host. */
  openai?: Record<string, unknown>;
  exposed?: string[];
  /**
   * Simulates an MCP Apps host: gives `window.parent` a distinct object so
   * postToParent actually posts, records every posted message, and answers
   * the handshake and bridge requests by calling the widget's own message
   * listener, exactly like a real host posting back into the iframe.
   */
  bridge?: BridgeHostOptions;
  /**
   * Expose a stubbed global ResizeObserver so a test can trigger the
   * widget's resize callback directly and assert it re-reports size.
   * Omitted entirely (not just false), so the default harness matches a
   * host environment with no ResizeObserver global at all -- exercising the
   * widget's `typeof ResizeObserver === 'function'` guard.
   */
  resizeObserver?: boolean;
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

  // href/target match the real widget HTML's anchor attributes exactly (see
  // buildUserSessionWidgetHtml), so a trace that reads them off these
  // elements reflects what a real click's native-navigation fallback would
  // actually use, not a disconnected test-only stand-in.
  const elements: Record<string, FakeElement> = {
    content: fakeElement(),
    'refresh-status': fakeElement(),
    'refresh-button': fakeElement(),
    'refresh-word': fakeElement(),
    'edit-link': fakeElement({ href: 'https://flaim.app/leagues?from=widget', target: '_blank' }),
    'yahoo-link': fakeElement({ href: 'https://sports.yahoo.com/fantasy/', target: '_blank' }),
    'espn-link': fakeElement({ href: 'https://www.espn.com/fantasy/', target: '_blank' }),
    'sleeper-link': fakeElement({ href: 'https://sleeper.com/', target: '_blank' }),
  };
  const classes = new Set<string>();
  const windowListeners: Record<string, Array<(event: unknown) => unknown>> = Object.create(null);
  const postedMessages: Array<Record<string, unknown>> = [];
  const openedTabs: string[] = [];
  const widgetEl = fakeWidgetEl();
  // Real style objects (FLA-427), so applyContainerDimensions() and
  // applySafeAreaInsets() have somewhere real to write, and tests can read
  // the resulting inline styles back.
  const documentElementStyle: Record<string, string> = {};
  const bodyStyle: Record<string, string> = {};

  const context: Record<string, unknown> = {
    document: {
      addEventListener() {},
      body: { scrollHeight: 0, style: bodyStyle },
      documentElement: {
        style: documentElementStyle,
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
      querySelector(selector: string) { return selector === '.widget' ? widgetEl : null; },
    },
    URL,
    setTimeout,
    clearTimeout,
  };
  const windowStub: Record<string, unknown> = {
    addEventListener(type: string, handler: (event: unknown) => unknown) {
      (windowListeners[type] = windowListeners[type] || []).push(handler);
    },
    open(url: string) { openedTabs.push(String(url)); },
    parent: null,
  };
  if (options.openai) windowStub.openai = options.openai;

  // Defaults to the script's own window (self-referencing), which makes
  // postToParent a no-op — the pre-existing behavior for every test that
  // does not opt into a scripted bridge host.
  let parent: Record<string, unknown> = windowStub;
  if (options.bridge) {
    const bridge = options.bridge;
    const deliver = (data: Record<string, unknown>) => {
      for (const handler of windowListeners.message || []) {
        handler({ source: parent, origin: 'null', data });
      }
    };
    parent = {
      postMessage(message: Record<string, unknown>) {
        postedMessages.push(message);
        if (message.method === 'ui/initialize') {
          if (bridge.initResult === null) return; // Host never answers.
          deliver({
            jsonrpc: '2.0',
            id: message.id,
            result: bridge.initResult ?? { hostCapabilities: { serverTools: true, openLinks: true } },
          });
          return;
        }
        if (message.id === undefined || message.id === null) return;
        const reply = bridge.respond
          ? bridge.respond({ id: message.id as string, method: message.method as string, params: message.params })
          : undefined;
        if (reply) deliver({ jsonrpc: '2.0', id: message.id, ...reply });
      },
    };
  }
  windowStub.parent = parent;
  context.window = windowStub;

  // Fluid sizing (FLA-427): a stubbed global, opt-in per test. Left off the
  // context entirely by default, so `typeof ResizeObserver` reads
  // 'undefined' in the script -- the same guard a host with no
  // ResizeObserver support would trip.
  let triggerResize: (() => void) | undefined;
  let resizeObserverTarget: unknown;
  if (options.resizeObserver) {
    context.ResizeObserver = class {
      constructor(callback: () => void) {
        triggerResize = callback;
      }
      observe(target: unknown) {
        resizeObserverTarget = target;
      }
      disconnect() {}
    };
  }

  runInNewContext(exposedScript, context);

  const exports: Record<string, unknown> = {};
  for (const name of exposed) exports[name] = context[`__${name}`];
  return {
    exports,
    elements,
    classes,
    windowListeners,
    contextWindow: windowStub,
    widgetEl,
    parent,
    postedMessages,
    openedTabs,
    documentElementStyle,
    bodyStyle,
    ...(options.resizeObserver ? { triggerResize, resizeObserverTarget } : {}),
  };
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
    'globalThis.__render = render;\nglobalThis.__queueSizeChanged = queueSizeChanged;\n})();',
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
    clearTimeout,
  };

  // window.parent must be a distinct object from window itself: postToParent
  // in the real script only posts when `window.parent !== window`, matching
  // how a sandboxed MCP Apps iframe actually sees its host frame.
  const parentWindow = {
    postMessage(message: Record<string, unknown>) {
      postedMessages.push(message);
    },
  };
  // Record window listeners so tests can play the host's side of the
  // ui/initialize handshake against the real message handler.
  const windowListeners: Record<string, Array<(event: unknown) => unknown>> = Object.create(null);
  context.window = {
    addEventListener(type: string, handler: (event: unknown) => unknown) {
      (windowListeners[type] = windowListeners[type] || []).push(handler);
    },
    parent: parentWindow,
  };

  runInNewContext(exposedScript, context);
  return {
    render: context.__render as (data: unknown) => void,
    queueSizeChanged: context.__queueSizeChanged as () => void,
    postedMessages,
    widgetEl,
    contentEl,
    windowListeners,
    parentWindow,
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

  it('renders the same script in every body apart from the extra credit-link handlers', () => {
    const scriptOf = (html: string) => html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const legacyScript = scriptOf(LEGACY_USER_SESSION_WIDGET_HTML);
    const v3Script = scriptOf(V3_USER_SESSION_WIDGET_HTML);
    const currentScript = scriptOf(USER_SESSION_WIDGET_HTML);
    expect(legacyScript).toBeTruthy();
    // The bodies with no extra provider links share one script byte for byte.
    expect(legacyScript).toBe(v3Script);
    // The current body adds one click handler per newly linkable provider and
    // changes nothing else.
    expect(currentScript).toBeTruthy();
    expect(currentScript).not.toBe(legacyScript);
    expect(currentScript).toContain("var espnLink = document.getElementById('espn-link');");
    expect(currentScript).toContain("var sleeperLink = document.getElementById('sleeper-link');");
    // Each added handler is one self-contained `var x = ...; if (x) { ... }`
    // block; strip both and the remainder must be the shared script verbatim.
    const addedHandlers =
      /\n {2}\/\/ Present only on bodies whose published widget CSP allows the (?:ESPN|Sleeper)\n[\s\S]*?\n {2}\}/g;
    expect((currentScript || '').replace(addedHandlers, '')).toBe(legacyScript);
  });

  // Fluid sizing (FLA-427): the card fills its host up to a 480px cap,
  // honors a reported containerDimensions.maxWidth, and folds safe-area
  // insets into both the applied padding and the reported size.
  describe('fluid sizing (FLA-427)', () => {
    it('drops the old 353px cap from every body and caps .widget at 480px', () => {
      for (const html of [LEGACY_USER_SESSION_WIDGET_HTML, V3_USER_SESSION_WIDGET_HTML, USER_SESSION_WIDGET_HTML]) {
        expect(html).not.toContain('353px');
        expect(html).toContain('max-width: 480px');
      }
    });

    it('reports WIDGET_MAX_WIDTH (480) when there is no rect to measure', async () => {
      const harness = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        bridge: { initResult: { hostCapabilities: {} } },
      });
      // The harness's .widget stub always has a real getBoundingClientRect
      // (see fakeWidgetEl); strip it to hit sendSizeChanged's "no rect"
      // fallback the same way a host with no .widget element yet would.
      // @ts-expect-error -- deliberately removed to force the fallback branch.
      delete harness.widgetEl.getBoundingClientRect;

      (harness.exports.render as (data: unknown) => void)(SAMPLE_SESSION);
      // render()'s queueSizeChanged() defers through setTimeout (no
      // requestAnimationFrame in this harness).
      await new Promise((resolve) => setTimeout(resolve, 0));

      const sizeMessages = harness.postedMessages.filter(
        (message) => message.method === 'ui/notifications/size-changed',
      );
      expect(sizeMessages).toContainEqual(expect.objectContaining({ params: { width: 480, height: 0 } }));
    });

    describe('containerDimensions (hostContext.containerDimensions)', () => {
      it.each([
        { maxWidth: 400, expectedWidth: '400px' },
        { maxWidth: 900, expectedWidth: '480px' },
      ])('sets html width to $expectedWidth from an init reply maxWidth of $maxWidth', ({ maxWidth, expectedWidth }) => {
        const { documentElementStyle } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
          bridge: { initResult: { hostCapabilities: {}, hostContext: { containerDimensions: { maxWidth } } } },
        });
        expect(documentElementStyle.width).toBe(expectedWidth);
      });

      it('leaves html width unset when the host reports a fixed width instead of maxWidth', () => {
        const { documentElementStyle } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
          bridge: { initResult: { hostCapabilities: {}, hostContext: { containerDimensions: { width: 400 } } } },
        });
        expect(documentElementStyle.width).toBeUndefined();
      });

      it('updates html width from a later host-context-changed notification', () => {
        const { documentElementStyle, windowListeners, parent } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
          bridge: {},
        });
        expect(documentElementStyle.width).toBeUndefined();

        windowListeners.message[0]({
          source: parent,
          origin: 'null',
          data: {
            jsonrpc: '2.0',
            method: 'ui/notifications/host-context-changed',
            params: { containerDimensions: { maxWidth: 400 } },
          },
        });
        expect(documentElementStyle.width).toBe('400px');
      });

      it('applies containerDimensions the same way whether or not window.openai exists', () => {
        const { documentElementStyle } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
          openai: { theme: 'light' },
          bridge: { initResult: { hostCapabilities: {}, hostContext: { containerDimensions: { maxWidth: 400 } } } },
        });
        expect(documentElementStyle.width).toBe('400px');
      });
    });

    describe('safe-area insets (hostContext.safeAreaInsets)', () => {
      it('applies insets as body padding and folds them into the reported size, from the init reply', async () => {
        const { bodyStyle, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
          bridge: {
            initResult: {
              hostCapabilities: {},
              hostContext: { safeAreaInsets: { top: 10, right: 5, bottom: 20, left: 5 } },
            },
          },
        });
        expect(bodyStyle.paddingTop).toBe('10px');
        expect(bodyStyle.paddingRight).toBe('5px');
        expect(bodyStyle.paddingBottom).toBe('20px');
        expect(bodyStyle.paddingLeft).toBe('5px');

        await new Promise((resolve) => setTimeout(resolve, 0));
        const sizeMessages = postedMessages.filter((message) => message.method === 'ui/notifications/size-changed');
        // The stubbed rect is 353x240 (see fakeWidgetEl); insets add
        // left+right to width and top+bottom to height.
        expect(sizeMessages).toContainEqual(
          expect.objectContaining({ params: { width: 363, height: 270 } }),
        );
      });

      it('updates the applied padding from a later host-context-changed notification', () => {
        const { bodyStyle, windowListeners, parent } = loadWidgetScript(USER_SESSION_WIDGET_HTML, { bridge: {} });
        expect(bodyStyle.paddingTop).toBeUndefined();

        windowListeners.message[0]({
          source: parent,
          origin: 'null',
          data: {
            jsonrpc: '2.0',
            method: 'ui/notifications/host-context-changed',
            params: { safeAreaInsets: { top: 12, right: 0, bottom: 0, left: 0 } },
          },
        });
        expect(bodyStyle.paddingTop).toBe('12px');
      });

      it('defaults to zero, so a host that never reports insets leaves the reported size unchanged', async () => {
        const { exports, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, { bridge: {} });
        (exports.render as (data: unknown) => void)(SAMPLE_SESSION);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const sizeMessages = postedMessages.filter((message) => message.method === 'ui/notifications/size-changed');
        expect(sizeMessages).toContainEqual(
          expect.objectContaining({ params: { width: 353, height: 240 } }),
        );
      });
    });

    describe('ResizeObserver', () => {
      it('observes .widget and re-reports size when the stubbed observer fires', async () => {
        const { triggerResize, resizeObserverTarget, widgetEl, postedMessages } = loadWidgetScript(
          USER_SESSION_WIDGET_HTML,
          { bridge: {}, resizeObserver: true },
        );
        expect(resizeObserverTarget).toBe(widgetEl);
        postedMessages.length = 0;

        expect(triggerResize).toBeTypeOf('function');
        triggerResize!();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const sizeMessages = postedMessages.filter((message) => message.method === 'ui/notifications/size-changed');
        expect(sizeMessages).toHaveLength(1);
        expect(sizeMessages[0].params).toEqual({ width: 353, height: 240 });
      });

      it('reports zero when the observer fires while the widget is hidden', async () => {
        const { exports, triggerResize, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
          bridge: {},
          resizeObserver: true,
        });
        (exports.render as (data: unknown) => void)({ allLeagues: [], widget: { hidden: true } });
        postedMessages.length = 0;

        triggerResize!();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const sizeMessages = postedMessages.filter((message) => message.method === 'ui/notifications/size-changed');
        expect(sizeMessages).toHaveLength(1);
        expect(sizeMessages[0].params).toEqual({ width: 0, height: 0 });
      });

      it('does not throw when ResizeObserver is absent from the host environment', () => {
        expect(() => loadWidgetScript(USER_SESSION_WIDGET_HTML, { bridge: {} })).not.toThrow();
      });
    });
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

  // Claude parity (FLA-426): when window.openai is absent, refresh and links
  // route through the MCP Apps bridge instead, gated by hostCapabilityReady().
  // These tests use loadWidgetScript's `bridge` option, a scripted host that
  // answers ui/initialize and any subsequent tools/call / ui/open-link.
  describe('MCP Apps bridge (Claude parity, FLA-426)', () => {
    function toolCallName(message: Record<string, unknown>): unknown {
      return (message.params as { name?: unknown } | undefined)?.name;
    }

    it('refreshes leagues through the bridge, posting two tools/call requests with distinct ids', async () => {
      const { exports, elements, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        bridge: {
          respond(message) {
            if (toolCallName(message) === 'refresh_leagues') {
              return {
                result: {
                  structuredContent: {
                    success: true,
                    results: { espn: { platform: 'espn', status: 'success', details: { added: 2 } } },
                  },
                },
              };
            }
            if (toolCallName(message) === 'get_user_session') {
              return { result: { structuredContent: SAMPLE_SESSION } };
            }
            return undefined;
          },
        },
      });

      await (exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();

      const toolCalls = postedMessages.filter((message) => message.method === 'tools/call');
      expect(toolCalls.map(toolCallName)).toEqual(['refresh_leagues', 'get_user_session']);
      expect(new Set(toolCalls.map((message) => message.id)).size).toBe(2);
      expect(elements['refresh-status'].innerHTML).toBe('Leagues refreshed.');
      expect(elements['refresh-status'].className).toBe('status is-success');
      expect(elements.content.innerHTML).toContain('Sunday Night Football League');
      expect(elements['refresh-button'].disabled).toBe(false);
    });

    it('shows a recoverable failure when the bridge replies with a JSON-RPC error', async () => {
      const { exports, elements, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        bridge: {
          respond() {
            return { error: { code: -32000, message: 'boom' } };
          },
        },
      });

      await (exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();

      // The rejection stops the flow before get_user_session is ever called.
      expect(postedMessages.filter((message) => message.method === 'tools/call')).toHaveLength(1);
      expect(elements['refresh-status'].className).toBe('status is-error');
      expect(elements['refresh-status'].innerHTML).toBe(
        'Refresh failed. <a href="https://flaim.app/leagues?from=widget" target="_blank" rel="noopener">Open leagues</a>.'
      );
      expect(elements['refresh-button'].disabled).toBe(false);
    });

    it('shows a recoverable failure when the tool result itself reports isError (e.g. INSUFFICIENT_SCOPE)', async () => {
      const { exports, elements } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        bridge: {
          respond(message) {
            if (toolCallName(message) !== 'refresh_leagues') return undefined;
            return { result: { isError: true, content: [{ type: 'text', text: 'INSUFFICIENT_SCOPE' }] } };
          },
        },
      });

      await (exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();

      expect(elements['refresh-status'].className).toBe('status is-error');
      expect(elements['refresh-status'].innerHTML).toBe(
        'Refresh failed. <a href="https://flaim.app/leagues?from=widget" target="_blank" rel="noopener">Open leagues</a>.'
      );
    });

    it('times out a bridge call that never replies, re-enables the button, and ignores a later late reply', async () => {
      vi.useFakeTimers();
      try {
        let sentId: unknown;
        const { exports, elements, windowListeners, parent } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
          bridge: {
            respond(message) {
              sentId = message.id;
              return undefined; // The host never answers this one.
            },
          },
        });

        const refreshPromise = (exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();
        await vi.advanceTimersByTimeAsync(120000);
        await refreshPromise;

        expect(elements['refresh-status'].className).toBe('status is-error');
        expect(elements['refresh-status'].innerHTML).toBe(
          'Refresh failed. <a href="https://flaim.app/leagues?from=widget" target="_blank" rel="noopener">Open leagues</a>.'
        );
        expect(elements['refresh-button'].disabled).toBe(false);

        // A reply that arrives after the timeout already dropped the pending
        // entry must be a silent no-op, not a crash or a status change.
        windowListeners.message[0]({
          source: parent,
          origin: 'null',
          data: { jsonrpc: '2.0', id: sentId, result: { structuredContent: SAMPLE_SESSION } },
        });
        expect(elements['refresh-status'].className).toBe('status is-error');
        expect(elements.content.innerHTML).toBe('');
      } finally {
        vi.useRealTimers();
      }
    });

    it('falls back to "Open Flaim to manage leagues" when the host init reply omits serverTools', async () => {
      const { exports, elements, openedTabs } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        // No openLinks either, so the LEAGUES_URL fallback also can't route
        // through the bridge — this isolates the serverTools-only guard.
        bridge: { initResult: { hostCapabilities: {} } },
      });

      await (exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();

      expect(elements['refresh-status'].innerHTML).toBe('Open Flaim to manage leagues.');
      expect(openedTabs).toEqual(['https://flaim.app/leagues?from=widget']);
    });

    it('falls back to "Open Flaim to manage leagues" when the host never answers ui/initialize', async () => {
      const { exports, elements, openedTabs } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        bridge: { initResult: null },
      });

      await (exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();

      expect(elements['refresh-status'].innerHTML).toBe('Open Flaim to manage leagues.');
      expect(openedTabs).toEqual(['https://flaim.app/leagues?from=widget']);
    });

    it('reports a zero size when a bridge refresh reloads a hidden widget', async () => {
      const { exports, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        bridge: {
          respond(message) {
            if (toolCallName(message) === 'refresh_leagues') {
              return {
                result: {
                  structuredContent: {
                    success: true,
                    results: { espn: { platform: 'espn', status: 'success', details: { added: 1 } } },
                  },
                },
              };
            }
            if (toolCallName(message) === 'get_user_session') {
              return { result: { structuredContent: { allLeagues: [], widget: { hidden: true } } } };
            }
            return undefined;
          },
        },
      });

      await (exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();

      const sizeMessages = postedMessages.filter((message) => message.method === 'ui/notifications/size-changed');
      expect(sizeMessages).toContainEqual(expect.objectContaining({ params: { width: 0, height: 0 } }));
    });

    it('applies the theme from the ui/initialize reply, then a later host-context-changed update', () => {
      const { classes, windowListeners, parent } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        bridge: { initResult: { hostCapabilities: {}, hostContext: { theme: 'dark' } } },
      });

      expect(classes.has('theme-dark')).toBe(true);
      expect(classes.has('theme-light')).toBe(false);

      // A partial host-context-changed update with no theme field is a no-op.
      windowListeners.message[0]({
        source: parent,
        origin: 'null',
        data: { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: {} },
      });
      expect(classes.has('theme-dark')).toBe(true);

      windowListeners.message[0]({
        source: parent,
        origin: 'null',
        data: { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light' } },
      });
      expect(classes.has('theme-light')).toBe(true);
      expect(classes.has('theme-dark')).toBe(false);
    });

    it('stays fully on the ChatGPT path when window.openai exists, even with a bridge host present', async () => {
      const calls: string[] = [];
      const openai = {
        theme: 'light',
        async callTool(name: string) {
          calls.push(name);
          if (name === 'refresh_leagues') {
            return {
              success: true,
              results: { espn: { platform: 'espn', status: 'success', details: { added: 1 } } },
            };
          }
          return SAMPLE_SESSION;
        },
      };
      const { exports, elements, postedMessages, classes, openedTabs } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
        openai,
        bridge: {
          initResult: { hostCapabilities: { serverTools: true, openLinks: true }, hostContext: { theme: 'dark' } },
        },
      });

      // The bridge host answered with a dark hostContext, but window.openai
      // exists, so window.openai.theme wins per the FLA-426 design decision.
      expect(classes.has('theme-dark')).toBe(false);
      expect(classes.has('theme-light')).toBe(true);

      await (exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();
      // Let the queued size-change notification(s) from render()/setRefreshStatus() flush.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls).toEqual(['refresh_leagues', 'get_user_session']);
      expect(elements['refresh-status'].innerHTML).toBe('Leagues refreshed.');

      // This openai stub has no openExternal or openUrl, and the bridge host
      // advertises openLinks, but window.openai's presence rules the bridge
      // out entirely for links exactly as it does for tool calls: the edit
      // link falls back to the native window.open, never ui/open-link.
      const { state: editState, event: editEvent } = clickEvent();
      elements['edit-link'].listeners.click[0](editEvent);
      expect(editState.prevented).toBe(true);
      expect(openedTabs).toEqual(['https://flaim.app/leagues?from=widget']);

      // The credit link's handler only intercepts via window.openai.openExternal
      // or the bridge; with neither available here, it leaves the native
      // anchor alone.
      const { state: creditState, event: creditEvent } = clickEvent();
      elements['yahoo-link'].listeners.click[0](creditEvent);
      expect(creditState.prevented).toBe(false);

      // Only the handshake and the widget's own size notifications were ever
      // posted: no tools/call for the refresh, no ui/open-link for either
      // link click above.
      expect(new Set(postedMessages.map((message) => message.method))).toEqual(
        new Set(['ui/initialize', 'ui/notifications/initialized', 'ui/notifications/size-changed'])
      );
    });

    describe('links', () => {
      it('routes the edit link through the bridge when openLinks is available', () => {
        const { elements, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, { bridge: {} });
        const { state, event } = clickEvent();

        elements['edit-link'].listeners.click[0](event);

        expect(state.prevented).toBe(true);
        const openLinkMessage = postedMessages.find((message) => message.method === 'ui/open-link');
        expect(openLinkMessage?.params).toEqual({ url: 'https://flaim.app/leagues?from=widget' });
      });

      it('routes a provider credit link through the bridge when openLinks is available', () => {
        const { elements, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, { bridge: {} });
        const { state, event } = clickEvent();

        elements['yahoo-link'].listeners.click[0](event);

        expect(state.prevented).toBe(true);
        const openLinkMessage = postedMessages.find((message) => message.method === 'ui/open-link');
        expect(openLinkMessage?.params).toEqual({ url: 'https://sports.yahoo.com/fantasy/' });
      });

      it('routes the "Open leagues" status link through the bridge when openLinks is available', async () => {
        const { elements, exports, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
          bridge: {
            respond() {
              return { error: { code: -32000, message: 'boom' } };
            },
          },
        });
        // Trigger a failure so #refresh-status carries the "Open leagues" link.
        await (exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();
        expect(elements['refresh-status'].innerHTML).toContain('Open leagues');

        const { state, event } = clickEvent();
        (event as { target?: unknown }).target = { tagName: 'A' };
        elements['refresh-status'].listeners.click[0](event);

        expect(state.prevented).toBe(true);
        const openLinkMessages = postedMessages.filter((message) => message.method === 'ui/open-link');
        expect(openLinkMessages).toHaveLength(1);
        expect(openLinkMessages[0].params).toEqual({ url: 'https://flaim.app/leagues?from=widget' });
      });

      it('ignores a click on #refresh-status that did not land on the anchor', () => {
        const { elements, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, { bridge: {} });
        const { event } = clickEvent();
        (event as { target?: unknown }).target = { tagName: 'DIV' };

        elements['refresh-status'].listeners.click[0](event);

        expect(postedMessages.filter((message) => message.method === 'ui/open-link')).toHaveLength(0);
      });

      it('falls back to window.open when the bridge open-link call reports isError', async () => {
        const { elements, openedTabs } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
          bridge: {
            respond() {
              return { result: { isError: true } };
            },
          },
        });
        const { event } = clickEvent();

        elements['yahoo-link'].listeners.click[0](event);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(openedTabs).toEqual(['https://sports.yahoo.com/fantasy/']);
      });

      it('falls back to window.open when the bridge open-link call times out', async () => {
        vi.useFakeTimers();
        try {
          const { elements, openedTabs } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
            bridge: { respond: () => undefined },
          });
          const { event } = clickEvent();

          elements['yahoo-link'].listeners.click[0](event);
          await vi.advanceTimersByTimeAsync(15000);

          expect(openedTabs).toEqual(['https://sports.yahoo.com/fantasy/']);
        } finally {
          vi.useRealTimers();
        }
      });

      it('leaves the native anchor alone without the openLinks capability, even with a bridge host present', () => {
        const { elements, postedMessages } = loadWidgetScript(USER_SESSION_WIDGET_HTML, {
          bridge: { initResult: { hostCapabilities: { serverTools: true } } },
        });
        const { state, event } = clickEvent();

        elements['yahoo-link'].listeners.click[0](event);

        expect(state.prevented).toBe(false);
        expect(postedMessages.filter((message) => message.method === 'ui/open-link')).toHaveLength(0);
      });
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
    // A host may ignore size messages that arrive before it answers
    // ui/initialize, and a hidden result can render before that answer.
    it('repeats the zero size once the host answers ui/initialize', () => {
      const { render, postedMessages, windowListeners, parentWindow } = loadEmbeddedRender();
      render({ allLeagues: [], widget: { hidden: true } });

      const init = postedMessages.find((message) => message.method === 'ui/initialize');
      expect(init).toBeDefined();
      windowListeners.message[0]({
        source: parentWindow,
        origin: 'null',
        data: { jsonrpc: '2.0', id: init!.id, result: {} },
      });

      const initializedAt = postedMessages.findIndex(
        (message) => message.method === 'ui/notifications/initialized',
      );
      expect(initializedAt).toBeGreaterThan(-1);
      const sizesAfterInit = postedMessages
        .slice(initializedAt + 1)
        .filter((message) => message.method === 'ui/notifications/size-changed');
      expect(sizesAfterInit).toHaveLength(1);
      expect(sizesAfterInit[0].params).toEqual({ width: 0, height: 0 });
    });

    it('posts no extra size on the ui/initialize answer when the widget is visible', () => {
      const { render, postedMessages, windowListeners, parentWindow } = loadEmbeddedRender();
      render({ allLeagues: [], defaultLeagues: {}, defaultSport: null });

      const init = postedMessages.find((message) => message.method === 'ui/initialize');
      windowListeners.message[0]({
        source: parentWindow,
        origin: 'null',
        data: { jsonrpc: '2.0', id: init!.id, result: {} },
      });

      const initializedAt = postedMessages.findIndex(
        (message) => message.method === 'ui/notifications/initialized',
      );
      expect(initializedAt).toBeGreaterThan(-1);
      expect(
        postedMessages
          .slice(initializedAt + 1)
          .filter((message) => message.method === 'ui/notifications/size-changed'),
      ).toHaveLength(0);
    });

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

  // Golden differential (FLA-426 cross-model review follow-up): the targeted
  // bridge tests above assert specific behaviors one at a time; this suite
  // instead runs the exact pre-FLA-426 script and the current script through
  // the same fake ChatGPT-with-a-bridge-host environment and diffs their full
  // ordered traces, so a change in call order, a duplicate call, or a
  // regression in an untouched link/failure path would show up even if no
  // single targeted assertion happens to catch it.
  //
  // Fixture choice: fixtures/pre-fla-426-user-session-widget-v4.html is the
  // exact v4 body origin/main served immediately before FLA-426 (see the
  // comment in that file for how it was produced). It holds the full HTML,
  // not just the extracted <script>, so it works with loadWidgetScript()
  // completely unmodified — the same "build the script body the same way the
  // tests build it today" extraction every other test in this file already
  // relies on. Only v4 is needed: none of the cases below (initial render,
  // refresh, edit link, status link, Yahoo credit link, hidden widget) probe
  // link-permission variance across widget URIs, which is what v1 vs v4
  // differ by.
  describe('golden differential: pre-FLA-426 baseline vs current (ChatGPT + bridge host present)', () => {
    const OLD_WIDGET_HTML = readFileSync(
      new URL('./fixtures/pre-fla-426-user-session-widget-v4.html', import.meta.url),
      'utf8',
    );

    // Every capability the widget ever checks, plus a hostContext theme that
    // conflicts with window.openai.theme below. window.openai must win on
    // both scripts: the old script has no bridge concept at all to prefer it
    // over, and the new script's hostCapabilityReady() gate must produce that
    // identical outcome whenever window.openai exists.
    const BRIDGE_HOST = {
      initResult: {
        hostCapabilities: { serverTools: true, openLinks: true },
        hostContext: { theme: 'dark' as const },
      },
    };

    interface CallLogEntry {
      name: string;
      args: unknown;
    }

    interface OpenedEntry {
      kind: 'window.open' | 'openExternal';
      url: unknown;
    }

    /**
     * What a single click actually did: whether the handler suppressed the
     * native action, the clicked anchor's own href/target at that moment, and
     * — the part a Set-of-methods or a "did it call preventDefault" check
     * alone would miss — which of the two ways the resulting navigation
     * happens: the browser's native anchor navigation (unprevented) or a
     * specific scripted call (prevented). A regression that started calling
     * preventDefault without ever opening anything, or vice versa, changes
     * `navigation` even when `defaultPrevented` alone would not.
     */
    interface ClickOutcome {
      defaultPrevented: boolean;
      href: unknown;
      target: unknown;
      navigation:
        | { kind: 'native'; href: unknown; target: unknown }
        | { kind: 'window.open' | 'openExternal'; url: unknown }
        | { kind: 'none' };
    }

    interface Trace {
      calls: CallLogEntry[];
      posted: Array<{ method: unknown; params: unknown }>;
      opened: OpenedEntry[];
      dom: {
        content: string;
        status: string;
        statusClass: string;
        buttonDisabled: boolean;
        buttonWord: string;
        /** render()'s hide/show toggle on the `.widget` element itself — the
         * dimension the hidden-widget case actually needs to compare, and
         * cheap to check on every other case too. */
        widgetDisplay: string;
      };
      theme: string[];
      /** Present only for the scenarios below that click something. */
      click?: ClickOutcome;
    }

    /** A window.openai stub whose callTool is scenario-specific; openExternal
     * always succeeds synchronously (a normal ChatGPT host), recording into
     * `opened` so link scenarios trace through the same host path both
     * scripts have always used, unaffected by the new bridge branch (which
     * only fires when window.openai is absent). */
    function buildOpenai(
      calls: CallLogEntry[],
      opened: OpenedEntry[],
      callTool?: (name: string, args: unknown) => unknown,
    ) {
      return {
        theme: 'light',
        openExternal(args: unknown) {
          opened.push({ kind: 'openExternal', url: (args as { href?: unknown } | undefined)?.href });
          return true;
        },
        async callTool(name: string, args: unknown) {
          calls.push({ name, args });
          if (!callTool) return SAMPLE_SESSION;
          return callTool(name, args);
        },
      };
    }

    function captureDom(harness: WidgetHarness): Trace['dom'] {
      const { elements } = harness;
      return {
        content: elements.content.innerHTML,
        status: elements['refresh-status'].innerHTML,
        statusClass: elements['refresh-status'].className,
        buttonDisabled: !!elements['refresh-button'].disabled,
        buttonWord: elements['refresh-word'].textContent,
        widgetDisplay: harness.widgetEl.style.display ?? '',
      };
    }

    /** Pulls href/target off the first `<a ...>` tag in an innerHTML string —
     * used for the status-link case, whose anchor is injected HTML rather
     * than one of the harness's static elements. */
    function extractAnchor(html: string): { href?: string; target?: string } | undefined {
      const tag = html.match(/<a\b([^>]*)>/i)?.[1];
      if (tag === undefined) return undefined;
      return {
        href: tag.match(/\bhref="([^"]*)"/)?.[1],
        target: tag.match(/\btarget="([^"]*)"/)?.[1],
      };
    }

    function classifyNavigation(
      prevented: boolean,
      href: unknown,
      target: unknown,
      opened: OpenedEntry[],
      openedBefore: number,
      openedTabs: string[],
      tabsBefore: number,
    ): ClickOutcome['navigation'] {
      if (!prevented) return { kind: 'native', href, target };
      if (opened.length > openedBefore) return { kind: 'openExternal', url: opened[opened.length - 1].url };
      if (openedTabs.length > tabsBefore) return { kind: 'window.open', url: openedTabs[openedTabs.length - 1] };
      return { kind: 'none' };
    }

    /**
     * Clicks `el` (or a no-op when it has no registered listener at all —
     * true of the old script's status-link anchor, which never gets a
     * listener) and records the full click outcome: whether the default was
     * prevented, the anchor's own href/target, and which of native
     * navigation or a specific scripted call would actually run. `overrides`
     * lets the status-link case supply the injected anchor's real
     * href/target (read from its innerHTML, not a harness element) and a
     * synthetic `event.target` for the delegated listener's `tagName` check.
     */
    function clickAndRecord(
      harness: WidgetHarness,
      opened: OpenedEntry[],
      el: FakeElement,
      listener: ((event: unknown) => unknown) | undefined,
      overrides: { href?: unknown; target?: unknown; eventTarget?: unknown } = {},
    ): ClickOutcome {
      const { state, event } = clickEvent();
      if (overrides.eventTarget !== undefined) (event as { target?: unknown }).target = overrides.eventTarget;
      const href = 'href' in overrides ? overrides.href : el.href;
      const target = 'target' in overrides ? overrides.target : el.target;
      const openedBefore = opened.length;
      const tabsBefore = harness.openedTabs.length;
      if (listener) listener(event);
      const navigation = classifyNavigation(
        state.prevented,
        href,
        target,
        opened,
        openedBefore,
        harness.openedTabs,
        tabsBefore,
      );
      return { defaultPrevented: state.prevented, href, target, navigation };
    }

    async function runScenario(
      html: string,
      callTool: ((name: string, args: unknown) => unknown) | undefined,
      openaiExtra: Record<string, unknown>,
      act: (harness: WidgetHarness, opened: OpenedEntry[], recordClick: (outcome: ClickOutcome) => void) => Promise<void> | void,
    ): Promise<Trace> {
      const calls: CallLogEntry[] = [];
      const opened: OpenedEntry[] = [];
      const openai = { ...buildOpenai(calls, opened, callTool), ...openaiExtra };
      const harness = loadWidgetScript(html, { openai, bridge: BRIDGE_HOST });
      let click: ClickOutcome | undefined;

      await act(harness, opened, (outcome) => { click = outcome; });
      // Flush any size-changed notification queued via setTimeout(fn, 0) (no
      // requestAnimationFrame in this harness), so every scenario captures a
      // settled trace regardless of which internal path queued it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      // clickAndRecord() only ever reads harness.openedTabs to classify a
      // click's navigation — it never pushes into `opened` itself — so this
      // merge is the sole source of 'window.open' entries and can't double count.
      for (const url of harness.openedTabs) opened.push({ kind: 'window.open', url });

      return {
        calls,
        posted: harness.postedMessages.map((message) => ({ method: message.method, params: message.params })),
        opened,
        dom: captureDom(harness),
        theme: Array.from(harness.classes).sort(),
        ...(click ? { click } : {}),
      };
    }

    const REFRESH_SUCCESS_RESULT = {
      success: true,
      results: { espn: { platform: 'espn', status: 'success', details: { added: 2 } } },
    };

    async function refresh(harness: WidgetHarness) {
      await (harness.exports.refreshLeagues as (event?: unknown) => Promise<unknown>)();
    }

    const scenarios: Array<{
      name: string;
      callTool?: (name: string, args: unknown) => unknown;
      openaiExtra?: Record<string, unknown>;
      act: (harness: WidgetHarness, opened: OpenedEntry[], recordClick: (outcome: ClickOutcome) => void) => Promise<void> | void;
    }> = [
      {
        name: '(a) initial render',
        openaiExtra: { toolOutput: SAMPLE_SESSION },
        act: () => {},
      },
      {
        name: '(b) refresh success',
        callTool: (name) => (name === 'refresh_leagues' ? REFRESH_SUCCESS_RESULT : SAMPLE_SESSION),
        act: refresh,
      },
      {
        name: '(c) refresh where refresh_leagues returns isError',
        callTool: (name) => (name === 'refresh_leagues' ? { isError: true } : SAMPLE_SESSION),
        act: refresh,
      },
      {
        name: '(d) refresh where callTool throws',
        callTool: () => {
          throw new Error('transport failure');
        },
        act: refresh,
      },
      {
        name: '(e) edit link click',
        act: (harness, opened, recordClick) => {
          const el = harness.elements['edit-link'];
          recordClick(clickAndRecord(harness, opened, el, el.listeners.click[0]));
        },
      },
      {
        name: '(f) status link after a failure',
        callTool: () => {
          throw new Error('transport failure');
        },
        act: async (harness, opened, recordClick) => {
          await refresh(harness);
          // The old script never attaches a listener here (it relies on the
          // plain anchor's own navigation); the new script attaches one
          // unconditionally but no-ops whenever window.openai exists. Either
          // way, href/target are read straight off the injected anchor
          // itself (not a harness element), so a regression that broke or
          // blanked that markup shows up here even though neither script
          // currently does anything scripted with this click.
          const anchor = extractAnchor(harness.elements['refresh-status'].innerHTML);
          const el = harness.elements['refresh-status'];
          recordClick(
            clickAndRecord(harness, opened, el, el.listeners.click?.[0], {
              href: anchor?.href,
              target: anchor?.target,
              eventTarget: { tagName: 'A' },
            }),
          );
        },
      },
      {
        name: '(g) Yahoo credit link click',
        act: (harness, opened, recordClick) => {
          const el = harness.elements['yahoo-link'];
          recordClick(clickAndRecord(harness, opened, el, el.listeners.click[0]));
        },
      },
      {
        name: '(h) hidden-widget payload',
        openaiExtra: { toolOutput: { allLeagues: [], widget: { hidden: true } } },
        act: () => {},
      },
    ];

    it.each(scenarios)('$name produces an identical trace on both scripts', async ({ callTool, openaiExtra, act }) => {
      const oldTrace = await runScenario(OLD_WIDGET_HTML, callTool, openaiExtra ?? {}, act);
      const newTrace = await runScenario(USER_SESSION_WIDGET_HTML, callTool, openaiExtra ?? {}, act);
      expect(newTrace).toEqual(oldTrace);
    });
  });
});
