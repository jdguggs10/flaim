const REDACTED_VALUE = "***redacted***";
const SECRET_KEY_PATTERN = /token|jwt|secret/i;
const CIRCULAR_VALUE = "[Circular]";
const HAS_HEADERS = typeof Headers !== "undefined";

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "authorization" || normalized.includes("clerk");
}

function redactValue(
  value: unknown,
  key: string | undefined,
  seen: WeakSet<object>,
): unknown {
  if (key) {
    if (shouldRedactKey(key)) {
      return REDACTED_VALUE;
    }

    if (typeof value === "string" && SECRET_KEY_PATTERN.test(key)) {
      return REDACTED_VALUE;
    }
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR_VALUE;
    }

    seen.add(value);
    return value.map((item) => redactValue(item, undefined, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return CIRCULAR_VALUE;
    }

    seen.add(value);

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (HAS_HEADERS && value instanceof Headers) {
      return redactValue(Object.fromEntries(value.entries()), undefined, seen);
    }

    if (value instanceof Map) {
      return redactValue(Object.fromEntries(value.entries()), undefined, seen);
    }

    if (value instanceof Set) {
      return Array.from(value, (item) => redactValue(item, undefined, seen));
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const redacted: Record<string, unknown> = {};

    for (const [entryKey, entryValue] of entries) {
      redacted[entryKey] = redactValue(entryValue, entryKey, seen);
    }

    return redacted;
  }

  return value;
}

export function redactSensitive(value: unknown): unknown {
  return redactValue(value, undefined, new WeakSet<object>());
}
