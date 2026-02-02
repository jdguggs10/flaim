export type TraceToolEvent = {
  id: string;
  tool_type: string;
  name?: string | null;
  arguments?: string;
  parsedArguments?: unknown;
  output?: string | null;
  status?: string;
  error?: string | null;
};

export type LlmTraceEntry = {
  id: string;
  kind: "request";
  sentAt: string;
  previousResponseId?: string | null;
  inputItems: unknown[];
  toolsSnapshot: unknown[];
  systemPrompt?: string;
  leagueContext?: string | null;
  userMessage?: string | null;
  assistantOutput?: string | null;
  toolEvents: TraceToolEvent[];
  error?: string | null;
};
