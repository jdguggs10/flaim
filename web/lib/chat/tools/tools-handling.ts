export const handleTool = async (toolName: string, parameters: any) => {
  console.log("Handle tool", toolName, parameters);
  throw new Error(`Tool not implemented: ${toolName}`);
};
