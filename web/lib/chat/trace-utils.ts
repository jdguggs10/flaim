const REDACTED_VALUE = "***redacted***";
const SECRET_KEY_PATTERN = /token|jwt|secret/i;

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "authorization" || normalized.includes("clerk");
}

function redactValue(value: unknown, key?: string): unknown {
  if (key) {
    if (shouldRedactKey(key)) {
      return REDACTED_VALUE;
    }

    if (typeof value === "string" && SECRET_KEY_PATTERN.test(key)) {
      return REDACTED_VALUE;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const redacted: Record<string, unknown> = {};

    for (const [entryKey, entryValue] of entries) {
      redacted[entryKey] = redactValue(entryValue, entryKey);
    }

    return redacted;
  }

  return value;
}

export function redactSensitive(value: unknown): unknown {
  return redactValue(value);
}
