// List of tools available to the assistant
// No need to include the top-level wrapper object as it is added in lib/tools/tools.ts
// More information on function calling: https://platform.openai.com/docs/guides/function-calling

interface Tool {
  name: string;
  parameters?: {
    [key: string]: {
      type: string;
      description?: string;
      enum?: string[];
      properties?: { [key: string]: string | unknown };
    };
  };
}

export const toolsList: Tool[] = [
  // Sport and platform selection is now handled via UI dropdowns
  // No function-based tools needed currently
];
