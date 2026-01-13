import { SYSTEM_PROMPT, buildLeagueContext } from "@/lib/chat/prompts";
import { parse } from "partial-json";
import { handleTool } from "@/lib/chat/tools/tools-handling";
import useConversationStore from "@/stores/chat/useConversationStore";
import { getTools } from "./tools/tools";
import { Annotation } from "@/components/chat/annotations";
import { functionsMap } from "@/config/functions";

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
  onMessage: (data: any) => void
) => {
  try {
    // Get response from the API (defined in app/api/chat/turn_response/route.ts)
    const response = await fetch("/api/chat/turn_response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages,
        tools: tools,
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
    setAssistantLoading,
  } = useConversationStore.getState();

  const tools = getTools();

  // Build dynamic league context based on user's active league
  const leagueContext = buildLeagueContext();

  const allConversationItems = [
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
    // Conversation history
    ...conversationItems,
  ];

  let assistantMessageContent = "";
  let functionArguments = "";
  // For streaming MCP tool call arguments
  let mcpArguments = "";

  await handleTurn(allConversationItems, tools, async ({ event, data }) => {
    switch (event) {
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
        setAssistantLoading(false);
        break;
      }

      case "response.output_item.added": {
        const { item } = data || {};
        // New item coming in
        if (!item || !item.type) {
          break;
        }
        setAssistantLoading(false);
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
            functionArguments += item.arguments || "";
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
            mcpArguments = item.arguments || "";
            chatMessages.push({
              type: "tool_call",
              tool_type: "mcp_call",
              status: "in_progress",
              id: item.id,
              name: item.name,
              arguments: item.arguments || "",
              parsedArguments: item.arguments ? parse(item.arguments) : {},
              output: null,
              metadata: { startedAt: Date.now() },
            });
            setChatMessages([...chatMessages]);
            break;
          }
          case "code_interpreter_call": {
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
        const toolCallMessage = chatMessages.find((m) => m.id === item.id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.call_id = item.call_id;
          setChatMessages([...chatMessages]);
        }

        // Push completed items to conversationItems in the format expected by Responses API
        // Different item types need different handling:
        if (item.type === "message") {
          // For messages, extract the complete content and push in proper format
          const messageContent = item.content || [];
          conversationItems.push({
            role: item.role || "assistant",
            content: messageContent,
          });
          setConversationItems([...conversationItems]);
        } else if (item.type === "mcp_call") {
          // For MCP calls, push the call item (which includes output from server-side execution)
          // The Responses API needs this to maintain context of what tools were called and their results
          conversationItems.push(item);
          setConversationItems([...conversationItems]);
        } else if (item.type === "function_call") {
          // For function calls, push the call specification
          // The output will be pushed separately after local execution
          conversationItems.push(item);
          setConversationItems([...conversationItems]);
        } else if (item.type === "web_search_call" || item.type === "file_search_call" || item.type === "code_interpreter_call") {
          // For built-in tools, push the complete item
          conversationItems.push(item);
          setConversationItems([...conversationItems]);
        }
        // Note: Other item types (like mcp_list_tools) don't need to be in conversation history

        if (
          toolCallMessage &&
          toolCallMessage.type === "tool_call" &&
          toolCallMessage.tool_type === "function_call"
        ) {
          // Handle tool call (execute function)
          try {
            const toolResult = await handleTool(
              toolCallMessage.name as keyof typeof functionsMap,
              toolCallMessage.parsedArguments
            );

            // Record tool output
            toolCallMessage.output = JSON.stringify(toolResult);
            toolCallMessage.status = "completed";
            // Add completion timing
            if (toolCallMessage.metadata) {
              const now = Date.now();
              toolCallMessage.metadata.completedAt = now;
              toolCallMessage.metadata.durationMs =
                now - toolCallMessage.metadata.startedAt;
            }
            setChatMessages([...chatMessages]);
            conversationItems.push({
              type: "function_call_output",
              call_id: toolCallMessage.call_id,
              status: "completed",
              output: JSON.stringify(toolResult),
            });
            setConversationItems([...conversationItems]);

            // Create another turn after tool output has been added
            await processMessages();
          } catch (error) {
            const message = error instanceof Error ? error.message : "Tool failed";
            toolCallMessage.output = JSON.stringify({ error: message });
            toolCallMessage.status = "failed";
            if (toolCallMessage.metadata) {
              const now = Date.now();
              toolCallMessage.metadata.completedAt = now;
              toolCallMessage.metadata.durationMs =
                now - toolCallMessage.metadata.startedAt;
              toolCallMessage.metadata.error = message;
            }
            setChatMessages([...chatMessages]);
            conversationItems.push({
              type: "function_call_output",
              call_id: toolCallMessage.call_id,
              status: "failed",
              output: JSON.stringify({ error: message }),
            });
            setConversationItems([...conversationItems]);

            // Let the assistant respond to the tool failure
            await processMessages();
          }
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
        functionArguments += data.delta || "";
        let parsedFunctionArguments = {};

        const toolCallMessage = chatMessages.find((m) => m.id === data.item_id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.arguments = functionArguments;
          try {
            if (functionArguments.length > 0) {
              parsedFunctionArguments = parse(functionArguments);
            }
            toolCallMessage.parsedArguments = parsedFunctionArguments;
          } catch {
            // partial JSON can fail parse; ignore
          }
          setChatMessages([...chatMessages]);
        }
        break;
      }

      case "response.function_call_arguments.done": {
        // This has the full final arguments string
        const { item_id, arguments: finalArgs } = data;

        functionArguments = finalArgs;

        // Mark the tool_call as "completed" and parse the final JSON
        const toolCallMessage = chatMessages.find((m) => m.id === item_id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.arguments = finalArgs;
          toolCallMessage.parsedArguments = parse(finalArgs);
          toolCallMessage.status = "completed";
          setChatMessages([...chatMessages]);
        }
        break;
      }
      // Streaming MCP tool call arguments
      case "response.mcp_call_arguments.delta": {
        // Append delta to MCP arguments
        mcpArguments += data.delta || "";
        let parsedMcpArguments: any = {};
        const toolCallMessage = chatMessages.find((m) => m.id === data.item_id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.arguments = mcpArguments;
          try {
            if (mcpArguments.length > 0) {
              parsedMcpArguments = parse(mcpArguments);
            }
            toolCallMessage.parsedArguments = parsedMcpArguments;
          } catch {
            // partial JSON can fail parse; ignore
          }
          setChatMessages([...chatMessages]);
        }
        break;
      }
      case "response.mcp_call_arguments.done": {
        // Final MCP arguments string received
        const { item_id, arguments: finalArgs } = data;
        mcpArguments = finalArgs;
        const toolCallMessage = chatMessages.find((m) => m.id === item_id);
        if (toolCallMessage && toolCallMessage.type === "tool_call") {
          toolCallMessage.arguments = finalArgs;
          toolCallMessage.parsedArguments = parse(finalArgs);
          toolCallMessage.status = "completed";
          setChatMessages([...chatMessages]);
        }
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
        break;
      }

      case "response.completed": {
        console.log("response completed", data);
        const { response } = data;

        // Handle all MCP tools list items (multiple servers can return these)
        const mcpListToolsMessages = response.output.filter(
          (m: Item) => m.type === "mcp_list_tools"
        );

        for (const mcpListToolsMessage of mcpListToolsMessages) {
          chatMessages.push({
            type: "mcp_list_tools",
            id: mcpListToolsMessage.id,
            server_label: mcpListToolsMessage.server_label,
            tools: mcpListToolsMessage.tools || [],
          });
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

        // Only update state if we added any MCP items
        if (mcpListToolsMessages.length > 0 || mcpApprovalRequestMessages.length > 0) {
          setChatMessages([...chatMessages]);
        }

        break;
      }

      case "error": {
        // Handle API errors
        const { error, status } = data;
        console.error(`[ERROR] API error:`, error);

        // Add error message to chat
        chatMessages.push({
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: `❌ Error: ${error}${status ? ` (Status: ${status})` : ''}\n\nPlease try again or check your configuration.`,
            },
          ],
        });
        setChatMessages([...chatMessages]);
        setAssistantLoading(false);
        break;
      }

      // Handle other events as needed
    }
  });
};
