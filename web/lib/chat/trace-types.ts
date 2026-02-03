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
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
};
