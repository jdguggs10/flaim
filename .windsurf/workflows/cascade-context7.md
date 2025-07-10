---
description: Prompt cascade to pull updated documentation before editing
---

Always retrieve updated documentation on the relevant technology beginning the task.

1. Think about the user's request 
2. Determine which aspect or aspects of the project this request applies to
3. Read @flaim/docs/dev/CONTEXT7_DOCUMENTATION_INDEX.md to determine what relavent documentation is available via context7
4. Tool call context7 mcp servers to pull the relevant documentation
5. Lastly, read the documentation that you retreived, and then proceed with the user's task