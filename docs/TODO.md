# TODO

## Features
- Make the auto-pull league feature also automatically trigger the season pull feature as well.


## Bugs
- Webpack cache warning during `npm run build`: "Serializing big strings (181kiB) impacts deserialization performance". Likely from `react-syntax-highlighter` (Prism) in `web/components/chat/tool-call.tsx`. Consider lazy-loading or a lighter alternative if it becomes a problem.

