import { SYSTEM_PROMPT, buildLeagueContext } from "@/lib/chat/prompts";
import { parse } from "partial-json";
import { handleTool } from "@/lib/chat/tools/tools-handling";
import useConversationStore from "@/stores/chat/useConversationStore";
import { getTools } from "./tools/tools";
import { Annotation } from "@/components/chat/annotations";
import { functionsMap } from "@/config/functions";
import { redactSensitive } from "@/lib/chat/trace-utils";
import type { TraceToolEvent } from "@/lib/chat/trace-types";

const normalizeAnnotation = (annotation: any): Annotation => ({
  ...annotation,
  fileId: annotation.file_id ?? annotation.fileId,
  containerId: annotation.container_id ?? annotation.containerId,
});

export interface ContentItem {
  type: "input_text" | "output_text" | "refusal" | "output_audio";
  annotations?: Annotation[];
  text?: string;
}

// Message items for storing conversation history matching API shape
export interface MessageItem {
  type: "message";
  role: "user" | "assistant" | "system";
  id?: string;
  content: ContentItem[];
}

// Debug metadata for tool calls
export interface ToolCallMetadata {
  startedAt: number; // timestamp when tool call started
  completedAt?: number; // timestamp when completed
  durationMs?: number; // calculated duration
  serverUrl?: string; // MCP server URL used
  error?: string; // error message if failed
}

// Custom items to display in chat
export interface ToolCallItem {
  type: "tool_call";
  tool_type:
    | "file_search_call"
    | "web_search_call"
    | "function_call"
    | "mcp_call"
    | "code_interpreter_call";
  status: "in_progress" | "completed" | "failed" | "searching";
  id: string;
  name?: string | null;
  call_id?: string;
  arguments?: string;
  parsedArguments?: any;
  output?: string | null;
  code?: string;
  files?: {
    file_id: string;
    mime_type: string;
    container_id?: string;
    filename?: string;
  }[];
  metadata?: ToolCallMetadata; // Debug timing and error info
}

export interface McpListToolsItem {
  type: "mcp_list_tools";
  id: string;
  server_label: string;
  tools: { name: string; description?: string }[];
}

export interface McpApprovalRequestItem {
  type: "mcp_approval_request";
  id: string;
  server_label: string;
  name: string;
  arguments?: string;
}

export type Item =
  | MessageItem
  | ToolCallItem
  | McpListToolsItem
  | McpApprovalRequestItem;

export const handleTurn = async (
  messages: any[],
  tools: any[],
  onMessage: (data: any) => void,
  previousResponseId?: string | null
) => {
  try {
    // Get response from the API (defined in app/api/chat/turn_response/route.ts)
    // Uses stored-responses flow: when previousResponseId is provided, the API
    // reconstructs context from the stored response instead of us rebuilding it
    const response = await fetch("/api/chat/turn_response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages,
        tools: tools,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      }),
    });

    if (!response.ok) {
      let errorDetails = `${response.status} - ${response.statusText}`;
      try {
        const errorData = (await response.json()) as any;
        errorDetails = errorData?.error || errorData?.details || errorDetails;
        console.error(`[ERROR] API request failed:`, errorData);
      } catch {
        console.error(
          `[ERROR] API request failed: ${response.status} - ${response.statusText}`
        );
      }
      // Add error message to chat
      onMessage({
        event: 'error',
        data: {
          error: errorDetails,
          status: response.status
        }
      });
      return;
    }

    // Reader for streaming data
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let buffer = "";

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      const chunkValue = decoder.decode(value);
      buffer += chunkValue;

      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const dataStr = line.slice(6);
          if (dataStr === "[DONE]") {
            done = true;
            break;
          }
          const data = JSON.parse(dataStr);
          onMessage(data);
        }
      }
    }

    // Handle any remaining data in buffer
    if (buffer && buffer.startsWith("data: ")) {
      const dataStr = buffer.slice(6);
      if (dataStr !== "[DONE]") {
        const data = JSON.parse(dataStr);
        onMessage(data);
      }
    }
  } catch (error) {
    console.error("Error handling turn:", error);
  }
};

export const processMessages = async () => {
  const {
    chatMessages,
    conversationItems,
    setChatMessages,
    setConversationItems,
    setLoadingState,
    previousResponseId,
    setPreviousResponseId,
    addTraceEntry,
    updateTraceEntry,
  } = useConversationStore.getState();

  const tools = getTools();

  // Build dynamic league context based on user's active league
  const leagueContext = buildLeagueContext();

  // With stored-responses flow:
  // - First turn (no previousResponseId): Send full context (system prompt + league context + user message)
  // - Subsequent turns: Send only NEW items since last response + previous_response_id
  //   The API reconstructs full context from the stored response
  let inputItems: any[];
  if (previousResponseId) {
    // We have a stored response - send only new items (user messages, function outputs)
    // conversationItems now contains only items added since last response
    inputItems = conversationItems;
  } else {
    // First turn - send full context
    inputItems = [
      // Static system instructions (defines assistant behavior)
      {
        role: "developer",
        content: SYSTEM_PROMPT,
      },
      // Dynamic league context (only injected if user has leagues configured)
      ...(leagueContext
        ? [
            {
              role: "developer",
              content: leagueContext,
            },
          ]
        : []),
      // Conversation history (for first turn, this is just the user message)
      ...conversationItems,
    ];
  }

  const traceId = crypto.randomUUID();
  const userMessageItem = [...conversationItems]
    .reverse()
    .find((item) => item?.role === "user");
  const userMessage =
    typeof userMessageItem?.content === "string" ? userMessageItem.content : null;

  addTraceEntry({
    id: traceId,
    kind: "request",
    sentAt: new Date().toISOString(),
    previousResponseId,
    inputItems,
    toolsSnapshot: redactSensitive(tools) as unknown[],
    systemPrompt: SYSTEM_PROMPT,
    leagueContext: leagueContext ?? null,
    userMessage,
    toolEvents: [],
  });

  const upsertToolEvent = (
    toolUpdate: Partial<TraceToolEvent> & { id: string; tool_type?: string },
  ) => {
    const normalizedUpdate = Object.fromEntries(
      Object.entries(toolUpdate).filter(([, value]) => value !== undefined),
    ) as Partial<TraceToolEvent> & { id: string; tool_type?: string };

    updateTraceEntry(traceId, (entry) => {
      const existingIndex = entry.toolEvents.findIndex(
        (event) => event.id === normalizedUpdate.id,
      );
      const resolvedToolType =
        normalizedUpdate.tool_type ??
        (existingIndex >= 0 ? entry.toolEvents[existingIndex].tool_type : "unknown");

      if (existingIndex === -1) {
        const nextEvent: TraceToolEvent = {
          ...normalizedUpdate,
          id: normalizedUpdate.id,
          tool_type: resolvedToolType,
        };
        return { ...entry, toolEvents: [...entry.toolEvents, nextEvent] };
      }

      const nextEvents = [...entry.toolEvents];
      nextEvents[existingIndex] = {
        ...nextEvents[existingIndex],
        ...normalizedUpdate,
        tool_type: resolvedToolType,
      };
      return { ...entry, toolEvents: nextEvents };
    });
  };

  const safeParseArguments = (value: string | null | undefined): unknown => {
    if (!value) {
      return {};
    }
    try {
      return parse(value);
    } catch {
      return {};
    }
  };

  const stringifyToolOutput = (output: unknown): string | null => {
    if (output == null) {
      return null;
    }
    if (typeof output === "string") {
      return output;
    }
    try {
      return JSON.stringify(output);
    } catch {
      try {
        return String(output);
      } catch {
        return "[unserializable]";
      }
    }
  };

  const setTraceAssistantOutput = (assistantOutput: string | null) => {
    updateTraceEntry(traceId, (entry) => ({
      ...entry,
      assistantOutput,
    }));
  };

  const setTraceError = (error: string | null) => {
    updateTraceEntry(traceId, (entry) => ({
      ...entry,
      error,
    }));
  };

  // Track pending function calls - we defer execution until after response.completed
  // so we have the response ID for the next turn
  const pendingFunctionCalls: { toolCallMessage: ToolCallItem }[] = [];

  let assistantMessageContent = "";
  const functionArgumentsByItem = new Map<string, string>();
  // For streaming MCP tool call arguments
  const mcpArgumentsByItem = new Map<string, string>();

  await handleTurn(inputItems, tools, async ({ event, data }) => {
    // DEBUG: Log all events for analysis
    console.log(`[SSE EVENT] ${event}`, data);

    switch (event) {
      case "response.created":
      case "response.in_progress": {
        setLoadingState({ status: "thinking", thinkingText: "" });
        break;
      }

      case "response.reasoning_summary_text.delta": {
        const { delta } = data;
        const current = useConversationStore.getState().loadingState;
        setLoadingState({
          status: "thinking",
          thinkingText: current.thinkingText + (delta || ""),
        });
        break;
      }

      case "response.output_text.delta":
      case "response.output_text.annotation.added": {
        const { delta, item_id, annotation } = data;

        let partial = "";
        if (typeof delta === "string") {
          partial = delta;
        }
        assistantMessageContent += partial;

        // If the last message isn't an assistant message, create a new one
        const lastItem = chatMessages[chatMessages.length - 1];
        if (
          !lastItem ||
          lastItem.type !== "message" ||
          lastItem.role !== "assistant" ||
          (lastItem.id && lastItem.id !== item_id)
        ) {
          chatMessages.push({
            type: "message",
            role: "assistant",
            id: item_id,
            content: [
              {
                type: "output_text",
                text: assistantMessageContent,
              },
            ],
          } as MessageItem);
        } else {
          const contentItem = lastItem.content[0];
          if (contentItem && contentItem.type === "output_text") {
            contentItem.text = assistantMessageContent;
            if (annotation) {
              contentItem.annotations = [
                ...(contentItem.annotations ?? []),
                normalizeAnnotation(annotation),
              ];
            }
          }
        }

        setChatMessages([...chatMessages]);
        setLoadingState({ status: "responding", thinkingText: "" });
        break;
      }

      case "response.output_item.added": {
        const { item } = data || {};
        if (!item || !item.type) {
          break;
        }
        // Only transition to "responding" for message items.
        // Tool calls keep the thinking/connecting state active
        // until actual text content arrives.
        if (item.type === "message") {
          setLoadingState({ status: "responding", thinkingText: "" });
        }
        // Handle differently depending on the item type
        switch (item.type) {
          case "message": {
            const text = item.content?.text || "";
            const annotations =
              item.content?.annotations?.map(normalizeAnnotation) || [];
            chatMessages.push({
              type: "message",
              role: "assistant",
              id: item.id,
              content: [
                {
                  type: "output_text",
                  text,
                  ...(annotations.length > 0 ? { annotations } : {}),
                },
              ],
            });
            // NOTE: Don't push to conversationItems here - the content is incomplete.
            // We'll push the complete message in response.output_item.done
            setChatMessages([...chatMessages]);
            break;
          }
          case "function_call": {
            const nextArguments =
              (functionArgumentsByItem.get(item.id) ?? "") + (item.arguments || "");
            functionArgumentsByItem.set(item.id, nextArguments);
            const parsedArguments = safeParseArguments(nextArguments);
            upsertToolEvent({
              id: item.id,
              tool_type: "function_call",
              name: item.name,
              arguments: nextArguments,
              parsedArguments,
              status: "in_progress",
            });
            chatMessages.push({
              type: "tool_call",
              tool_type: "function_call",
              status: "in_progress",
              id: item.id,
              name: item.name, // function name,e.g. "get_weather"
              arguments: item.arguments || "",
              parsedArguments: {},
              output: null,
              metadata: { startedAt: Date.now() },
            });
            setChatMessages([...chatMessages]);
            break;
          }
          case "web_search_call": {
            upsertToolEvent({
              id: item.id,
              tool_type: "web_search_call",
              status: item.status || "in_progress",
            });
            chatMessages.push({
              type: "tool_call",
              tool_type: "web_search_call",
              status: item.status || "in_progress",
              id: item.id,
              metadata: { startedAt: Date.now() },
            });
            setChatMessages([...chatMessages]);
            break;
          }
          case "file_search_call": {
            upsertToolEvent({
              id: item.id,
              tool_type: "file_search_call",
              status: item.status || "in_progress",
            });
            chatMessages.push({
              type: "tool_call",
              tool_type: "file_search_call",
              status: item.status || "in_progress",
              id: item.id,
              metadata: { startedAt: Date.now() },
            });
            setChatMessages([...chatMessages]);
            break;
          }
          case "mcp_call": {
            const nextArguments =
              (mcpArgumentsByItem.get(item.id) ?? "") + (item.arguments || "");
            mcpArgumentsByItem.set(item.id, nextArguments);
            const parsedArguments = safeParseArguments(nextArguments);
            upsertToolEvent({
              id: item.id,
              tool_type: "mcp_call",
              name: item.name,
              arguments: nextArguments,
              parsedArguments,
              status: "in_progress",
            });
            chatMessages.push({
              type: "tool_call",
              tool_type: "mcp_call",
              status: "in_progress",
              id: item.id,
              name: item.name,
              arguments: item.arguments || "",
              parsedArguments: safeParseArguments(item.arguments),
              output: null,
              metadata: { startedAt: Date.now() },
            });
            setChatMessages([...chatMessages]);
            break;
          }
          case "code_interpreter_call": {
            upsertToolEvent({
              id: item.id,
              tool_type: "code_interpreter_call",
              status: item.status || "in_progress",
            });
            chatMessages.push({
              type: "tool_call",
              tool_type: "code_interpreter_call",
              status: item.status || "in_progress",
              id: item.id,
              code: "",
              files: [],
              metadata: { startedAt: Date.now() },
            });
            setChatMessages([...chatMessages]);
            break;
          }
        }
        break;
      }

      case "response.output_item.done": {
        // After output item is done, adding tool call ID and pushing to conversation
        const { item } = data || {};
        if (item && item.type && item.type !== "message") {
          upsertToolEvent({
            id: item.id,
            tool_type: item.type,
            status: item.status,
            output: stringifyToolOutput(item.output),
          });
        }
        const toolCallMessage = chatMessages.find((m) => m.id === item.id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.call_id = item.call_id;
          setChatMessages([...chatMessages]);
        }

        // With stored-responses flow, we do NOT push assistant output/tool call items
        // into conversationItems. The API reconstructs full context from
        // previous_response_id, and we only need to keep NEW user inputs or local
        // tool outputs between turns.

        if (
          toolCallMessage &&
          toolCallMessage.type === "tool_call" &&
          toolCallMessage.tool_type === "function_call"
        ) {
          // Defer function execution until after response.completed
          // This ensures we have the response ID for the stored-responses flow
          pendingFunctionCalls.push({ toolCallMessage });
        }
        if (
          toolCallMessage &&
          toolCallMessage.type === "tool_call" &&
          toolCallMessage.tool_type === "mcp_call"
        ) {
          toolCallMessage.output = item.output;
          toolCallMessage.status = "completed";
          // Add completion timing
          if (toolCallMessage.metadata) {
            const now = Date.now();
            toolCallMessage.metadata.completedAt = now;
            toolCallMessage.metadata.durationMs =
              now - toolCallMessage.metadata.startedAt;
          }
          setChatMessages([...chatMessages]);
        }
        break;
      }

      case "response.function_call_arguments.delta": {
        // Streaming arguments delta to show in the chat
        const nextArguments =
          (functionArgumentsByItem.get(data.item_id) ?? "") + (data.delta || "");
        functionArgumentsByItem.set(data.item_id, nextArguments);
        let parsedFunctionArguments = {};

        const toolCallMessage = chatMessages.find((m) => m.id === data.item_id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.arguments = nextArguments;
          try {
            if (nextArguments.length > 0) {
              parsedFunctionArguments = parse(nextArguments);
            }
            toolCallMessage.parsedArguments = parsedFunctionArguments;
          } catch {
            // partial JSON can fail parse; ignore
          }
          setChatMessages([...chatMessages]);
        }
        upsertToolEvent({
          id: data.item_id,
          tool_type: "function_call",
          arguments: nextArguments,
          parsedArguments: parsedFunctionArguments,
          status: "in_progress",
        });
        break;
      }

      case "response.function_call_arguments.done": {
        // This has the full final arguments string
        const { item_id, arguments: finalArgs } = data;

        functionArgumentsByItem.set(item_id, finalArgs);
        const parsedArguments = safeParseArguments(finalArgs);

        // Mark the tool_call as "completed" and parse the final JSON
        const toolCallMessage = chatMessages.find((m) => m.id === item_id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.arguments = finalArgs;
          toolCallMessage.parsedArguments = parsedArguments;
          toolCallMessage.status = "completed";
          setChatMessages([...chatMessages]);
        }
        upsertToolEvent({
          id: item_id,
          tool_type: "function_call",
          arguments: finalArgs,
          parsedArguments,
          status: "completed",
        });
        functionArgumentsByItem.delete(item_id);
        break;
      }
      // Streaming MCP tool call arguments
      case "response.mcp_call_arguments.delta": {
        // Append delta to MCP arguments
        const nextArguments =
          (mcpArgumentsByItem.get(data.item_id) ?? "") + (data.delta || "");
        mcpArgumentsByItem.set(data.item_id, nextArguments);
        let parsedMcpArguments: any = {};
        const toolCallMessage = chatMessages.find((m) => m.id === data.item_id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.arguments = nextArguments;
          try {
            if (nextArguments.length > 0) {
              parsedMcpArguments = parse(nextArguments);
            }
            toolCallMessage.parsedArguments = parsedMcpArguments;
          } catch {
            // partial JSON can fail parse; ignore
          }
          setChatMessages([...chatMessages]);
        }
        upsertToolEvent({
          id: data.item_id,
          tool_type: "mcp_call",
          arguments: nextArguments,
          parsedArguments: parsedMcpArguments,
          status: "in_progress",
        });
        break;
      }
      case "response.mcp_call_arguments.done": {
        // Final MCP arguments string received
        const { item_id, arguments: finalArgs } = data;
        mcpArgumentsByItem.set(item_id, finalArgs);
        const parsedArguments = safeParseArguments(finalArgs);
        const toolCallMessage = chatMessages.find((m) => m.id === item_id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.arguments = finalArgs;
          toolCallMessage.parsedArguments = parsedArguments;
          toolCallMessage.status = "completed";
          setChatMessages([...chatMessages]);
        }
        upsertToolEvent({
          id: item_id,
          tool_type: "mcp_call",
          arguments: finalArgs,
          parsedArguments,
          status: "completed",
        });
        mcpArgumentsByItem.delete(item_id);
        break;
      }

      case "response.web_search_call.completed": {
        const { item_id, output } = data;
        const toolCallMessage = chatMessages.find((m) => m.id === item_id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.output = output;
          toolCallMessage.status = "completed";
          // Add completion timing
          if (toolCallMessage.metadata) {
            const now = Date.now();
            toolCallMessage.metadata.completedAt = now;
            toolCallMessage.metadata.durationMs =
              now - toolCallMessage.metadata.startedAt;
          }
          setChatMessages([...chatMessages]);
        }
        upsertToolEvent({
          id: item_id,
          tool_type: "web_search_call",
          output: stringifyToolOutput(output),
          status: "completed",
        });
        break;
      }

      case "response.file_search_call.completed": {
        const { item_id, output } = data;
        const toolCallMessage = chatMessages.find((m) => m.id === item_id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.output = output;
          toolCallMessage.status = "completed";
          // Add completion timing
          if (toolCallMessage.metadata) {
            const now = Date.now();
            toolCallMessage.metadata.completedAt = now;
            toolCallMessage.metadata.durationMs =
              now - toolCallMessage.metadata.startedAt;
          }
          setChatMessages([...chatMessages]);
        }
        upsertToolEvent({
          id: item_id,
          tool_type: "file_search_call",
          output: stringifyToolOutput(output),
          status: "completed",
        });
        break;
      }

      case "response.code_interpreter_call_code.delta": {
        const { delta, item_id } = data;
        const toolCallMessage = [...chatMessages]
          .reverse()
          .find(
            (m) =>
              m.type === "tool_call" &&
              m.tool_type === "code_interpreter_call" &&
              m.status !== "completed" &&
              m.id === item_id
          ) as ToolCallItem | undefined;
        // Accumulate deltas to show the code streaming
        if (toolCallMessage) {
          toolCallMessage.code = (toolCallMessage.code || "") + delta;
          setChatMessages([...chatMessages]);
          upsertToolEvent({
            id: item_id,
            tool_type: "code_interpreter_call",
            output: stringifyToolOutput(toolCallMessage.code || ""),
            status: "in_progress",
          });
        }
        break;
      }

      case "response.code_interpreter_call_code.done": {
        const { code, item_id } = data;
        const toolCallMessage = [...chatMessages]
          .reverse()
          .find(
            (m) =>
              m.type === "tool_call" &&
              m.tool_type === "code_interpreter_call" &&
              m.status !== "completed" &&
              m.id === item_id
          ) as ToolCallItem | undefined;

        // Mark the call as completed and set the code
        if (toolCallMessage) {
          toolCallMessage.code = code;
          toolCallMessage.status = "completed";
          // Add completion timing
          if (toolCallMessage.metadata) {
            const now = Date.now();
            toolCallMessage.metadata.completedAt = now;
            toolCallMessage.metadata.durationMs =
              now - toolCallMessage.metadata.startedAt;
          }
          setChatMessages([...chatMessages]);
        }
        upsertToolEvent({
          id: item_id,
          tool_type: "code_interpreter_call",
          output: stringifyToolOutput(code),
          status: "completed",
        });
        break;
      }

      case "response.code_interpreter_call.completed": {
        const { item_id } = data;
        const toolCallMessage = chatMessages.find(
          (m) => m.type === "tool_call" && m.id === item_id
        ) as ToolCallItem | undefined;
        if (toolCallMessage) {
          toolCallMessage.status = "completed";
          // Add completion timing (only if not already set)
          if (toolCallMessage.metadata && !toolCallMessage.metadata.completedAt) {
            const now = Date.now();
            toolCallMessage.metadata.completedAt = now;
            toolCallMessage.metadata.durationMs =
              now - toolCallMessage.metadata.startedAt;
          }
          setChatMessages([...chatMessages]);
        }
        upsertToolEvent({
          id: item_id,
          tool_type: "code_interpreter_call",
          status: "completed",
        });
        break;
      }

      case "response.completed": {
        console.log("response completed", data);
        setLoadingState({ status: "idle", thinkingText: "" });
        const { response } = data;
        const lastAssistantMessage = [...chatMessages]
          .reverse()
          .find((item) => item.type === "message" && item.role === "assistant") as MessageItem | undefined;
        const lastAssistantText =
          lastAssistantMessage?.content?.[0]?.type === "output_text"
            ? lastAssistantMessage.content[0].text || ""
            : "";
        const assistantOutput =
          assistantMessageContent || lastAssistantText || null;
        setTraceAssistantOutput(assistantOutput);

        if (response.usage) {
          updateTraceEntry(traceId, (entry) => ({
            ...entry,
            usage: response.usage,
          }));
        }

        // Store the response ID for the stored-responses flow
        // This allows subsequent turns to reference this response instead of rebuilding history
        if (response.id) {
          setPreviousResponseId(response.id);
          // Clear conversationItems - with stored-responses, we only need NEW items for next turn
          // The API reconstructs full context from the stored response
          setConversationItems([]);
        }

        // Handle all MCP approval request items (multiple servers can return these)
        const mcpApprovalRequestMessages = response.output.filter(
          (m: Item) => m.type === "mcp_approval_request"
        );

        for (const mcpApprovalRequestMessage of mcpApprovalRequestMessages) {
          chatMessages.push({
            type: "mcp_approval_request",
            id: mcpApprovalRequestMessage.id,
            server_label: mcpApprovalRequestMessage.server_label,
            name: mcpApprovalRequestMessage.name,
            arguments: mcpApprovalRequestMessage.arguments,
          });
        }

        // Only update state if we added any MCP approval items
        if (mcpApprovalRequestMessages.length > 0) {
          setChatMessages([...chatMessages]);
        }

        break;
      }

      case "error": {
        // Handle API errors
        const { error, status } = data;
        console.error(`[ERROR] API error:`, error);
        setTraceError(
          `${error}${status ? ` (Status: ${status})` : ""}`,
        );

        // Add error message to chat
        chatMessages.push({
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: `\u274C Error: ${error}${status ? ` (Status: ${status})` : ''}\n\nPlease try again or check your configuration.`,
            },
          ],
        });
        setChatMessages([...chatMessages]);
        setLoadingState({ status: "idle", thinkingText: "" });
        break;
      }

      // Handle other events as needed
    }
  }, previousResponseId);

  // After handleTurn completes, process any pending function calls
  // We deferred these until we have the response ID for proper stored-responses linking
  for (const { toolCallMessage } of pendingFunctionCalls) {
    try {
      const toolResult = await handleTool(
        toolCallMessage.name as keyof typeof functionsMap,
        toolCallMessage.parsedArguments
      );

      const toolOutput = stringifyToolOutput(toolResult) ?? "null";
      // Record tool output in display
      toolCallMessage.output = toolOutput;
      toolCallMessage.status = "completed";
      if (toolCallMessage.metadata) {
        const now = Date.now();
        toolCallMessage.metadata.completedAt = now;
        toolCallMessage.metadata.durationMs = now - toolCallMessage.metadata.startedAt;
      }
      upsertToolEvent({
        id: toolCallMessage.id,
        tool_type: "function_call",
        output: toolOutput,
        status: "completed",
      });
      setChatMessages([...chatMessages]);

      // Clear conversationItems and add only the function output for next turn
      // (with stored-responses, the API reconstructs context from previousResponseId)
      setConversationItems([{
        type: "function_call_output",
        call_id: toolCallMessage.call_id,
        output: toolOutput,
      }]);

      // Make next turn to get assistant response to tool output
      await processMessages();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool failed";
      const errorOutput = stringifyToolOutput({ error: message }) ?? "{\"error\":\"Tool failed\"}";
      toolCallMessage.output = errorOutput;
      toolCallMessage.status = "failed";
      if (toolCallMessage.metadata) {
        const now = Date.now();
        toolCallMessage.metadata.completedAt = now;
        toolCallMessage.metadata.durationMs = now - toolCallMessage.metadata.startedAt;
        toolCallMessage.metadata.error = message;
      }
      upsertToolEvent({
        id: toolCallMessage.id,
        tool_type: "function_call",
        output: errorOutput,
        status: "failed",
        error: message,
      });
      setChatMessages([...chatMessages]);

      // Clear conversationItems and add error output for next turn
      setConversationItems([{
        type: "function_call_output",
        call_id: toolCallMessage.call_id,
        output: errorOutput,
      }]);

      // Let the assistant respond to the tool failure
      await processMessages();
    }
  }
};
