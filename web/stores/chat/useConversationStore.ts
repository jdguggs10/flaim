import { create } from "zustand";
import { Item } from "@/lib/chat/assistant";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { INITIAL_MESSAGE } from "@/config/constants";
import { LlmTraceEntry } from "@/lib/chat/trace-types";

export type LoadingStatus = "idle" | "connecting" | "thinking" | "responding";

export interface LoadingState {
  status: LoadingStatus;
  thinkingText: string;
}

interface ConversationState {
  // Items displayed in the chat
  chatMessages: Item[];
  // Items sent to the Responses API (only used for first turn before we have a response ID)
  conversationItems: any[];
  // LLM trace entries (bounded to last 50)
  traceEntries: LlmTraceEntry[];
  // Loading state for assistant response
  loadingState: LoadingState;
  // Previous response ID for stored-responses flow (avoids rebuilding conversation history)
  previousResponseId: string | null;

  setChatMessages: (items: Item[]) => void;
  setConversationItems: (messages: any[]) => void;
  addChatMessage: (item: Item) => void;
  addConversationItem: (message: ChatCompletionMessageParam) => void;
  addTraceEntry: (entry: LlmTraceEntry) => void;
  updateTraceEntry: (
    id: string,
    updater: (entry: LlmTraceEntry) => LlmTraceEntry,
  ) => void;
  setLoadingState: (state: LoadingState) => void;
  setPreviousResponseId: (id: string | null) => void;
  clearTraces: () => void;
  clearConversation: () => void;
  rawSet: (state: any) => void;
}

const useConversationStore = create<ConversationState>((set, get) => ({
  chatMessages: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: INITIAL_MESSAGE }],
    },
  ],
  conversationItems: [],
  traceEntries: [],
  loadingState: { status: "idle", thinkingText: "" },
  previousResponseId: null,
  setChatMessages: (items) => set({ chatMessages: items }),
  setConversationItems: (messages) => set({ conversationItems: messages }),
  addChatMessage: (item) =>
    set((state) => ({ chatMessages: [...state.chatMessages, item] })),
  addConversationItem: (message) =>
    set((state) => ({
      conversationItems: [...state.conversationItems, message],
    })),
  addTraceEntry: (entry) =>
    set((state) => {
      const nextEntries = [...state.traceEntries, entry];
      return { traceEntries: nextEntries.slice(-50) };
    }),
  updateTraceEntry: (id, updater) =>
    set((state) => {
      const entryIndex = state.traceEntries.findIndex((entry) => entry.id === id);
      if (entryIndex === -1) {
        return state;
      }

      const nextEntries = [...state.traceEntries];
      nextEntries[entryIndex] = updater(nextEntries[entryIndex]);
      return { traceEntries: nextEntries.slice(-50) };
    }),
  setLoadingState: (loadingState) => set({ loadingState }),
  setPreviousResponseId: (id) => set({ previousResponseId: id }),
  clearTraces: () => set({ traceEntries: [] }),
  clearConversation: () => {
    get().clearTraces();
    set({
      chatMessages: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: INITIAL_MESSAGE }],
        },
      ],
      conversationItems: [],
      loadingState: { status: "idle", thinkingText: "" },
      previousResponseId: null,
    });
  },
  rawSet: set,
}));

export default useConversationStore;
