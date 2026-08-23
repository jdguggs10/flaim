import type { ExecuteResponse } from '../../types';
import { extractErrorCode } from '@flaim/worker-shared';
import { asArray, parseYahooPercentOwned, toYahooBoolean } from '../normalizers';
import { defaultMetadataForYahooCode, isYahooClientError } from '../errors';

export function toExecuteErrorResponse(error: unknown): ExecuteResponse {
  const code = extractErrorCode(error);
  const metadata = isYahooClientError(error) ? error : defaultMetadataForYahooCode(code);

  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    code,
    status: metadata.status,
    upstream_status: isYahooClientError(error) ? error.upstreamStatus : undefined,
    retryable: metadata.retryable,
    retry_after: metadata.retryAfter,
    retry_after_source: isYahooClientError(error) ? error.retryAfterSource : undefined,
  };
}

export function extractPlayerMeta(playerData: unknown[]): Record<string, unknown> {
  const metaArray = playerData?.[0] as unknown[];
  let playerMeta: Record<string, unknown> = {};
  if (Array.isArray(metaArray)) {
    for (const item of metaArray) {
      if (typeof item === 'object' && item !== null) {
        playerMeta = { ...playerMeta, ...item };
      }
    }
  }
  return playerMeta;
}

export function extractPlayerPercentOwned(playerData: unknown[]): number | null {
  const ownershipData = playerData?.[1] as Record<string, unknown> | undefined;
  const ownership = ownershipData?.ownership as Record<string, unknown> | undefined;
  return parseYahooPercentOwned(ownership?.percent_owned);
}

export interface YahooKeeperStatus {
  /**
   * `undefined` when Yahoo sends an encoding `toYahooBoolean` doesn't
   * recognize (FLA-284 audit: this previously fell back to `Boolean(raw)`,
   * which coerces any truthy-looking unrecognized value — including a
   * non-empty unrecognized string — to `true`). An unrecognized encoding
   * must never be guessed at; the key is simply omitted from the emitted
   * JSON when this is `undefined`.
   */
  status: boolean | undefined;
  /**
   * Passed through unchanged: every known capture (roster/free-agent/search
   * fixtures across platforms this field has been observed on) shows `cost`
   * as `false` — never populated — so there is no confirmed shape to
   * normalize it to (number? string? Yahoo's own docs don't mention this
   * field at all). Undocumented/reverse-engineered (research brief §3.2).
   */
  cost: unknown;
  /** See `status` above — same undefined-on-unrecognized rule applies. */
  kept: boolean | undefined;
}

/**
 * Normalize Yahoo's undocumented `is_keeper` player field ({status, cost,
 * kept}) to typed booleans. `is_keeper` is present on every player once a
 * league is keeper-format — `status`/`kept` are `false` for a non-kept
 * player, not simply absent — so callers should emit `isKeeper` whenever
 * this returns a defined value, not only when status/kept are true.
 * `status`/`kept` are `undefined` (not a guessed default) when Yahoo sends
 * an encoding `toYahooBoolean` doesn't recognize.
 */
export function normalizeIsKeeper(raw: unknown): YahooKeeperStatus | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    status: toYahooBoolean(obj.status),
    cost: obj.cost,
    kept: toYahooBoolean(obj.kept),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Extract the flat settings-fields object from Yahoo's
 * `/league/{key}/settings` response. After `unwrapLeague()` merges the
 * league array, `.settings` is itself a nested array — a real captured
 * fixture (hkyplyr/yahoo_fantasy_ex) shows length 2: index 0 holds the
 * fields this handler reads (draft_type, can_trade_draft_picks, trade_end_date,
 * ...), index 1+ holds unrelated per-week/stat metadata — rather than a flat
 * object, unlike most single-value Yahoo nested resources (e.g. `roster`,
 * `standings`). Also defensively handles Yahoo's numeric-keyed-object form
 * ({"0": {...}, "count": 1}) in case this resource's shape varies by
 * game/season. This sub-resource is new to Flaim (FLA-284) and its exact
 * wire shape cannot be live-verified while Yahoo API access is cut
 * (FLA-237), so this degrades to undefined rather than guessing further —
 * including when the numeric-keyed-object fallback finds no plain-object
 * entry: this used to fall back to returning the raw (non-flat) container
 * itself, which would hand callers something shaped nothing like a
 * settings-fields object; treating it as "not found" instead lets the
 * caller push its existing LEAGUE_SETTINGS_UNAVAILABLE-style warning
 * (FLA-284 audit).
 */
export function extractLeagueSettings(rawSettings: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(rawSettings)) {
    return rawSettings.find(isPlainObject);
  }
  if (isPlainObject(rawSettings)) {
    return asArray(rawSettings).find(isPlainObject);
  }
  return undefined;
}

/**
 * Extract the primary manager name from a Yahoo team metadata object.
 * After unwrapTeam merges metadata, team.managers may be:
 * - A native array: [{ manager: { nickname: "..." } }]
 * - A Yahoo numeric-keyed object: { "0": { manager: { nickname: "..." } }, count: 1 }
 * We use asArray() to normalize both forms.
 */
export function extractManagerName(team: Record<string, unknown>): string | undefined {
  const raw = team.managers;
  if (!raw || typeof raw !== 'object') return undefined;

  const managersArray = asArray(raw as Record<string, unknown>);
  if (managersArray.length === 0) return undefined;

  const firstWrapper = managersArray[0] as Record<string, unknown> | undefined;
  const manager = firstWrapper?.manager as Record<string, unknown> | undefined;
  return (manager?.nickname as string) || undefined;
}
