# OpenAI Responses API Starter App Architecture

## Overview

This is a Next.js application that demonstrates how to build a conversational AI assistant using OpenAI's **Responses API**. The app provides a chat interface with tool integration capabilities including web search, file search, code interpretation, custom functions, and MCP (Model Context Protocol) servers.

## Key Technologies

- **Next.js 15.2.3** - React framework for the web application
- **TypeScript** - Type safety throughout the application
- **OpenAI SDK 4.87.3** - Integration with OpenAI's Responses API
- **Zustand** - State management for conversation and tools
- **Tailwind CSS** - Styling and responsive design
- **Radix UI** - Accessible UI components

## Core Architecture

### 1. Application Structure

```
├── app/                          # Next.js app directory
│   ├── api/turn_response/        # Responses API endpoint
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Main page component
├── components/                   # React components
│   ├── assistant.tsx            # Main assistant container
│   ├── chat.tsx                 # Chat interface
│   ├── tools-panel.tsx          # Tool configuration panel
│   └── ui/                      # Reusable UI components
├── lib/                         # Core logic
│   ├── assistant.ts             # Responses API integration
│   └── tools/                   # Tool handling logic
├── stores/                      # State management
│   ├── useConversationStore.ts  # Chat state
│   └── useToolsStore.ts         # Tool configuration state
└── config/                      # Configuration
    ├── constants.ts             # App constants
    ├── functions.ts             # Custom function definitions
    └── tools-list.ts            # Available tools list
```

### 2. OpenAI Responses API Integration

The heart of the application is the **Responses API** integration, which enables multi-turn conversations with tool calling capabilities.

#### Key Components:

**API Route (`app/api/turn_response/route.ts`)**
```typescript
// Creates streaming connection to OpenAI Responses API
const events = await openai.responses.create({
  model: MODEL,
  input: messages,
  tools,
  stream: true,
  parallel_tool_calls: false,
});
```

**Assistant Logic (`lib/assistant.ts`)**
- Handles real-time streaming from the Responses API
- Processes different event types (text deltas, tool calls, completions)
- Manages conversation state and tool execution
- Coordinates between UI updates and API responses

### 3. Event-Driven Architecture

The Responses API operates on an event-driven model with the following key events:

#### Message Events
- `response.output_text.delta` - Streaming text content
- `response.output_text.annotation.added` - File/web search annotations
- `response.output_item.added` - New conversation items
- `response.output_item.done` - Item completion

#### Tool Call Events
- `response.function_call_arguments.delta` - Streaming function arguments
- `response.function_call_arguments.done` - Complete function arguments
- `response.web_search_call.completed` - Web search results
- `response.file_search_call.completed` - File search results
- `response.code_interpreter_call_code.delta` - Streaming code execution
- `response.mcp_call_arguments.delta` - MCP tool streaming

#### Completion Events
- `response.completed` - Full response completion with metadata

### 4. Tool System

The application supports multiple tool types that extend the assistant's capabilities:

#### Built-in OpenAI Tools
1. **Web Search** - Internet search capabilities
2. **File Search** - Vector store knowledge base search
3. **Code Interpreter** - Python code execution in sandboxed environment

#### Custom Tools
1. **Functions** - Locally defined JavaScript functions
2. **MCP (Model Context Protocol)** - Remote tool servers

#### Tool Configuration (`lib/tools/tools.ts`)
```typescript
const getTools = () => {
  const tools = [];
  
  if (webSearchEnabled) {
    tools.push({ type: "web_search", user_location: {...} });
  }
  
  if (fileSearchEnabled) {
    tools.push({ 
      type: "file_search", 
      vector_store_ids: [vectorStore?.id] 
    });
  }
  
  if (codeInterpreterEnabled) {
    tools.push({ type: "code_interpreter", container: { type: "auto" } });
  }
  
  // Add custom functions and MCP tools...
  
  return tools;
};
```

### 5. State Management

The application uses Zustand for lightweight state management with two main stores:

#### Conversation Store (`stores/useConversationStore.ts`)
- `chatMessages` - UI-displayed conversation items
- `conversationItems` - API-sent conversation history
- `isAssistantLoading` - Loading state management

#### Tools Store (`stores/useToolsStore.ts`)
- Tool enable/disable states
- Configuration for each tool type
- Vector store management
- MCP server configuration

### 6. User Interface

#### Main Components

**Assistant Component (`components/assistant.tsx`)**
- Container for the chat interface
- Handles message sending and tool approval
- Coordinates between UI and processing logic

**Chat Component (`components/chat.tsx`)**
- Renders conversation messages and tool calls
- Manages input handling and auto-scrolling
- Supports different message types (text, tools, annotations)

**Tools Panel (`components/tools-panel.tsx`)**
- Configuration interface for all available tools
- Real-time tool enable/disable
- Tool-specific settings (web search location, vector stores, etc.)

### 7. Streaming and Real-time Updates

The application implements real-time streaming in several layers:

#### Server-Sent Events (SSE)
```typescript
// API route streams events to client
const stream = new ReadableStream({
  async start(controller) {
    for await (const event of events) {
      controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
    }
  }
});
```

#### Client-side Event Processing
```typescript
// Process streaming events and update UI
await handleTurn(allConversationItems, tools, async ({ event, data }) => {
  switch (event) {
    case "response.output_text.delta":
      // Update message content in real-time
      break;
    case "response.function_call_arguments.delta":
      // Show streaming tool arguments
      break;
    // Handle other events...
  }
});
```

### 8. Tool Execution Flow

#### Custom Functions
1. Function call detected in stream
2. Arguments parsed from streaming JSON
3. Local function executed via `handleTool()`
4. Result added to conversation
5. New turn initiated with function output

#### Built-in Tools (Web/File Search, Code Interpreter)
1. Tool call initiated by API
2. OpenAI handles execution server-side
3. Results streamed back via completion events
4. UI updated with tool outputs

#### MCP Tools
1. MCP server configured with URL and label
2. Tool calls routed to remote MCP server
3. Optional approval workflow for security
4. Results returned and displayed

### 9. Security and Approval

The application includes approval mechanisms for potentially sensitive operations:

- **MCP Tool Approval** - Optional user confirmation for MCP tool calls
- **Tool Restrictions** - Configurable allowed tools for MCP servers
- **Environment Isolation** - Code interpreter runs in sandboxed containers

### 10. Configuration

#### Model Configuration (`config/constants.ts`)
```typescript
export const MODEL = "gpt-4.1";
export const DEVELOPER_PROMPT = `...`; // System prompt
```

#### Tool Definitions (`config/functions.ts`, `config/tools-list.ts`)
- Custom function schemas
- Tool parameters and descriptions
- Validation and type definitions

## Key Features

### Multi-turn Conversations
- Maintains conversation context across multiple exchanges
- Supports complex reasoning with tool use
- Handles interruptions and clarifications

### Tool Integration
- Seamless integration of multiple tool types
- Real-time tool execution with streaming feedback
- Configurable tool availability

### Streaming Experience
- Real-time message display as content is generated
- Live tool execution progress
- Instant UI updates for better user experience

### Extensibility
- Plugin architecture for custom tools
- MCP protocol support for remote tools
- Configurable tool parameters and behaviors

## Data Flow

1. **User Input** → Conversation Store → Process Messages
2. **API Call** → OpenAI Responses API with tools configuration
3. **Streaming Response** → Event processing → UI updates
4. **Tool Calls** → Local/Remote execution → Results integration
5. **Completion** → Final state update → Ready for next turn

This architecture provides a robust foundation for building conversational AI applications with OpenAI's Responses API, offering both built-in capabilities and extensive customization options through the tool system.