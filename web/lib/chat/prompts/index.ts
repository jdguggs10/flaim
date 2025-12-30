/**
 * Flaim Prompts
 *
 * Central export for all LLM prompt-related content.
 *
 * - SYSTEM_PROMPT: Static instructions for the assistant (edit in system-prompt.ts)
 * - buildLeagueContext: Dynamic league context builder (edit templates in league-context.ts)
 */

export { SYSTEM_PROMPT } from "./system-prompt";
export { buildLeagueContext } from "./league-context";
