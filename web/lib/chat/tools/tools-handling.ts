import { functionsMap } from "@/config/functions";

type ToolFunction = (params: any) => Promise<any>;
type ToolName = keyof typeof functionsMap;

export const handleTool = async (toolName: ToolName, parameters: any) => {
  console.log("Handle tool", toolName, parameters);
  
  // If functionsMap is empty or doesn't have the tool, throw an error
  const toolFunction = functionsMap[toolName] as ToolFunction | undefined;
  
  if (!toolFunction || typeof toolFunction !== 'function') {
    throw new Error(`Tool not implemented: ${toolName}`);
  }
  
  return await toolFunction(parameters);
};
