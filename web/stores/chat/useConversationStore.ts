import { create } from "zustand";
import { Item } from "@/lib/chat/assistant";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { INITIAL_MESSAGE } from "@/config/constants";

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
  // Loading state for assistant response
  loadingState: LoadingState;
  // Previous response ID for stored-responses flow (avoids rebuilding conversation history)
  previousResponseId: string | null;

  setChatMessages: (items: Item[]) => void;
  setConversationItems: (messages: any[]) => void;
  addChatMessage: (item: Item) => void;
  addConversationItem: (message: ChatCompletionMessageParam) => void;
  setLoadingState: (state: LoadingState) => void;
  setPreviousResponseId: (id: string | null) => void;
  clearConversation: () => void;
  rawSet: (state: any) => void;
}

const useConversationStore = create<ConversationState>((set) => ({
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
  setChatMessages: (items) => set({ chatMessages: items }),
  setConversationItems: (messages) => set({ conversationItems: messages }),
  addChatMessage: (item) =>
    set((state) => ({ chatMessages: [...state.chatMessages, item] })),
  addConversationItem: (message) =>
    set((state) => ({
      conversationItems: [...state.conversationItems, message],
    })),
  setLoadingState: (loadingState) => set({ loadingState }),
  setPreviousResponseId: (id) => set({ previousResponseId: id }),
  clearConversation: () =>
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
    }),
  rawSet: set,
}));

export default useConversationStore;
