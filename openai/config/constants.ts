export const MODEL = "gpt-4.1";

// NOTE: System prompt has been moved to lib/prompts/system-prompt.ts
// for easier editing and maintenance.

// Initial message that will be displayed in the chat
export const INITIAL_MESSAGE = `
Hi, how can I help you?
`;

export const defaultVectorStore = {
  id: "",
  name: "Example",
};
