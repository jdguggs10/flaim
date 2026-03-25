const URLISH_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;
const DOMAINISH_PATTERN =
  /\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|gov|edu|app|ai|co|us|uk|ca)\b/gi;
const CITATION_PARENS_PATTERN =
  /\s*\((?:[^)]*\b(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+(?:com|org|net|io|gov|edu|app|ai|co|us|uk|ca))\b[^)]*)\)/gi;

const MIN_WORDS = 30;
const MAX_WORDS = 50;
const SHORT_ANSWER_FALLBACKS: Partial<Record<string, string>> = {
  "transactions-watch":
    "The next meaningful change will probably come from today’s injury, lineup, or role news rather than a league transaction.",
};

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function countWords(text: string) {
  return normalizeWhitespace(text)
    .split(" ")
    .filter(Boolean).length;
}

function stripSourceArtifacts(text: string) {
  return normalizeWhitespace(
    text
      .replace(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi, "")
      .replace(CITATION_PARENS_PATTERN, "")
      .replace(URLISH_PATTERN, "")
      .replace(DOMAINISH_PATTERN, "")
      .replace(/\(\s*\)/g, "")
  );
}

function splitSentences(text: string) {
  return text.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) ?? [];
}

function trimToWordLimit(text: string, maxWords: number) {
  const words = normalizeWhitespace(text).split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return normalizeWhitespace(text);
  }

  const trimmed = words.slice(0, maxWords).join(" ").replace(/[,:;]+$/, "");
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function formatPublicChatAnswer(text: string) {
  const cleaned = stripSourceArtifacts(text);
  if (!cleaned) {
    return "";
  }

  const sentences = splitSentences(cleaned).map((sentence) =>
    normalizeWhitespace(sentence)
  ).filter(Boolean);

  const candidate =
    sentences.length > 0
      ? normalizeWhitespace(sentences.slice(0, 2).join(" "))
      : cleaned;

  return trimToWordLimit(candidate, MAX_WORDS);
}

export function formatPublicChatAnswerForPreset(text: string, presetId: string) {
  const formatted = formatPublicChatAnswer(text);
  if (!formatted) {
    return "";
  }

  const fallback = SHORT_ANSWER_FALLBACKS[presetId];
  if (!fallback) {
    return formatted;
  }

  const sentenceCount = splitSentences(formatted).filter(Boolean).length;
  if (countWords(formatted) >= MIN_WORDS && sentenceCount >= 2) {
    return formatted;
  }

  const withFallback = normalizeWhitespace(
    `${formatted.replace(/[.!?]+$/, ".")} ${fallback}`
  );

  return trimToWordLimit(withFallback, MAX_WORDS);
}

export function getPublicChatAnswerWordCount(text: string) {
  return countWords(text);
}
